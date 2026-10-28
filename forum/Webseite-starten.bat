@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js fehlt. Bitte Version 22 oder neuer von https://nodejs.org installieren und diese Datei nochmal starten.
  pause
  exit /b 1
)
echo.
echo  turkac.org startet auf http://localhost:3000
echo  Beim allerersten Start steht das Admin-Passwort in diesem Fenster. Notiere es dir.
echo  Zum Beenden dieses Fenster schliessen oder Strg+C druecken.
echo.
start "" /min cmd /c "timeout /t 3 >nul & start http://localhost:3000/spiele/"
node server.js
pause
