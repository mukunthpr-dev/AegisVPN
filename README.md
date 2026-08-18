# AegisVPN

AegisVPN is a lightweight local proxy helper for VPN connections. It provides a small local proxy (server.py) that integrates with VPN networking to route traffic and perform optional TLS-related handling.
It uses the Tor onion network to essentially hop to different countries and provided unlimited data
this is fully local and has multiple secuerity protocols like WireGaurd, OpenVPN, Stealth DPI Obfuscation, It was made to be the most protected and also free VPN and unlimed dats,because everyone deserves freedom. It was vibe coded in under 2 hours, 
NOTE: This repository contains the local proxy/server component used by the AegisVPN client. It does not include credentials or private VPN server endpoints.

## Contents

- server.py — local proxy / helper server
- README.md — this file
- screenshots/ — example screenshots showing setup and usage

## Features

- Starts a local HTTP/HTTPS proxy on 127.0.0.1:9090
- Designed to integrate with macOS system proxy settings while the VPN is active
- Simple Python 3 codebase; easy to inspect and run

## Prerequisites

- macOS (tested on latest macOS)
- Python 3.8+ (python3)
- Git (for source control)
- Tor in the Command Line

Optional:
- Virtual environment tools (venv)

## Installation

1. Clone the repository (or use the ZIP):

   git clone <your-repo-url>
   cd AegisVPN

2. (Optional) Create a virtual environment and activate it:

   python3 -m venv .venv
   source .venv/bin/activate

3. Install any Python dependencies (if server.py requires more than stdlib). If none are required, skip.

   pip install -r requirements.txt

## Running locally

The proxy server is started by running server.py. The project expects the process to bind to 127.0.0.1:9090 by default.

Recommended run (keeps process running after terminal closes):

   cd /path/to/AegisVPN
   nohup python3 server.py >/tmp/aegis-proxy.log 2>&1 &

To stop the running server:

1. Find the listening process (macOS):

   sudo lsof -nP -iTCP:9090 -sTCP:LISTEN

2. Kill the PID shown (replace <PID>):

   kill <PID>

If the process does not stop, use:

   kill -9 <PID>

## macOS Integration (System Proxy)

When the VPN is active the AegisVPN helper sets the system HTTP/HTTPS proxy to 127.0.0.1:9090 so browsers route traffic through the local proxy.

If browsers show TLS/certificate errors (e.g., "Secure Connection Failed" / PR_END_OF_FILE_ERROR) while connected to the VPN:

1. Restart the local proxy process (server.py) as shown above.
2. If the problem persists, temporarily disable the system proxy and test (run from Terminal):

   # list network services (identify the one you use, e.g. "Wi-Fi")
   networksetup -listallnetworkservices

   # replace "Wi-Fi" with your active service
   sudo networksetup -setwebproxystate "Wi-Fi" off
   sudo networksetup -setsecurewebproxystate "Wi-Fi" off

Re-enable later with:

   sudo networksetup -setwebproxystate "Wi-Fi" on
   sudo networksetup -setsecurewebproxystate "Wi-Fi" on

## Screenshots

Main Aegis Dashboard:
<img src="screenshots/Aegis Dashboard Main.png" alt="Screenshot of Aegis Main Dashboard screen">
Country Selector:
<img src="screenshots/Countries screen Aegis.png" alt="Screenshot of Aegis Country Selector">
Protocols Adjustment Screen:
<img src="screenshots/Protocols screen aegis.png" alt="Screenshot of Aegis Protocols Adjustment Screen">
Double VPN Multi Hop Configuration:
<img src="screenshots/Double VPN Multi Hop Aegis.png" alt="Screenshot of Aegis Multi Hop Configuration Screen">
Security Screen:
<img src="screenshots/Security Screen Aegis.png" alt="Screenshot of Aegis Security Screen">
Aegis Sandbox Browser:
<img src="screenshots/Aegis Sandbox Browser.png" alt="Screenshot of Aegis Sandbox Browser">
## Troubleshooting

- Browser reports TLS / certificate errors only when VPN is connected
  - Inspect system proxy with: `scutil --proxy`
  - If HTTPEnable/HTTPSEnable is set to 1 and proxy is 127.0.0.1:9090, confirm server.py is running and listening on that port.

- Check server logs:

  tail -n 200 /tmp/aegis-proxy.log

- Test with curl for verbose TLS handshake debugging:

  curl -vk https://www.google.com

## Development notes

- The local proxy is intentionally simple so you can inspect TLS handling.
- If you modify server.py, restart the running process to pick up changes

## License

This project is under an MIT License as shown in the repository
--------------------------------------------------------------
**_Made with ❤️ by Mukunth P.R_**
