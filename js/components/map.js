// AegisVPN Canvas World Map & Interactive Topology Visualizer
// Renders global nodes, glowing pulsing arcs, encrypted packet streams & multi-hop paths

export class WorldMapVisualizer {
  constructor(canvasId, options = {}) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.servers = options.servers || [];
    this.activeServer = options.activeServer || null;
    this.hop2Server = options.hop2Server || null;
    this.userOrigin = options.userOrigin || { lat: 37.7749, lon: -122.4194, name: 'Local Device', ip: '127.0.0.1' };
    this.isConnected = options.isConnected || false;
    this.isConnecting = options.isConnecting || false;
    this.onSelectServer = options.onSelectServer || (() => {});

    this.particles = [];
    this.pulseAngle = 0;
    this.hoveredServer = null;
    this.animationFrameId = null;

    this.initCanvas();
    this.initEventListeners();
    this.startAnimationLoop();
  }

  initCanvas() {
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.width = rect.width;
    this.height = Math.max(380, Math.min(520, rect.width * 0.48));
    this.dpr = window.devicePixelRatio || 1;

    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.scale(this.dpr, this.dpr);
  }

  // Convert Latitude & Longitude to Canvas X, Y (Equirectangular Projection)
  project(lat, lon) {
    const x = ((lon + 180) / 360) * (this.width - 40) + 20;
    const y = ((90 - lat) / 180) * (this.height - 40) + 20;
    return { x, y };
  }

  initEventListeners() {
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      let found = null;
      for (const server of this.servers) {
        const { x, y } = this.project(server.lat, server.lon);
        const dist = Math.hypot(mouseX - x, mouseY - y);
        if (dist <= 12) {
          found = server;
          break;
        }
      }

      this.hoveredServer = found;
      this.canvas.style.cursor = found ? 'pointer' : 'default';
    });

    this.canvas.addEventListener('click', (e) => {
      if (this.hoveredServer) {
        this.onSelectServer(this.hoveredServer);
      }
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.hoveredServer = null;
    });
  }

  updateState({ activeServer, hop2Server, isConnected, isConnecting, servers }) {
    if (activeServer !== undefined) this.activeServer = activeServer;
    if (hop2Server !== undefined) this.hop2Server = hop2Server;
    if (isConnected !== undefined) this.isConnected = isConnected;
    if (isConnecting !== undefined) this.isConnecting = isConnecting;
    if (servers !== undefined) this.servers = servers;
  }

  startAnimationLoop() {
    const loop = () => {
      this.render();
      this.animationFrameId = requestAnimationFrame(loop);
    };
    loop();
  }

  destroy() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }

  render() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    this.pulseAngle += 0.04;
    if (this.pulseAngle > Math.PI * 2) this.pulseAngle = 0;

    // Draw Cyber Background & Grid Lines
    this.drawCyberGrid(ctx);

    // Draw Simplified Stylized Continents
    this.drawStylizedMap(ctx);

    // Draw Active VPN Tunnel Arcs & Particles
    if (this.activeServer && (this.isConnected || this.isConnecting)) {
      const origin = this.project(this.userOrigin.lat, this.userOrigin.lon);
      const hop1 = this.project(this.activeServer.lat, this.activeServer.lon);

      this.drawCurvedBeam(ctx, origin, hop1, '#00f2fe', '#4facfe');

      if (this.hop2Server) {
        const hop2 = this.project(this.hop2Server.lat, this.hop2Server.lon);
        this.drawCurvedBeam(ctx, hop1, hop2, '#ff0844', '#ffb199');
      }
    }

    // Draw User Origin Point
    this.drawOriginNode(ctx);

    // Draw Server Nodes
    this.drawServerNodes(ctx);

    // Draw Hover Tooltip
    if (this.hoveredServer) {
      this.drawTooltip(ctx, this.hoveredServer);
    }
  }

  drawCyberGrid(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.04)';
    ctx.lineWidth = 1;

    // Longitude lines
    for (let x = 20; x < this.width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }

    // Latitude lines
    for (let y = 20; y < this.height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }

    // Equator highlight
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.08)';
    ctx.beginPath();
    ctx.moveTo(0, this.height / 2);
    ctx.lineTo(this.width, this.height / 2);
    ctx.stroke();

    ctx.restore();
  }

  drawStylizedMap(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.12)';
    ctx.lineWidth = 1;

    // Stylized landmass polygons (North America, South America, Eurasia, Africa, Australia)
    const landmasses = [
      // North America
      [[15, -125], [60, -140], [70, -70], [45, -55], [25, -80], [10, -85], [20, -105]],
      // South America
      [[10, -75], [5, -50], [-25, -45], [-55, -68], [-20, -70], [0, -80]],
      // Europe & Asia
      [[35, -10], [60, 5], [70, 40], [70, 140], [60, 170], [35, 140], [20, 120], [10, 105], [25, 60], [40, 30], [35, -10]],
      // Africa
      [[35, -5], [30, 32], [10, 50], [-34, 20], [5, 10], [15, -17]],
      // Australia
      [[-12, 130], [-15, 145], [-38, 145], [-35, 115], [-20, 115]],
      // Greenland / Iceland
      [[75, -40], [70, -20], [65, -45], [80, -40]]
    ];

    for (const polygon of landmasses) {
      ctx.beginPath();
      polygon.forEach((pt, idx) => {
        const { x, y } = this.project(pt[0], pt[1]);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }

  drawCurvedBeam(ctx, p1, p2, colorStart, colorEnd) {
    ctx.save();

    // Control point for smooth curved arc
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.hypot(dx, dy);
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2 - Math.min(80, dist * 0.35);

    // Glowing Arc Path
    const grad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
    grad.addColorStop(0, colorStart);
    grad.addColorStop(1, colorEnd);

    // Outer glow
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.quadraticCurveTo(midX, midY, p2.x, p2.y);
    ctx.strokeStyle = colorStart;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 6;
    ctx.stroke();

    // Core laser line
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.quadraticCurveTo(midX, midY, p2.x, p2.y);
    ctx.strokeStyle = grad;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Flowing Particles (Encrypted Packets)
    const particleCount = 5;
    for (let i = 0; i < particleCount; i++) {
      const t = ((Date.now() / 1200) + (i / particleCount)) % 1;
      const px = (1 - t) * (1 - t) * p1.x + 2 * (1 - t) * t * midX + t * t * p2.x;
      const py = (1 - t) * (1 - t) * p1.y + 2 * (1 - t) * t * midY + t * t * p2.y;

      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = colorStart;
      ctx.shadowBlur = 10;
      ctx.fill();
    }

    ctx.restore();
  }

  drawOriginNode(ctx) {
    const { x, y } = this.project(this.userOrigin.lat, this.userOrigin.lon);
    ctx.save();

    // Pulsing ring
    const pulse = (Math.sin(this.pulseAngle * 1.5) + 1) / 2;
    ctx.beginPath();
    ctx.arc(x, y, 6 + pulse * 6, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Core point
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#00f2fe';
    ctx.shadowColor = '#00f2fe';
    ctx.shadowBlur = 8;
    ctx.fill();

    // Label
    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = 'rgba(0, 242, 254, 0.85)';
    ctx.fillText('YOU', x + 8, y - 4);

    ctx.restore();
  }

  drawServerNodes(ctx) {
    ctx.save();

    for (const server of this.servers) {
      const { x, y } = this.project(server.lat, server.lon);
      const isActive = this.activeServer && this.activeServer.id === server.id;
      const isHop2 = this.hop2Server && this.hop2Server.id === server.id;
      const isHovered = this.hoveredServer && this.hoveredServer.id === server.id;

      if (isActive) {
        // Active server glowing beacon
        const pulse = (Math.sin(this.pulseAngle * 2) + 1) / 2;
        ctx.beginPath();
        ctx.arc(x, y, 8 + pulse * 8, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0, 242, 254, 0.6)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#00f2fe';
        ctx.shadowColor = '#00f2fe';
        ctx.shadowBlur = 12;
        ctx.fill();
      } else if (isHop2) {
        // Double VPN exit node beacon
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#ff0844';
        ctx.shadowColor = '#ff0844';
        ctx.shadowBlur = 10;
        ctx.fill();
      } else {
        // Regular server node
        ctx.beginPath();
        ctx.arc(x, y, isHovered ? 4.5 : 2.5, 0, Math.PI * 2);
        ctx.fillStyle = isHovered ? '#00f2fe' : 'rgba(255, 255, 255, 0.45)';
        if (isHovered) {
          ctx.shadowColor = '#00f2fe';
          ctx.shadowBlur = 8;
        }
        ctx.fill();
      }
    }

    ctx.restore();
  }

  drawTooltip(ctx, server) {
    const { x, y } = this.project(server.lat, server.lon);
    ctx.save();

    const padding = 10;
    const boxWidth = 170;
    const boxHeight = 65;
    let boxX = x + 12;
    let boxY = y - boxHeight - 8;

    if (boxX + boxWidth > this.width) boxX = x - boxWidth - 12;
    if (boxY < 10) boxY = y + 15;

    // Glass backdrop
    ctx.fillStyle = 'rgba(10, 15, 29, 0.92)';
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.4)';
    ctx.lineWidth = 1.2;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 14;

    this.roundRect(ctx, boxX, boxY, boxWidth, boxHeight, 8, true, true);

    // Text Content
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.fillText(`${server.flag} ${server.city}, ${server.code}`, boxX + padding, boxY + 18);

    ctx.fillStyle = '#a0aec0';
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText(`Ping: `, boxX + padding, boxY + 36);

    ctx.fillStyle = server.ping < 20 ? '#10b981' : server.ping < 40 ? '#f59e0b' : '#ef4444';
    ctx.fillText(`${server.ping} ms`, boxX + padding + 35, boxY + 36);

    ctx.fillStyle = '#a0aec0';
    ctx.fillText(`Load: `, boxX + padding + 90, boxY + 36);

    ctx.fillStyle = server.load < 50 ? '#10b981' : '#f59e0b';
    ctx.fillText(`${server.load}%`, boxX + padding + 125, boxY + 36);

    ctx.fillStyle = 'rgba(0, 242, 254, 0.85)';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillText(`⚡ 10 Gbps RAM-Only`, boxX + padding, boxY + 53);

    ctx.restore();
  }

  roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }
}
