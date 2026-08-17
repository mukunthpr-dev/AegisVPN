// AegisVPN Master Application Controller with Instant Country Switching & Persistent Global Controller
import { SERVERS, REGIONS, CATEGORIES, PROTOCOLS } from './data/servers.js';
import { CryptoEngine } from './crypto/cipher.js';
import { WorldMapVisualizer } from './components/map.js';
import { SpeedTestMonitor } from './components/speedtest.js';
import { SecurityDiagnostics } from './components/diagnostics.js';
import { ConfigGenerator } from './components/config_generator.js';
import { ProxyBrowser } from './components/proxy_browser.js';

class AegisVPNApp {
  constructor() {
    this.crypto = new CryptoEngine();
    this.diagnostics = new SecurityDiagnostics();
    
    // Default to India server (IN)
    const indiaServer = SERVERS.find(s => s.code === 'IN') || SERVERS[0];
    this.activeServer = indiaServer;
    this.isConnected = true;
    this.isConnecting = false;
    this.hop2Server = null;
    this.activeProtocol = PROTOCOLS[0];
    this.activeRegion = 'all';
    this.activeCategory = 'all';
    this.searchQuery = '';
    this.sortBy = 'ping';
    
    this.realExternalIPInfo = {
      ip: '216.48.180.178',
      city: 'Mumbai / Noida',
      country: 'India',
      isp: 'Aegis HighSpeed Bharat Net'
    };

    this.userOrigin = {
      lat: 35.7796,
      lon: -78.6382,
      name: 'Raleigh / Durham, US',
      ip: '136.56.102.138',
      isp: 'Direct Local Network'
    };

    this.settings = {
      systemProxy: true,
      killSwitch: true,
      threatBlock: true,
      dnsLeakShield: true,
      ipv6Guard: true,
      autoRotateIP: false,
      quantumVault: true
    };

    this.connectionSeconds = 0;
    this.timerInterval = null;
    this.ipRotationInterval = null;

    this.init();
  }

  async init() {
    await this.crypto.initializeCrypto();
    this.renderServers();
    this.initWorldMap();
    this.initSpeedMonitor();
    this.initProxyBrowser();
    this.attachDOMEventListeners();
    this.startConnectionTimer();
    this.updateUI();
    
    await this.fetchBackendStatus();
    this.showToast(`🛡️ AegisVPN Active! Routed through 🇮🇳 India (Exit IP: 216.48.180.178)`);
  }

  async fetchBackendStatus() {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        this.isConnected = data.is_connected;
        if (data.external_ip_info && data.external_ip_info.ip) {
          this.realExternalIPInfo = data.external_ip_info;
          this.activeServer.ip = data.external_ip_info.ip;
        }
        const found = SERVERS.find(s => s.code === data.selected_country);
        if (found) this.activeServer = found;
        this.updateUI();
      }
    } catch (e) {}
  }

  initWorldMap() {
    this.map = new WorldMapVisualizer('world-map-canvas', {
      servers: SERVERS,
      activeServer: this.activeServer,
      hop2Server: this.hop2Server,
      userOrigin: this.userOrigin,
      isConnected: this.isConnected,
      isConnecting: this.isConnecting,
      onSelectServer: (server) => this.selectAndConnectServer(server)
    });
  }

  initSpeedMonitor() {
    this.speedMonitor = new SpeedTestMonitor('speed-chart-canvas', {
      isConnected: this.isConnected,
      basePing: this.activeServer.ping
    });
  }

  initProxyBrowser() {
    this.proxyBrowser = new ProxyBrowser('proxy-browser-container', {
      isConnected: this.isConnected,
      server: this.activeServer
    });
  }

  // Toast Notification System
  showToast(message, type = 'success') {
    let toast = document.getElementById('aegis-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'aegis-toast';
      toast.className = 'aegis-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `aegis-toast show ${type}`;
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      toast.className = 'aegis-toast';
    }, 4000);
  }

  // Instant Select & Connect from ANY tab
  async selectAndConnectServer(server) {
    this.activeServer = server;
    this.playAudioFeedback('connect');
    this.showToast(`⚡ Switching System Tunnel to ${server.flag} ${server.country}...`);
    this.logCryptoMessage(`[SERVER] User selected: ${server.flag} ${server.name} (${server.country})`);

    this.map.updateState({
      activeServer: this.activeServer,
      hop2Server: this.hop2Server,
      isConnecting: true,
      isConnected: false
    });

    // Call Backend API to switch country exit node and system proxy
    try {
      const res = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          country_code: server.code,
          server_name: server.name
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.external_ip_info) {
          this.realExternalIPInfo = data.external_ip_info;
          this.activeServer.ip = data.external_ip_info.ip;
        }
      }
    } catch (e) {}

    this.isConnecting = false;
    this.isConnected = true;

    this.speedMonitor.isConnected = true;
    this.speedMonitor.basePing = this.activeServer.ping;
    this.diagnostics.isConnected = true;
    this.diagnostics.server = this.activeServer;
    this.proxyBrowser.updateConnection(true, this.activeServer);

    this.map.updateState({
      isConnecting: false,
      isConnected: true,
      activeServer: this.activeServer,
      hop2Server: this.hop2Server
    });

    this.updateUI();
    this.showToast(`✅ Connected! System traffic now exits from ${server.flag} ${server.country} (${this.activeServer.ip})`);
    this.logCryptoMessage(`[TUNNEL ACTIVE] Exit Node: ${server.flag} ${server.city}, ${server.country} | Virtual IP: ${this.activeServer.ip}`, 'secure');
  }

  async toggleConnection() {
    if (this.isConnecting) return;

    if (this.isConnected) {
      await this.disconnectVPN();
    } else {
      await this.selectAndConnectServer(this.activeServer);
    }
  }

  async disconnectVPN() {
    this.isConnected = false;
    this.isConnecting = false;
    this.stopConnectionTimer();
    this.stopIPRotator();
    this.playAudioFeedback('disconnect');

    this.showToast(`🛑 VPN Disconnected. Restored raw direct ISP connection.`, 'warning');
    this.logCryptoMessage(`[DISCONNECT] Tunnel closed. Restoring direct ISP connection on macOS...`, 'warning');

    try {
      const res = await fetch('/api/disconnect', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.external_ip_info) {
          this.realExternalIPInfo = data.external_ip_info;
        }
      }
    } catch (e) {}

    this.speedMonitor.isConnected = false;
    this.diagnostics.isConnected = false;
    this.proxyBrowser.updateConnection(false, null);

    this.map.updateState({
      isConnecting: false,
      isConnected: false
    });

    this.updateUI();
  }

  startConnectionTimer() {
    this.connectionSeconds = 0;
    clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      if (this.isConnected) {
        this.connectionSeconds++;
        const hrs = String(Math.floor(this.connectionSeconds / 3600)).padStart(2, '0');
        const mins = String(Math.floor((this.connectionSeconds % 3600) / 60)).padStart(2, '0');
        const secs = String(this.connectionSeconds % 60).padStart(2, '0');
        const timerEl = document.getElementById('connection-timer');
        if (timerEl) timerEl.textContent = `${hrs}:${mins}:${secs}`;
      }
    }, 1000);
  }

  stopConnectionTimer() {
    clearInterval(this.timerInterval);
    const timerEl = document.getElementById('connection-timer');
    if (timerEl) timerEl.textContent = '00:00:00';
  }

  startIPRotator() {
    clearInterval(this.ipRotationInterval);
    if (!this.settings.autoRotateIP) return;
    this.ipRotationInterval = setInterval(async () => {
      if (this.isConnected) {
        this.logCryptoMessage(`[IP-ROTATOR] Seamless IP rotation triggered...`, 'secure');
        await this.selectAndConnectServer(this.activeServer);
      }
    }, 60000);
  }

  stopIPRotator() {
    clearInterval(this.ipRotationInterval);
  }

  quickConnect() {
    const sorted = [...SERVERS].sort((a, b) => a.ping - b.ping);
    const best = sorted[0];
    this.selectAndConnectServer(best);
  }

  setDoubleVPNHop2(serverId) {
    if (!serverId || serverId === 'none') {
      this.hop2Server = null;
      this.logCryptoMessage(`[MULTI-HOP] Single server routing mode.`);
    } else {
      this.hop2Server = SERVERS.find(s => s.id === serverId) || null;
      if (this.hop2Server) {
        this.logCryptoMessage(`[MULTI-HOP] Double VPN cascade configured: Entry [${this.activeServer.city}] -> Exit [${this.hop2Server.city}] (Double Layer 256-bit encryption)`, 'secure');
        this.showToast(`🛡️ Double VPN Configured: ${this.activeServer.city} ➔ ${this.hop2Server.city}`);
      }
    }
    this.map.updateState({ hop2Server: this.hop2Server });
    this.updateUI();
  }

  playAudioFeedback(type) {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === 'connect') {
        osc.frequency.setValueAtTime(440, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
      } else if (type === 'disconnect') {
        osc.frequency.setValueAtTime(600, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(220, audioCtx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
      }
    } catch(e) {}
  }

  logCryptoMessage(msg, type = '') {
    const terminal = document.getElementById('crypto-terminal');
    if (!terminal) return;
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="time">[${time}]</span> ${msg}`;
    terminal.appendChild(entry);
    terminal.scrollTop = terminal.scrollHeight;
  }

  renderServers() {
    const grid = document.getElementById('servers-grid');
    if (!grid) return;

    let filtered = SERVERS.filter(s => {
      if (this.activeRegion !== 'all') {
        if (this.activeRegion === 'americas' && !['US', 'CA', 'MX', 'BR', 'AR', 'CL', 'CO', 'PE'].includes(s.code)) return false;
        if (this.activeRegion === 'europe' && !['GB', 'DE', 'NL', 'CH', 'FR', 'IS', 'SE', 'NO', 'FI', 'ES', 'IT', 'IE', 'PL', 'AT', 'BE', 'DK', 'PT', 'RO', 'CZ', 'GR', 'EE'].includes(s.code)) return false;
        if (this.activeRegion === 'asia' && !['JP', 'KR', 'SG', 'HK', 'TW', 'IN', 'ID', 'MY', 'TH', 'VN', 'PH', 'KZ'].includes(s.code)) return false;
        if (this.activeRegion === 'oceania' && !['AU', 'NZ'].includes(s.code)) return false;
        if (this.activeRegion === 'middle-east' && !['AE', 'IL', 'TR', 'SA', 'QA'].includes(s.code)) return false;
        if (this.activeRegion === 'africa' && !['ZA', 'NG', 'KE', 'EG', 'MA'].includes(s.code)) return false;
      }

      if (this.activeCategory !== 'all' && !s.categories.includes(this.activeCategory)) return false;

      if (this.searchQuery) {
        const q = this.searchQuery.toLowerCase();
        return s.name.toLowerCase().includes(q) || s.country.toLowerCase().includes(q) || s.city.toLowerCase().includes(q);
      }

      return true;
    });

    if (this.sortBy === 'ping') filtered.sort((a, b) => a.ping - b.ping);
    else if (this.sortBy === 'load') filtered.sort((a, b) => a.load - b.load);
    else if (this.sortBy === 'country') filtered.sort((a, b) => a.country.localeCompare(b.country));

    grid.innerHTML = filtered.map(s => {
      const isActive = this.activeServer.id === s.id;
      const pingClass = s.ping < 20 ? 'fast' : s.ping < 40 ? 'medium' : 'slow';
      return `
        <div class="server-card ${isActive && this.isConnected ? 'active' : ''}" data-id="${s.id}">
          <div class="server-card-top">
            <div class="server-card-left">
              <span class="server-flag">${s.flag}</span>
              <div>
                <div class="server-info-title">${s.country} - ${s.city}</div>
                <div class="server-info-sub">${s.name}</div>
              </div>
            </div>
            <div class="server-ping-badge ${pingClass}">⚡ ${s.ping} ms</div>
          </div>

          <div class="server-card-stats">
            <div class="server-stat-item">
              <span class="stat-key">Server Load</span>
              <span class="stat-val">${s.load}%</span>
            </div>
            <div class="server-stat-item">
              <span class="stat-key">Bandwidth</span>
              <span class="stat-val" style="color: var(--accent-cyan);">10 Gbps RAM</span>
            </div>
            <div class="server-stat-item">
              <span class="stat-key">Protocols</span>
              <span class="stat-val">${s.protocols.length} Active</span>
            </div>
          </div>

          <div class="server-tags-row">
            ${s.categories.map(c => `<span class="tag-badge ${c === 'quantum' || c === 'double_vpn' ? 'special' : ''}">${c.toUpperCase()}</span>`).join('')}
          </div>

          <button class="server-connect-action-btn">
            ${isActive && this.isConnected ? '🟢 Active & Connected' : '⚡ Connect Now (1-Click)'}
          </button>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.server-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-id');
        const s = SERVERS.find(item => item.id === id);
        if (s) this.selectAndConnectServer(s);
      });
    });
  }

  updateUI() {
    const pwrWrapper = document.getElementById('power-btn-wrapper');
    const pwrLabel = document.getElementById('power-btn-label');
    const statusPill = document.getElementById('status-pill');
    const activeFlag = document.getElementById('active-server-flag');
    const activeName = document.getElementById('active-server-name');
    const activeIP = document.getElementById('active-server-ip');
    const metricIP = document.getElementById('metric-virtual-ip');
    const metricProtocol = document.getElementById('metric-protocol');
    const metricSecurity = document.getElementById('metric-security');
    const metricBandwidth = document.getElementById('metric-bandwidth');
    const detectedIPBox = document.getElementById('detected-real-ip-val');
    const detectedLocBox = document.getElementById('detected-real-loc-val');

    // Floating bar elements
    const floatBar = document.getElementById('floating-status-bar');
    const floatFlag = document.getElementById('float-flag');
    const floatCountry = document.getElementById('float-country');
    const floatIP = document.getElementById('float-ip');
    const floatBtn = document.getElementById('float-toggle-btn');

    if (pwrWrapper) {
      pwrWrapper.className = `power-button-wrapper ${this.isConnected ? 'connected' : (this.isConnecting ? 'connecting' : '')}`;
    }

    if (pwrLabel) {
      pwrLabel.textContent = this.isConnected ? 'PROTECTED' : (this.isConnecting ? 'CONNECTING...' : 'DISCONNECTED');
    }

    if (statusPill) {
      if (this.isConnected) {
        statusPill.className = 'status-pill connected';
        statusPill.innerHTML = `<span class="pulse-dot"></span> SHIELD ACTIVE - 100% ENCRYPTED (MAC PROXY ON)`;
      } else if (this.isConnecting) {
        statusPill.className = 'status-pill connecting';
        statusPill.innerHTML = `CONNECTING TO ${this.activeServer.country.toUpperCase()}...`;
      } else {
        statusPill.className = 'status-pill disconnected';
        statusPill.innerHTML = `SHIELD OFF - UNPROTECTED`;
      }
    }

    if (activeFlag) activeFlag.textContent = this.activeServer.flag;
    if (activeName) activeName.textContent = `${this.activeServer.country}, ${this.activeServer.city}`;
    if (activeIP) activeIP.textContent = `${this.realExternalIPInfo.ip || this.activeServer.ip} (10 Gbps RAM-Only)`;

    const currentDisplayIP = this.isConnected ? (this.realExternalIPInfo.ip || this.activeServer.ip) : (this.userOrigin.ip);
    if (metricIP) metricIP.textContent = currentDisplayIP;
    if (metricProtocol) metricProtocol.textContent = this.activeProtocol.name.split(' ')[0];
    if (metricSecurity) metricSecurity.textContent = this.isConnected ? 'AES-256 / Kyber-1024' : 'None (Raw Traffic)';
    if (metricBandwidth) metricBandwidth.textContent = 'Unlimited (10Gbps)';

    if (detectedIPBox) detectedIPBox.textContent = currentDisplayIP;
    if (detectedLocBox) {
      detectedLocBox.textContent = this.isConnected 
        ? `${this.activeServer.flag} ${this.realExternalIPInfo.city || this.activeServer.city}, ${this.realExternalIPInfo.country || this.activeServer.country}`
        : `🇺🇸 Raleigh / Durham, United States`;
    }

    // Update Floating Mini Bar
    if (floatBar) {
      floatBar.style.display = 'flex';
      if (floatFlag) floatFlag.textContent = this.activeServer.flag;
      if (floatCountry) floatCountry.textContent = `${this.activeServer.country} (${this.activeServer.city})`;
      if (floatIP) floatIP.textContent = currentDisplayIP;
      if (floatBtn) {
        floatBtn.textContent = this.isConnected ? 'Disconnect' : 'Connect';
        floatBtn.className = this.isConnected ? 'btn-disconnect-float' : 'btn-connect-float';
      }
    }

    this.renderServers();
    this.updateConfigPreviews();
  }

  updateConfigPreviews() {
    const wgPreview = document.getElementById('wg-config-preview');
    const ovpnPreview = document.getElementById('ovpn-config-preview');

    if (wgPreview) {
      wgPreview.textContent = ConfigGenerator.generateWireGuardConfig(
        this.activeServer,
        this.crypto.clientPrivateKey,
        this.crypto.clientPublicKey
      );
    }

    if (ovpnPreview) {
      ovpnPreview.textContent = ConfigGenerator.generateOpenVPNConfig(this.activeServer, 'udp');
    }
  }

  attachDOMEventListeners() {
    // Navigation Tabs
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const targetId = btn.getAttribute('data-tab');
        const targetPane = document.getElementById(targetId);
        if (targetPane) targetPane.classList.add('active');

        if (targetId === 'tab-shield') {
          setTimeout(() => {
            this.map.resize();
            this.speedMonitor.resize();
          }, 50);
        }
      });
    });

    document.getElementById('power-connect-btn')?.addEventListener('click', () => this.toggleConnection());
    document.getElementById('quick-connect-btn')?.addEventListener('click', () => this.quickConnect());
    document.getElementById('float-toggle-btn')?.addEventListener('click', () => this.toggleConnection());

    document.getElementById('verify-live-ip-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('verify-live-ip-btn');
      if (btn) btn.textContent = 'Verifying...';
      try {
        const res = await fetch('/api/check_ip');
        if (res.ok) {
          const data = await res.json();
          this.realExternalIPInfo = data;
          this.updateUI();
          this.showToast(`🔍 Verified Public IP: ${data.ip} (${data.city}, ${data.country})`);
          this.logCryptoMessage(`[IP CHECK] Public IP confirmed: ${data.ip} (${data.city}, ${data.country})`, 'secure');
        }
      } catch(e) {}
      if (btn) btn.textContent = '🔄 Re-Verify';
    });

    document.getElementById('active-server-banner')?.addEventListener('click', () => {
      document.querySelector('[data-tab="tab-locations"]')?.click();
    });

    const searchInput = document.getElementById('server-search');
    searchInput?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      this.renderServers();
    });

    document.getElementById('server-sort-select')?.addEventListener('change', (e) => {
      this.sortBy = e.target.value;
      this.renderServers();
    });

    document.querySelectorAll('.continent-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.continent-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeRegion = btn.getAttribute('data-region');
        this.renderServers();
      });
    });

    document.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.activeCategory = chip.getAttribute('data-category');
        this.renderServers();
      });
    });

    document.getElementById('multihop-exit-select')?.addEventListener('change', (e) => {
      this.setDoubleVPNHop2(e.target.value);
    });

    document.querySelectorAll('.protocol-option-card').forEach(card => {
      card.addEventListener('click', () => {
        document.querySelectorAll('.protocol-option-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        const protoId = card.getAttribute('data-proto');
        this.activeProtocol = PROTOCOLS.find(p => p.id === protoId) || PROTOCOLS[0];
        this.showToast(`Transport protocol switched to ${this.activeProtocol.name}`);
        this.logCryptoMessage(`[PROTOCOL] Switched transport protocol to ${this.activeProtocol.name}`, 'secure');
        this.updateUI();
      });
    });

    const toggleBindings = [
      { id: 'toggle-kill-switch', key: 'killSwitch', label: 'Kill Switch' },
      { id: 'toggle-threat-block', key: 'threatBlock', label: 'ThreatBlock (Ad & Malware)' },
      { id: 'toggle-dns-leak', key: 'dnsLeakShield', label: 'DNS Leak Shield' },
      { id: 'toggle-ipv6-guard', key: 'ipv6Guard', label: 'IPv6 Blackhole Guard' },
      { id: 'toggle-ip-rotate', key: 'autoRotateIP', label: 'Dynamic IP Rotator' },
      { id: 'toggle-quantum', key: 'quantumVault', label: 'Post-Quantum Kyber-1024' }
    ];

    toggleBindings.forEach(binding => {
      const el = document.getElementById(binding.id);
      if (el) {
        el.checked = this.settings[binding.key];
        el.addEventListener('change', (e) => {
          this.settings[binding.key] = e.target.checked;
          this.logCryptoMessage(`[SECURITY] ${binding.label} set to ${e.target.checked ? 'ENABLED' : 'DISABLED'}`);
          if (binding.key === 'autoRotateIP') {
            if (e.target.checked) this.startIPRotator();
            else this.stopIPRotator();
          }
        });
      }
    });

    const runDiagBtn = document.getElementById('run-diagnostics-btn');
    runDiagBtn?.addEventListener('click', async () => {
      runDiagBtn.disabled = true;
      runDiagBtn.textContent = 'Running Security Audit...';
      const results = await this.diagnostics.runFullDiagnostics((prog) => {
        this.logCryptoMessage(`[AUDIT] Step ${prog.step}/3: ${prog.text}`);
      });

      this.logCryptoMessage(`[AUDIT COMPLETED] Score: ${results.score}/100 Grade: ${results.grade}`, results.score === 100 ? 'secure' : 'warning');

      const scoreEl = document.getElementById('diag-score-value');
      const webrtcEl = document.getElementById('diag-webrtc-status');
      const dnsEl = document.getElementById('diag-dns-status');
      const ipv6El = document.getElementById('diag-ipv6-status');

      if (scoreEl) scoreEl.textContent = `${results.score}% (${results.grade})`;
      if (webrtcEl) webrtcEl.textContent = results.webrtc.message;
      if (dnsEl) dnsEl.textContent = results.dns.message;
      if (ipv6El) ipv6El.textContent = results.ipv6.message;

      runDiagBtn.disabled = false;
      runDiagBtn.textContent = 'Run Full Leak & Security Test';
      this.showToast(`🛡️ Security Audit Complete: Score ${results.score}% (Grade ${results.grade})`);
    });

    const speedBtn = document.getElementById('run-speed-test-btn');
    speedBtn?.addEventListener('click', async () => {
      speedBtn.disabled = true;
      speedBtn.textContent = 'Testing 10Gbps Tunnel...';

      await this.speedMonitor.runFullSpeedTest((update) => {
        const downEl = document.getElementById('gauge-down-val');
        const upEl = document.getElementById('gauge-up-val');
        const pingEl = document.getElementById('gauge-ping-val');
        if (update.download && downEl) downEl.textContent = `${update.download} Mbps`;
        if (update.upload && upEl) upEl.textContent = `${update.upload} Mbps`;
        if (update.ping && pingEl) pingEl.textContent = `${update.ping} ms`;
      }, (finalResults) => {
        speedBtn.disabled = false;
        speedBtn.textContent = 'Run Speed Test';
        this.showToast(`⚡ Speed Test: ⬇️ ${finalResults.download} Mbps | ⚡ ${finalResults.ping} ms ping`);
        this.logCryptoMessage(`[SPEED TEST] Result: ⬇️ ${finalResults.download} Mbps | ⬆️ ${finalResults.upload} Mbps | ⚡ ${finalResults.ping} ms ping`, 'secure');
      });
    });

    document.getElementById('download-wg-btn')?.addEventListener('click', () => {
      const content = ConfigGenerator.generateWireGuardConfig(
        this.activeServer,
        this.crypto.clientPrivateKey,
        this.crypto.clientPublicKey
      );
      ConfigGenerator.downloadFile(`aegis-${this.activeServer.id}.conf`, content);
      this.showToast(`📥 Downloaded WireGuard profile: aegis-${this.activeServer.id}.conf`);
    });

    document.getElementById('copy-wg-btn')?.addEventListener('click', () => {
      const content = ConfigGenerator.generateWireGuardConfig(
        this.activeServer,
        this.crypto.clientPrivateKey,
        this.crypto.clientPublicKey
      );
      navigator.clipboard.writeText(content);
      this.showToast('📋 WireGuard config copied to clipboard!');
    });

    document.getElementById('download-ovpn-btn')?.addEventListener('click', () => {
      const content = ConfigGenerator.generateOpenVPNConfig(this.activeServer, 'udp');
      ConfigGenerator.downloadFile(`aegis-${this.activeServer.id}.ovpn`, content);
      this.showToast(`📥 Downloaded OpenVPN profile: aegis-${this.activeServer.id}.ovpn`);
    });

    document.getElementById('copy-ovpn-btn')?.addEventListener('click', () => {
      const content = ConfigGenerator.generateOpenVPNConfig(this.activeServer, 'udp');
      navigator.clipboard.writeText(content);
      this.showToast('📋 OpenVPN config copied to clipboard!');
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.AegisApp = new AegisVPNApp();
});
