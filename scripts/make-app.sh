#!/bin/bash
# Build "Chess Engine.app" into /Applications: a launcher that starts the local
# server if it isn't running, then opens the game in the browser.
# Run once; rerun after changing the embedded script below.
set -e

APP="/Applications/Chess Engine.app"

mkdir -p "$APP/Contents/MacOS"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Chess Engine</string>
  <key>CFBundleDisplayName</key><string>Chess Engine</string>
  <key>CFBundleIdentifier</key><string>local.faraz.chessengine</string>
  <key>CFBundleExecutable</key><string>ChessEngine</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

cat > "$APP/Contents/MacOS/ChessEngine" <<'LAUNCH'
#!/bin/bash
# Start the chess server if it isn't running, then open it in the browser.
set -e

DIR="$HOME/Programming/chess-engine"
URL="http://127.0.0.1:8790"
LOG="$DIR/logs/launch.log"

up() { curl -sf -o /dev/null --max-time 1 "$URL/api/health"; }

if ! up; then
  (cd "$DIR" && nohup ./run.sh >>"$LOG" 2>&1 &)
  waited=0
  until up; do
    sleep 0.5
    waited=$((waited + 1))
    if [ "$waited" -ge 240 ]; then
      osascript -e 'display notification "Server did not start - see logs/launch.log" with title "Chess Engine"'
      exit 1
    fi
  done
fi

open "$URL"
LAUNCH

chmod +x "$APP/Contents/MacOS/ChessEngine"

echo "Installed: $APP"
echo "Launch it with Cmd+Space, type \"Chess Engine\", Enter."
