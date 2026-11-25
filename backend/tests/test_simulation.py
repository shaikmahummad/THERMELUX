import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.simulation.solver import Layer, Wall, run_simulation, thermal_resistance, validate_steady_state


@pytest.fixture
def wall():
    return Wall(
        inner_temperature_c=1000,
        outer_temperature_c=100,
        initial_temperature_c=20,
        layers=(
            Layer("Firebrick", 0.12, 1.2),
            Layer("Ceramic fiber", 0.08, 0.16, 160, 1050),
        ),
        nodes=101,
        sensor_positions_m=(0.04, 0.1, 0.16),
    )


def test_thermal_resistance_and_analytic_fourier_law(wall):
    assert thermal_resistance(wall.layers) == pytest.approx(0.6)
    result = run_simulation(wall)
    assert result["reference_heat_flux_w_m2"] == pytest.approx(1500)
    assert result["average_heat_flux_w_m2"] == pytest.approx(1500)
    assert result["temperatures_c"][0] == pytest.approx(1000)
    assert result["temperatures_c"][-1] == pytest.approx(100)


def test_steady_finite_volume_heat_flux_is_continuous_across_interfaces(wall):
    result = run_simulation(wall)
    assert max(result["heat_flux_w_m2"]) - min(result["heat_flux_w_m2"]) < 1e-8
    assert len(result["interfaces"]) == 1


def test_temperature_drop_is_proportional_to_layer_resistance(wall):
    result = run_simulation(wall)
    drops = [item["temperature_drop_c"] for item in result["layers"]]
    assert sum(drops) == pytest.approx(900)
    assert drops[1] > drops[0]


def test_transient_solver_is_bounded_and_moves_toward_boundaries(wall):
    transient = Wall(**{**wall.__dict__, "duration_s": 600, "time_step_s": 100})
    result = run_simulation(transient, "transient")
    initial = result["temperature_history_c"][0]
    final = result["temperature_history_c"][-1]
    assert len(result["times_s"]) == 7
    assert final[1] > initial[1]
    assert final[-2] > initial[-2]
    assert min(final) >= 20
    assert max(final) <= 1000
    assert result["energy_balance"]["relative_error_percent"] < 1e-8


def test_deterministic_virtual_measurement_noise(wall):
    noisy = Wall(**{**wall.__dict__, "noise_std_c": 0.5})
    one = run_simulation(noisy)
    two = run_simulation(noisy)
    assert one["sensor_measurements"] == two["sensor_measurements"]
    assert any(sensor["noise_c"] != 0 for sensor in one["sensor_measurements"])
    estimates = one["sensor_interval_heat_flux_w_m2"]
    assert len(estimates) == len(one["sensor_measurements"]) - 1
    assert all(item["ideal_heat_flux_w_m2"] == pytest.approx(1500) for item in estimates)
    assert any(item["measured_heat_flux_w_m2"] != pytest.approx(1500) for item in estimates)


def test_steady_validation_passes_and_resolution_is_reported(wall):
    report = validate_steady_state(wall, (21, 41))
    assert report["passed"] is True
    assert [item["grid_nodes"] for item in report["results"]] == [21, 41]


def test_invalid_layer_is_rejected(wall):
    invalid = Wall(**{**wall.__dict__, "layers": (Layer("bad", 0.1, 0),)})
    with pytest.raises(ValueError, match="conductivity"):
        run_simulation(invalid)


def test_api_health_and_run():
    with TestClient(app) as client:
        assert client.get("/api/health").json()["status"] == "ok"
        response = client.post(
            "/api/simulations/run",
            json={
                "layers": [{"name": "Brick", "thickness_m": 0.2, "conductivity_w_mk": 1.0}],
                "nodes": 21,
            },
        )
        assert response.status_code == 200
        assert response.json()["result"]["reference_heat_flux_w_m2"] == pytest.approx(4500)


def test_api_estimates_flux_from_virtual_sensor_pairs():
    with TestClient(app) as client:
        response = client.post(
            "/api/simulations/estimate-heat-flux",
            json={
                "layers": [
                    {"name": "Brick", "thickness_m": 0.1, "conductivity_w_mk": 1.0},
                    {"name": "Fiber", "thickness_m": 0.1, "conductivity_w_mk": 0.1},
                ],
                "nodes": 41,
            },
        )
        assert response.status_code == 200
        estimates = response.json()["sensor_interval_heat_flux_w_m2"]
        assert len(estimates) == 3
        assert all(item["ideal_heat_flux_w_m2"] == pytest.approx(818.181818, rel=1e-6) for item in estimates)


def test_api_validation_reports_transient_energy_balance():
    with TestClient(app) as client:
        response = client.post(
            "/api/simulations/validate",
            json={
                "layers": [{"name": "Brick", "thickness_m": 0.2, "conductivity_w_mk": 1.0}],
                "nodes": 21,
                "duration_s": 100,
                "time_step_s": 10,
            },
        )
        assert response.status_code == 200
        energy_balance = response.json()["energy_balance"]
        assert energy_balance["passed"] is True
        assert energy_balance["relative_error_percent"] < 1e-8


def test_api_rejects_sensor_outside_wall():
    with TestClient(app) as client:
        response = client.post(
            "/api/simulations/run",
            json={
                "layers": [{"name": "Brick", "thickness_m": 0.2, "conductivity_w_mk": 1.0}],
                "sensor_positions_m": [0.3],
            },
        )
        assert response.status_code == 422


def test_api_save_load_delete_and_pdf_report():
    payload = {
        "layers": [{"name": "Brick", "thickness_m": 0.2, "conductivity_w_mk": 1.0}],
        "nodes": 21,
    }
    with TestClient(app) as client:
        created = client.post("/api/simulations/save", json=payload)
        assert created.status_code == 200
        simulation_id = created.json()["id"]
        loaded = client.get(f"/api/simulations/{simulation_id}")
        assert loaded.status_code == 200
        assert loaded.json()["result"]["reference_heat_flux_w_m2"] == pytest.approx(4500)
        listed = client.get("/api/simulations")
        assert simulation_id in [item["id"] for item in listed.json()]
        pdf = client.post("/api/reports/pdf", json=payload)
        assert pdf.status_code == 200
        assert pdf.headers["content-type"] == "application/pdf"
        assert pdf.content.startswith(b"%PDF")
        assert client.delete(f"/api/simulations/{simulation_id}").status_code == 204


def test_sensor_positions_must_be_unique(wall):
    duplicate = Wall(**{**wall.__dict__, "sensor_positions_m": (0.1, 0.1)})
    with pytest.raises(ValueError, match="unique"):
        run_simulation(duplicate)
