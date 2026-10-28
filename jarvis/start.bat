@echo off
cd /d "%~dp0"
set HF_HUB_DISABLE_SYMLINKS_WARNING=1
set PYTHONWARNINGS=ignore
call venv\Scripts\activate.bat
python jarvis.py
pause
