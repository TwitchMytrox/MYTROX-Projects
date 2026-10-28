@echo off
cd /d "%~dp0"
echo === Chatterbox (realistische Offline-Stimme) installieren ===
echo Das ist gross (ca. 3-5 GB) und dauert etwas.
call venv\Scripts\activate.bat
pip install chatterbox-tts
echo.
echo === PyTorch mit Grafikkarten-Unterstuetzung (NVIDIA) ===
for /f %%v in ('python -c "import torch;print(torch.__version__.split('+')[0])"') do set TV=%%v
echo Torch-Version: %TV%
pip install --force-reinstall --no-deps torch==%TV% torchaudio==%TV% --index-url https://download.pytorch.org/whl/cu126
python -c "import torch;print('Grafikkarte erkannt:', torch.cuda.is_available())"
echo.
echo Fertig! Jetzt in config.json "stimme": "chatterbox" eintragen
echo und einen 10-20 s WAV-Clip in den Ordner "stimme" legen.
pause
