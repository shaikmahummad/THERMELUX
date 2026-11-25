from __future__ import annotations

from dataclasses import dataclass
from math import ceil

import numpy as np


@dataclass(frozen=True)
class Layer:
    name: str
    thickness_m: float
    conductivity_w_mk: float
    density_kg_m3: float = 2200.0
    specific_heat_j_kgk: float = 900.0


@dataclass(frozen=True)
class Wall:
    inner_temperature_c: float
    outer_temperature_c: float
    initial_temperature_c: float
    layers: tuple[Layer, ...]
    nodes: int = 121
    duration_s: float = 3600.0
    time_step_s: float = 60.0
    noise_std_c: float = 0.0
    sensor_positions_m: tuple[float, ...] = ()
    random_seed: int = 7

    @property
    def thickness_m(self) -> float:
        return sum(layer.thickness_m for layer in self.layers)


def _validate(wall: Wall) -> None:
    if not wall.layers:
        raise ValueError("At least one wall layer is required.")
    if any(layer.thickness_m <= 0 for layer in wall.layers):
        raise ValueError("Layer thicknesses must be greater than zero.")
    if any(layer.conductivity_w_mk <= 0 for layer in wall.layers):
        raise ValueError("Thermal conductivity must be greater than zero.")
    if any(layer.density_kg_m3 <= 0 or layer.specific_heat_j_kgk <= 0 for layer in wall.layers):
        raise ValueError("Density and specific heat capacity must be greater than zero.")
    if wall.nodes < 5 or wall.nodes > 2001:
        raise ValueError("Grid nodes must be between 5 and 2001.")
    if wall.duration_s <= 0 or wall.time_step_s <= 0:
        raise ValueError("Duration and time step must be greater than zero.")
    if wall.time_step_s < wall.duration_s / 10000:
        raise ValueError("Simulation exceeds the local compute budget; increase the time step or reduce the grid.")
    steps = ceil(wall.duration_s / wall.time_step_s)
    if steps > 10000 or steps * wall.nodes > 5_000_000:
        raise ValueError("Simulation exceeds the local compute budget; increase the time step or reduce the grid.")
    if wall.noise_std_c < 0:
        raise ValueError("Measurement noise cannot be negative.")
    if any(position < 0 or position > wall.thickness_m for position in wall.sensor_positions_m):
        raise ValueError("Sensor positions must lie within the wall.")
    if len(set(wall.sensor_positions_m)) != len(wall.sensor_positions_m):
        raise ValueError("Virtual sensor positions must be unique.")


def thermal_resistance(layers: tuple[Layer, ...]) -> float:
    if not layers or any(layer.thickness_m <= 0 or layer.conductivity_w_mk <= 0 for layer in layers):
        raise ValueError("Layers need positive thickness and conductivity.")
    return sum(layer.thickness_m / layer.conductivity_w_mk for layer in layers)


def _transient_cells(wall: Wall) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    layer_counts = np.maximum(
        1,
        np.rint(wall.nodes * np.array([layer.thickness_m for layer in wall.layers]) / wall.thickness_m).astype(int),
    )
    while int(layer_counts.sum()) > wall.nodes:
        largest = int(np.argmax(layer_counts))
        if layer_counts[largest] <= 1:
            break
        layer_counts[largest] -= 1
    while int(layer_counts.sum()) < wall.nodes:
        largest = int(np.argmax(np.array([layer.thickness_m for layer in wall.layers]) / layer_counts))
        layer_counts[largest] += 1

    widths: list[float] = []
    conductivity: list[float] = []
    density: list[float] = []
    capacity: list[float] = []
    centers: list[float] = []
    edge = 0.0
    for layer, count in zip(wall.layers, layer_counts):
        width = layer.thickness_m / int(count)
        for _ in range(int(count)):
            centers.append(edge + width / 2.0)
            widths.append(width)
            conductivity.append(layer.conductivity_w_mk)
            density.append(layer.density_kg_m3)
            capacity.append(layer.density_kg_m3 * layer.specific_heat_j_kgk)
            edge += width
    return (
        np.asarray(centers),
        np.asarray(widths),
        np.asarray(conductivity),
        np.asarray(density),
        np.asarray(capacity),
    )


def _face_conductances(widths: np.ndarray, conductivity: np.ndarray) -> np.ndarray:
    count = len(widths)
    conductance = np.empty(count + 1)
    conductance[0] = 2.0 * conductivity[0] / widths[0]
    conductance[-1] = 2.0 * conductivity[-1] / widths[-1]
    if count > 1:
        conductance[1:-1] = 1.0 / (
            widths[:-1] / (2.0 * conductivity[:-1]) + widths[1:] / (2.0 * conductivity[1:])
        )
    return conductance


def _run_steady(wall: Wall) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    centers, widths, conductivity, _, _ = _transient_cells(wall)
    count = len(centers)
    conductance = _face_conductances(widths, conductivity)
    diagonal = conductance[:-1] + conductance[1:]
    off_diagonal = -conductance[1:-1]
    rhs = np.zeros(count)
    rhs[0] += conductance[0] * wall.inner_temperature_c
    rhs[-1] += conductance[-1] * wall.outer_temperature_c
    cell_temperature = _solve_tridiagonal(off_diagonal, diagonal, off_diagonal, rhs)
    face_flux = np.concatenate(
        (
            [conductance[0] * (wall.inner_temperature_c - cell_temperature[0])],
            conductance[1:-1] * (cell_temperature[:-1] - cell_temperature[1:]),
            [conductance[-1] * (cell_temperature[-1] - wall.outer_temperature_c)],
        )
    )

    cell_edges = np.concatenate(([0.0], np.cumsum(widths)))
    interface_positions = np.cumsum([layer.thickness_m for layer in wall.layers])[:-1]
    positions = np.unique(np.concatenate(([0.0], centers, interface_positions, [wall.thickness_m])))
    temperatures = np.empty_like(positions)
    for index, position in enumerate(positions):
        if position <= 0:
            temperatures[index] = wall.inner_temperature_c
        elif position >= wall.thickness_m:
            temperatures[index] = wall.outer_temperature_c
        else:
            cell_index = min(int(np.searchsorted(cell_edges, position, side="right") - 1), count - 1)
            temperatures[index] = cell_temperature[cell_index] - (
                face_flux[cell_index] * (position - centers[cell_index]) / conductivity[cell_index]
            )
    return positions, temperatures, face_flux, cell_edges


def _run_transient(wall: Wall) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict]:
    centers, widths, conductivity, _, volumetric_capacity = _transient_cells(wall)
    count = len(centers)
    conductance = _face_conductances(widths, conductivity)

    steps = max(1, int(np.ceil(wall.duration_s / wall.time_step_s)))
    dt = wall.duration_s / steps
    temperature = np.full(count, wall.initial_temperature_c, dtype=float)
    snapshots = [temperature.copy()]
    times = [0.0]
    snapshot_every = max(1, steps // 100)
    areal_capacity = volumetric_capacity * widths
    initial_stored_energy = float(np.dot(areal_capacity, temperature))
    integrated_net_heat = 0.0

    diagonal = volumetric_capacity * widths / dt
    matrix_diagonal = diagonal.copy()
    matrix_diagonal += conductance[:-1] + conductance[1:]
    lower = -conductance[1:-1].copy()
    upper = -conductance[1:-1].copy()

    for step in range(1, steps + 1):
        rhs = diagonal * temperature
        rhs[0] += conductance[0] * wall.inner_temperature_c
        rhs[-1] += conductance[-1] * wall.outer_temperature_c
        temperature = _solve_tridiagonal(lower, matrix_diagonal, upper, rhs)
        heat_in = conductance[0] * (wall.inner_temperature_c - temperature[0])
        heat_out = conductance[-1] * (temperature[-1] - wall.outer_temperature_c)
        integrated_net_heat += (heat_in - heat_out) * dt
        if step % snapshot_every == 0 or step == steps:
            snapshots.append(temperature.copy())
            times.append(step * dt)
    edges = np.concatenate(([0.0], np.cumsum(widths)))
    stored_energy_change = float(np.dot(areal_capacity, temperature) - initial_stored_energy)
    energy_balance = {
        "stored_energy_change_j_m2": stored_energy_change,
        "net_boundary_heat_j_m2": integrated_net_heat,
        "relative_error_percent": float(
            abs(stored_energy_change - integrated_net_heat)
            / max(abs(stored_energy_change), abs(integrated_net_heat), 1e-12)
            * 100.0
        ),
    }
    return centers, np.asarray(times), np.asarray(snapshots), conductance, edges, energy_balance


def _solve_tridiagonal(lower: np.ndarray, diagonal: np.ndarray, upper: np.ndarray, rhs: np.ndarray) -> np.ndarray:
    d = diagonal.copy()
    b = rhs.copy()
    u = upper.copy()
    for index in range(1, len(d)):
        factor = lower[index - 1] / d[index - 1]
        d[index] -= factor * u[index - 1]
        b[index] -= factor * b[index - 1]
    result = np.empty_like(b)
    result[-1] = b[-1] / d[-1]
    for index in range(len(d) - 2, -1, -1):
        result[index] = (b[index] - u[index] * result[index + 1]) / d[index]
    return result


def _conductivity_at(wall: Wall, position: float) -> float:
    edge = 0.0
    for layer in wall.layers:
        edge += layer.thickness_m
        if position <= edge:
            return layer.conductivity_w_mk
    return wall.layers[-1].conductivity_w_mk


def _resistance_between(wall: Wall, start: float, end: float) -> float:
    resistance = 0.0
    layer_start = 0.0
    for layer in wall.layers:
        layer_end = layer_start + layer.thickness_m
        overlap = max(0.0, min(end, layer_end) - max(start, layer_start))
        resistance += overlap / layer.conductivity_w_mk
        layer_start = layer_end
    return resistance


def _layerwise_gradient_flux(wall: Wall, positions: np.ndarray, temperatures: np.ndarray) -> np.ndarray:
    flux = np.empty_like(positions)
    layer_start = 0.0
    for layer in wall.layers:
        layer_end = layer_start + layer.thickness_m
        indices = np.flatnonzero((positions >= layer_start - 1e-12) & (positions <= layer_end + 1e-12))
        if len(indices) >= 2:
            local_gradient = np.gradient(temperatures[indices], positions[indices])
            flux[indices] = -layer.conductivity_w_mk * local_gradient
        layer_start = layer_end
    return flux


def run_simulation(wall: Wall, mode: str = "steady") -> dict:
    _validate(wall)
    if mode not in {"steady", "transient"}:
        raise ValueError("Mode must be 'steady' or 'transient'.")

    reference_flux = (wall.inner_temperature_c - wall.outer_temperature_c) / thermal_resistance(wall.layers)
    if mode == "steady":
        positions, temperatures, flux, flux_positions = _run_steady(wall)
        times = np.array([0.0])
        history = temperatures[np.newaxis, :]
        energy_balance = None
    else:
        centers, times, cell_history, conductance, flux_positions, energy_balance = _run_transient(wall)
        interface_positions = np.cumsum([layer.thickness_m for layer in wall.layers])[:-1]
        positions = np.unique(np.concatenate(([0.0], centers, interface_positions, [wall.thickness_m])))
        history_rows = []
        for cell_temperatures in cell_history:
            interface_temperatures = []
            for position in interface_positions:
                face = int(np.argmin(np.abs(flux_positions - position)))
                left_cell = face - 1
                interface_flux = conductance[face] * (cell_temperatures[left_cell] - cell_temperatures[face])
                interface_temperatures.append(
                    cell_temperatures[left_cell]
                    - interface_flux * (position - centers[left_cell]) / _conductivity_at(wall, position - 1e-12)
                )
            sample_positions = np.concatenate(([0.0], centers, interface_positions, [wall.thickness_m]))
            sample_temperatures = np.concatenate(
                (
                    [wall.inner_temperature_c],
                    cell_temperatures,
                    interface_temperatures,
                    [wall.outer_temperature_c],
                )
            )
            order = np.argsort(sample_positions)
            history_rows.append(np.interp(positions, sample_positions[order], sample_temperatures[order]))
        history = np.asarray(history_rows)
        temperatures = history[-1]
        flux = np.concatenate(
            (
                [conductance[0] * (wall.inner_temperature_c - cell_history[-1, 0])],
                conductance[1:-1] * (cell_history[-1, :-1] - cell_history[-1, 1:]),
                [conductance[-1] * (cell_history[-1, -1] - wall.outer_temperature_c)],
            )
        )

    gradient_flux = _layerwise_gradient_flux(wall, positions, temperatures)
    gradient_integral = np.sum((gradient_flux[1:] + gradient_flux[:-1]) * np.diff(positions) / 2.0)
    gradient_average = float(gradient_integral / wall.thickness_m)
    sensor_positions = wall.sensor_positions_m or tuple(
        np.linspace(wall.thickness_m * 0.15, wall.thickness_m * 0.85, 4)
    )
    rng = np.random.default_rng(wall.random_seed)
    sensors = []
    for index, position in enumerate(sensor_positions, start=1):
        ideal = float(np.interp(position, positions, temperatures))
        measured = ideal + float(rng.normal(0.0, wall.noise_std_c)) if wall.noise_std_c else ideal
        sensors.append(
            {
                "id": f"T{index:02d}",
                "position_m": float(position),
                "temperature_c": ideal,
                "measured_temperature_c": measured,
                "noise_c": measured - ideal,
                "temperature_history_c": [
                    float(np.interp(position, positions, history_row)) for history_row in history
                ],
            }
        )
    ordered_sensors = sorted(sensors, key=lambda sensor: sensor["position_m"])
    sensor_interval_flux = []
    for left, right in zip(ordered_sensors, ordered_sensors[1:]):
        resistance = _resistance_between(wall, left["position_m"], right["position_m"])
        sensor_interval_flux.append(
            {
                "start_m": left["position_m"],
                "end_m": right["position_m"],
                "ideal_heat_flux_w_m2": -(
                    right["temperature_c"] - left["temperature_c"]
                ) / resistance,
                "measured_heat_flux_w_m2": -(
                    right["measured_temperature_c"] - left["measured_temperature_c"]
                ) / resistance,
            }
        )

    interface_positions = np.cumsum([layer.thickness_m for layer in wall.layers])[:-1]
    interfaces = [
        {
            "position_m": float(position),
            "temperature_c": float(np.interp(position, positions, temperatures)),
        }
        for position in interface_positions
    ]
    layer_results = []
    prior = 0.0
    for layer in wall.layers:
        end = prior + layer.thickness_m
        layer_results.append(
            {
                "name": layer.name,
                "thickness_m": layer.thickness_m,
                "conductivity_w_mk": layer.conductivity_w_mk,
                "temperature_drop_c": float(
                    np.interp(prior, positions, temperatures) - np.interp(end, positions, temperatures)
                ),
            }
        )
        prior = end

    return {
        "mode": mode,
        "positions_m": positions.tolist(),
        "temperatures_c": temperatures.tolist(),
        "temperature_history_c": history.tolist(),
        "times_s": times.tolist(),
        "heat_flux_w_m2": flux.tolist(),
        "heat_flux_positions_m": flux_positions.tolist(),
        "gradient_heat_flux_w_m2": gradient_flux.tolist(),
        "reference_heat_flux_w_m2": float(reference_flux),
        "average_heat_flux_w_m2": float(np.mean(flux)),
        "maximum_heat_flux_w_m2": float(np.max(flux)),
        "minimum_heat_flux_w_m2": float(np.min(flux)),
        "relative_error_percent": float(abs(gradient_average - reference_flux) / max(abs(reference_flux), 1e-12) * 100.0),
        "total_thickness_m": wall.thickness_m,
        "sensor_measurements": sensors,
        "sensor_interval_heat_flux_w_m2": sensor_interval_flux,
        "interfaces": interfaces,
        "layers": layer_results,
        "grid_nodes": len(positions),
        "final_time_s": float(times[-1]),
        "energy_balance": energy_balance,
    }


def validate_steady_state(wall: Wall, resolutions: tuple[int, ...] = (21, 41, 81, 161)) -> dict:
    _validate(wall)
    reference = (wall.inner_temperature_c - wall.outer_temperature_c) / thermal_resistance(wall.layers)
    results = []
    for nodes in resolutions:
        candidate = Wall(
            inner_temperature_c=wall.inner_temperature_c,
            outer_temperature_c=wall.outer_temperature_c,
            initial_temperature_c=wall.initial_temperature_c,
            layers=wall.layers,
            nodes=nodes,
        )
        result = run_simulation(candidate, "steady")
        error = abs(result["average_heat_flux_w_m2"] - reference) / max(abs(reference), 1e-12) * 100.0
        results.append(
            {
                "grid_nodes": nodes,
                "heat_flux_w_m2": result["average_heat_flux_w_m2"],
                "relative_error_percent": error,
                "passed": error < 1e-8,
            }
        )
    return {
        "reference_heat_flux_w_m2": reference,
        "results": results,
        "passed": all(item["passed"] for item in results),
        "tolerance_percent": 1e-8,
    }
