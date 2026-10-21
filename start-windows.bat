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

rem Reinicia o servidor automaticamente se ele parar por qualquer motivo (modo 24/7).
:loop
node server/index.js %*
echo.
echo [%date% %time%] Servidor parou. Reiniciando em 5 segundos... (feche esta janela para encerrar)
timeout /t 5 /nobreak >nul
goto loop
