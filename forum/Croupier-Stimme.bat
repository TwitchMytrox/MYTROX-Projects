@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  Turkac Arcade - Croupier-Stimme erzeugen
echo  ----------------------------------------
echo  1 = Stimmen anzeigen
echo  2 = Alle fehlenden Zeilen erzeugen (Standardstimme)
echo  3 = Alle fehlenden Zeilen mit eigener Stimme (Name oder ID eingeben)
echo  4 = Nur zaehlen (Zeichenverbrauch), nichts erzeugen
echo.
set /p W=Auswahl: 
if "%W%"=="1" node tools\make-dealer-voice.js --list
if "%W%"=="2" node tools\make-dealer-voice.js
if "%W%"=="3" (set /p V=Stimme: & call node tools\make-dealer-voice.js --voice "%V%")
if "%W%"=="4" node tools\make-dealer-voice.js --dry
echo.
pause
