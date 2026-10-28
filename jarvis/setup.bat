@echo off
cd /d "%~dp0"
echo === Jarvis Setup ===
python -m venv venv
call venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
echo.
echo Fertig! Starte Jarvis mit start.bat
pause
