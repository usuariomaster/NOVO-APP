@echo off
chcp 65001 >nul
title SisPericia
setlocal enableextensions enabledelayedexpansion

set "BASE=%USERPROFILE%\SisPericia"
set "APP=%BASE%\app"
set "ZIP=%TEMP%\sispericia.zip"
set "URL=https://codeload.github.com/usuariomaster/NOVO-APP/zip/refs/heads/claude/sei-dispatch-system-7mvzei"

echo ============================================================
echo    SisPericia - Despachos da Pericia
echo ============================================================
echo.

rem --- Verifica o Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] O Node.js nao esta instalado.
  echo.
  echo   Baixe e instale a versao LTS em:  https://nodejs.org
  echo   Depois feche esta janela e clique novamente neste arquivo.
  echo.
  pause
  exit /b
)

rem --- Se ja estiver instalado, apenas inicia ---
if exist "%APP%\node_modules" goto iniciar

echo Baixando o sistema pela primeira vez... aguarde.
curl -L -o "%ZIP%" "%URL%"
if errorlevel 1 goto erro_download
if not exist "%ZIP%" goto erro_download

echo Extraindo os arquivos...
if exist "%BASE%\_tmp" rmdir /s /q "%BASE%\_tmp"
mkdir "%BASE%\_tmp"
tar -xf "%ZIP%" -C "%BASE%\_tmp"
if errorlevel 1 goto erro_extrair

set "SRC="
for /d %%D in ("%BASE%\_tmp\*") do set "SRC=%%D"
if not defined SRC goto erro_extrair

if exist "%APP%" rmdir /s /q "%APP%"
move "!SRC!" "%APP%" >nul
rmdir /s /q "%BASE%\_tmp" 2>nul
del "%ZIP%" >nul 2>nul

echo.
echo Instalando os componentes... isso pode levar alguns minutos.
echo (Um bom momento para um cafe.)
echo.
cd /d "%APP%"
call npm install
if errorlevel 1 goto erro_install

:iniciar
cd /d "%APP%"
echo.
echo ============================================================
echo   Pronto! O navegador vai abrir sozinho em instantes.
echo.
echo     Login:  admin@pericia.local
echo     Senha:  admin123
echo.
echo   NAO feche esta janela enquanto usar o sistema.
echo   (Para desligar depois, feche esta janela.)
echo ============================================================
start "" cmd /c "timeout /t 8 >nul & start "" http://localhost:3000"
call npm start
pause
exit /b

:erro_download
echo.
echo [ERRO] Nao consegui baixar o sistema. Verifique a conexao com a internet e tente de novo.
pause
exit /b

:erro_extrair
echo.
echo [ERRO] Nao consegui extrair os arquivos.
pause
exit /b

:erro_install
echo.
echo [ERRO] Falha ao instalar os componentes.
echo Tire um print desta janela inteira e envie para suporte.
pause
exit /b
