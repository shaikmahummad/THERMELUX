from __future__ import annotations

import json
import io
import math
import sqlite3
import uuid
from contextlib import asynccontextmanager
from contextlib import closing
from pathlib import Path
from typing import Literal

from fastapi import Body, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.simulation.solver import Layer, Wall, run_simulation, validate_steady_state


ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "data" / "thermalux.sqlite3"


class LayerInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    thickness_m: float = Field(gt=0, le=2)
    conductivity_w_mk: float = Field(gt=0, le=500)
    density_kg_m3: float = Field(default=2200, gt=0, le=30000)
    specific_heat_j_kgk: float = Field(default=900, gt=0, le=10000)


class SimulationRequest(BaseModel):
    inner_temperature_c: float = Field(default=1000, ge=-273.15, le=3000)
    outer_temperature_c: float = Field(default=100, ge=-273.15, le=2000)
    initial_temperature_c: float = Field(default=20, ge=-273.15, le=2000)
    layers: list[LayerInput] = Field(min_length=1, max_length=12)
    nodes: int = Field(default=121, ge=5, le=2001)
    duration_s: float = Field(default=3600, gt=0, le=604800)
    time_step_s: float = Field(default=60, gt=0, le=86400)
    mode: Literal["steady", "transient"] = "steady"
    noise_std_c: float = Field(default=0, ge=0, le=100)
    sensor_positions_m: list[float] = Field(default_factory=list)
    random_seed: int = 7

    @model_validator(mode="after")
    def validate_sensors_and_time(self):
        thickness = sum(layer.thickness_m for layer in self.layers)
        if any(position < 0 or position > thickness for position in self.sensor_positions_m):
            raise ValueError("Sensor positions must lie within the configured wall.")
        if len(set(self.sensor_positions_m)) != len(self.sensor_positions_m):
            raise ValueError("Virtual sensor positions must be unique.")
        if self.time_step_s < self.duration_s / 10000:
            raise ValueError("Simulation exceeds the local compute budget; increase the time step or reduce the grid.")
        steps = math.ceil(self.duration_s / self.time_step_s)
        if steps > 10000 or steps * self.nodes > 5_000_000:
            raise ValueError("Simulation exceeds the local compute budget; increase the time step or reduce the grid.")
        return self

    def to_wall(self) -> Wall:
        return Wall(
            inner_temperature_c=self.inner_temperature_c,
            outer_temperature_c=self.outer_temperature_c,
            initial_temperature_c=self.initial_temperature_c,
            layers=tuple(Layer(**layer.model_dump()) for layer in self.layers),
            nodes=self.nodes,
            duration_s=self.duration_s,
            time_step_s=self.time_step_s,
            noise_std_c=self.noise_std_c,
            sensor_positions_m=tuple(self.sensor_positions_m),
            random_seed=self.random_seed,
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    with closing(_connection()) as connection:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS simulations (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                config_json TEXT NOT NULL,
                result_json TEXT NOT NULL
            )"""
        )
        connection.commit()
    yield


app = FastAPI(title="THERMALUX API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "THERMALUX"}


@app.post("/api/simulations/run")
def simulate(request: SimulationRequest):
    try:
        result = run_simulation(request.to_wall(), request.mode)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {"id": None, "config": request.model_dump(), "result": result}


@app.post("/api/simulations/steady-state")
def simulate_steady_state(request: SimulationRequest):
    return simulate(request.model_copy(update={"mode": "steady"}))


@app.post("/api/simulations/transient")
def simulate_transient(request: SimulationRequest):
    return simulate(request.model_copy(update={"mode": "transient"}))


@app.post("/api/simulations/estimate-heat-flux")
def estimate_heat_flux(request: SimulationRequest):
    response = simulate(request)
    return {
        "reference_heat_flux_w_m2": response["result"]["reference_heat_flux_w_m2"],
        "sensor_interval_heat_flux_w_m2": response["result"]["sensor_interval_heat_flux_w_m2"],
        "gradient_heat_flux_w_m2": response["result"]["gradient_heat_flux_w_m2"],
    }


@app.post("/api/simulations/validate")
def validate(request: SimulationRequest):
    try:
        wall = request.to_wall()
        result = validate_steady_state(wall)
        transient = run_simulation(wall, "transient")
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    energy_balance = transient["energy_balance"]
    energy_balance["tolerance_percent"] = 1e-8
    energy_balance["passed"] = energy_balance["relative_error_percent"] < energy_balance["tolerance_percent"]
    result["energy_balance"] = energy_balance
    result["passed"] = result["passed"] and energy_balance["passed"]
    return result


@app.post("/api/simulations/compare")
def compare(requests: list[SimulationRequest] = Body(min_length=2, max_length=4)):
    comparisons = []
    for request in requests:
        try:
            result = run_simulation(request.to_wall(), request.mode)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        comparisons.append({"config": request.model_dump(), "result": result})
    return {"scenarios": comparisons}


@app.post("/api/simulations/save")
def save_simulation(request: SimulationRequest):
    try:
        result = run_simulation(request.to_wall(), request.mode)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    simulation_id = str(uuid.uuid4())
    with closing(_connection()) as connection:
        connection.execute(
            "INSERT INTO simulations (id, config_json, result_json) VALUES (?, ?, ?)",
            (simulation_id, request.model_dump_json(), json.dumps(result)),
        )
        connection.commit()
    return {"id": simulation_id, "config": request.model_dump(), "result": result}


@app.get("/api/simulations")
def list_simulations():
    with closing(_connection()) as connection:
        rows = connection.execute(
            "SELECT id, created_at, config_json, result_json FROM simulations ORDER BY created_at DESC"
        ).fetchall()
    return [
        {
            "id": row["id"],
            "created_at": row["created_at"],
            "config": json.loads(row["config_json"]),
            "result": json.loads(row["result_json"]),
        }
        for row in rows
    ]


@app.get("/api/simulations/{simulation_id}")
def get_simulation(simulation_id: str):
    with closing(_connection()) as connection:
        row = connection.execute(
            "SELECT id, created_at, config_json, result_json FROM simulations WHERE id = ?",
            (simulation_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Simulation was not found.")
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "config": json.loads(row["config_json"]),
        "result": json.loads(row["result_json"]),
    }


@app.delete("/api/simulations/{simulation_id}", status_code=204)
def delete_simulation(simulation_id: str):
    with closing(_connection()) as connection:
        cursor = connection.execute("DELETE FROM simulations WHERE id = ?", (simulation_id,))
        connection.commit()
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="Simulation was not found.")
    return Response(status_code=204)


@app.get("/api/materials")
def materials():
    return [
        {"name": "Dense fireclay brick", "conductivity_w_mk": 1.4, "density_kg_m3": 2100, "specific_heat_j_kgk": 1000, "range_c": "Up to 1300", "source_note": "Representative illustrative value"},
        {"name": "Insulating firebrick", "conductivity_w_mk": 0.45, "density_kg_m3": 900, "specific_heat_j_kgk": 1000, "range_c": "Up to 1200", "source_note": "Representative illustrative value"},
        {"name": "Ceramic fiber insulation", "conductivity_w_mk": 0.16, "density_kg_m3": 160, "specific_heat_j_kgk": 1050, "range_c": "Up to 1200", "source_note": "Representative illustrative value"},
        {"name": "Calcium silicate board", "conductivity_w_mk": 0.09, "density_kg_m3": 250, "specific_heat_j_kgk": 900, "range_c": "Up to 1000", "source_note": "Representative illustrative value"},
    ]


@app.post("/api/reports/pdf")
def create_pdf_report(request: SimulationRequest):
    try:
        wall = request.to_wall()
        result = run_simulation(wall, request.mode)
        steady_validation = validate_steady_state(wall, (21, 41, 81))
        transient_result = result if result["energy_balance"] is not None else run_simulation(wall, "transient")
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    energy_balance = transient_result["energy_balance"]

    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=letter, title="THERMALUX Simulation Report")
    styles = getSampleStyleSheet()
    story = [
        Paragraph("THERMALUX · Furnace wall simulation report", styles["Title"]),
        Paragraph("Heat Flux Estimation from Measured Temperature Gradients in a Furnace Wall Using Numerical Simulation", styles["Normal"]),
        Spacer(1, 12),
        Paragraph(f"Simulation ID: {uuid.uuid4()}", styles["Normal"]),
        Paragraph(f"Mode: {request.mode} · Grid: {request.nodes} cells · Generated locally", styles["Normal"]),
        Spacer(1, 12),
        Paragraph("Configuration and results", styles["Heading2"]),
    ]
    summary = [
        ["Quantity", "Value"],
        ["Hot-side surface temperature", f"{request.inner_temperature_c:.3f} °C"],
        ["Cold-side surface temperature", f"{request.outer_temperature_c:.3f} °C"],
        ["Total wall thickness", f"{result['total_thickness_m']:.5f} m"],
        ["Analytical reference heat flux", f"{result['reference_heat_flux_w_m2']:.5f} W/m²"],
        ["Numerical/estimated average heat flux", f"{result['average_heat_flux_w_m2']:.5f} W/m²"],
        ["Relative error vs reference", f"{result['relative_error_percent']:.6f}%"],
    ]
    table = Table(summary, colWidths=[280, 220])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#28323d")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#b8c0c8")),
        ("PADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(table)
    story.extend([Spacer(1, 12), Paragraph("Wall layers", styles["Heading2"])])
    layer_rows = [["Layer", "Thickness (m)", "k (W/m·K)", "ΔT (°C)"]]
    layer_rows.extend(
        [layer["name"], f"{layer['thickness_m']:.5f}", f"{layer['conductivity_w_mk']:.5f}", f"{layer['temperature_drop_c']:.3f}"]
        for layer in result["layers"]
    )
    layer_table = Table(layer_rows, colWidths=[210, 90, 90, 90])
    layer_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#28323d")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#b8c0c8")),
        ("PADDING", (0, 0), (-1, -1), 5),
    ]))
    story.extend([layer_table, Spacer(1, 12), Paragraph("Mathematical model", styles["Heading2"])])
    story.append(Paragraph(
        "One-dimensional conduction: ρ cp ∂T/∂t = ∂/∂x(k ∂T/∂x). Steady heat flux is calculated from "
        "series thermal resistance, q″ = (T_hot − T_cold) / Σ(L_i/k_i). Transient cases use an implicit "
        "backward-Euler finite-volume discretization with harmonic interface conductances and fixed surface temperatures.",
        styles["BodyText"],
    ))
    story.extend([Spacer(1, 8), Paragraph("Assumptions and limitations", styles["Heading2"])])
    story.append(Paragraph(
        "Material properties are constant representative values. The model is one-dimensional and does not include "
        "radiation, contact resistance, lateral heat loss, or convection boundary conditions. Sensor readings in this "
        "application are virtual values generated from the numerical model, not physical thermocouple measurements. "
        "This software is a computational demonstration and has not been experimentally validated; results are not "
        "a substitute for qualified engineering review.",
        styles["BodyText"],
    ))
    story.extend([Spacer(1, 8), Paragraph("Numerical validation", styles["Heading2"])])
    story.append(Paragraph(
        f"Analytical steady-state check: {'PASS' if steady_validation['passed'] else 'FAIL'} "
        f"(maximum grid error {max(item['relative_error_percent'] for item in steady_validation['results']):.8g}%). "
        f"Transient energy balance: {'PASS' if energy_balance['relative_error_percent'] < 1e-8 else 'FAIL'} "
        f"(relative balance error {energy_balance['relative_error_percent']:.8g}%).",
        styles["BodyText"],
    ))
    story.extend([Spacer(1, 8), Paragraph("Temperature profile sample", styles["Heading2"])])
    profile_rows = [["Depth (m)", "Temperature (°C)", "Gradient heat flux (W/m²)"]]
    stride = max(1, len(result["positions_m"]) // 24)
    for index in range(0, len(result["positions_m"]), stride):
        profile_rows.append([
            f"{result['positions_m'][index]:.5f}",
            f"{result['temperatures_c'][index]:.3f}",
            f"{result['gradient_heat_flux_w_m2'][index]:.3f}",
        ])
    profile = Table(profile_rows, colWidths=[150, 170, 170], repeatRows=1)
    profile.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#28323d")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#b8c0c8")),
        ("PADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(profile)
    document.build(story)
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="thermalux-simulation-report.pdf"'},
    )
