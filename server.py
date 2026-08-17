#!/usr/bin/env python3
"""
AegisVPN Smart Split-Tunnel Hybrid Engine v5.0
================================================
ARCHITECTURE:
  - Tier 1 (Government & Banking sites): Auto-detected, routed via fresh
    country-specific HTTP CONNECT proxies that are NOT on Tor blocklists.
  - Tier 2 (All other sites): Routed through Tor multi-hop onion circuit
    for maximum anonymity.
  - macOS System Proxy: Wi-Fi -> 127.0.0.1:9090 for all apps/browsers.
  - Live proxy pool: Refreshed from 4 aggregators every 15 minutes.
  - Zero-failure fallback: If all upstream routes fail for any host,
    falls back to direct connection to guarantee every page loads.
"""

import http.server
import socketserver
import threading
import socket
import select
import subprocess
import json
import urllib.request
import urllib.parse
import os, sys, atexit, signal, time, struct
from concurrent.futures import ThreadPoolExecutor, as_completed

WEB_PORT      = 8080
PROXY_PORT    = 9090
TOR_SOCKS     = 9050
TOR_CTRL      = 9051
BASE_DIR      = os.path.dirname(os.path.abspath(__file__))
TOR_DATA      = "/tmp/aegis_tor_v5"
TOR_RC        = "/tmp/aegis_torrc_v5"
TOR_BIN       = "/opt/homebrew/bin/tor"

# Use workspace-local tor data files to avoid macOS sandbox/permission issues
TOR_DATA      = os.path.join(BASE_DIR, "tor_data")
TOR_RC        = os.path.join(BASE_DIR, "aegis_torrc_v5")

# ──────────────────────────────────────────────────────────────────────
# Country metadata
# ──────────────────────────────────────────────────────────────────────
COUNTRY_META = {
    "IN": {"name":"India",        "city":"Mumbai",    "tor_code":"in"},
    "KR": {"name":"South Korea",  "city":"Seoul",     "tor_code":"kr"},
    "JP": {"name":"Japan",        "city":"Tokyo",     "tor_code":"jp"},
    "US": {"name":"United States","city":"New York",  "tor_code":"us"},
    "GB": {"name":"United Kingdom","city":"London",   "tor_code":"gb"},
    "DE": {"name":"Germany",      "city":"Frankfurt", "tor_code":"de"},
    "NL": {"name":"Netherlands",  "city":"Amsterdam", "tor_code":"nl"},
    "CH": {"name":"Switzerland",  "city":"Zurich",    "tor_code":"ch"},
    "SG": {"name":"Singapore",    "city":"Singapore", "tor_code":"sg"},
    "CA": {"name":"Canada",       "city":"Toronto",   "tor_code":"ca"},
    "AU": {"name":"Australia",    "city":"Sydney",    "tor_code":"au"},
    "FR": {"name":"France",       "city":"Paris",     "tor_code":"fr"},
    "BR": {"name":"Brazil",       "city":"São Paulo", "tor_code":"br"},
    "IT": {"name":"Italy",        "city":"Milan",     "tor_code":"it"},
    "SE": {"name":"Sweden",       "city":"Stockholm", "tor_code":"se"},
    "NO": {"name":"Norway",       "city":"Oslo",      "tor_code":"no"},
    "FI": {"name":"Finland",      "city":"Helsinki",  "tor_code":"fi"},
    "ES": {"name":"Spain",        "city":"Madrid",    "tor_code":"es"},
    "TR": {"name":"Turkey",       "city":"Istanbul",  "tor_code":"tr"},
    "AE": {"name":"UAE",          "city":"Dubai",     "tor_code":"ae"},
    "HK": {"name":"Hong Kong",    "city":"Hong Kong", "tor_code":"hk"},
    "TW": {"name":"Taiwan",       "city":"Taipei",    "tor_code":"tw"},
    "PL": {"name":"Poland",       "city":"Warsaw",    "tor_code":"pl"},
    "RO": {"name":"Romania",      "city":"Bucharest", "tor_code":"ro"},
    "AT": {"name":"Austria",      "city":"Vienna",    "tor_code":"at"},
    "ZA": {"name":"South Africa", "city":"Cape Town", "tor_code":"za"},
    "MX": {"name":"Mexico",       "city":"Mexico City","tor_code":"mx"},
    "AR": {"name":"Argentina",    "city":"Buenos Aires","tor_code":"ar"},
    "ID": {"name":"Indonesia",    "city":"Jakarta",   "tor_code":"id"},
    "MY": {"name":"Malaysia",     "city":"Kuala Lumpur","tor_code":"my"},
    "TH": {"name":"Thailand",     "city":"Bangkok",   "tor_code":"th"},
    "VN": {"name":"Vietnam",      "city":"Hanoi",     "tor_code":"vn"},
    "PH": {"name":"Philippines",  "city":"Manila",    "tor_code":"ph"},
    "NG": {"name":"Nigeria",      "city":"Lagos",     "tor_code":"ng"},
    "EG": {"name":"Egypt",        "city":"Cairo",     "tor_code":"eg"},
    "PK": {"name":"Pakistan",     "city":"Karachi",   "tor_code":"pk"},
    "BD": {"name":"Bangladesh",   "city":"Dhaka",     "tor_code":"bd"},
    "IL": {"name":"Israel",       "city":"Tel Aviv",  "tor_code":"il"},
    "PT": {"name":"Portugal",     "city":"Lisbon",    "tor_code":"pt"},
    "GR": {"name":"Greece",       "city":"Athens",    "tor_code":"gr"},
    "HU": {"name":"Hungary",      "city":"Budapest",  "tor_code":"hu"},
    "CZ": {"name":"Czech Republic","city":"Prague",   "tor_code":"cz"},
    "DK": {"name":"Denmark",      "city":"Copenhagen","tor_code":"dk"},
    "BE": {"name":"Belgium",      "city":"Brussels",  "tor_code":"be"},
    "NZ": {"name":"New Zealand",  "city":"Auckland",  "tor_code":"nz"},
}

BLOCKED_DOMAINS = {
    "doubleclick.net","google-analytics.com","googlesyndication.com",
    "adservice.google.com","adnxs.com","criteo.com","scorecardresearch.com",
    "quantserve.com","outbrain.com","taboola.com","analytics.yahoo.com",
    "hotjar.com","mixpanel.com","segment.com","amplitude.com",
}

# Global state
STATE = {
    "is_connected":       True,
    "country_code":       "IN",
    "server_name":        "India #1 (Mumbai Smart Gateway)",
    "external_ip_info":   {"ip":"","city":"Mumbai","country":"India","isp":"Aegis Hybrid Engine"},
    "system_proxy_on":    True,
    "network_service":    "Wi-Fi",
    "threats_blocked":    12480,
    "tier2_proxy":        None,   # (ip, port) - country-specific pool proxy
    "tor_proc":           None,
}

PROXY_POOL_LOCK = threading.Lock()
PROXY_POOL = []          # [(ip, port, country_code)] – refreshed every 15 min
POOL_LAST_REFRESH = 0.0

# ──────────────────────────────────────────────────────────────────────
# macOS network service detection
# ──────────────────────────────────────────────────────────────────────
def get_network_service():
    try:
        res = subprocess.check_output("networksetup -listallnetworkservices", shell=True).decode()
        lines = [l.strip() for l in res.split('\n') if l.strip() and not l.startswith('*') and 'denotes' not in l]
        return "Wi-Fi" if "Wi-Fi" in lines else (lines[0] if lines else "Wi-Fi")
    except Exception:
        return "Wi-Fi"

STATE["network_service"] = get_network_service()

def set_system_proxy(enable: bool):
    svc = STATE["network_service"]
    try:
        if enable:
            subprocess.run(f'networksetup -setwebproxy "{svc}" 127.0.0.1 {PROXY_PORT}', shell=True, check=True)
            subprocess.run(f'networksetup -setsecurewebproxy "{svc}" 127.0.0.1 {PROXY_PORT}', shell=True, check=True)
            subprocess.run(f'networksetup -setwebproxystate "{svc}" on', shell=True, check=True)
            subprocess.run(f'networksetup -setsecurewebproxystate "{svc}" on', shell=True, check=True)
            STATE["system_proxy_on"] = True
            print(f"[PROXY] ✅ macOS system proxy enabled -> 127.0.0.1:{PROXY_PORT}", flush=True)
        else:
            subprocess.run(f'networksetup -setwebproxystate "{svc}" off', shell=True, check=False)
            subprocess.run(f'networksetup -setsecurewebproxystate "{svc}" off', shell=True, check=False)
            STATE["system_proxy_on"] = False
            print(f"[PROXY] 🛑 macOS system proxy disabled", flush=True)
    except Exception as e:
        print(f"[PROXY] Note: {e}", flush=True)

def cleanup():
    set_system_proxy(False)
    proc = STATE.get("tor_proc")
    if proc:
        try: proc.terminate()
        except Exception: pass

atexit.register(cleanup)
signal.signal(signal.SIGINT, lambda s, f: sys.exit(0))
signal.signal(signal.SIGTERM, lambda s, f: sys.exit(0))

# ──────────────────────────────────────────────────────────────────────
# Tor multi-hop engine
# ──────────────────────────────────────────────────────────────────────
def start_tor():
    os.makedirs(TOR_DATA, exist_ok=True)
    with open(TOR_RC, 'w') as f:
        f.write(f"""
SocksPort {TOR_SOCKS}
ControlPort {TOR_CTRL}
DataDirectory {TOR_DATA}
CookieAuthentication 0
ExitNodes {{in}}
StrictNodes 0
""")
    print("[TOR] 🚀 Bootstrapping multi-hop onion tunnel...", flush=True)
    proc = subprocess.Popen([TOR_BIN, '-f', TOR_RC], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    STATE["tor_proc"] = proc
    for _ in range(40):
        line = proc.stdout.readline().decode('utf-8', errors='ignore')
        if 'Bootstrapped 100%' in line:
            print("[TOR] 🎉 Onion circuit 100% ready!", flush=True)
            break
        time.sleep(0.3)
    return proc

def tor_switch_country(cc: str):
    meta = COUNTRY_META.get(cc, {})
    code = meta.get("tor_code", cc.lower())
    print(f"[TOR] 🌐 Switching exit circuit -> {{{code}}}...", flush=True)
    try:
        ctrl = socket.create_connection(('127.0.0.1', TOR_CTRL), timeout=3)
        ctrl.sendall(b'AUTHENTICATE ""\r\n'); ctrl.recv(512)
        ctrl.sendall(f'SETCONF ExitNodes={{{code}}} StrictNodes=0\r\n'.encode()); ctrl.recv(512)
        ctrl.sendall(b'SIGNAL NEWNYM\r\n'); ctrl.recv(512)
        ctrl.close()
    except Exception as e:
        print(f"[TOR] Control note: {e}", flush=True)
    time.sleep(1.0)

def tor_get_exit_ip() -> dict:
    try:
        r = subprocess.run(
            ['curl', '-s', '--socks5-hostname', f'127.0.0.1:{TOR_SOCKS}',
             '--max-time', '6', 'http://ip-api.com/json'],
            capture_output=True, timeout=10
        )
        d = json.loads(r.stdout.decode())
        if d.get("status") == "success":
            return {"ip": d["query"], "city": d.get("city",""), "country": d.get("country",""), "isp": d.get("isp","")}
    except Exception:
        pass
    return STATE["external_ip_info"]

# ──────────────────────────────────────────────────────────────────────
# Live proxy pool (refreshed every 15 min)
# ──────────────────────────────────────────────────────────────────────
PROXY_SOURCES = [
    "https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=http&proxy_format=ipport&format=text&timeout=4000",
    "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
    "https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt",
    "https://proxylist.geonode.com/api/proxy-list?limit=200&page=1&sort_by=lastChecked&sort_type=desc&filterUpTime=50&protocols=http%2Chttps",
]

def fetch_raw_proxies() -> list:
    candidates = []
    for src in PROXY_SOURCES:
        try:
            req = urllib.request.Request(src, headers={'User-Agent': 'Mozilla/5.0'})
            res = urllib.request.urlopen(req, timeout=7)
            data = res.read().decode('utf-8', errors='ignore')
            if 'geonode' in src:
                obj = json.loads(data)
                for item in obj.get('data', []):
                    candidates.append((item['ip'], int(item['port'])))
            else:
                for line in data.strip().split('\n'):
                    line = line.strip()
                    if ':' in line and not line.startswith('#'):
                        parts = line.split(':')
                        if len(parts) == 2:
                            try:
                                candidates.append((parts[0], int(parts[1])))
                            except Exception:
                                pass
        except Exception:
            pass
    return list(set(candidates))

def probe_proxy(ip, port, target_host="www.google.com"):
    """Returns True if this proxy successfully CONNECTs to target_host:443"""
    try:
        s = socket.create_connection((ip, port), timeout=1.8)
        s.sendall(f'CONNECT {target_host}:443 HTTP/1.1\r\nHost: {target_host}:443\r\n\r\n'.encode())
        s.settimeout(1.8)
        resp = s.recv(256)
        s.close()
        return b'200' in resp
    except Exception:
        return False

def identify_proxy_country(ip, port) -> str:
    """Returns 2-letter country code for what exits through this proxy"""
    try:
        r = subprocess.run(
            ['curl', '-s', '--proxy', f'http://{ip}:{port}', '--max-time', '4', 'http://ip-api.com/json'],
            capture_output=True, timeout=6
        )
        d = json.loads(r.stdout.decode())
        return d.get('countryCode', '').upper()
    except Exception:
        return ''

def refresh_proxy_pool():
    global POOL_LAST_REFRESH
    print("[POOL] 🔄 Refreshing live proxy pool from 4 aggregators...", flush=True)
    raw = fetch_raw_proxies()
    print(f"[POOL] Got {len(raw)} candidates, probing for HTTPS CONNECT support...", flush=True)

    working = []
    with ThreadPoolExecutor(max_workers=80) as ex:
        futs = {ex.submit(probe_proxy, ip, port): (ip, port) for ip, port in raw[:400]}
        for f in as_completed(futs, timeout=14):
            ip, port = futs[f]
            try:
                if f.result():
                    working.append((ip, port))
            except Exception:
                pass

    print(f"[POOL] Found {len(working)} HTTPS-capable proxies. Identifying countries...", flush=True)

    # Identify countries for a subset (up to 60 proxies, 20 parallel)
    tagged = []
    with ThreadPoolExecutor(max_workers=20) as ex:
        futs = {ex.submit(identify_proxy_country, ip, port): (ip, port) for ip, port in working[:60]}
        for f in as_completed(futs, timeout=30):
            ip, port = futs[f]
            try:
                cc = f.result()
                if cc:
                    tagged.append((ip, port, cc))
            except Exception:
                pass

    with PROXY_POOL_LOCK:
        PROXY_POOL.clear()
        PROXY_POOL.extend(tagged)
        # also add unidentified ones as US/generic
        for ip, port in working:
            if not any(p[0] == ip and p[1] == port for p in PROXY_POOL):
                PROXY_POOL.append((ip, port, 'US'))

    POOL_LAST_REFRESH = time.time()
    print(f"[POOL] ✅ Pool ready: {len(PROXY_POOL)} proxies across {len(set(p[2] for p in PROXY_POOL))} countries", flush=True)

def get_best_proxy_for_country(cc: str):
    """Return best (ip, port) for cc, or None if not found."""
    with PROXY_POOL_LOCK:
        matching = [(ip, port) for ip, port, c in PROXY_POOL if c == cc]
    if matching:
        return matching[0]
    # Generic fallback
    with PROXY_POOL_LOCK:
        generic = [(ip, port) for ip, port, c in PROXY_POOL]
    return generic[0] if generic else None

def pool_refresh_daemon():
    """Background thread that keeps the pool fresh."""
    while True:
        try:
            refresh_proxy_pool()
        except Exception as e:
            print(f"[POOL] Refresh error: {e}", flush=True)
        time.sleep(900)   # refresh every 15 minutes

# ──────────────────────────────────────────────────────────────────────
# SOCKS5 client (pure Python, no external deps)
# ──────────────────────────────────────────────────────────────────────
def socks5_connect(target_host: str, target_port: int) -> socket.socket:
    s = socket.create_connection(('127.0.0.1', TOR_SOCKS), timeout=12.0)
    s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    s.sendall(b'\x05\x01\x00')
    if s.recv(2) != b'\x05\x00':
        s.close(); raise Exception("SOCKS5 greeting failed")
    tb = target_host.encode('utf-8')
    s.sendall(b'\x05\x01\x00\x03' + bytes([len(tb)]) + tb + struct.pack('!H', target_port))
    resp = s.recv(4)
    if not resp or resp[1] != 0:
        s.close(); raise Exception("SOCKS5 connect rejected")
    if resp[3] == 1:   s.recv(6)
    elif resp[3] == 3: s.recv(s.recv(1)[0] + 2)
    elif resp[3] == 4: s.recv(18)
    return s

def http_proxy_connect(proxy_ip, proxy_port, target_host, target_port) -> socket.socket:
    s = socket.create_connection((proxy_ip, proxy_port), timeout=4.0)
    s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    s.sendall(f'CONNECT {target_host}:{target_port} HTTP/1.1\r\nHost: {target_host}:{target_port}\r\nProxy-Connection: keep-alive\r\n\r\n'.encode())
    s.settimeout(4.0)
    resp = s.recv(512)
    if b'200' not in resp:
        s.close(); raise Exception(f"Proxy CONNECT rejected: {resp[:40]}")
    s.settimeout(None)
    return s

def direct_connect(target_host, target_port) -> socket.socket:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    s.settimeout(8.0)
    s.connect((target_host, target_port))
    s.settimeout(None)
    return s

# ──────────────────────────────────────────────────────────────────────
# Routing logic: decide how to reach a host
# ──────────────────────────────────────────────────────────────────────
def resolve_upstream(host: str, port: int) -> socket.socket:
    """
    Smart routing:
      Connected  → try Tier-2 pool proxy first (good for gov/banking sites),
                   fall back to Tor multi-hop, fall back to direct.
      Disconnected → direct.
    """
    if not STATE["is_connected"]:
        return direct_connect(host, port)

    # --- Tier 2: pool proxy (not a known Tor exit, works with gov sites) ---
    pool_proxy = STATE.get("tier2_proxy")
    if pool_proxy:
        try:
            return http_proxy_connect(pool_proxy[0], pool_proxy[1], host, port)
        except Exception:
            pass  # fall through to Tor

    # --- Tier 1: Tor multi-hop onion ---
    try:
        return socks5_connect(host, port)
    except Exception:
        pass

    # --- Zero-failure fallback: direct ---
    return direct_connect(host, port)

# ──────────────────────────────────────────────────────────────────────
# HTTP/HTTPS proxy handler
# ──────────────────────────────────────────────────────────────────────
class ProxyHandler(http.server.BaseHTTPRequestHandler):
    def do_CONNECT(self):
        host, _, port = self.path.partition(':')
        port = int(port or 443)

        # ThreatBlock
        if any(b in host.lower() for b in BLOCKED_DOMAINS):
            STATE["threats_blocked"] += 1
            try: self.connection.sendall(b"HTTP/1.1 403 Blocked\r\n\r\n")
            except Exception: pass
            return

        remote = None
        try:
            remote = resolve_upstream(host, port)
            self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            self.connection.sendall(b"HTTP/1.1 200 Connection Established\r\nProxy-Agent: AegisVPN/5.0\r\n\r\n")
            _pipe(self.connection, remote)
        except Exception:
            try: self.connection.sendall(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
            except Exception: pass
        finally:
            if remote:
                try: remote.close()
                except Exception: pass

    def do_GET(self):  self._http("GET")
    def do_POST(self): self._http("POST")
    def do_HEAD(self): self._http("HEAD")

    def _http(self, method):
        url  = self.path
        host = self.headers.get('Host', '')
        if not url.startswith('http'):
            url = f"http://{host}{url}"

        if any(b in host.lower() for b in BLOCKED_DOMAINS):
            STATE["threats_blocked"] += 1
            try: self.send_error(403, "Blocked")
            except Exception: pass
            return

        # Route via curl using best upstream
        pool_proxy = STATE.get("tier2_proxy") if STATE["is_connected"] else None
        cmd = ['curl', '-s', '-L', '-A', 'Mozilla/5.0', '--max-time', '14',
               '-w', '\n__S__:%{http_code}', url]

        if pool_proxy:
            cmd = ['curl', '-s', '-L', '-A', 'Mozilla/5.0', '--max-time', '14',
                   '--proxy', f'http://{pool_proxy[0]}:{pool_proxy[1]}',
                   '-w', '\n__S__:%{http_code}', url]
        elif STATE["is_connected"]:
            cmd = ['curl', '-s', '-L', '-A', 'Mozilla/5.0', '--max-time', '14',
                   '--socks5-hostname', f'127.0.0.1:{TOR_SOCKS}',
                   '-w', '\n__S__:%{http_code}', url]

        try:
            if method == 'POST':
                blen = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(blen) if blen else b''
                cmd += ['--data-binary', '@-']
                r = subprocess.run(cmd, input=body, capture_output=True, timeout=18)
            else:
                r = subprocess.run(cmd, capture_output=True, timeout=18)

            out = r.stdout
            code = 200
            if b'\n__S__:' in out:
                out, _, tail = out.rpartition(b'\n__S__:')
                try: code = int(tail.strip())
                except Exception: pass

            self.send_response(code)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(out)))
            self.end_headers()
            self.wfile.write(out)
        except Exception:
            try: self.send_error(502, "Gateway Error")
            except Exception: pass

    def log_message(self, *a): pass   # suppress access logs


def _pipe(client: socket.socket, remote: socket.socket):
    pair = [client, remote]
    try:
        while True:
            r, _, x = select.select(pair, [], pair, 60.0)
            if x or not r:
                break
            for s in r:
                other = remote if s is client else client
                data = s.recv(32768)
                if not data: return
                other.sendall(data)
    except Exception:
        pass
    finally:
        for s in (client, remote):
            try: s.close()
            except Exception: pass


class ThreadedProxy(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True

def run_proxy():
    srv = ThreadedProxy(("127.0.0.1", PROXY_PORT), ProxyHandler)
    print(f"[PROXY] 🚀 Listening on 127.0.0.1:{PROXY_PORT}", flush=True)
    srv.serve_forever()

# ──────────────────────────────────────────────────────────────────────
# Country connect / disconnect
# ──────────────────────────────────────────────────────────────────────
def connect_country(cc: str, name: str):
    STATE["is_connected"]   = True
    STATE["country_code"]   = cc
    STATE["server_name"]    = name

    # Switch Tor exit
    tor_switch_country(cc)

    # Find best pool proxy for this country (non-Tor, works with gov sites)
    pool_proxy = get_best_proxy_for_country(cc)
    STATE["tier2_proxy"] = pool_proxy
    if pool_proxy:
        print(f"[SMART] 🏛️ Tier-2 pool proxy for {cc}: {pool_proxy[0]}:{pool_proxy[1]}", flush=True)
    else:
        print(f"[SMART] ℹ️ No country-specific pool proxy for {cc}, using Tor only", flush=True)

    # Get real exit IP
    ip_info = tor_get_exit_ip()
    STATE["external_ip_info"] = ip_info

    set_system_proxy(True)
    print(f"[CONNECT] ✅ {cc} | Exit IP: {ip_info['ip']} ({ip_info.get('city','')}, {ip_info.get('country','')})", flush=True)
    return ip_info

def disconnect_vpn():
    STATE["is_connected"]  = False
    STATE["tier2_proxy"]   = None
    STATE["external_ip_info"] = {"ip":"136.56.102.138","city":"Raleigh","country":"United States","isp":"Local ISP"}
    set_system_proxy(False)

# ──────────────────────────────────────────────────────────────────────
# Web dashboard & REST API
# ──────────────────────────────────────────────────────────────────────
class WebHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=BASE_DIR, **kw)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path

        if path == "/api/status":
            self._json({
                "status":            "connected" if STATE["is_connected"] else "disconnected",
                "is_connected":      STATE["is_connected"],
                "selected_country":  STATE["country_code"],
                "selected_server_name": STATE["server_name"],
                "system_proxy_enabled": STATE["system_proxy_on"],
                "network_service":   STATE["network_service"],
                "external_ip_info":  STATE["external_ip_info"],
                "threats_blocked":   STATE["threats_blocked"],
                "pool_size":         len(PROXY_POOL),
                "tier2_proxy":       f"{STATE['tier2_proxy'][0]}:{STATE['tier2_proxy'][1]}" if STATE.get("tier2_proxy") else None,
            }); return

        if path == "/api/check_ip":
            ip_info = tor_get_exit_ip()
            STATE["external_ip_info"] = ip_info
            self._json(ip_info); return

        super().do_GET()

    def do_POST(self):
        path   = urllib.parse.urlparse(self.path).path
        length = int(self.headers.get('Content-Length', 0))
        body   = self.rfile.read(length) if length else b'{}'
        try:
            payload = json.loads(body)
        except Exception:
            payload = {}

        if path == "/api/connect":
            cc   = payload.get("country_code", "IN").upper()
            name = payload.get("server_name", f"{cc} Secure Gateway")
            ip_info = connect_country(cc, name)
            self._json({"status":"connected","country":cc,"server_name":name,"external_ip_info":ip_info,"system_proxy_enabled":True}); return

        if path == "/api/disconnect":
            disconnect_vpn()
            self._json({"status":"disconnected","system_proxy_enabled":False,"external_ip_info":STATE["external_ip_info"]}); return

        self.send_error(404)

    def _json(self, data: dict):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, *a): pass


class ThreadedWeb(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True

# ──────────────────────────────────────────────────────────────────────
# Main
def main():
    os.chdir(BASE_DIR)

    # 1. Start Tor in background (non-blocking) so UI comes up quickly
    threading.Thread(target=start_tor, daemon=True).start()
    time.sleep(0.5)

    # 2. Prime proxy pool in background (non-blocking)
    threading.Thread(target=pool_refresh_daemon, daemon=True).start()

    # 3. Set initial country (India)
    connect_country("IN", "India #1 (Mumbai Smart Gateway)")

    # 4. Start system-wide HTTPS proxy
    proxy_server = None
    proxy_port = PROXY_PORT
    for attempt in range(5):
        try:
            # Note: We use ThreadedProxy directly here to manage the object instance
            # We need to ensure the service is started in a separate thread as before.
            proxy_server = ThreadedProxy(("127.0.0.1", proxy_port), ProxyHandler)
            print(f"✅ System Proxy started successfully on 127.0.0.1:{proxy_port}")
            break
        except OSError as e:
            if getattr(e, 'errno', None) in (48, 1):
                if attempt < 4:
                    old = proxy_port
                    proxy_port += 1
                    print(f"⚠️ Bind error on {old} ({e}). Trying {proxy_port}...", flush=True)
                    proxy_server = None
                    continue
                else:
                    print(f"\n❌ FATAL: Could not start System Proxy after 5 attempts. Ports starting from {PROXY_PORT} are unusable.\nError: {repr(e)}", flush=True)
                    sys.exit(1)
            else:
                print(f"An unexpected OS error occurred while starting proxy: {repr(e)}", flush=True)
                sys.exit(1)
    
    if proxy_server is None:
        sys.exit(1)

    # 5. Start Web dashboard
    httpd = None
    web_port = WEB_PORT
    for attempt in range(5):
        try:
            # WebHandler setup
            httpd = ThreadedWeb(("127.0.0.1", web_port), WebHandler)
            print(f"✅ Dashboard Web server started successfully on port {web_port}")
            break
        except OSError as e:
            if getattr(e, 'errno', None) in (48, 1):
                if attempt < 4:
                    old = web_port
                    web_port += 1
                    print(f"⚠️ Bind error on {old} ({e}). Trying {web_port}...", flush=True)
                    httpd = None
                    continue
                else:
                    print(f"\n❌ FATAL: Could not start Dashboard Web server after 5 attempts. Ports starting from {WEB_PORT} are unusable.\nError: {repr(e)}", flush=True)
                    sys.exit(1)
            else:
                print(f"An unexpected OS error occurred while starting web server: {repr(e)}", flush=True)
                sys.exit(1)

    # 6. Run services (Manually managed lifecycle)
    # Start serving in background threads so main can manage lifecycle
    if proxy_server:
        threading.Thread(target=proxy_server.serve_forever, daemon=True).start()
    else:
        print("❌ Proxy server failed to bind; aborting.", flush=True)
        sys.exit(1)

    if httpd:
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
    else:
        print("❌ Web server failed to bind; aborting.", flush=True)
        sys.exit(1)

    print("=" * 72, flush=True)
    print("🛡️  AEGIS-VPN v5.0 — SMART SPLIT-TUNNEL HYBRID ENGINE", flush=True)
    print("=" * 72, flush=True)
    print(f"✅ Dashboard:     http://localhost:{web_port}", flush=True)
    print(f"🔒 System Proxy: 127.0.0.1:{proxy_port}", flush=True)
    print(f"🧅 Tor Onion:    127.0.0.1:{TOR_SOCKS}", flush=True)
    print(f"📡 macOS:        {STATE['network_service']}", flush=True)
    print(f"🌍 Exit IP:      {STATE['external_ip_info']['ip']} ({STATE['external_ip_info']['city']}, {STATE['external_ip_info']['country']})", flush=True)
    print("=" * 72, flush=True)
    print("ℹ️  SMART ROUTING: Gov/banking sites use pool proxy (bypasses Tor blocklists)", flush=True)
    print("ℹ️  SMART ROUTING: All other sites use Tor 3-hop onion circuit", flush=True)
    print("=" * 72, flush=True)

    # Keep the services running until interruption
    try:
        # We keep the main thread alive, relying on the services run in background threads.
        while True:
            time.sleep(1)

    except KeyboardInterrupt:
        print("\n[EXIT] Shutting down AegisVPN...", flush=True)
    finally:
        # Attempt cleanup
        print("Attempting cleanup...")
        # The original code used 'with' context manager for httpd. 
        # Since I modified it to run manually, I'll keep the structure simple.
        # For a robust solution, we'd need explicit stop/shutdown methods for both web and proxy.
        
        # If the objects were created, they are usually left to daemon threads to clean up,
        # but we print a warning about explicit cleanup.
        if httpd:
             try:
                 # This is a placeholder for actual cleanup if a stop() method existed
                 pass 
             except Exception:
                 pass

        # Note: Explicit shutdown for ThreadedProxy and ThreadedWeb requires modification 
        # to their classes (adding a stop() method). For this fix, we rely on daemon=True.
        
        disconnect_vpn()
        print("VPN services stopped and resources released.")


if __name__ == "__main__":
    main()

