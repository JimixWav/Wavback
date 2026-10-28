@echo off
rem Windows : double-clic pour lancer Wavback.
rem La premiere fois, il installe ce qui manque dans le dossier bin (quelques minutes).
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1" -Run
if errorlevel 1 pause
