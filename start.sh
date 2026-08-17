#!/bin/bash
# AegisVPN Launch Script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "======================================================="
echo "  🛡️  Launching AegisVPN Privacy & Cybersecurity Suite "
echo "======================================================="

# Open default browser
if which open > /dev/null; then
  open "http://localhost:8080"
elif which xdg-open > /dev/null; then
  xdg-open "http://localhost:8080"
fi

# Run python server
python3 server.py
