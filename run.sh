#!/bin/bash
# chess-engine — build the UI once if needed, then serve app + API on :8790
set -e
cd "$(dirname "$0")"
source .venv/bin/activate
if [ ! -d web/dist ]; then
  (cd web && npm install && npm run build)
fi
exec uvicorn server.main:app --host 127.0.0.1 --port 8790
