@echo off
title Factoria de Contenido IA - Aiimplementaciones
cls
echo ================================================================
echo   Iniciando Factoria de Contenido Localmente - Aiimplementaciones
echo ================================================================
echo.
cd /d "%~dp0"

echo [1/2] Abriendo panel en el navegador...
start http://localhost:3456

echo [2/2] Iniciando servidor Node.js en http://localhost:3456...
echo Presiona Ctrl + C en esta ventana para detener el servidor.
echo.
node factoria-server.js

pause
