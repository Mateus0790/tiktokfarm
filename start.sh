#!/usr/bin/env bash
# Inicia o servidor e reinicia automaticamente se ele cair (modo 24/7).
# Código 10 = encerrado de propósito (painel, encerrar.sh ou Ctrl+C): não reinicia.
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
while true; do
  node server/index.js "$@"
  [ $? -eq 10 ] && { echo "TikTok Farm encerrado."; exit 0; }
  echo "[$(date)] Servidor parou. Reiniciando em 5 segundos..."
  sleep 5
done
