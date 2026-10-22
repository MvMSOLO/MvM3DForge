#!/bin/sh
if curl -s http://127.0.0.1:8080/ >/dev/null 2>&1; then
  echo "Dev server is already healthy on 0.0.0.0:8080"
  exit 0
fi

echo "Starting dev server on 0.0.0.0:8080..."
nohup npm run dev > dev-server.log 2>&1 &

# Wait for server up to 10 seconds
for i in $(seq 1 10); do
  if curl -s http://127.0.0.1:8080/ >/dev/null 2>&1; then
    echo "Dev server started successfully!"
    exit 0
  fi
  sleep 1
done

echo "Dev server start initiated."
exit 0
