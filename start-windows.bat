@echo off
chcp 65001 >nul
title TikTok Farm
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale a versao LTS em https://nodejs.org e rode de novo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias, aguarde...
  call npm install
)

rem Reinicia o servidor automaticamente se ele cair (modo 24/7).
rem Codigo 10 = encerrado de proposito (painel, encerrar-windows.bat ou Ctrl+C): nao reinicia.
:loop
node server/index.js %*
if "%errorlevel%"=="10" goto fim
echo.
echo [%date% %time%] Servidor parou. Reiniciando em 5 segundos... (feche esta janela para encerrar)
timeout /t 5 /nobreak >nul
goto loop

:fim
echo.
echo TikTok Farm encerrado. Pode fechar esta janela.
timeout /t 5 >nul
