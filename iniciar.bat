@echo off
chcp 65001 >nul
title SisPericia - Despachos da Pericia
cd /d "%~dp0"

echo ============================================================
echo   SisPericia - iniciando...
echo ============================================================
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado.
  echo.
  echo   Instale o Node.js ^(versao LTS^) em: https://nodejs.org
  echo   Depois feche esta janela e clique novamente em iniciar.bat
  echo.
  pause
  exit /b
)

if not exist node_modules (
  echo Primeira vez: instalando componentes ^(pode levar alguns minutos^)...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao instalar. Verifique sua internet e tente de novo.
    pause
    exit /b
  )
)

echo.
echo Abrindo o sistema no navegador: http://localhost:3000
echo (Para desligar, feche esta janela preta.)
echo.
start "" http://localhost:3000
call npm start
pause
