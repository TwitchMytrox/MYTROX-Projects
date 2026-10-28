@echo off
cd /d "%~dp0"
echo === GPU-Setup fuer NVIDIA-Grafikkarten ===
nvidia-smi >nul 2>&1 || (echo Keine NVIDIA-Karte bzw. kein Treiber gefunden. Ollama nutzt AMD-Karten trotzdem automatisch, sofern unterstuetzt. & pause & exit /b)
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv
call venv\Scripts\activate.bat
pip install nvidia-cublas-cu12 "nvidia-cudnn-cu12>=9,<10"
echo.
echo Fertig! Starte Jarvis mit start.bat - er sollte jetzt "Whisper laeuft auf der Grafikkarte" melden.
pause
