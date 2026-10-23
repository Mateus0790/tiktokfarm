@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Fecha o TikTok Farm (o start-windows.bat nao vai religar).
powershell -NoProfile -Command ^
  "$port = 8080; try { $c = Get-Content 'config.json' -Raw | ConvertFrom-Json; if ($c.server.port) { $port = $c.server.port } } catch {};" ^
  "try { Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:' + $port + '/api/shutdown') -Headers @{ 'X-TikTokFarm' = '1' } | Out-Null; Write-Host 'TikTok Farm encerrado.' }" ^
  "catch { Write-Host 'O TikTok Farm nao parece estar rodando.' }"
timeout /t 4 >nul
