@echo off
chcp 65001 >nul
title SisPericia
setlocal enableextensions enabledelayedexpansion

set "BASE=%USERPROFILE%\SisPericia"
set "APP=%BASE%\app"
set "TMP=%BASE%\_tmp"
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

rem --- Baixa a versao mais recente do sistema ---
echo Buscando a versao mais recente... aguarde.
curl -L -o "%ZIP%" "%URL%"
if errorlevel 1 goto sem_internet
if not exist "%ZIP%" goto sem_internet

if exist "%TMP%" rmdir /s /q "%TMP%"
mkdir "%TMP%"
tar -xf "%ZIP%" -C "%TMP%"
if errorlevel 1 goto erro_extrair

set "SRC="
for /d %%D in ("%TMP%\*") do set "SRC=%%D"
if not defined SRC goto erro_extrair

if not exist "%APP%" mkdir "%APP%"
rem Atualiza os arquivos do sistema, PRESERVANDO seus dados e os componentes:
robocopy "!SRC!" "%APP%" /MIR /XD node_modules data /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto erro_copia
rmdir /s /q "%TMP%" 2>nul
del "%ZIP%" >nul 2>nul

cd /d "%APP%"

rem --- Instala componentes na primeira vez ---
if not exist "node_modules" (
  echo.
  echo Instalando componentes pela primeira vez... pode levar alguns minutos.
  echo (Um bom momento para um cafe.)
  echo.
  call npm install
  if errorlevel 1 goto erro_install
)

rem --- Garante o navegador do robo do SEI ---
echo Verificando o navegador do robo...
call npx --yes playwright install chromium

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

:sem_internet
echo.
echo [ERRO] Nao consegui baixar o sistema. Verifique a conexao com a internet e tente de novo.
pause
exit /b

:erro_extrair
echo.
echo [ERRO] Nao consegui extrair os arquivos.
pause
exit /b

:erro_copia
echo.
echo [ERRO] Nao consegui atualizar os arquivos do sistema.
pause
exit /b

:erro_install
echo.
echo [ERRO] Falha ao instalar os componentes.
echo Tire um print desta janela inteira e envie para suporte.
pause
exit /b
