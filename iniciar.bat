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
echo Iniciando o servidor... o navegador abrira sozinho em instantes.
echo (Para desligar o sistema, feche esta janela preta.)
echo.
rem Abre o navegador apenas depois de ~7s, dando tempo do servidor subir:
start "" cmd /c "timeout /t 7 >nul & start "" http://localhost:3000"
call npm start
pause
