#!/usr/bin/env bash
# Inicia o servidor e reinicia automaticamente se ele parar (modo 24/7).
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
while true; do
  node server/index.js "$@"
  echo "[$(date)] Servidor parou. Reiniciando em 5 segundos... (Ctrl+C duas vezes para encerrar)"
  sleep 5
done
