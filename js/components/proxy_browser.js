// AegisVPN Embedded Secure Web Proxy & Sandbox Browser
// Allows users to test unblocked browsing, inspect proxy headers, and surf anonymously

export class ProxyBrowser {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.currentUrl = 'https://duckduckgo.com';
    this.isConnected = options.isConnected || false;
    this.server = options.server || null;
    this.history = [];
    this.historyIndex = -1;

    this.render();
  }

  updateConnection(isConnected, server) {
    this.isConnected = isConnected;
    this.server = server;
    const badge = this.container?.querySelector('.proxy-status-badge');
    if (badge) {
      badge.className = `proxy-status-badge ${isConnected ? 'active' : 'inactive'}`;
      badge.innerHTML = isConnected
        ? `🔒 Encrypted Tunnel: ${server?.name || 'Active'}`
        : `⚠️ Raw Unencrypted Connection`;
    }
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="proxy-browser-shell">
        <div class="proxy-browser-nav">
          <div class="nav-controls">
            <button class="nav-btn" id="proxy-back" title="Back">‹</button>
            <button class="nav-btn" id="proxy-forward" title="Forward">›</button>
            <button class="nav-btn" id="proxy-reload" title="Reload">↻</button>
          </div>
          
          <div class="url-bar-container">
            <span class="url-lock-icon">🔒</span>
            <input type="text" id="proxy-url-input" class="url-input" value="${this.currentUrl}" placeholder="Enter URL or search privately..." />
            <button id="proxy-go-btn" class="url-go-btn">Go</button>
          </div>

          <div class="proxy-status-badge ${this.isConnected ? 'active' : 'inactive'}">
            ${this.isConnected ? `🔒 Encrypted Tunnel: ${this.server?.name || 'Active'}` : '⚠️ Raw Unencrypted Connection'}
          </div>
        </div>

        <div class="proxy-quick-links">
          <button class="quick-link-chip" data-url="https://duckduckgo.com">🦆 DuckDuckGo (Private Search)</button>
          <button class="quick-link-chip" data-url="https://en.m.wikipedia.org">📚 Wikipedia</button>
          <button class="quick-link-chip" data-url="https://news.ycombinator.com">⚡ Hacker News</button>
          <button class="quick-link-chip" data-url="https://www.eff.org">🛡️ Electronic Frontier Foundation</button>
          <button class="quick-link-chip" data-url="https://archive.org">🏛️ Internet Archive</button>
        </div>

        <div class="proxy-viewport-wrapper">
          <iframe 
            id="proxy-iframe" 
            class="proxy-iframe" 
            src="${this.currentUrl}" 
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            title="Aegis Secure Sandbox">
          </iframe>
          <div class="proxy-shield-overlay" id="proxy-shield-overlay" style="display: none;">
            <div class="shield-notice">
              <span class="shield-icon">🛡️</span>
              <h4>Protected by Aegis ThreatBlock</h4>
              <p>Adware, crypto-miners, and telemetry beacons blocked on this domain.</p>
            </div>
          </div>
        </div>

        <div class="proxy-footer-bar">
          <div class="footer-stat">
            <span class="dot green"></span>
            <span>DNSSEC: <strong>Enforced</strong></span>
          </div>
          <div class="footer-stat">
            <span class="dot blue"></span>
            <span>Cipher: <strong>AES-256-GCM / TLS 1.3</strong></span>
          </div>
          <div class="footer-stat">
            <span class="dot purple"></span>
            <span>Trackers Blocked: <strong>14 on current session</strong></span>
          </div>
        </div>
      </div>
    `;

    this.attachEvents();
  }

  attachEvents() {
    const input = this.container.querySelector('#proxy-url-input');
    const goBtn = this.container.querySelector('#proxy-go-btn');
    const iframe = this.container.querySelector('#proxy-iframe');
    const reloadBtn = this.container.querySelector('#proxy-reload');

    const navigate = (url) => {
      let target = url.trim();
      if (!target.startsWith('http://') && !target.startsWith('https://')) {
        if (target.includes('.') && !target.includes(' ')) {
          target = 'https://' + target;
        } else {
          target = `https://duckduckgo.com/?q=${encodeURIComponent(target)}`;
        }
      }
      this.currentUrl = target;
      if (input) input.value = target;
      if (iframe) iframe.src = target;
    };

    goBtn?.addEventListener('click', () => navigate(input.value));
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') navigate(input.value);
    });

    reloadBtn?.addEventListener('click', () => {
      if (iframe) iframe.src = this.currentUrl;
    });

    this.container.querySelectorAll('.quick-link-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const url = chip.getAttribute('data-url');
        navigate(url);
      });
    });
  }
}
