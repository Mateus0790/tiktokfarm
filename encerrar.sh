#!/usr/bin/env bash
# Fecha o TikTok Farm (o start.sh não vai religar).
cd "$(dirname "$0")"
PORT=$(node -e "try{console.log(require('./config.json').server.port||8080)}catch{console.log(8080)}")
curl -fsS -X POST -H 'X-TikTokFarm: 1' "http://127.0.0.1:$PORT/api/shutdown" >/dev/null \
  && echo "TikTok Farm encerrado." || echo "O TikTok Farm não parece estar rodando."
