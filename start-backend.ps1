# Start the backend FastAPI server
Set-Location "$PSScriptRoot\backend"

if (-not (Test-Path ".venv")) {
    Write-Host "Creating virtual environment..."
    python -m venv .venv
}

Write-Host "Activating virtual environment..."
& .\.venv\Scripts\Activate.ps1

Write-Host "Installing dependencies..."
pip install -r requirements.txt --quiet

Write-Host "Starting FastAPI server on http://localhost:8000 ..."
uvicorn main:app --reload --host 0.0.0.0 --port 8000
