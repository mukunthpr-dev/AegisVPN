// AegisVPN Speed Test & Real-time Throughput Graph Renderer
// Live Canvas waveform telemetry, Download/Upload Mbps, Ping & Jitter metrics

export class SpeedTestMonitor {
  constructor(canvasId, options = {}) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.isRunning = false;
    this.isConnected = options.isConnected || false;
    this.basePing = options.basePing || 15;

    // Telemetry metrics
    this.downloadMbps = 0;
    this.uploadMbps = 0;
    this.pingMs = this.basePing;
    this.jitterMs = 1.2;
    this.packetLoss = 0.0;
    this.totalDataBytes = 1428570000; // Simulated session usage

    // Historical data buffer for canvas graph (60 data points)
    this.historyLength = 50;
    this.downloadHistory = new Array(this.historyLength).fill(0);
    this.uploadHistory = new Array(this.historyLength).fill(0);

    this.initCanvas();
    this.startBackgroundTrafficSimulator();
  }

  initCanvas() {
    if (!this.canvas) return;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.width = rect.width;
    this.height = 140;
    this.dpr = window.devicePixelRatio || 1;

    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    if (this.ctx) this.ctx.scale(this.dpr, this.dpr);
  }

  startBackgroundTrafficSimulator() {
    setInterval(() => {
      if (this.isConnected && !this.isRunning) {
        // Subtle ambient live traffic
        const noiseDown = Math.max(5, (Math.sin(Date.now() / 1500) + 1) * 35 + Math.random() * 15);
        const noiseUp = Math.max(2, (Math.cos(Date.now() / 1800) + 1) * 12 + Math.random() * 6);
        
        this.downloadMbps = parseFloat(noiseDown.toFixed(1));
        this.uploadMbps = parseFloat(noiseUp.toFixed(1));
        this.pingMs = Math.max(8, Math.round(this.basePing + (Math.random() * 4 - 2)));
        this.jitterMs = parseFloat((0.8 + Math.random() * 0.9).toFixed(1));
        this.totalDataBytes += (this.downloadMbps + this.uploadMbps) * 125000; // accumulate bytes

        this.pushHistory(this.downloadMbps, this.uploadMbps);
      } else if (!this.isConnected && !this.isRunning) {
        this.downloadMbps = 0;
        this.uploadMbps = 0;
        this.pingMs = 0;
        this.jitterMs = 0;
        this.pushHistory(0, 0);
      }
      this.drawGraph();
    }, 400);
  }

  pushHistory(down, up) {
    this.downloadHistory.push(down);
    if (this.downloadHistory.length > this.historyLength) this.downloadHistory.shift();

    this.uploadHistory.push(up);
    if (this.uploadHistory.length > this.historyLength) this.uploadHistory.shift();
  }

  async runFullSpeedTest(onUpdate, onComplete) {
    if (this.isRunning) return;
    this.isRunning = true;

    // Stage 1: Ping / Jitter determination (1.2 seconds)
    if (onUpdate) onUpdate({ stage: 'ping', status: 'Measuring Latency & Jitter...' });
    for (let i = 0; i < 6; i++) {
      this.pingMs = Math.max(6, Math.round(this.basePing + (Math.random() * 3 - 1.5)));
      this.jitterMs = parseFloat((0.4 + Math.random() * 0.8).toFixed(1));
      if (onUpdate) onUpdate({ ping: this.pingMs, jitter: this.jitterMs, stage: 'ping' });
      await new Promise(r => setTimeout(r, 200));
    }

    // Stage 2: Download Speed Ramp-up (3.5 seconds)
    if (onUpdate) onUpdate({ stage: 'download', status: 'Testing 10Gbps Multi-Stream Download...' });
    const targetDown = 750 + Math.random() * 220; // 750-970 Mbps realistic high-speed tunnel
    const downSteps = 20;
    for (let i = 1; i <= downSteps; i++) {
      const progress = i / downSteps;
      const currentDown = targetDown * Math.sin(progress * Math.PI / 2) + (Math.random() * 40 - 20);
      this.downloadMbps = parseFloat(Math.max(10, currentDown).toFixed(1));
      this.pushHistory(this.downloadMbps, this.uploadMbps);
      this.drawGraph();
      if (onUpdate) onUpdate({ download: this.downloadMbps, stage: 'download' });
      await new Promise(r => setTimeout(r, 150));
    }

    // Stage 3: Upload Speed Ramp-up (3.0 seconds)
    if (onUpdate) onUpdate({ stage: 'upload', status: 'Testing Encrypted Pipe Upload Throughput...' });
    const targetUp = 380 + Math.random() * 150; // 380-530 Mbps upload
    const upSteps = 16;
    for (let i = 1; i <= upSteps; i++) {
      const progress = i / upSteps;
      const currentUp = targetUp * Math.sin(progress * Math.PI / 2) + (Math.random() * 30 - 15);
      this.uploadMbps = parseFloat(Math.max(8, currentUp).toFixed(1));
      this.pushHistory(this.downloadMbps, this.uploadMbps);
      this.drawGraph();
      if (onUpdate) onUpdate({ upload: this.uploadMbps, stage: 'upload' });
      await new Promise(r => setTimeout(r, 150));
    }

    this.isRunning = false;
    if (onComplete) {
      onComplete({
        download: this.downloadMbps,
        upload: this.uploadMbps,
        ping: this.pingMs,
        jitter: this.jitterMs,
        packetLoss: 0.0
      });
    }
  }

  drawGraph() {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    const maxVal = Math.max(100, ...this.downloadHistory, ...this.uploadHistory);
    const stepX = this.width / (this.historyLength - 1);

    // Draw grid
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let y = 0; y < this.height; y += 35) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }
    ctx.restore();

    // Draw Download Area & Line (Cyan)
    this.drawLineSeries(ctx, this.downloadHistory, maxVal, stepX, '#00f2fe', 'rgba(0, 242, 254, 0.15)');

    // Draw Upload Area & Line (Purple/Pink)
    this.drawLineSeries(ctx, this.uploadHistory, maxVal, stepX, '#d946ef', 'rgba(217, 70, 239, 0.12)');
  }

  drawLineSeries(ctx, data, maxVal, stepX, strokeColor, fillColor) {
    ctx.save();

    ctx.beginPath();
    data.forEach((val, i) => {
      const x = i * stepX;
      const y = this.height - (val / maxVal) * (this.height - 20) - 10;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    // Fill underneath
    ctx.lineTo(this.width, this.height);
    ctx.lineTo(0, this.height);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    // Stroke line
    ctx.beginPath();
    data.forEach((val, i) => {
      const x = i * stepX;
      const y = this.height - (val / maxVal) * (this.height - 20) - 10;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.shadowColor = strokeColor;
    ctx.shadowBlur = 6;
    ctx.stroke();

    ctx.restore();
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
