@echo off
setlocal enabledelayedexpansion
title Ejecutar Pipeline de Contenido - Aiimplementaciones
cd /d "%~dp0"

if "%~1"=="" (
    echo.
    echo ================================================================
    echo   Uso: ejecutar_pipeline.bat "Tema de tu contenido"
    echo   Ejemplo: ejecutar_pipeline.bat "Por que las clinicas pierden pacientes en WhatsApp"
    echo ================================================================
    echo.
    set /p TEMA="Escribe el tema que deseas procesar: "
) else (
    set "TEMA=%~1"
)

if "!TEMA!"=="" (
    echo [ERROR] No se especifico ningun tema. Operacion cancelada.
    pause
    exit /b 1
)

echo.
echo ================================================================
echo   Iniciando Pipeline de Contenido Local
echo   Tema: !TEMA!
echo ================================================================
echo.

node factoria-server.js --cli "!TEMA!" 2>nul || (
    echo Ejecutando a traves del panel web local...
    start http://localhost:3456
    node factoria-server.js
)

pause
