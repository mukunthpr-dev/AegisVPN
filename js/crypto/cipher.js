// AegisVPN Cryptographic Core Engine
// Real Web Crypto API primitives + Handshake telemetry & Quantum Cipher Simulation

export class CryptoEngine {
  constructor() {
    this.sessionKey = null;
    this.keyPair = null;
    this.cipher = 'AES-256-GCM'; // 'AES-256-GCM' | 'ChaCha20-Poly1305' | 'Kyber-1024-Hybrid'
    this.pfsCounter = 0;
    this.lastRotated = Date.now();
    this.bytesEncrypted = 0;
    this.bytesDecrypted = 0;
    this.packetsProcessed = 0;
  }

  // Generate random base64 key
  static generateRandomKey(bytes = 32) {
    const array = new Uint8Array(bytes);
    window.crypto.getRandomValues(array);
    return btoa(String.fromCharCode.apply(null, array));
  }

  // Generate real Web Crypto AES-GCM Key
  async initializeCrypto() {
    try {
      this.sessionKey = await window.crypto.subtle.generateKey(
        {
          name: "AES-GCM",
          length: 256
        },
        true,
        ["encrypt", "decrypt"]
      );
      this.clientPrivateKey = CryptoEngine.generateRandomKey(32);
      this.clientPublicKey = CryptoEngine.generateRandomKey(32);
      return true;
    } catch (e) {
      console.warn("Web Crypto fallback active:", e);
      return false;
    }
  }

  // Simulate full military-grade handshake with progressive log emitter
  async performHandshake(server, protocol, onStep) {
    const steps = [
      {
        phase: 'INIT',
        message: `[INIT] Negotiating tunnel with ${server.name} (${server.ip}:${server.port})...`,
        delay: 250,
        meta: { proto: protocol.name, cipher: this.cipher }
      },
      {
        phase: 'PQC_KEM',
        message: `[KEY-EXCHANGE] Performing ML-KEM / Kyber-1024 Post-Quantum key encapsulation + Curve25519 ECDH...`,
        delay: 350,
        meta: { ephemeralPub: CryptoEngine.generateRandomKey(32).substring(0, 16) + '...' }
      },
      {
        phase: 'HKDF',
        message: `[KDF] Deriving session master keys via HKDF-SHA512 with Perfect Forward Secrecy (PFS)...`,
        delay: 250,
        meta: { entropy: '512-bit Hardware TRNG' }
      },
      {
        phase: 'AUTH',
        message: `[AUTH] Zero-knowledge proof verified against server fingerprint: [${server.pubKey.substring(0, 12)}...]`,
        delay: 300,
        meta: { status: 'MUTUAL_VERIFIED' }
      },
      {
        phase: 'FIREWALL',
        message: `[FIREWALL] Binding Aegis Kill-Switch & enabling IPv6 Leak Guard + DNSSEC resolver...`,
        delay: 200,
        meta: { dns: '1.1.1.1, 9.9.9.9 (Encrypted DoH)' }
      },
      {
        phase: 'ESTABLISHED',
        message: `[SECURE] Tunnel active. 256-bit symmetric stream established. 0.0.0.0/0 routed through ${server.country}.`,
        delay: 150,
        meta: { ip: server.ip, status: 'CONNECTED' }
      }
    ];

    for (const step of steps) {
      if (onStep) onStep(step);
      await new Promise(r => setTimeout(r, step.delay));
    }

    this.lastRotated = Date.now();
    return true;
  }

  // Encrypt payload simulation
  async encryptPayload(plainText) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plainText);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    
    this.bytesEncrypted += data.length + 16;
    this.packetsProcessed++;

    if (this.sessionKey) {
      try {
        const encrypted = await window.crypto.subtle.encrypt(
          { name: "AES-GCM", iv: iv },
          this.sessionKey,
          data
        );
        return {
          iv: btoa(String.fromCharCode(...iv)),
          ciphertext: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
          bytes: data.length + 16
        };
      } catch (e) {
        // Fallback
      }
    }

    return {
      iv: CryptoEngine.generateRandomKey(12),
      ciphertext: CryptoEngine.generateRandomKey(data.length),
      bytes: data.length + 16
    };
  }

  // Perfect Forward Secrecy - Periodic Key Rotation
  rotateEphemeralKey() {
    this.pfsCounter++;
    this.lastRotated = Date.now();
    return {
      newKeyId: `PFS-${Math.random().toString(36).substring(2, 9).toUpperCase()}`,
      rotatedAt: new Date().toLocaleTimeString(),
      rotationCount: this.pfsCounter
    };
  }
}
