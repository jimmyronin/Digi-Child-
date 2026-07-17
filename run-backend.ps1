# Start the Digi-Child Backend Server

Write-Host "Installing dependencies..."
python -m pip install -r requirements.txt

Write-Host "Starting API server..."
python -m uvicorn main:app --reload --port 8000
