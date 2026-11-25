# THERMALUX

THERMALUX is a local furnace-wall heat-transfer simulation and analysis application. It computes a one-dimensional temperature field across a multi-layer wall, compares heat flux with an analytical thermal-resistance reference, and generates reproducible virtual sensor values. All sensor data is simulated; the software does not connect to physical equipment.

## Run on Windows

Install Python 3.10+ and Node.js 20+. From this directory, launch `start.bat`. It creates a backend virtual environment, installs dependencies, starts the FastAPI and Vite development servers in separate terminals, and opens the frontend.

Manual startup:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn app.main:app --app-dir . --reload
```

In another terminal:

```powershell
cd frontend
npm install
npm run dev
```

- Web application: http://localhost:5173
- API and interactive docs: http://localhost:8000/docs
- Health check: http://localhost:8000/api/health

The SQLite database is created at `data/thermalux.sqlite3`.

## Numerical model

The model solves one-dimensional conduction,

`ρ cp ∂T/∂t = ∂/∂x(k ∂T/∂x)`,

with constant, piecewise material properties and fixed inner/outer surface temperatures. The steady solution uses the series resistance `R = Σ(Lᵢ/kᵢ)` and `q″ = (T_hot − T_cold)/R`. The transient solver uses a backward-Euler finite-volume discretization with cell-centered temperatures, heat-capacity storage, and harmonic face conductances to preserve interface heat flow. Its time step is implicit and stable for the configured positive time steps.

The gradient estimate is evaluated from the solved profile using `q″ = −k dT/dx`; the analytical reference and numerical/gradient estimates are shown separately. Virtual sensor noise is generated from a configured seed and is repeatable. Temperature units are Celsius; conductivity and temperature differences use SI units.

## Validation and limitations

The validation endpoint checks steady-state flux against the exact series-resistance reference at multiple grid resolutions and reports transient stored-energy versus net-boundary-heat balance. It does not claim independent experimental validation. The current model is one-dimensional; it omits radiation, contact resistance, lateral heat flow, and convection boundaries. Material-library data are representative illustrative values, not manufacturer specifications. Transient grid-convergence studies, interactive transient heatmaps, user-authored material persistence, and report figures are not yet implemented. Solver jobs are synchronous but bounded by a local compute budget; pause, cancellation, and live progress are not available. Do not treat outputs as engineering design certification.

## Features

- React/TypeScript application with workspace, overview, temperature and heat-flux analysis, materials, scenario comparison, validation, and report pages.
- Interactive Three.js / React Three Fiber layered-wall view with orbit, zoom, reset, layer inspection, and a 2D cross-section fallback.
- FastAPI backend for steady and transient computation, material information, validation, save/load, and PDF generation.
- CSV and JSON data exports; PDF report includes model assumptions, layer properties, actual computed results, and profile samples.
- SQLite persistence for saved simulation configurations and results.
- Focused numerical/API tests (pytest) and frontend interaction tests (Vitest/Testing Library).

## Tests

```powershell
cd backend
python -m pytest
```

```powershell
cd frontend
npm test
npm run build
```
