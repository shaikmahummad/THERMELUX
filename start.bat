@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python 3.10 or later is required.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or later is required.
  pause
  exit /b 1
)

if not exist "backend\.venv\Scripts\python.exe" (
  python -m venv "backend\.venv"
  if errorlevel 1 exit /b 1
)
"backend\.venv\Scripts\python.exe" -m pip install -r "backend\requirements.txt"
if errorlevel 1 exit /b 1

if not exist "frontend\node_modules" (
  pushd "frontend"
  call npm install
  if errorlevel 1 (
    popd
    exit /b 1
  )
  popd
)

start "THERMALUX API" cmd /k "cd /d ""%~dp0"" && ""%~dp0backend\.venv\Scripts\python.exe"" -m uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000"
start "THERMALUX Frontend" cmd /k "cd /d ""%~dp0frontend"" && npm run dev"
timeout /t 3 /nobreak >nul
start "" "http://localhost:5173"
echo THERMALUX is starting. API documentation: http://localhost:8000/docs
endlocal
