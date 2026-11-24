import { TUNING } from "../config/tuning.js";
import { clamp, rand, hexToRgba } from "../core/math.js";

function normalizeVolume(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function env() {
  return Sound._env;
}

export const Sound = {
  ctx: null,
  _env: null,

  init(context) {
    this._env = context;
    const s = context.getInitialSettings();
    this.muted = !!s.muted;
    this.musicVolume = normalizeVolume(s.musicVolume, 0.8);
    this.sfxVolume = normalizeVolume(s.sfxVolume, 1.0);
    this.trackIdx = Number.isInteger(s.musicTrack) ? s.musicTrack : null;
  },

  master: null,
  sfxGain: null,
  compressor: null,
  reverbSend: null,
  reverbHighpass: null,
  reverbLowpass: null,
  reverb: null,
  reverbReturn: null,
  muted: false,
  musicVolume: 0.8,
  sfxVolume: 1.0,
  musicBaseGain: 1.55,
  musicDuckGain: null,

  // Player 1 oscillators & gains
  engineOscP1: null,
  engineGainP1: null,
  engineFilterP1: null,
  enginePannerP1: null,
  driftOscP1: null,
  driftGainP1: null,
  driftFilterP1: null,
  driftPannerP1: null,
  rumbleOscP1: null,
  rumbleGainP1: null,
  rumbleFilterP1: null,
  rumblePannerP1: null,

  // Player 2 oscillators & gains
  engineOscP2: null,
  engineGainP2: null,
  engineFilterP2: null,
  enginePannerP2: null,
  driftOscP2: null,
  driftGainP2: null,
  driftFilterP2: null,
  driftPannerP2: null,
  rumbleOscP2: null,
  rumbleGainP2: null,
  rumbleFilterP2: null,
  rumblePannerP2: null,

  _noiseBuffer: null,
  _delayBus: null,
  _switchTrackTimer: null,
  _previewMusicTimer: null,
  _distCurves: null,
  _titleThemeSources: null,
  _titleThemeTimers: null,
  musicBus: null,
  musicSidechainGain: null,
  musicLowShelf: null,
  musicHighShelf: null,
  musicReverbSend: null,

  _getDistCurve(kind = "soft") {
    if (!this._distCurves) this._distCurves = {};
    if (this._distCurves[kind]) return this._distCurves[kind];
    const n = 256;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; ++i) {
      const x = (i * 2) / n - 1;
      if (kind === "soft") {
        curve[i] = Math.tanh(x * 1.9);
      } else if (kind === "warm") {
        curve[i] = Math.tanh(x * 2.6);
      } else if (kind === "heavy") {
        curve[i] = Math.tanh(x * 4.8) * 0.9 + Math.sin(x * Math.PI) * 0.1;
      } else if (kind === "dirty") {
        curve[i] = Math.sign(x) * Math.pow(Math.abs(x), 0.45) * 0.82 + Math.tanh(x * 3.8) * 0.18;
      } else if (kind === "kick") {
        curve[i] = Math.tanh(x * 2.8);
      } else {
        curve[i] = Math.tanh(x * 2.2);
      }
    }
    this._distCurves[kind] = curve;
    return curve;
  },

  _getNoiseBuffer() {
    if (!this.ctx) return null;
    if (!this._noiseBuffer || this._noiseBuffer.sampleRate !== this.ctx.sampleRate) {
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * 1.5));
      const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this._noiseBuffer = buffer;
    }
    return this._noiseBuffer;
  },

  _getMusicDest(sidechained = false) {
    if (sidechained && this.musicSidechainGain) return this.musicSidechainGain;
    return this.musicBus || this.musicGain;
  },

  _connectPanTo(node, dest, pan = 0) {
    if (!node || !dest) return null;
    if (this.ctx && this.ctx.createStereoPanner && Math.abs(pan) > 0.001) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      node.connect(p);
      p.connect(dest);
      return p;
    }
    node.connect(dest);
    return null;
  },

  _sendToMusicReverb(node, amount = 0.22, time = null) {
    if (!this.ctx || !node || !this.musicReverbSend || amount <= 0.001) return null;
    const send = this.ctx.createGain();
    const t = time ?? this.ctx.currentTime;
    send.gain.setValueAtTime(amount, t);
    node.connect(send);
    send.connect(this.musicReverbSend);
    return send;
  },

  triggerMusicSidechain(time, depth = 0.65, releaseDur = 0.22) {
    if (!this.ctx || !this.musicSidechainGain) return;
    const g = this.musicSidechainGain.gain;
    const floor = clamp(depth, 0.32, 0.96);
    const rel = clamp(releaseDur, 0.08, 0.42);
    try {
      g.cancelScheduledValues(time);
      g.setValueAtTime(1.0, time);
      g.linearRampToValueAtTime(floor, time + 0.008);
      g.exponentialRampToValueAtTime(1.0, time + rel);
    } catch (e) {}
  },

  ensureDelayBus() {
    const busDest = this.musicBus || this.musicGain;
    if (!this.ctx || !busDest) return null;
    if (this._delayBus && this._delayBus.musicGain === this.musicGain) {
      return this._delayBus;
    }
    if (this._delayBus) {
      try {
        this._delayBus.input.disconnect();
        this._delayBus.delay.disconnect();
        this._delayBus.delayR?.disconnect();
        this._delayBus.feedback.disconnect();
        this._delayBus.wetFilter.disconnect();
        this._delayBus.wetFilterR?.disconnect();
        this._delayBus.hpFilter?.disconnect();
        this._delayBus.wetGain.disconnect();
        this._delayBus.panner?.disconnect();
        this._delayBus.pannerR?.disconnect();
      } catch (e) {}
      this._delayBus = null;
    }
    const stepDur = 60.0 / (this.tempo || 124) / 4.0;
    const delayTime = clamp(stepDur * 3, 0.06, 1.4);

    // True stereo ping-pong delay (warm bandpass-shaped echoes bouncing L <-> R)
    const input = this.ctx.createGain();
    input.gain.value = 1.0;
    const hpFilter = this.ctx.createBiquadFilter();
    hpFilter.type = "highpass";
    hpFilter.frequency.value = 280;

    const delayL = this.ctx.createDelay(2.0);
    delayL.delayTime.value = delayTime;
    const delayR = this.ctx.createDelay(2.0);
    delayR.delayTime.value = delayTime;

    const wetFilterL = this.ctx.createBiquadFilter();
    wetFilterL.type = "lowpass";
    wetFilterL.frequency.value = 3400;
    const wetFilterR = this.ctx.createBiquadFilter();
    wetFilterR.type = "lowpass";
    wetFilterR.frequency.value = 3000;

    const feedback = this.ctx.createGain();
    feedback.gain.value = 0.28;
    const wetGain = this.ctx.createGain();
    wetGain.gain.value = 0.58;

    input.connect(hpFilter);
    hpFilter.connect(delayL);
    delayL.connect(wetFilterL);
    wetFilterL.connect(delayR);
    delayR.connect(wetFilterR);
    wetFilterR.connect(feedback);
    feedback.connect(delayL);

    let pannerL = null;
    let pannerR = null;
    if (this.ctx.createStereoPanner) {
      pannerL = this.ctx.createStereoPanner();
      pannerL.pan.value = -0.62;
      pannerR = this.ctx.createStereoPanner();
      pannerR.pan.value = 0.62;
      wetFilterL.connect(pannerL);
      pannerL.connect(wetGain);
      wetFilterR.connect(pannerR);
      pannerR.connect(wetGain);
    } else {
      wetFilterL.connect(wetGain);
      wetFilterR.connect(wetGain);
    }
    wetGain.connect(busDest);

    this._delayBus = {
      musicGain: this.musicGain,
      input,
      hpFilter,
      delay: delayL,
      delayR,
      feedback,
      wetFilter: wetFilterL,
      wetFilterR,
      wetGain,
      panner: pannerL,
      pannerR,
      setDelayTime(dt, t) {
        const safe = clamp(dt, 0.05, 1.4);
        delayL.delayTime.setTargetAtTime(safe, t, 0.04);
        delayR.delayTime.setTargetAtTime(safe, t, 0.04);
      },
    };
    return this._delayBus;
  },

  ensure() {
    if (this.ctx) return;
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      this.ctx = new C();
      this.master = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-14, this.ctx.currentTime);
      this.compressor.knee.setValueAtTime(16, this.ctx.currentTime);
      this.compressor.ratio.setValueAtTime(3.5, this.ctx.currentTime);
      this.compressor.attack.setValueAtTime(0.008, this.ctx.currentTime);
      this.compressor.release.setValueAtTime(0.18, this.ctx.currentTime);

      this.reverbSend = this.ctx.createGain();
      this.reverbSend.gain.value = 0.055;
      this.reverbHighpass = this.ctx.createBiquadFilter();
      this.reverbHighpass.type = "highpass";
      this.reverbHighpass.frequency.value = 420;
      this.reverbLowpass = this.ctx.createBiquadFilter();
      this.reverbLowpass.type = "lowpass";
      this.reverbLowpass.frequency.value = 7200;
      this.reverb = this.ctx.createConvolver();
      this.reverb.buffer = this._buildReverbImpulse(1.35, 2.6);
      this.reverbReturn = this.ctx.createGain();
      this.reverbReturn.gain.value = 0.32;
      this.reverbMuteGain = this.ctx.createGain();
      this.reverbMuteGain.gain.value = 1.0;

      // Dedicated music duck bus: sits between musicGain and master so SFX can
      // momentarily dip the music without touching the user's music-volume setting.
      this.musicDuckGain = this.ctx.createGain();
      this.musicDuckGain.gain.value = 1.0;
      this.musicDuckGain.connect(this.master);

      this.sfxGain.connect(this.master);
      this.master.connect(this.compressor);
      this.master.connect(this.reverbSend);
      this.reverbSend.connect(this.reverbHighpass);
      this.reverbHighpass.connect(this.reverbLowpass);
      this.reverbLowpass.connect(this.reverb);
      this.reverb.connect(this.reverbReturn);
      this.reverbReturn.connect(this.reverbMuteGain);
      this.reverbMuteGain.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);
      this.setMuted(this.muted);
      this.setSfxVolume(this.sfxVolume, { persist: false });
      this.setMusicVolume(this.musicVolume, { persist: false });
      // Do not play main race music on title screen
    } catch (e) { /* audio unsupported */ }
  },

  _buildReverbImpulse(duration = 1.2, decay = 2.4) {
    const rate = this.ctx.sampleRate;
    const length = Math.max(1, Math.floor(rate * duration));
    const impulse = this.ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < impulse.numberOfChannels; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const stereoOffset = ch === 0 ? 0.93 : 1.07;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * stereoOffset;
      }
    }
    return impulse;
  },
  resume() {
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  },
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.68;
    if (this.reverbMuteGain) this.reverbMuteGain.gain.value = m ? 0 : 1.0;
    env().saveSettings({ muted: this.muted });
  },
  setMusicVolume(v, opts = {}) {
    this.musicVolume = normalizeVolume(v, 0.8);
    if (this.musicGain) {
      this.musicGain.gain.value = this.musicBaseGain * this.musicVolume;
    }
    if (this.musicReverbSend) {
      this.musicReverbSend.gain.value = 0.38 * this.musicVolume;
    }
    if (this.ctx && this.titleThemeNodes && this.titleThemeNodes.length) {
      const now = this.ctx.currentTime;
      for (const node of this.titleThemeNodes) {
        try {
          node.gain.setTargetAtTime(1.35 * this.musicVolume, now, 0.03);
        } catch (e) {}
      }
    }
    if (opts.persist !== false) env().saveSettings({ musicVolume: this.musicVolume });
  },
  setSfxVolume(v, opts = {}) {
    this.sfxVolume = normalizeVolume(v, 1.0);
    if (this.sfxGain) this.sfxGain.gain.value = this.sfxVolume;
    if (opts.persist !== false) env().saveSettings({ sfxVolume: this.sfxVolume });
  },

  tone(freq, dur, type = "square", vol = 0.18, freqEnd, attack = 0.005, pan = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    let panner = null;
    if (this.ctx.createStereoPanner && pan !== 0) {
      panner = this.ctx.createStereoPanner();
      panner.pan.value = pan;
      osc.connect(g);
      g.connect(panner);
      panner.connect(this.sfxGain);
    } else {
      osc.connect(g);
      g.connect(this.sfxGain);
    }
    osc.onended = () => {
      try { g.disconnect(); panner?.disconnect(); } catch (e) {}
    };

    osc.start(t); osc.stop(t + dur + 0.02);
  },

  noise(dur = 0.18, vol = 0.18, hpFreq = 600, pan = 0) {
    if (!this.ctx || this.muted) return;
    const buffer = this._getNoiseBuffer();
    if (!buffer) return;
    const t = this.ctx.currentTime;
    const safeDur = clamp(dur, 0.01, 1.45);
    const maxOffset = Math.max(0, 1.5 - safeDur - 0.02);
    const offset = Math.random() * maxOffset;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = hpFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0001, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + safeDur);

    let panner = null;
    if (this.ctx.createStereoPanner && pan !== 0) {
      panner = this.ctx.createStereoPanner();
      panner.pan.value = pan;
      src.connect(filter);
      filter.connect(g);
      g.connect(panner);
      panner.connect(this.sfxGain);
    } else {
      src.connect(filter);
      filter.connect(g);
      g.connect(this.sfxGain);
    }
    src.onended = () => {
      try { filter.disconnect(); g.disconnect(); panner?.disconnect(); } catch (e) {}
    };
    src.start(t, offset, safeDur);
  },

  _spatialParams(x, y, vol) {
    const ps = env().getPlayerSpatial(); if (!ps) return { pan: 0, scaledVol: vol };
    const dx = x - ps.x;
    const dy = y - ps.y;
    const d = Math.hypot(dx, dy);
    const rightX = -Math.sin(ps.heading);
    const rightY = Math.cos(ps.heading);
    const relX = dx * rightX + dy * rightY;
    const pan = Math.max(-1, Math.min(1, relX / TUNING.SPATIAL_PAN_RANGE));
    const scaledVol = vol * Math.max(0, Math.min(1, 1 - d / TUNING.SPATIAL_RANGE));
    return { pan, scaledVol };
  },

  spatialTone(x, y, freq, dur, type = "square", vol = 0.18, freqEnd, attack = 0.005) {
    const { pan, scaledVol } = this._spatialParams(x, y, vol);
    if (scaledVol <= 0.001) return;
    this.tone(freq, dur, type, scaledVol, freqEnd, attack, pan);
  },

  spatialNoise(x, y, dur = 0.18, vol = 0.18, hpFreq = 600) {
    const { pan, scaledVol } = this._spatialParams(x, y, vol);
    if (scaledVol <= 0.001) return;
    this.noise(dur, scaledVol, hpFreq, pan);
  },

  coin() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(8000, t + 0.06);
    osc1.type = "square";
    osc1.frequency.setValueAtTime(1320, t);
    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(1320, t);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc1.connect(filter); osc2.connect(filter);
    filter.connect(g); g.connect(this.sfxGain);
    osc1.onended = () => { try { filter.disconnect(); g.disconnect(); } catch (e) {} };
    osc1.start(t); osc1.stop(t + 0.09);
    osc2.start(t); osc2.stop(t + 0.09);
    setTimeout(() => {
      if (!this.ctx || this.muted) return;
      const t2 = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const o2 = this.ctx.createOscillator();
      const g2 = this.ctx.createGain();
      o.type = "square"; o.frequency.value = 1980;
      o2.type = "sine"; o2.frequency.value = 1980 * 2;
      g2.gain.setValueAtTime(0.001, t2);
      g2.gain.linearRampToValueAtTime(0.13, t2 + 0.005);
      g2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.12);
      o.connect(g2); o2.connect(g2); g2.connect(this.sfxGain);
      o.onended = () => { try { g2.disconnect(); } catch (e) {} };
      o.start(t2); o.stop(t2 + 0.13);
      o2.start(t2); o2.stop(t2 + 0.13);
    }, 55);
  },
  boost() {
    if (!this.ctx || this.muted) return;
    this.duckMusic(0.35, 280);
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(300, t);
    filter.frequency.exponentialRampToValueAtTime(3500, t + 0.35);
    filter.Q.setValueAtTime(3, t);
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(960, t + 0.4);
    osc2.type = "square";
    osc2.frequency.setValueAtTime(90, t);
    osc2.frequency.exponentialRampToValueAtTime(480, t + 0.4);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.02);
    g.gain.setValueAtTime(0.14, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(filter); osc2.connect(filter);
    filter.connect(g); g.connect(this.sfxGain);
    osc.onended = () => { try { filter.disconnect(); g.disconnect(); } catch (e) {} };
    osc.start(t); osc.stop(t + 0.52);
    osc2.start(t); osc2.stop(t + 0.52);
    this.noise(0.2, 0.06, 1800);
  },
  crash() {
    if (!this.ctx || this.muted) return;
    this.duckMusic(0.45, 240);
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(800, t);
    filter.frequency.exponentialRampToValueAtTime(100, t + 0.2);
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(filter); filter.connect(g); g.connect(this.sfxGain);
    osc.onended = () => { try { filter.disconnect(); g.disconnect(); } catch (e) {} };
    osc.start(t); osc.stop(t + 0.27);
    this.noise(0.3, 0.18, 150);
    setTimeout(() => this.noise(0.15, 0.06, 400), 40);
  },
  lap() {
    if (!this.ctx || this.muted) return;
    this.duckMusic(0.3, 280);
    const freqs = [523, 659, 784, 988];
    freqs.forEach((f, i) => {
      setTimeout(() => {
        if (!this.ctx || this.muted) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = "triangle"; osc.frequency.value = f;
        osc2.type = "sine"; osc2.frequency.value = f * 2;
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.15, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        osc.connect(g); osc2.connect(g); g.connect(this.sfxGain);
        osc.onended = () => { try { g.disconnect(); } catch (e) {} };
        osc.start(t); osc.stop(t + 0.2);
        osc2.start(t); osc2.stop(t + 0.2);
      }, i * 80);
    });
  },
  countdown(go) {
    if (!this.ctx || this.muted) return;
    if (go) {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "square"; osc.frequency.value = 880;
      osc2.type = "triangle"; osc2.frequency.value = 1760;
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.2, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(g); osc2.connect(g); g.connect(this.sfxGain);
      osc.onended = () => { try { g.disconnect(); } catch (e) {} };
      osc.start(t); osc.stop(t + 0.37);
      osc2.start(t); osc2.stop(t + 0.37);
      setTimeout(() => {
        if (!this.ctx || this.muted) return;
        const t2 = this.ctx.currentTime;
        const o = this.ctx.createOscillator();
        const g2 = this.ctx.createGain();
        o.type = "square"; o.frequency.value = 1320;
        g2.gain.setValueAtTime(0.001, t2);
        g2.gain.linearRampToValueAtTime(0.18, t2 + 0.005);
        g2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.3);
        o.connect(g2); g2.connect(this.sfxGain);
        o.onended = () => { try { g2.disconnect(); } catch (e) {} };
        o.start(t2); o.stop(t2 + 0.32);
      }, 70);
    } else {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "triangle"; osc.frequency.value = 523;
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(g); g.connect(this.sfxGain);
      osc.onended = () => { try { g.disconnect(); } catch (e) {} };
      osc.start(t); osc.stop(t + 0.24);
    }
  },
  finish() {
    if (!this.ctx || this.muted) return;
    this.duckMusic(0.55, 700);
    const notes = [523, 659, 784, 1047, 1319, 1568];
    notes.forEach((f, i) => {
      setTimeout(() => {
        if (!this.ctx || this.muted) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 3000 + i * 800;
        osc.type = "triangle"; osc.frequency.value = f;
        osc2.type = "sine"; osc2.frequency.value = f * 1.5;
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.16 - i * 0.01, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        osc.connect(filter); osc2.connect(filter);
        filter.connect(g); g.connect(this.sfxGain);
        osc.onended = () => { try { filter.disconnect(); g.disconnect(); } catch (e) {} };
        osc.start(t); osc.stop(t + 0.37);
        osc2.start(t); osc2.stop(t + 0.37);
      }, i * 85);
    });
  },
  itembox() {
    if (!this.ctx || this.muted) return;
    this.duckMusic(0.22, 200);
    const freqs = [660, 990, 1320];
    freqs.forEach((f, i) => {
      setTimeout(() => {
        if (!this.ctx || this.muted) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = "square"; osc.frequency.value = f;
        osc2.type = "triangle"; osc2.frequency.value = f * 1.01;
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.12, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.001, t + (i === 2 ? 0.18 : 0.10));
        osc.connect(g); osc2.connect(g); g.connect(this.sfxGain);
        osc.onended = () => { try { g.disconnect(); } catch (e) {} };
        osc.start(t); osc.stop(t + 0.2);
        osc2.start(t); osc2.stop(t + 0.2);
      }, i * 55);
    });
  },
  shield() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(600, t);
    filter.frequency.exponentialRampToValueAtTime(2400, t + 0.15);
    filter.Q.setValueAtTime(2, t);
    osc.type = "triangle"; osc.frequency.setValueAtTime(440, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.2);
    osc2.type = "sine"; osc2.frequency.setValueAtTime(660, t);
    osc2.frequency.exponentialRampToValueAtTime(1320, t + 0.2);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.connect(filter); osc2.connect(filter);
    filter.connect(g); g.connect(this.sfxGain);
    osc.onended = () => { try { filter.disconnect(); g.disconnect(); } catch (e) {} };
    osc.start(t); osc.stop(t + 0.3);
    osc2.start(t); osc2.stop(t + 0.3);
  },
  // Briefly dip the music so a punchy SFX cuts through, then recover.
  // amount: 0..1 portion of music to remove at the dip; ms: recovery time.
  duckMusic(amount = 0.4, ms = 220) {
    if (!this.ctx || this.muted || !this.musicDuckGain) return;
    const g = this.musicDuckGain.gain;
    const now = this.ctx.currentTime;
    const floor = Math.max(0.45, 1 - amount * 0.55);
    const recover = Math.max(0.12, ms / 1000);
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(floor, now + 0.03);
    g.linearRampToValueAtTime(1.0, now + recover);
  },
  // Sparkly ascending chime for rare/powerful item rolls.
  rareItem() {
    if (!this.ctx || this.muted) return;
    this.duckMusic(0.5, 320);
    const notes = [784, 1047, 1319, 1760];
    notes.forEach((f, i) => {
      setTimeout(() => {
        if (!this.ctx || this.muted) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = f * 1.5;
        filter.Q.value = 1.5;
        osc.type = "triangle"; osc.frequency.value = f;
        osc2.type = "sine"; osc2.frequency.value = f * 2;
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.15, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        osc.connect(filter); osc2.connect(filter);
        filter.connect(g); g.connect(this.sfxGain);
        osc.onended = () => { try { filter.disconnect(); g.disconnect(); } catch (e) {} };
        osc.start(t); osc.stop(t + 0.24);
        osc2.start(t); osc2.stop(t + 0.24);
      }, i * 60);
    });
  },
  // Tense rising stinger when the player crosses into the final lap.
  finalLap() {
    if (!this.ctx || this.muted) return;
    this.duckMusic(0.55, 520);
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(700, t0);
    filter.frequency.exponentialRampToValueAtTime(4200, t0 + 0.45);
    osc.type = "sawtooth"; osc.frequency.setValueAtTime(220, t0);
    osc.frequency.exponentialRampToValueAtTime(660, t0 + 0.5);
    osc2.type = "square"; osc2.frequency.setValueAtTime(110, t0);
    osc2.frequency.exponentialRampToValueAtTime(330, t0 + 0.5);
    g.gain.setValueAtTime(0.001, t0);
    g.gain.linearRampToValueAtTime(0.18, t0 + 0.04);
    g.gain.setValueAtTime(0.14, t0 + 0.35);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);
    osc.connect(filter); osc2.connect(filter);
    filter.connect(g); g.connect(this.sfxGain);
    osc.onended = () => { try { filter.disconnect(); g.disconnect(); } catch (e) {} };
    osc.start(t0); osc.stop(t0 + 0.62);
    osc2.start(t0); osc2.stop(t0 + 0.62);
    setTimeout(() => {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime;
      [880, 1175].forEach((f, i) => {
        const o = this.ctx.createOscillator();
        const gg = this.ctx.createGain();
        o.type = "triangle"; o.frequency.value = f;
        gg.gain.setValueAtTime(0.001, t + i * 0.02);
        gg.gain.linearRampToValueAtTime(0.12, t + 0.02 + i * 0.02);
        gg.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        o.connect(gg); gg.connect(this.sfxGain);
        o.onended = () => { try { gg.disconnect(); } catch (e) {} };
        o.start(t); o.stop(t + 0.32);
      });
    }, 360);
  },
  // Harsh "rejection stamp" buzz when an approval is revoked in Battle mode.
  approvalPop() {
    if (!this.ctx || this.muted) return;
    this.duckMusic(0.4, 260);
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1400, t);
    filter.frequency.exponentialRampToValueAtTime(300, t + 0.18);
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.2);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    osc.connect(filter); filter.connect(g); g.connect(this.sfxGain);
    osc.onended = () => { try { filter.disconnect(); g.disconnect(); } catch (e) {} };
    osc.start(t); osc.stop(t + 0.26);
    this.noise(0.12, 0.08, 800);
  },
  approvalSteal() {
    if (!this.ctx || this.muted) return;
    const freqs = [520, 660, 880];
    freqs.forEach((f, i) => {
      setTimeout(() => {
        if (!this.ctx || this.muted) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = "triangle"; osc.frequency.value = f;
        osc2.type = "square"; osc2.frequency.value = f * 1.01;
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.12, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.001, t + (i === 2 ? 0.14 : 0.08));
        osc.connect(g); osc2.connect(g); g.connect(this.sfxGain);
        osc.onended = () => { try { g.disconnect(); } catch (e) {} };
        osc.start(t); osc.stop(t + 0.16);
        osc2.start(t); osc2.stop(t + 0.16);
      }, i * 45);
    });
  },
  killConfirm() {
    if (!this.ctx || this.muted) return;
    const freqs = [440, 880];
    freqs.forEach((f, i) => {
      setTimeout(() => {
        if (!this.ctx || this.muted) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = "triangle"; osc.frequency.value = f;
        osc2.type = "square"; osc2.frequency.value = f * 0.5;
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.14, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.001, t + (i === 0 ? 0.12 : 0.22));
        osc.connect(g); osc2.connect(g); g.connect(this.sfxGain);
        osc.onended = () => { try { g.disconnect(); } catch (e) {} };
        osc.start(t); osc.stop(t + 0.25);
        osc2.start(t); osc2.stop(t + 0.25);
      }, i * 90);
    });
  },
  honk(charId) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    if (charId === "anton") {
      // Quick double beep
      this.tone(520, 0.08, "square", 0.16);
      setTimeout(() => this.tone(620, 0.1, "square", 0.14), 90);
    } else if (charId === "artur") {
      // Truck air horn (low descending)
      this.tone(220, 0.25, "sawtooth", 0.2, 160);
      this.tone(165, 0.3, "sawtooth", 0.12, 120);
    } else if (charId === "rissal") {
      // Nervous high-pitched squeak
      this.tone(880, 0.06, "sine", 0.14, 1200);
      setTimeout(() => this.tone(1100, 0.05, "sine", 0.12, 800), 70);
      setTimeout(() => this.tone(660, 0.07, "sine", 0.1), 130);
    } else if (charId === "pia") {
      // Deep intimidating bass honk
      this.tone(110, 0.3, "sawtooth", 0.22, 80);
      this.noise(0.15, 0.06, 200);
    } else if (charId === "florian") {
      // Executive chime (ascending triad)
      this.tone(523, 0.1, "triangle", 0.14);
      setTimeout(() => this.tone(659, 0.1, "triangle", 0.12), 80);
      setTimeout(() => this.tone(784, 0.15, "triangle", 0.10), 160);
    } else {
      this.tone(440, 0.12, "square", 0.15);
    }
  },

  bump() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(260, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.06);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(g); g.connect(this.sfxGain);
    osc.onended = () => { try { g.disconnect(); } catch (e) {} };
    osc.start(t); osc.stop(t + 0.1);
    this.noise(0.06, 0.08, 300);
  },

  playDriftTier(tier) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const scheduleChime = (freq, startAt, dur, type = "triangle", vol = 0.15) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, startAt);
      g.gain.setValueAtTime(0.0001, startAt);
      g.gain.linearRampToValueAtTime(vol, startAt + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
      osc.connect(g);
      g.connect(this.sfxGain);
      osc.onended = () => { try { g.disconnect(); } catch (e) {} };
      osc.start(startAt);
      osc.stop(startAt + dur + 0.02);
    };
    if (tier === 1) {
      scheduleChime(659.25, t, 0.14, "triangle", 0.14); // E5
    } else if (tier === 2) {
      scheduleChime(830.61, t, 0.16, "triangle", 0.16); // G#5
    } else if (tier >= 3) {
      scheduleChime(987.77, t, 0.18, "triangle", 0.16); // B5
      scheduleChime(1318.51, t + 0.045, 0.22, "sine", 0.15); // E6 sparkle
    }
  },

  // Dual Synthesizer Engines
  startEngine(playerIdx) {
    if (!this.ctx || this.muted) return;
    const existing = playerIdx === 1 ? this.engineOscP1 : this.engineOscP2;
    if (existing) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();

      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(65, t); // low rumble
      g.gain.setValueAtTime(0.001, t);

      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(140, t);

      osc.connect(filter);
      filter.connect(g);

      // Pan Left for P1, Right for P2
      const panVal = playerIdx === 1 ? -0.45 : (playerIdx === 2 ? 0.45 : 0);
      let panner = null;
      if (this.ctx.createStereoPanner && panVal !== 0) {
        panner = this.ctx.createStereoPanner();
        panner.pan.value = panVal;
        g.connect(panner);
        panner.connect(this.sfxGain);
      } else {
        g.connect(this.sfxGain);
      }

      osc.start();

      if (playerIdx === 1) {
        this.engineOscP1 = osc;
        this.engineGainP1 = g;
        this.engineFilterP1 = filter;
        this.enginePannerP1 = panner;
      } else {
        this.engineOscP2 = osc;
        this.engineGainP2 = g;
        this.engineFilterP2 = filter;
        this.enginePannerP2 = panner;
      }
    } catch (e) {
      console.warn("Failed to start engine " + playerIdx, e);
    }
  },

  updateEngine(playerIdx, speed, maxSpeed, isBoosting) {
    if (!this.ctx || this.muted) return;
    let osc = playerIdx === 1 ? this.engineOscP1 : this.engineOscP2;
    let gain = playerIdx === 1 ? this.engineGainP1 : this.engineGainP2;
    let filter = playerIdx === 1 ? this.engineFilterP1 : this.engineFilterP2;

    if (!osc || !gain) {
      this.startEngine(playerIdx);
      osc = playerIdx === 1 ? this.engineOscP1 : this.engineOscP2;
      gain = playerIdx === 1 ? this.engineGainP1 : this.engineGainP2;
      filter = playerIdx === 1 ? this.engineFilterP1 : this.engineFilterP2;
    }
    if (!osc || !gain) return;
    try {
      const t = this.ctx.currentTime;
      const ratio = clamp(speed / Math.max(0.1, maxSpeed || 1), 0, 1.5);
      const targetFreq = 50 + ratio * 115 + (isBoosting ? 40 : 0);
      osc.frequency.setTargetAtTime(targetFreq, t, 0.06);

      if (filter) {
        const targetCutoff = 140 + ratio * 400 + (isBoosting ? 160 : 0);
        filter.frequency.setTargetAtTime(targetCutoff, t, 0.06);
      }

      const targetGain = 0.024 + ratio * 0.044 + (isBoosting ? 0.02 : 0);
      gain.gain.setTargetAtTime(targetGain, t, 0.06);
    } catch (e) {}
  },

  stopEngine(playerIdx) {
    const osc = playerIdx === 1 ? this.engineOscP1 : this.engineOscP2;
    const filter = playerIdx === 1 ? this.engineFilterP1 : this.engineFilterP2;
    const gain = playerIdx === 1 ? this.engineGainP1 : this.engineGainP2;
    const panner = playerIdx === 1 ? this.enginePannerP1 : this.enginePannerP2;
    if (osc) {
      try {
        osc.stop();
        osc.disconnect();
      } catch (e) {}
      try { filter?.disconnect(); } catch (e) {}
      try { gain?.disconnect(); } catch (e) {}
      try { panner?.disconnect(); } catch (e) {}
      if (playerIdx === 1) {
        this.engineOscP1 = null;
        this.engineGainP1 = null;
        this.engineFilterP1 = null;
        this.enginePannerP1 = null;
      } else {
        this.engineOscP2 = null;
        this.engineGainP2 = null;
        this.engineFilterP2 = null;
        this.enginePannerP2 = null;
      }
    }
  },

  stopAllEngines() {
    this.stopEngine(1);
    this.stopEngine(2);
  },

  // Dual Drift Squeals
  startDriftSqueal(playerIdx) {
    if (!this.ctx || this.muted) return;
    const existing = playerIdx === 1 ? this.driftOscP1 : this.driftOscP2;
    if (existing) return;
    try {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(800, this.ctx.currentTime);
      g.gain.setValueAtTime(0.001, this.ctx.currentTime);

      const filter = this.ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(900, this.ctx.currentTime);
      filter.Q.setValueAtTime(3.5, this.ctx.currentTime);

      osc.connect(filter);
      filter.connect(g);

      const panVal = playerIdx === 1 ? -0.45 : (playerIdx === 2 ? 0.45 : 0);
      let panner = null;
      if (this.ctx.createStereoPanner && panVal !== 0) {
        panner = this.ctx.createStereoPanner();
        panner.pan.value = panVal;
        g.connect(panner);
        panner.connect(this.sfxGain);
      } else {
        g.connect(this.sfxGain);
      }

      osc.start();

      if (playerIdx === 1) {
        this.driftOscP1 = osc;
        this.driftGainP1 = g;
        this.driftFilterP1 = filter;
        this.driftPannerP1 = panner;
      } else {
        this.driftOscP2 = osc;
        this.driftGainP2 = g;
        this.driftFilterP2 = filter;
        this.driftPannerP2 = panner;
      }
    } catch (e) {}
  },

  updateDriftSqueal(playerIdx, drifting, speed) {
    if (!this.ctx || this.muted) return;
    const osc = playerIdx === 1 ? this.driftOscP1 : this.driftOscP2;
    const gain = playerIdx === 1 ? this.driftGainP1 : this.driftGainP2;

    if (drifting && speed > 1.5) {
      if (!osc) {
        this.startDriftSqueal(playerIdx);
      } else {
        const t = this.ctx.currentTime;
        const freq = 820 + Math.sin(t * 55) * 80;
        osc.frequency.setTargetAtTime(freq, t, 0.02);
        const vol = clamp((speed - 1.5) * 0.02, 0, 0.055);
        gain.gain.setTargetAtTime(vol, t, 0.05);
      }
    } else {
      this.stopDriftSqueal(playerIdx);
    }
  },

  stopDriftSqueal(playerIdx) {
    const osc = playerIdx === 1 ? this.driftOscP1 : this.driftOscP2;
    const filter = playerIdx === 1 ? this.driftFilterP1 : this.driftFilterP2;
    const gain = playerIdx === 1 ? this.driftGainP1 : this.driftGainP2;
    const panner = playerIdx === 1 ? this.driftPannerP1 : this.driftPannerP2;
    if (osc) {
      try {
        osc.stop();
        osc.disconnect();
      } catch (e) {}
      try { filter?.disconnect(); } catch (e) {}
      try { gain?.disconnect(); } catch (e) {}
      try { panner?.disconnect(); } catch (e) {}
      if (playerIdx === 1) {
        this.driftOscP1 = null;
        this.driftGainP1 = null;
        this.driftFilterP1 = null;
        this.driftPannerP1 = null;
      } else {
        this.driftOscP2 = null;
        this.driftGainP2 = null;
        this.driftFilterP2 = null;
        this.driftPannerP2 = null;
      }
    }
  },

  stopAllDriftSqueals() {
    this.stopDriftSqueal(1);
    this.stopDriftSqueal(2);
  },

  // Dual Rumble Buzzes
  startRumble(playerIdx) {
    if (!this.ctx || this.muted) return;
    const existing = playerIdx === 1 ? this.rumbleOscP1 : this.rumbleOscP2;
    if (existing) return;
    try {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();

      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(45, this.ctx.currentTime);
      g.gain.setValueAtTime(0.001, this.ctx.currentTime);

      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(80, this.ctx.currentTime);

      osc.connect(filter);
      filter.connect(g);

      const panVal = playerIdx === 1 ? -0.45 : (playerIdx === 2 ? 0.45 : 0);
      let panner = null;
      if (this.ctx.createStereoPanner && panVal !== 0) {
        panner = this.ctx.createStereoPanner();
        panner.pan.value = panVal;
        g.connect(panner);
        panner.connect(this.sfxGain);
      } else {
        g.connect(this.sfxGain);
      }

      osc.start();

      if (playerIdx === 1) {
        this.rumbleOscP1 = osc;
        this.rumbleGainP1 = g;
        this.rumbleFilterP1 = filter;
        this.rumblePannerP1 = panner;
      } else {
        this.rumbleOscP2 = osc;
        this.rumbleGainP2 = g;
        this.rumbleFilterP2 = filter;
        this.rumblePannerP2 = panner;
      }
    } catch (e) {}
  },

  updateRumble(playerIdx, active, speed) {
    if (!this.ctx || this.muted) return;
    const osc = playerIdx === 1 ? this.rumbleOscP1 : this.rumbleOscP2;
    const gain = playerIdx === 1 ? this.rumbleGainP1 : this.rumbleGainP2;

    if (active && speed > 1.5) {
      if (!osc) {
        this.startRumble(playerIdx);
      } else {
        const t = this.ctx.currentTime;
        const freq = 38 + Math.sin(t * 85) * 12;
        osc.frequency.setTargetAtTime(freq, t, 0.02);
        const vol = clamp((speed - 1.5) * 0.036, 0, 0.095);
        gain.gain.setTargetAtTime(vol, t, 0.05);
      }
    } else {
      this.stopRumble(playerIdx);
    }
  },

  stopRumble(playerIdx) {
    const osc = playerIdx === 1 ? this.rumbleOscP1 : this.rumbleOscP2;
    const filter = playerIdx === 1 ? this.rumbleFilterP1 : this.rumbleFilterP2;
    const gain = playerIdx === 1 ? this.rumbleGainP1 : this.rumbleGainP2;
    const panner = playerIdx === 1 ? this.rumblePannerP1 : this.rumblePannerP2;
    if (osc) {
      try {
        osc.stop();
        osc.disconnect();
      } catch (e) {}
      try { filter?.disconnect(); } catch (e) {}
      try { gain?.disconnect(); } catch (e) {}
      try { panner?.disconnect(); } catch (e) {}
      if (playerIdx === 1) {
        this.rumbleOscP1 = null;
        this.rumbleGainP1 = null;
        this.rumbleFilterP1 = null;
        this.rumblePannerP1 = null;
      } else {
        this.rumbleOscP2 = null;
        this.rumbleGainP2 = null;
        this.rumbleFilterP2 = null;
        this.rumblePannerP2 = null;
      }
    }
  },

  stopAllRumbles() {
    this.stopRumble(1);
    this.stopRumble(2);
  },

  // Retro Soundtrack Sequencer State
  musicInterval: null,
  musicGain: null,
  nextNoteTime: 0.0,
  stepIndex: 0,
  tempo: 124,
  isPlayingMusic: false,
  tracks: [
    {
      name: "Systematic Review",
      tempo: 124,
      iconSVG: (c) => `<svg width="20" height="20" viewBox="0 0 16 16" shape-rendering="crispEdges"><rect x="1" y="2" width="10" height="12" rx="1" fill="${c}" opacity="0.3"/><rect x="1" y="2" width="10" height="2" fill="${c}"/><rect x="3" y="6" width="6" height="1" fill="${c}" opacity="0.8"/><rect x="3" y="8" width="5" height="1" fill="${c}" opacity="0.6"/><rect x="3" y="10" width="7" height="1" fill="${c}" opacity="0.8"/><rect x="3" y="12" width="4" height="1" fill="${c}" opacity="0.5"/><circle cx="13" cy="11" r="2.5" fill="none" stroke="${c}" stroke-width="1.5"/><line x1="15" y1="13" x2="15" y2="15" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/></svg>`,
      color: "#57f2ff",
      style: "Synthwave Cruise"
    },
    {
      name: "Adverse Event Report",
      tempo: 128,
      iconSVG: (c) => `<svg width="20" height="20" viewBox="0 0 16 16" shape-rendering="crispEdges"><polygon points="8,1 15,13 1,13" fill="${c}" opacity="0.25"/><polygon points="8,2 14,12 2,12" fill="none" stroke="${c}" stroke-width="1.2"/><rect x="7" y="5" width="2" height="4" rx="0.5" fill="${c}"/><rect x="7" y="10" width="2" height="2" rx="0.5" fill="${c}"/></svg>`,
      color: "#ff4d6d",
      style: "Acid Sprint"
    },
    {
      name: "Protocol Amendment",
      tempo: 118,
      iconSVG: (c) => `<svg width="20" height="20" viewBox="0 0 16 16" shape-rendering="crispEdges"><rect x="2" y="1" width="9" height="13" rx="1" fill="${c}" opacity="0.2"/><rect x="2" y="1" width="9" height="13" rx="1" fill="none" stroke="${c}" stroke-width="1"/><rect x="4" y="4" width="5" height="1" fill="${c}" opacity="0.7"/><rect x="4" y="6" width="4" height="1" fill="${c}" opacity="0.5"/><rect x="4" y="8" width="5" height="1" fill="${c}" opacity="0.7"/><line x1="12" y1="8" x2="15" y2="5" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/><line x1="12" y1="8" x2="12" y2="14" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/></svg>`,
      color: "#a4ff80",
      style: "Chiptune Flow"
    },
    {
      name: "Phase III Approval",
      tempo: 128,
      iconSVG: (c) => `<svg width="20" height="20" viewBox="0 0 16 16" shape-rendering="crispEdges"><rect x="3" y="4" width="10" height="6" rx="3" fill="${c}" opacity="0.3"/><rect x="3" y="4" width="10" height="6" rx="3" fill="none" stroke="${c}" stroke-width="1.2"/><line x1="8" y1="5" x2="8" y2="9" stroke="${c}" stroke-width="1" opacity="0.6"/><rect x="5" y="11" width="6" height="2" rx="1" fill="${c}" opacity="0.4"/><rect x="6" y="13" width="4" height="1" fill="${c}" opacity="0.3"/><circle cx="8" cy="2" r="1" fill="${c}"/></svg>`,
      color: "#b983ff",
      style: "Heavy Modern Banger"
    },
    {
      name: "Post-Market Surveillance",
      tempo: 85,
      iconSVG: (c) => `<svg width="20" height="20" viewBox="0 0 16 16" shape-rendering="crispEdges"><circle cx="6" cy="8" r="4" fill="${c}" opacity="0.15"/><circle cx="6" cy="8" r="4" fill="none" stroke="${c}" stroke-width="1.2"/><circle cx="6" cy="8" r="1.5" fill="${c}" opacity="0.5"/><line x1="9" y1="11" x2="14" y2="14" stroke="${c}" stroke-width="2" stroke-linecap="round"/><rect x="4" y="6" width="1" height="4" fill="${c}" opacity="0.4"/><rect x="7" y="5" width="1" height="3" fill="${c}" opacity="0.4"/></svg>`,
      color: "#ff6b35",
      style: "Dirty Downtempo"
    },
    {
      name: "Regulatory Submission",
      tempo: 136,
      iconSVG: (c) => `<svg width="20" height="20" viewBox="0 0 16 16" shape-rendering="crispEdges"><rect x="2" y="3" width="12" height="10" rx="1" fill="${c}" opacity="0.15"/><rect x="2" y="3" width="12" height="3" fill="${c}" opacity="0.35"/><rect x="2" y="3" width="12" height="10" rx="1" fill="none" stroke="${c}" stroke-width="1"/><rect x="4" y="8" width="3" height="3" fill="${c}" opacity="0.5"/><rect x="9" y="8" width="3" height="3" fill="${c}" opacity="0.3"/><polyline points="5,4 8,2 11,4" fill="none" stroke="${c}" stroke-width="1" opacity="0.8"/></svg>`,
      color: "#39ff14",
      style: "Minimal Techno"
    }
  ],
  trackIdx: null,
  toastTimeout: null,

  showTrackToast() {
    const toast = document.getElementById("audio-toast");
    const title = document.getElementById("audio-track-title");
    const tempo = document.getElementById("audio-track-tempo");
    const icon = document.getElementById("audio-toast-icon");
    if (!toast || !title || !tempo) return;

    const t = this.tracks[this.trackIdx || 0] || this.tracks[0];
    title.innerText = t.name;
    tempo.innerText = this.tempo + " BPM" + (this.tempo > t.tempo ? " (FINAL LAP!)" : "");
    if (icon) icon.innerHTML = t.iconSVG ? t.iconSVG(t.color) : "";
    toast.style.borderColor = t.color;
    toast.style.boxShadow = `0 8px 32px ${hexToRgba(t.color, 0.25)}`;

    toast.classList.remove("hidden");
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      toast.classList.add("hidden");
    }, 3500);
  },

  startMusic() {
    if (!this.ctx || this.isPlayingMusic) return;
    if (this._switchTrackTimer) {
      clearTimeout(this._switchTrackTimer);
      this._switchTrackTimer = null;
    }
    if (this._previewMusicTimer) {
      clearTimeout(this._previewMusicTimer);
      this._previewMusicTimer = null;
    }
    this.isPlayingMusic = true;

    if (this.trackIdx === null || this.trackIdx === undefined) {
      this.trackIdx = Math.floor(Math.random() * this.tracks.length);
    }
    const t = this.tracks[this.trackIdx] || this.tracks[0];
    this.tempo = this.mapStyle === "japanese" ? (this.tempo || 96) : t.tempo;

    // Master music chain:
    // (sidechained voices -> musicSidechainGain) + (drums/lead) -> musicBus -> lowShelf -> highShelf -> musicGain -> musicDuckGain
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 1.0;

    this.musicSidechainGain = this.ctx.createGain();
    this.musicSidechainGain.gain.value = 1.0;
    this.musicSidechainGain.connect(this.musicBus);

    this.musicLowShelf = this.ctx.createBiquadFilter();
    this.musicLowShelf.type = "lowshelf";
    this.musicLowShelf.frequency.value = 95;
    this.musicLowShelf.gain.value = this.trackIdx === 4 ? 3.5 : 2.6;

    this.musicHighShelf = this.ctx.createBiquadFilter();
    this.musicHighShelf.type = "highshelf";
    this.musicHighShelf.frequency.value = 7200;
    this.musicHighShelf.gain.value = this.trackIdx === 4 ? 0.5 : 1.8;

    this.musicGain = this.ctx.createGain();
    this.musicBaseGain = this.mapStyle === "japanese" ? 1.55
      : this.trackIdx === 5 ? 1.18
      : this.trackIdx === 3 ? 1.10
      : this.trackIdx === 4 ? 1.75
      : this.trackIdx === 2 ? 1.85
      : this.trackIdx === 1 ? 1.18
      : 1.95;
    this.musicGain.gain.value = this.musicBaseGain * this.musicVolume;

    this.musicBus.connect(this.musicLowShelf);
    this.musicLowShelf.connect(this.musicHighShelf);
    this.musicHighShelf.connect(this.musicGain);
    this.musicGain.connect(this.musicDuckGain || this.master);

    // Dedicated music reverb send feeds the shared convolver chain (tracks stay lush, kicks stay dry)
    if (this.reverbHighpass) {
      this.musicReverbSend = this.ctx.createGain();
      this.musicReverbSend.gain.value = 0.38 * this.musicVolume;
      this.musicReverbSend.connect(this.reverbHighpass);
    }

    this.nextNoteTime = this.ctx.currentTime + 0.06;
    this.stepIndex = 0;

    const lookahead = 0.16; // seconds
    const scheduleInterval = 45; // milliseconds

    const scheduler = () => {
      if (!this.isPlayingMusic || !this.ctx) return;
      const now = this.ctx.currentTime;
      // Prevent runaway burst scheduling after tab backgrounding or frame stalls
      if (now - this.nextNoteTime > 0.35) {
        this.nextNoteTime = now + 0.03;
      }
      let stepsScheduled = 0;
      while (this.nextNoteTime < now + lookahead && stepsScheduled < 8) {
        try {
          this.scheduleStep(this.stepIndex, this.nextNoteTime);
        } catch (e) {
          console.warn("Audio scheduleStep error", e);
        }
        const secondsPerStep = 60.0 / Math.max(40, this.tempo || 124) / 4.0; // 16th notes
        this.nextNoteTime += secondsPerStep;
        const loopLen = this.getLoopSteps();
        this.stepIndex = (this.stepIndex + 1) % loopLen;
        stepsScheduled++;
      }
      this.musicInterval = setTimeout(scheduler, scheduleInterval);
    };
    scheduler();

    this.showTrackToast();

    if (this.mapStyle !== "japanese" && this.trackIdx === 4) this.startVinylCrackle();
  },

  getLoopSteps() {
    if (this.mapStyle === "japanese") return 1024;
    return 512; // Full 32-bar evolving arrangements on all 6 tracks
  },

  vinylCrackleNode: null,
  vinylCrackleGain: null,
  vinylCrackleHp: null,
  vinylCrackleLp: null,

  startVinylCrackle() {
    if (!this.ctx || this.vinylCrackleNode) return;
    const bufLen = this.ctx.sampleRate * 4;
    const buffer = this.ctx.createBuffer(1, bufLen, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = Math.random() < 0.012 ? (Math.random() * 2 - 1) * 0.72 : (Math.random() * 2 - 1) * 0.008;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2400;

    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 320;

    const g = this.ctx.createGain();
    g.gain.value = 0.016;

    src.connect(hp);
    hp.connect(lp);
    lp.connect(g);
    g.connect(this.musicBus || this.musicGain);

    src.start();
    this.vinylCrackleNode = src;
    this.vinylCrackleGain = g;
    this.vinylCrackleHp = hp;
    this.vinylCrackleLp = lp;
  },

  stopVinylCrackle() {
    if (this.vinylCrackleNode) {
      try { this.vinylCrackleNode.stop(); this.vinylCrackleNode.disconnect(); } catch (e) {}
      this.vinylCrackleNode = null;
    }
    if (this.vinylCrackleHp) {
      try { this.vinylCrackleHp.disconnect(); } catch (e) {}
      this.vinylCrackleHp = null;
    }
    if (this.vinylCrackleLp) {
      try { this.vinylCrackleLp.disconnect(); } catch (e) {}
      this.vinylCrackleLp = null;
    }
    if (this.vinylCrackleGain) {
      try { this.vinylCrackleGain.disconnect(); } catch (e) {}
      this.vinylCrackleGain = null;
    }
  },

  stopMusic(fade = false) {
    this.isPlayingMusic = false;
    this.stopVinylCrackle();
    if (this._switchTrackTimer) {
      clearTimeout(this._switchTrackTimer);
      this._switchTrackTimer = null;
    }
    if (this._previewMusicTimer) {
      clearTimeout(this._previewMusicTimer);
      this._previewMusicTimer = null;
    }
    if (this.musicInterval) {
      clearTimeout(this.musicInterval);
      this.musicInterval = null;
    }
    const oldDelayBus = this._delayBus;
    this._delayBus = null;
    const oldMusicBus = this.musicBus;
    const oldSidechain = this.musicSidechainGain;
    const oldLowShelf = this.musicLowShelf;
    const oldHighShelf = this.musicHighShelf;
    const oldReverbSend = this.musicReverbSend;
    this.musicBus = null;
    this.musicSidechainGain = null;
    this.musicLowShelf = null;
    this.musicHighShelf = null;
    this.musicReverbSend = null;

    const cleanupAuxNodes = () => {
      if (oldDelayBus) {
        try {
          oldDelayBus.input?.disconnect();
          oldDelayBus.hpFilter?.disconnect();
          oldDelayBus.delay?.disconnect();
          oldDelayBus.delayR?.disconnect();
          oldDelayBus.feedback?.disconnect();
          oldDelayBus.wetFilter?.disconnect();
          oldDelayBus.wetFilterR?.disconnect();
          oldDelayBus.wetGain?.disconnect();
          oldDelayBus.panner?.disconnect();
          oldDelayBus.pannerR?.disconnect();
        } catch (e) {}
      }
      try { oldSidechain?.disconnect(); } catch (e) {}
      try { oldMusicBus?.disconnect(); } catch (e) {}
      try { oldLowShelf?.disconnect(); } catch (e) {}
      try { oldHighShelf?.disconnect(); } catch (e) {}
      try { oldReverbSend?.disconnect(); } catch (e) {}
    };
    if (this.musicGain) {
      const oldGain = this.musicGain;
      if (fade && this.ctx) {
        const now = this.ctx.currentTime;
        oldGain.gain.cancelScheduledValues(now);
        oldGain.gain.setValueAtTime(Math.max(0.0001, oldGain.gain.value), now);
        oldGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
        if (oldReverbSend) {
          oldReverbSend.gain.setValueAtTime(Math.max(0.0001, oldReverbSend.gain.value), now);
          oldReverbSend.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
        }
        setTimeout(() => {
          cleanupAuxNodes();
          try { oldGain.disconnect(); } catch (e) {}
        }, 210);
      } else {
        cleanupAuxNodes();
        try { oldGain.disconnect(); } catch (e) {}
      }
      this.musicGain = null;
    } else {
      cleanupAuxNodes();
    }
  },

  switchTrack(newIdx) {
    const safeIdx = Math.floor(Math.max(0, Math.min(newIdx, this.tracks.length - 1)));
    this.stopMusic(true);
    this.trackIdx = safeIdx;
    env().saveSettings({ musicTrack: safeIdx });
    const t = this.tracks[safeIdx];
    this.tempo = t.tempo;
    if (env().isPlayerOnFinalLap()) {
      this.tempo = t.tempo + TUNING.FINAL_LAP_TEMPO_BOOST;
    }
    if (this._switchTrackTimer) clearTimeout(this._switchTrackTimer);
    this._switchTrackTimer = setTimeout(() => {
      this._switchTrackTimer = null;
      this.startMusic();
    }, 60);
  },

  scheduleStep(step, time) {
    // Select musical style per map
    if (this.mapStyle === "japanese") {
      this.scheduleJapaneseStep(step, time);
      return;
    }

    const barInLoop = Math.floor(step / 16);
    const bar = barInLoop % 8;
    const phrase = Math.floor(barInLoop / 8); // 0: Hook, 1: Full Chorus, 2: Lift/Solo, 3: Climax/Build
    const stepInBar = step % 16;
    const stepDur = 60.0 / this.tempo / 4.0; // 16th note duration
    const track = this.trackIdx || 0;
    const loopBars = this.getLoopSteps() / 16;
    const isFinalBar = barInLoop === loopBars - 1;
    const isBreakdown = phrase === 3 && bar === 6;
    const isBuildBar = bar === 7 && (phrase === 1 || phrase === 3);

    // Reactive race excitement (0..1): groove ALWAYS plays; intensity & final lap enrich brightness, percussion, and harmony
    const rawIntensity = clamp(env().getMusicIntensity ? env().getMusicIntensity() : 0.7, 0, 1);
    const isFinalLap = !!(env().isPlayerOnFinalLap && env().isPlayerOnFinalLap());
    const energy = clamp(0.45 + rawIntensity * 0.4 + (isFinalLap ? 0.25 : 0), 0.35, 1.0);
    const highEnergy = energy > 0.62 || phrase === 1 || phrase === 2 || isFinalLap;

    // 1. Bass groove (clean mono sub + sculpted mid-bass, sidechained against kick)
    const bassFreq = this.getBassFreq(step, phrase);
    if (bassFreq && !(isBreakdown && stepInBar % 4 !== 0)) {
      const bassDurMult = track === 5 ? 0.92 : track === 3 ? 1.45 : track === 4 ? 2.8 : track === 0 ? 0.95 : 1.05;
      this.playBassNote(bassFreq, time, stepDur * bassDurMult, step, energy, phrase);
    }

    // 2. Lead melody (rich dual-voice synth with delayed vibrato, stereo pan & ping-pong delay)
    const melFreq = this.getMelodyNote(step, phrase);
    if (melFreq) {
      const melDurMult = track === 5 ? 3.2 : track === 3 ? 2.7 : track === 4 ? 4.4 : track === 2 ? 1.55 : 2.1;
      const octaveLift = (phrase === 2 && (track === 0 || track === 2 || track === 3) && (stepInBar === 0 || stepInBar === 8))
        || (isFinalLap && phrase >= 1 && stepInBar === 0 && bar % 2 === 0);
      this.playMelodyNote(melFreq, time, stepDur * melDurMult, {
        energy,
        phrase,
        octaveShimmer: octaveLift,
        pan: (stepInBar % 8 < 4) ? -0.1 : 0.1,
      });
    }

    // 2a. Harmonically locked counter-melody / sparkle plucks in Phrases 1–3
    const chordFreqs = this.getChordFreqs(track, bar);
    if (phrase >= 1 && !isBreakdown && chordFreqs && chordFreqs.length) {
      const counterHit =
        (track === 0 && (stepInBar === 2 || stepInBar === 6 || stepInBar === 10 || stepInBar === 14)) ||
        (track === 1 && (stepInBar === 3 || stepInBar === 11 || (phrase === 2 && stepInBar === 15))) ||
        (track === 2 && (stepInBar === 4 || stepInBar === 10 || stepInBar === 14)) ||
        (track === 3 && (stepInBar === 2 || stepInBar === 6 || stepInBar === 10 || stepInBar === 14)) ||
        (track === 4 && (stepInBar === 6 || stepInBar === 14)) ||
        (track === 5 && (stepInBar === 3 || stepInBar === 11));
      if (counterHit) {
        const chordNote = chordFreqs[(stepInBar + bar + phrase) % chordFreqs.length];
        const octaveMult = track === 4 ? 2 : (track === 5 ? 2 : (chordNote < 360 ? 2 : 1));
        const pan = (stepInBar % 4 < 2) ? -0.45 : 0.45;
        this.playPluckCounter(chordNote * octaveMult, time, stepDur * (track === 4 ? 2.4 : 1.15), {
          track,
          energy,
          pan,
          vol: (phrase === 2 ? 0.052 : 0.04) * (0.85 + energy * 0.25),
        });
      }
    }

    // 2b. Chords / Pads / Arps (always present to keep harmonic fullness; evolve by section)
    if (track === 0) {
      if (stepInBar === 0) {
        this.playJunoPad(chordFreqs, time, stepDur * (isBreakdown ? 16 : 15), energy);
      }
      if ((phrase >= 1 || bar >= 4) && !isBreakdown && stepInBar % 2 === 0) {
        const arpNote = chordFreqs[(stepInBar / 2 + bar) % chordFreqs.length] * 2;
        this.playPluckCounter(arpNote, time, stepDur * 0.72, {
          track: 0,
          energy,
          pan: ((stepInBar / 2) % 2 === 0) ? -0.38 : 0.38,
          vol: 0.026,
        });
      }
    } else if (track === 1) {
      if (bar < 7 && (stepInBar === 3 || stepInBar === 7 || stepInBar === 11 || stepInBar === 15)) {
        this.playChiptuneArp(chordFreqs, time, stepDur * 0.95, 0.35);
      }
      if (stepInBar === 0 && (phrase >= 1 || bar >= 4)) {
        this.playJunoPad(chordFreqs.map(f => f * 0.5), time, stepDur * 14, energy * 0.85);
      }
    } else if (track === 2) {
      if (bar < 7 && stepInBar % 4 === 1) {
        this.playChiptuneArp(chordFreqs, time, stepDur * 1.15, (stepInBar === 1 || stepInBar === 9) ? -0.35 : 0.35);
      }
      if (phrase >= 1 && stepInBar === 0 && bar % 2 === 0) {
        this.playChiptuneArp(chordFreqs.map(f => f * 0.5), time, stepDur * 2.2, 0);
      }
    } else if (track === 3) {
      if (!isBreakdown && (stepInBar === 2 || stepInBar === 6 || stepInBar === 10 || stepInBar === 14)) {
        this.playHouseChord(chordFreqs, time, stepDur * 2.6, energy);
      } else if (isBreakdown && stepInBar === 0) {
        this.playJunoPad(chordFreqs, time, stepDur * 15, energy);
      }
    } else if (track === 4) {
      if (stepInBar === 0 || (phrase >= 1 && stepInBar === 10 && bar % 2 === 1)) {
        this.playRhodesPad(chordFreqs, time, stepDur * (stepInBar === 0 ? 14 : 6), energy);
      }
    } else if (track === 5) {
      if ((bar >= 2 || phrase >= 1) && (stepInBar === 0 || (phrase >= 2 && stepInBar === 10))) {
        this.playDowntempoPad(chordFreqs, time, stepDur * (stepInBar === 0 ? 10 : 4.5), energy);
      }
    }

    // 3. Drums & Percussion (punchy, rhythmic, with bar-7 fills & crash drops)
    const shouldCrash = stepInBar === 0 && (bar === 0 || (bar === 4 && phrase === 1));
    if (shouldCrash && (track !== 4 || phrase > 0)) {
      this.playCrashCymbal(time, phrase === 0 ? 0.055 : 0.075);
    }

    if (track === 4) {
      // Dirty Downtempo: dusty swung breakbeat
      if (!isBreakdown) {
        if (stepInBar === 0 || stepInBar === 10 || (phrase >= 1 && bar % 2 === 1 && stepInBar === 7)) {
          this.playRetroKick(time, true, 0.84, stepDur * 3);
        }
        if (stepInBar === 4 || stepInBar === 12) {
          this.playRetroSnare(time, 0.92);
        }
        if ((bar >= 2 || phrase >= 1) && (stepInBar === 7 || stepInBar === 15)) {
          this.playRetroSnare(time, 0.28);
        }
        if (stepInBar % 2 === 0) {
          const isOpen = (bar % 2 === 1 && stepInBar === 8) || (phrase >= 1 && stepInBar === 14);
          const vel = (stepInBar % 4 === 2) ? 0.95 : 0.55;
          this.playRetroHiHat(time, isOpen, vel, (stepInBar % 4 === 2) ? 0.22 : -0.18);
        }
      }
      if (bar === 7 && stepInBar >= 10) {
        this.playRetroSnare(time, 0.35 + (stepInBar - 10) * 0.11);
      }
    } else if (track === 5) {
      // Minimal Techno: relentless four-on-the-floor + hypnotic offbeat hats & dub-clap groove
      if (!isBreakdown && (stepInBar === 0 || stepInBar === 4 || stepInBar === 8 || stepInBar === 12)) {
        this.playRetroKick(time, true, 0.56, stepDur * 2.6);
      }
      if (!isBreakdown && (stepInBar === 2 || stepInBar === 6 || stepInBar === 10 || stepInBar === 14)) {
        this.playRetroHiHat(time, phrase >= 2 && stepInBar === 14, 1.0, 0.25);
      }
      if (highEnergy && !isBreakdown && stepInBar % 2 === 1) {
        this.playRetroHiHat(time, false, 0.42, -0.25);
      }
      if ((bar >= 2 || phrase >= 1) && !isBreakdown && (stepInBar === 4 || stepInBar === 12)) {
        this.playClap(time, 0.65);
        this.playRetroSnare(time, 0.45);
      }
      if (bar === 7 && stepInBar >= 12) {
        this.playRetroSnare(time, (stepInBar - 11) / 4.0);
        this.playClap(time, (stepInBar - 11) / 4.5);
      }
    } else if (track === 3) {
      // Heavy Modern Banger: pumping four-on-the-floor house groove
      if (!isBreakdown) {
        if (stepInBar === 0 || stepInBar === 4 || stepInBar === 8 || stepInBar === 12) {
          this.playRetroKick(time, true, 0.52, stepDur * 2.8);
        }
        if (stepInBar === 2 || stepInBar === 6 || stepInBar === 10 || stepInBar === 14) {
          this.playRetroHiHat(time, true, highEnergy ? 1.0 : 0.78, 0.28);
        }
        if (highEnergy && stepInBar % 2 === 1 && (bar >= 2 || phrase >= 1)) {
          this.playRetroHiHat(time, false, 0.48, -0.28);
        }
        if (stepInBar === 4 || stepInBar === 12) {
          this.playClap(time, 1.0);
          this.playRetroSnare(time, 0.68);
        }
        if ((bar >= 4 || phrase >= 1) && (stepInBar === 7 || stepInBar === 15)) {
          this.playRetroSnare(time, 0.34);
        }
      } else {
        if (stepInBar === 0 || stepInBar === 8) {
          this.playRetroKick(time, true, 0.62, stepDur * 3.0);
        }
        if (stepInBar === 4 || stepInBar === 12) {
          this.playClap(time, 0.8);
        }
      }
      if (bar === 7 && stepInBar >= 8) {
        const ramp = (stepInBar - 7) / 8.0;
        this.playRetroSnare(time, ramp);
        if (stepInBar >= 12) this.playClap(time, (stepInBar - 11) / 4.5);
      }
    } else {
      // Tracks 0 (Synthwave), 1 (Acid), 2 (Chiptune)
      const chorus = bar === 4 || bar === 5 || phrase === 1 || phrase === 2;
      const sidechainDepth = track === 0 ? 0.68 : track === 1 ? 0.64 : 0.84;

      if (!isBreakdown) {
        const kickSteps = chorus
          ? [0, 4, 8, 12]
          : (track === 1 ? [0, 4, 8, 12] : track === 2 ? [0, 6, 8, 12] : [0, 8, 10]);
        if (kickSteps.includes(stepInBar)) {
          this.playRetroKick(time, track === 1 || chorus, sidechainDepth, stepDur * 2.5);
        }

        if (stepInBar === 4 || stepInBar === 12) {
          this.playRetroSnare(time, track === 2 ? 0.78 : 0.96);
          if (track === 1 && chorus) this.playClap(time, 0.65);
        }

        // Crisp grooving hi-hats (always present on offbeats, 16th shimmer at high energy)
        if (stepInBar % 2 === 0) {
          const isOffbeat = stepInBar % 4 === 2;
          const openHat = isOffbeat && (chorus || track === 1) && (stepInBar === 6 || stepInBar === 14);
          this.playRetroHiHat(time, openHat, isOffbeat ? 0.92 : 0.45, isOffbeat ? 0.24 : -0.2);
        } else if (highEnergy && (chorus || track === 1)) {
          this.playRetroHiHat(time, false, 0.36, stepInBar % 4 === 1 ? -0.3 : 0.3);
        }
      } else {
        if (stepInBar === 0 || stepInBar === 8) {
          this.playRetroKick(time, false, 0.75, stepDur * 2.8);
        }
        if (stepInBar === 4 || stepInBar === 12) {
          this.playRetroSnare(time, 0.65);
        }
      }

      // Musical bar-7 tom & snare turnaround fills
      if (bar === 7 && stepInBar >= 10) {
        if (track === 0 || track === 2) {
          const tomNotes = [220, 196, 165, 146.83, 123.47, 98];
          const tomIdx = stepInBar - 10;
          if (stepInBar === 10 || stepInBar === 12 || stepInBar === 14 || stepInBar === 15) {
            this.playRetroTom(tomNotes[tomIdx] || 110, time, (tomIdx - 2.5) * 0.22);
          }
          if (stepInBar >= 13) this.playRetroSnare(time, (stepInBar - 12) / 3.5);
        } else {
          this.playRetroSnare(time, (stepInBar - 9) / 6.5);
        }
      }
    }

    // 4. Transition riser into Phrase drop / loop restart
    if ((isBuildBar || isFinalBar) && stepInBar >= 10) {
      const progress = (stepInBar - 10) / 6.0;
      const noiseBuf = this._getNoiseBuffer();
      const dest = this._getMusicDest(false);
      if (this.ctx && !this.muted && dest && noiseBuf) {
        const dur = clamp(stepDur * 1.4, 0.04, 0.6);
        const src = this.ctx.createBufferSource();
        src.buffer = noiseBuf;
        const hp = this.ctx.createBiquadFilter();
        hp.type = "bandpass";
        hp.frequency.setValueAtTime(700 + progress * 4200, time);
        hp.frequency.linearRampToValueAtTime(1400 + progress * 5200, time + dur);
        hp.Q.setValueAtTime(2.6, time);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.001, time);
        g.gain.linearRampToValueAtTime((isFinalBar ? 0.055 : 0.036) * (0.35 + progress), time + dur * 0.65);
        g.gain.exponentialRampToValueAtTime(0.001, time + dur);
        src.connect(hp);
        hp.connect(g);
        g.connect(dest);
        src.onended = () => { try { hp.disconnect(); g.disconnect(); } catch (e) {} };
        src.start(time, Math.random() * 0.5, dur);
      }
    }
  },

  getBassFreq(step, phrase = 0) {
    const barInLoop = Math.floor(step / 16);
    const bar = barInLoop % 8;
    const stepInBar = step % 16;
    const track = this.trackIdx || 0;

    if (track === 0) {
      // Synthwave Cruise: driving 16th-note Outrun octave bassline in Em
      const roots = [82.41, 65.41, 73.42, 61.74, 82.41, 65.41, 55.00, 61.74];
      const driving = phrase === 1 || phrase === 2 || bar === 4 || bar === 5;
      const patterns = driving
        ? [
            [1, 1, 2, 1, 1, 2, 1, 1.5, 1, 1, 2, 1, 1.5, 1, 2, 1.5],
            [1, null, 2, 1, 1, 2, null, 1.5, 1, 1, 2, 1, 1, 2, 1.5, 2],
            [1, 1, 2, 1, 1.5, 1, 2, 1, 1, 1, 2, 1, 1.5, 2, 1, 1.5],
            [1, 1, 2, null, 1, 2, 1, 1.5, 1, 1, 2, 1, 1.5, 1, 2, null],
          ]
        : [
            [1, null, 2, 1, null, 1.5, null, 2, 1, null, 2, 1, 1.5, null, 2, null],
            [1, null, 1.5, null, 2, null, 1.5, 1, 1, null, 2, null, 1.5, null, 1, 2],
            [1, null, 2, 1, 1.5, null, 2, null, 1, null, 1.5, 1, 2, null, 1.5, null],
            [1, null, 2, null, 1.5, null, 1, 2, 1, null, 2, null, 1.5, null, 2, null],
          ];
      const ratio = (bar >= 6 ? [1, null, 2, null, 1, null, 1.5, null, 1, null, 2, null, 1.5, null, 2, null] : patterns[bar % patterns.length])[stepInBar];
      return ratio ? roots[bar] * ratio : null;
    }

    if (track === 1) {
      const roots = [55.00, 43.65, 49.00, 41.20, 55.00, 43.65, 36.71, 41.20];
      const patterns = [
        [1, null, 1.189, 2, 1.498, null, 1, 1.782, 1, null, 1.189, 2, 1.498, null, 1, 2],
        [1, 1.498, null, 1.189, 2, 1.782, null, 1, 1, null, 1.189, 1.498, 2, null, 1.782, 1],
        [1, null, 1.189, 1.498, null, 2, 1, null, 1.189, 2, 1.782, null, 1, 2, 1.189, 1.498],
        [1, null, 1.498, 2, 1.189, null, 1, 2, 1.782, null, 1.189, 1, 1, 2, 1.498, null],
      ];
      const ratio = (bar >= 6 ? [1, null, 2, 1.189, null, 1, 1.498, null, 1, null, 2, 1.782, 1.498, null, 2, null] : patterns[bar % patterns.length])[stepInBar];
      return ratio ? roots[bar] * ratio : null;
    }

    if (track === 2) {
      const roots = [65.41, 98.00, 55.00, 87.31, 65.41, 98.00, 87.31, 98.00];
      const patterns = [
        [1, null, 2, null, 1.5, null, 2, 1, 1, null, 2, null, 1.5, null, 1.25, 2],
        [1, null, 1.5, null, 2, null, 1.5, null, 1, null, 2, 1, 1.5, null, 2, null],
        [1, null, 2, null, 1.2, null, 1.5, 2, 1, null, 2, null, 1.5, null, 1.2, 2],
        [1, null, 1.5, null, 2, null, 1, 1.5, 1, null, 1.25, null, 1.5, null, 2, null],
      ];
      const ratio = (bar >= 6 ? [1, null, 1.5, null, 2, null, 1.5, null, 1, null, 1.5, null, 2, null, 1.5, null] : patterns[bar % patterns.length])[stepInBar];
      return ratio ? roots[bar] * ratio : null;
    }

    if (track === 3) {
      const roots = [43.65, 51.91, 38.89, 58.27, 43.65, 51.91, 46.25, 58.27];
      const patterns = [
        [1, null, 1, 1.5, null, null, 1, 2, 1.5, null, 1, null, 2, null, 1.5, null],
        [1, null, 1, null, 1.5, null, 1, 2, null, null, 1, 1.5, 1.5, null, 2, null],
        [1, null, 1.5, null, 1, null, 2, null, 1, null, 1.5, null, 1, 2, null, 1.5],
        [1, null, 1, null, 2, null, 1.5, null, 1, null, 1, 1.5, null, 2, 2, null],
      ];
      const ratio = (bar >= 6 ? [1, null, null, null, 1.5, null, null, null, 1, null, null, null, 2, null, null, null] : patterns[bar % patterns.length])[stepInBar];
      return ratio ? roots[bar] * ratio : null;
    }

    if (track === 4) {
      const roots = [36.71, 41.20, 32.70, 36.71, 36.71, 41.20, 34.65, 41.20];
      const patterns = [
        [1, null, null, null, null, 1.5, null, null, 1, null, null, 2, null, null, 1.5, null],
        [1, null, null, 1.5, null, null, null, null, 1, null, null, null, null, 2, null, null],
        [1, null, null, null, null, null, 1.5, null, null, null, 1, null, null, null, 2, null],
        [1, null, null, null, 1.5, null, null, 2, null, null, null, null, 1, null, 1.5, null],
      ];
      const ratio = (bar >= 6 ? [1, null, null, null, null, null, null, null, 1.5, null, null, null, null, null, null, null] : patterns[bar % patterns.length])[stepInBar];
      return ratio ? roots[bar] * ratio : null;
    }

    if (track === 5) {
      // Regulatory Submission: F# minor, hypnotic rolling pulse
      const roots = [46.25, 46.25, 43.65, 46.25, 46.25, 43.65, 41.20, 43.65];
      const patterns = [
        [1, null, 1, null, 1, null, 1.189, null, 1, null, 1, 2, 1.498, null, 1, null],
        [1, null, 1, null, 1.189, null, 1, null, 1, null, 1.498, null, 1, 2, 1, null],
        [1, null, 1, 1.189, null, 2, 1, null, 1.498, null, 1, null, 1, 1.189, null, 2],
        [1, null, 1, null, 1, null, 1, 2, 1, null, 1, null, 1, null, 1.498, null],
      ];
      const ratio = (bar >= 6 ? [1, null, 1, null, null, null, 1, null, null, null, 1.189, null, 1, null, null, null] : patterns[bar % patterns.length])[stepInBar];
      return ratio ? roots[bar] * ratio : null;
    }

    return null;
  },

  getPatternNote(step, events, length = 128) {
    const idx = step % length;
    const hit = events.find(([pos]) => pos === idx);
    return hit ? hit[1] : null;
  },

  getMelodyNote(step, phrase = 0) {
    const track = this.trackIdx || 0;
    const barInLoop = Math.floor(step / 16);
    const bar = barInLoop % 8;
    const stepInBar = step % 16;

    if (track === 0) {
      if (bar === 6) {
        return [440.00, null, null, 523.25, null, 659.25, null, null, 783.99, null, 659.25, null, 523.25, null, null, null][stepInBar];
      } else if (bar === 7) {
        return [493.88, null, 622.25, null, 739.99, null, null, 880.00, 987.77, null, 739.99, null, 622.25, null, 493.88, null][stepInBar];
      }
      if (phrase === 2) {
        // Soaring synthwave lift variation (Em - C - D - Bm)
        return this.getPatternNote(step, [
          [0, 659.25], [3, 783.99], [6, 987.77], [10, 880.00], [12, 783.99], [15, 659.25],
          [16, 783.99], [19, 659.25], [22, 523.25], [26, 659.25], [29, 783.99],
          [32, 739.99], [35, 880.00], [38, 1174.66], [42, 987.77], [45, 880.00], [47, 739.99],
          [48, 739.99], [52, 587.33], [56, 493.88], [60, 587.33], [62, 739.99],
          [64, 659.25], [67, 783.99], [70, 987.77], [74, 1174.66], [76, 987.77], [79, 783.99],
          [80, 1046.50], [84, 987.77], [87, 783.99], [90, 659.25], [93, 783.99],
        ]);
      }
      return this.getPatternNote(step, [
        [0, 329.63], [3, 392.00], [6, 493.88], [10, 587.33], [12, 493.88], [15, 392.00],
        [17, 523.25], [20, 659.25], [23, 587.33], [26, 783.99], [29, 659.25],
        [32, 440.00], [35, 587.33], [38, 739.99], [42, 880.00], [45, 739.99], [47, 587.33],
        [49, 493.88], [52, 587.33], [55, 440.00], [58, 392.00], [61, 369.99],
        [64, 329.63], [67, 493.88], [70, 659.25], [74, 587.33], [76, 493.88], [79, 440.00],
        [81, 392.00], [84, 523.25], [87, 659.25], [90, 783.99], [93, 659.25],
      ]);
    }

    if (track === 1) {
      if (bar === 6) {
        return [587.33, null, 698.46, null, null, 880.00, null, 1046.50, 1174.66, null, 880.00, null, 698.46, null, null, null][stepInBar];
      } else if (bar === 7) {
        return [659.25, 830.61, null, 987.77, null, 1174.66, null, null, 1318.51, null, 987.77, null, 830.61, null, 659.25, null][stepInBar];
      }
      if (phrase === 2) {
        return this.getPatternNote(step, [
          [0, 880.00], [2, 783.99], [4, 659.25], [6, 783.99], [8, 880.00], [11, 1046.50], [14, 987.77],
          [16, 698.46], [19, 880.00], [22, 1046.50], [25, 880.00], [28, 698.46], [30, 659.25],
          [32, 783.99], [34, 987.77], [37, 1174.66], [40, 987.77], [43, 783.99], [46, 659.25],
          [48, 830.61], [50, 987.77], [53, 1318.51], [56, 1174.66], [59, 987.77], [62, 830.61],
          [64, 880.00], [67, 1046.50], [70, 1318.51], [74, 1174.66], [77, 1046.50],
          [80, 698.46], [83, 880.00], [86, 1046.50], [90, 987.77], [93, 880.00],
        ]);
      }
      return this.getPatternNote(step, [
        [0, 440.00], [1, 523.25], [4, 659.25], [7, 587.33], [10, 523.25], [12, 659.25], [15, 783.99],
        [16, 349.23], [18, 523.25], [21, 587.33], [24, 440.00], [27, 523.25], [30, 698.46],
        [32, 392.00], [33, 493.88], [36, 659.25], [39, 587.33], [42, 493.88], [44, 587.33], [47, 783.99],
        [48, 415.30], [50, 587.33], [53, 659.25], [56, 493.88], [59, 587.33], [62, 830.61],
        [64, 440.00], [67, 523.25], [69, 659.25], [72, 783.99], [75, 659.25], [78, 587.33],
        [80, 349.23], [83, 440.00], [85, 587.33], [88, 698.46], [91, 587.33], [94, 523.25],
      ]);
    }

    if (track === 2) {
      if (bar === 6) {
        return [698.46, null, 880.00, null, 1046.50, null, null, 1318.51, 1396.91, null, 1046.50, null, 880.00, null, null, null][stepInBar];
      } else if (bar === 7) {
        return [783.99, null, 987.77, null, 1174.66, null, 1396.91, null, 1567.98, null, 1174.66, null, 987.77, null, 783.99, null][stepInBar];
      }
      if (phrase === 2) {
        return this.getPatternNote(step, [
          [0, 1046.50], [2, 987.77], [4, 783.99], [6, 880.00], [8, 1046.50], [11, 1318.51], [14, 1174.66],
          [16, 783.99], [18, 987.77], [21, 1174.66], [24, 987.77], [27, 783.99], [30, 659.25],
          [32, 880.00], [34, 1046.50], [37, 1318.51], [40, 1046.50], [43, 880.00], [46, 783.99],
          [48, 698.46], [51, 880.00], [54, 1046.50], [58, 987.77], [61, 783.99],
          [64, 1046.50], [67, 1318.51], [70, 1567.98], [74, 1318.51], [77, 1046.50],
          [80, 987.77], [83, 1174.66], [86, 1567.98], [90, 1318.51], [93, 1174.66],
        ]);
      }
      return this.getPatternNote(step, [
        [0, 523.25], [2, 659.25], [5, 783.99], [8, 880.00], [11, 783.99], [14, 587.33],
        [16, 392.00], [19, 493.88], [22, 587.33], [24, 659.25], [27, 587.33], [30, 440.00],
        [32, 440.00], [34, 523.25], [37, 659.25], [40, 783.99], [43, 659.25], [46, 493.88],
        [48, 349.23], [51, 440.00], [54, 523.25], [56, 659.25], [59, 523.25], [62, 392.00],
        [64, 523.25], [67, 659.25], [69, 783.99], [72, 1046.50], [75, 880.00], [78, 659.25],
        [80, 392.00], [82, 493.88], [85, 587.33], [88, 783.99], [91, 659.25], [94, 493.88],
      ]);
    }

    if (track === 3) {
      if (bar === 6) {
        return [523.25, null, null, 622.25, null, null, 698.46, null, 783.99, null, null, 698.46, null, 622.25, null, null][stepInBar];
      } else if (bar === 7) {
        return [466.16, null, 523.25, null, 622.25, null, null, 698.46, 783.99, null, 698.46, null, 622.25, null, 523.25, null][stepInBar];
      }
      if (phrase === 2) {
        return this.getPatternNote(step, [
          [0, 698.46], [4, 830.61], [8, 1046.50], [11, 932.33], [14, 830.61],
          [16, 783.99], [20, 932.33], [24, 1046.50], [28, 783.99], [30, 698.46],
          [32, 622.25], [36, 783.99], [40, 932.33], [44, 783.99], [46, 698.46],
          [48, 587.33], [52, 698.46], [56, 932.33], [60, 830.61], [62, 698.46],
          [64, 698.46], [68, 1046.50], [72, 932.33], [76, 830.61], [78, 783.99],
          [80, 830.61], [84, 1046.50], [88, 1244.51], [92, 1046.50], [94, 932.33],
        ]);
      }
      return this.getPatternNote(step, [
        [4, 523.25], [11, 622.25], [14, 698.46],
        [18, 523.25], [23, 783.99], [30, 622.25],
        [36, 466.16], [43, 622.25], [46, 698.46],
        [50, 587.33], [55, 698.46], [62, 523.25],
        [68, 523.25], [71, 622.25], [78, 783.99],
        [82, 523.25], [87, 932.33], [94, 783.99],
      ]);
    }

    if (track === 4) {
      if (bar === 6) {
        return [293.66, null, null, null, null, null, 349.23, null, null, null, null, null, 329.63, null, null, null][stepInBar];
      } else if (bar === 7) {
        return [261.63, null, null, null, 293.66, null, null, null, 329.63, null, null, null, null, null, 293.66, null][stepInBar];
      }
      if (phrase === 2) {
        return this.getPatternNote(step, [
          [0, 493.88], [6, 440.00], [12, 392.00],
          [20, 440.00], [28, 392.00],
          [34, 440.00], [42, 523.25], [50, 493.88],
          [58, 392.00],
          [64, 493.88], [72, 440.00], [80, 392.00],
          [88, 440.00], [94, 392.00],
        ]);
      }
      return this.getPatternNote(step, [
        [0, 329.63], [7, 293.66], [14, 349.23],
        [22, 329.63], [30, 293.66],
        [36, 329.63], [44, 369.99], [50, 349.23],
        [58, 293.66],
        [66, 329.63], [74, 261.63], [80, 293.66],
        [88, 349.23], [95, 329.63],
      ]);
    }

    if (track === 5) {
      // F# minor: 32-bar minimal techno line, opening from sparse pings into a hypnotic alarm motif.
      const phraseMotifs = [
        [
          [0, 369.99], [12, 493.88], [24, 415.30], [44, 329.63],
          [64, 369.99], [76, 554.37], [96, 415.30], [116, 493.88],
        ],
        [
          [128, 369.99], [134, 415.30], [140, 493.88], [148, 554.37],
          [160, 659.25], [168, 554.37], [176, 493.88], [184, 415.30],
          [192, 369.99], [204, 493.88], [212, 554.37], [220, 659.25], [236, 493.88], [248, 415.30],
        ],
        [
          [256, 739.99], [260, 659.25], [268, 554.37], [276, 493.88],
          [288, 554.37], [292, 659.25], [300, 739.99], [308, 880.00],
          [320, 739.99], [324, 659.25], [332, 554.37], [340, 493.88],
          [352, 415.30], [364, 493.88], [372, 554.37], [380, 659.25],
        ],
        [
          [384, 554.37], [388, 493.88], [392, 415.30], [396, 369.99],
          [400, 329.63], [408, 369.99], [416, 415.30], [424, 493.88],
          [432, 554.37], [436, 659.25], [440, 739.99], [444, 880.00],
          [448, 739.99], [456, 659.25], [464, 554.37], [472, 493.88],
          [480, 415.30], [488, 369.99], [496, 493.88], [504, 554.37],
        ],
      ];
      return this.getPatternNote(step, phraseMotifs[phrase] || phraseMotifs[0], 512);
    }

    return null;
  },

  playBassNote(freq, time, dur, step, energy = 0.8, phrase = 0) {
    const dest = this._getMusicDest(true);
    if (!this.ctx || this.muted || !dest || !freq) return;
    const bar = Math.floor(step / 16) % 8;
    const stepInBar = step % 16;
    const track = this.trackIdx || 0;
    const isModern = track === 3;
    const isDowntempo = track === 4;
    const isAcid = track === 1;
    const isMinimal = track === 5;
    const safeDur = Math.max(0.04, dur);

    // Clean mono sub-oscillator bypasses heavy waveshaper for rock-solid low end
    const subOsc = this.ctx.createOscillator();
    subOsc.type = (isModern || isDowntempo || isMinimal) ? "sine" : "triangle";
    subOsc.frequency.setValueAtTime(freq * 0.5, time);

    const subGain = this.ctx.createGain();
    subGain.gain.value = (isModern || isDowntempo || isMinimal) ? 0.72 : 0.55;

    // Harmonic mid-bass oscillator runs through cached waveshaper + resonant filter
    const gritOsc = this.ctx.createOscillator();
    gritOsc.type = (isModern || track === 2) ? "square" : "sawtooth";
    gritOsc.frequency.setValueAtTime(freq, time);
    gritOsc.detune.setValueAtTime(isDowntempo ? 14 : isModern ? 10 : 6, time);

    if (isAcid && stepInBar % 4 !== 0) {
      const slideTime = Math.min(0.065, safeDur * 0.45);
      subOsc.frequency.setValueAtTime((freq * 0.5) * 0.91, time);
      subOsc.frequency.exponentialRampToValueAtTime(freq * 0.5, time + slideTime);
      gritOsc.frequency.setValueAtTime(freq * 0.91, time);
      gritOsc.frequency.exponentialRampToValueAtTime(freq, time + slideTime);
    }

    const dist = this.ctx.createWaveShaper();
    dist.curve = this._getDistCurve(isDowntempo ? "dirty" : isModern ? "heavy" : "warm");
    dist.oversample = "none";

    // Filter evolves with bar, phrase, and race energy
    const brightness = 0.8 + energy * 0.4 + (phrase === 2 ? 0.18 : 0);
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    if (isDowntempo) {
      filter.Q.setValueAtTime(bar >= 6 ? 1.2 : 3.2, time);
      filter.frequency.setValueAtTime((bar >= 6 ? 380 : 720) * brightness, time);
      filter.frequency.exponentialRampToValueAtTime(95, time + safeDur * 0.92);
    } else if (isModern) {
      filter.Q.setValueAtTime(bar >= 6 ? 2.0 : 5.0, time);
      filter.frequency.setValueAtTime((bar >= 6 ? 640 : 1550) * brightness, time);
      filter.frequency.exponentialRampToValueAtTime(150, time + safeDur * 0.82);
    } else if (isAcid) {
      const acidAccent = (stepInBar === 0 || stepInBar === 3 || stepInBar === 11);
      filter.Q.setValueAtTime(bar >= 6 ? 2.5 : (acidAccent ? 7.8 : 5.6), time);
      filter.frequency.setValueAtTime((acidAccent ? 1850 : 1050) * brightness, time);
      filter.frequency.exponentialRampToValueAtTime(125, time + safeDur * 0.85);
    } else if (isMinimal) {
      filter.Q.setValueAtTime(2.6, time);
      filter.frequency.setValueAtTime((520 + (bar % 4) * 140) * brightness, time);
      filter.frequency.exponentialRampToValueAtTime(115, time + safeDur * 0.88);
    } else {
      filter.Q.setValueAtTime(bar >= 6 ? 1.5 : 3.0, time);
      filter.frequency.setValueAtTime((bar >= 6 ? 340 : 880) * brightness, time);
      filter.frequency.exponentialRampToValueAtTime(120, time + safeDur * 0.85);
    }

    const gain = this.ctx.createGain();
    const accent = (stepInBar === 0 || stepInBar === 8) ? 1.05 : 0.84;
    const peak = (isDowntempo ? 0.30 : isModern ? 0.32 : isAcid ? 0.27 : 0.26) * accent;
    const attack = isDowntempo ? 0.032 : isModern ? 0.005 : 0.01;
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(peak, time + attack);
    gain.gain.exponentialRampToValueAtTime(0.001, time + safeDur);

    gritOsc.connect(dist);
    dist.connect(filter);
    filter.connect(gain);

    subOsc.connect(subGain);
    subGain.connect(gain);

    gain.connect(dest);

    subOsc.onended = () => {
      try {
        dist.disconnect();
        filter.disconnect();
        subGain.disconnect();
        gain.disconnect();
      } catch (e) {}
    };

    const stopAt = time + safeDur + 0.02;
    subOsc.start(time);
    subOsc.stop(stopAt);
    gritOsc.start(time);
    gritOsc.stop(stopAt);
  },

  getChordFreqs(track, bar) {
    if (track === 0) {
      // Em, C, D, Bm, Em, C, Am, B7
      if (bar === 0 || bar === 4) return [329.63, 392.00, 493.88]; // Em (E4, G4, B4)
      if (bar === 1 || bar === 5) return [261.63, 329.63, 392.00]; // C (C4, E4, G4)
      if (bar === 2) return [293.66, 369.99, 440.00];             // D (D4, F#4, A4)
      if (bar === 3) return [246.94, 293.66, 369.99];             // Bm (B3, D4, F#4)
      if (bar === 6) return [220.00, 261.63, 329.63];             // Am (A3, C4, E4)
      if (bar === 7) return [246.94, 311.13, 369.99];             // B7 (B3, D#4, F#4)
    }
    if (track === 1) {
      // Am, F, G, Em, Am, F, Dm, E
      if (bar === 0 || bar === 4) return [440.00, 523.25, 659.25]; // Am (A4, C5, E5)
      if (bar === 1 || bar === 5) return [349.23, 440.00, 523.25]; // F (F4, A4, C5)
      if (bar === 2) return [392.00, 493.88, 587.33];             // G (G4, B4, D5)
      if (bar === 3) return [329.63, 392.00, 493.88];             // Em (E4, G4, B4)
      if (bar === 6) return [293.66, 349.23, 440.00];             // Dm (D4, F4, A4)
      if (bar === 7) return [329.63, 415.30, 493.88];             // E (E4, G#4, B4)
    }
    if (track === 2) {
      // C, G, Am, F, C, G, F, G
      if (bar === 0 || bar === 4) return [523.25, 659.25, 783.99]; // C (C5, E5, G5)
      if (bar === 1 || bar === 5) return [392.00, 493.88, 587.33]; // G (G4, B4, D5)
      if (bar === 2) return [440.00, 523.25, 659.25];             // Am (A4, C5, E5)
      if (bar === 3 || bar === 6) return [349.23, 440.00, 523.25]; // F (F4, A4, C5)
      if (bar === 7) return [392.00, 493.88, 587.33];             // G (G4, B4, D5)
    }
    if (track === 3) {
      // Fm9, Abmaj7, Eb, Bb; extended voicings for smoother house stabs.
      if (bar === 0 || bar === 4) return [349.23, 415.30, 523.25, 622.25];
      if (bar === 1 || bar === 5) return [415.30, 523.25, 622.25, 783.99];
      if (bar === 2 || bar === 6) return [311.13, 392.00, 466.16, 622.25];
      if (bar === 3 || bar === 7) return [293.66, 349.23, 466.16, 587.33];
    }
    if (track === 4) {
      // Em7, Am9, Dm7, G7b9 - dark jazzy downtempo voicings
      if (bar === 0 || bar === 4) return [164.81, 196.00, 246.94, 293.66]; // Em7
      if (bar === 1 || bar === 5) return [220.00, 261.63, 329.63, 392.00]; // Am9
      if (bar === 2 || bar === 6) return [146.83, 174.61, 220.00, 261.63]; // Dm7
      if (bar === 3 || bar === 7) return [196.00, 246.94, 293.66, 369.99]; // G7
    }
    if (track === 5) {
      // F#m, Dmaj7, A, E — dark minimal voicings
      if (bar === 0 || bar === 4) return [184.99, 220.00, 277.18]; // F#m
      if (bar === 1 || bar === 5) return [146.83, 185.00, 220.00, 277.18]; // Dmaj7
      if (bar === 2 || bar === 6) return [220.00, 277.18, 329.63]; // A
      if (bar === 3 || bar === 7) return [164.81, 207.65, 246.94]; // E
    }
    return [523.25, 659.25, 783.99]; // Default C chord
  },

  playDowntempoPad(freqs, time, dur, energy = 0.75) {
    const dest = this._getMusicDest(true);
    if (!this.ctx || this.muted || !dest || !freqs?.length) return;
    const safeDur = Math.max(0.08, dur);
    const bright = 0.85 + energy * 0.35;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.setValueAtTime(1.1, time);
    filter.frequency.setValueAtTime(780 * bright, time);
    filter.frequency.linearRampToValueAtTime(1550 * bright, time + safeDur * 0.4);
    filter.frequency.exponentialRampToValueAtTime(360, time + safeDur);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.072, time + safeDur * 0.16);
    gain.gain.setValueAtTime(0.062, time + safeDur * 0.55);
    gain.gain.exponentialRampToValueAtTime(0.001, time + safeDur);

    let firstOsc = null;
    const extraGains = [];
    freqs.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      if (!firstOsc) firstOsc = osc;
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, time);
      osc.detune.setValueAtTime((idx - 1.5) * 11 + Math.sin(idx * 2.1) * 4, time);
      const osc2 = this.ctx.createOscillator();
      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(freq * 1.002, time);
      osc2.detune.setValueAtTime((idx - 1.5) * -8, time);
      const osc2Gain = this.ctx.createGain();
      osc2Gain.gain.value = 0.55;
      extraGains.push(osc2Gain);
      osc.connect(filter);
      osc2.connect(osc2Gain);
      osc2Gain.connect(filter);
      osc.start(time);
      osc.stop(time + safeDur + 0.05);
      osc2.start(time);
      osc2.stop(time + safeDur + 0.05);
    });
    filter.connect(gain);

    let panner = null;
    let lfo = null;
    let lfoGain = null;
    if (this.ctx.createStereoPanner) {
      panner = this.ctx.createStereoPanner();
      lfo = this.ctx.createOscillator();
      lfoGain = this.ctx.createGain();
      lfo.frequency.value = 0.18;
      lfoGain.gain.value = 0.38;
      lfo.connect(lfoGain);
      lfoGain.connect(panner.pan);
      lfo.start(time);
      lfo.stop(time + safeDur + 0.05);
      gain.connect(panner);
      panner.connect(dest);
    } else {
      gain.connect(dest);
    }

    const revSend = this._sendToMusicReverb(gain, 0.36, time);
    if (firstOsc) {
      firstOsc.onended = () => {
        try {
          extraGains.forEach(g => g.disconnect());
          filter.disconnect();
          gain.disconnect();
          panner?.disconnect();
          lfo?.disconnect();
          lfoGain?.disconnect();
          revSend?.disconnect();
        } catch (e) {}
      };
    }
  },

  playJunoPad(freqs, time, dur, energy = 0.75) {
    const dest = this._getMusicDest(true);
    if (!this.ctx || this.muted || !dest || !freqs?.length) return;
    const safeDur = Math.max(0.08, dur);
    const bright = 0.8 + energy * 0.42;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.setValueAtTime(1.3, time);
    filter.frequency.setValueAtTime(980 * bright, time);
    filter.frequency.linearRampToValueAtTime(2450 * bright, time + safeDur * 0.35);
    filter.frequency.exponentialRampToValueAtTime(520, time + safeDur);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.06, time + safeDur * 0.14);
    gain.gain.setValueAtTime(0.05, time + safeDur * 0.62);
    gain.gain.exponentialRampToValueAtTime(0.001, time + safeDur);

    let firstOsc = null;
    freqs.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      if (!firstOsc) firstOsc = osc;
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, time);
      osc.detune.setValueAtTime((idx - 1) * 7.5 + rand(-3, 3), time);
      const osc2 = this.ctx.createOscillator();
      osc2.type = "sawtooth";
      osc2.frequency.setValueAtTime(freq, time);
      osc2.detune.setValueAtTime((idx - 1) * -7.5 + rand(-3, 3), time);
      osc.connect(filter);
      osc2.connect(filter);
      osc.start(time);
      osc.stop(time + safeDur + 0.05);
      osc2.start(time);
      osc2.stop(time + safeDur + 0.05);
    });
    filter.connect(gain);

    // Subtle stereo chorus pan sway
    let panner = null;
    let lfo = null;
    let lfoGain = null;
    if (this.ctx.createStereoPanner) {
      panner = this.ctx.createStereoPanner();
      lfo = this.ctx.createOscillator();
      lfoGain = this.ctx.createGain();
      lfo.frequency.value = 0.28;
      lfoGain.gain.value = 0.34;
      lfo.connect(lfoGain);
      lfoGain.connect(panner.pan);
      lfo.start(time);
      lfo.stop(time + safeDur + 0.05);
      gain.connect(panner);
      panner.connect(dest);
    } else {
      gain.connect(dest);
    }

    const revSend = this._sendToMusicReverb(gain, 0.4, time);
    const delayBus = this.ensureDelayBus();
    let sendGain = null;
    if (delayBus) {
      sendGain = this.ctx.createGain();
      sendGain.gain.setValueAtTime(0.24, time);
      gain.connect(sendGain);
      sendGain.connect(delayBus.input);
    }
    if (firstOsc) {
      firstOsc.onended = () => {
        try {
          filter.disconnect();
          gain.disconnect();
          panner?.disconnect();
          lfo?.disconnect();
          lfoGain?.disconnect();
          sendGain?.disconnect();
          revSend?.disconnect();
        } catch (e) {}
      };
    }
  },

  playRhodesPad(freqs, time, dur, energy = 0.75) {
    const dest = this._getMusicDest(true);
    if (!this.ctx || this.muted || !dest || !freqs?.length) return;
    const safeDur = Math.max(0.08, dur);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.07 * (0.9 + energy * 0.2), time + 0.009);
    gain.gain.exponentialRampToValueAtTime(0.036, time + safeDur * 0.32);
    gain.gain.exponentialRampToValueAtTime(0.001, time + safeDur);

    let firstOsc = null;
    const extraGains = [];
    freqs.forEach((freq) => {
      const osc = this.ctx.createOscillator();
      if (!firstOsc) firstOsc = osc;
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, time);
      const osc2 = this.ctx.createOscillator();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(freq * 2, time);
      const osc2g = this.ctx.createGain();
      osc2g.gain.setValueAtTime(0.28, time);
      osc2g.gain.exponentialRampToValueAtTime(0.018, time + safeDur * 0.5);
      const osc3 = this.ctx.createOscillator();
      osc3.type = "sine";
      osc3.frequency.setValueAtTime(freq * 3.01, time);
      const osc3g = this.ctx.createGain();
      osc3g.gain.setValueAtTime(0.11, time);
      osc3g.gain.exponentialRampToValueAtTime(0.001, time + safeDur * 0.22);
      extraGains.push(osc2g, osc3g);
      osc.connect(gain);
      osc2.connect(osc2g);
      osc2g.connect(gain);
      osc3.connect(osc3g);
      osc3g.connect(gain);
      osc.start(time);
      osc.stop(time + safeDur + 0.04);
      osc2.start(time);
      osc2.stop(time + safeDur + 0.04);
      osc3.start(time);
      osc3.stop(time + safeDur + 0.04);
    });

    // Classic Rhodes stereo autopan
    let panner = null;
    let lfo = null;
    let lfoGain = null;
    if (this.ctx.createStereoPanner) {
      panner = this.ctx.createStereoPanner();
      lfo = this.ctx.createOscillator();
      lfoGain = this.ctx.createGain();
      lfo.frequency.value = 1.6;
      lfoGain.gain.value = 0.32;
      lfo.connect(lfoGain);
      lfoGain.connect(panner.pan);
      lfo.start(time);
      lfo.stop(time + safeDur + 0.04);
      gain.connect(panner);
      panner.connect(dest);
    } else {
      gain.connect(dest);
    }

    const revSend = this._sendToMusicReverb(gain, 0.34, time);
    if (firstOsc) {
      firstOsc.onended = () => {
        try {
          extraGains.forEach(g => g.disconnect());
          gain.disconnect();
          panner?.disconnect();
          lfo?.disconnect();
          lfoGain?.disconnect();
          revSend?.disconnect();
        } catch (e) {}
      };
    }
  },

  playChiptuneArp(freqs, time, dur, pan = 0) {
    const dest = this._getMusicDest(true);
    if (!this.ctx || this.muted || !dest || !freqs?.length) return;
    const safeDur = Math.max(0.04, dur);
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = "square";
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(3400, time);
    filter.frequency.exponentialRampToValueAtTime(1400, time + safeDur);
    filter.Q.setValueAtTime(1.2, time);

    const pwmLfo = this.ctx.createOscillator();
    const pwmGain = this.ctx.createGain();
    pwmLfo.frequency.value = 3.4;
    pwmGain.gain.value = 16;
    pwmLfo.connect(pwmGain);
    pwmGain.connect(osc.detune);
    pwmLfo.start(time);
    pwmLfo.stop(time + safeDur + 0.02);

    const arpSpeed = 0.04;
    let t = time;
    let idx = 0;
    while (t < time + safeDur) {
      const freq = freqs[idx % freqs.length];
      const prevFreq = idx > 0 ? freqs[(idx - 1) % freqs.length] : freq;
      if (idx > 0 && Math.abs(freq - prevFreq) > 20) {
        osc.frequency.setValueAtTime(prevFreq, t);
        osc.frequency.exponentialRampToValueAtTime(freq, t + arpSpeed * 0.28);
      } else {
        osc.frequency.setValueAtTime(freq, t);
      }
      idx++;
      t += arpSpeed;
    }

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.064, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, time + safeDur);

    osc.connect(filter);
    filter.connect(gain);
    const panner = this._connectPanTo(gain, dest, pan);

    const delayBus = this.ensureDelayBus();
    let sendGain = null;
    if (delayBus) {
      sendGain = this.ctx.createGain();
      sendGain.gain.setValueAtTime(0.2, time);
      gain.connect(sendGain);
      sendGain.connect(delayBus.input);
    }

    osc.onended = () => {
      try {
        filter.disconnect();
        gain.disconnect();
        panner?.disconnect();
        sendGain?.disconnect();
        pwmLfo.disconnect();
        pwmGain.disconnect();
      } catch (e) {}
    };

    osc.start(time);
    osc.stop(time + safeDur + 0.02);
  },

  playPluckCounter(freq, time, dur, opts = {}) {
    const dest = this._getMusicDest(true);
    if (!this.ctx || this.muted || !dest || !freq) return;
    const safeDur = Math.max(0.035, dur);
    const track = opts.track ?? (this.trackIdx || 0);
    const energy = opts.energy ?? 0.75;
    const pan = opts.pan ?? 0;
    const vol = (opts.vol ?? 0.042) * 1.3;

    const osc = this.ctx.createOscillator();
    osc.type = track === 2 ? "square" : track === 4 ? "triangle" : "sawtooth";
    osc.frequency.setValueAtTime(freq, time);

    const osc2 = this.ctx.createOscillator();
    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(freq, time);
    osc2.detune.setValueAtTime(track === 2 ? 4 : 8, time);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.setValueAtTime(track === 1 ? 4.2 : 2.0, time);
    filter.frequency.setValueAtTime((track === 4 ? 1900 : 3200) * (0.8 + energy * 0.35), time);
    filter.frequency.exponentialRampToValueAtTime(track === 4 ? 420 : 620, time + safeDur * 0.9);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(vol, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, time + safeDur);

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    const panner = this._connectPanTo(gain, dest, pan);

    const delayBus = this.ensureDelayBus();
    let sendGain = null;
    if (delayBus) {
      sendGain = this.ctx.createGain();
      sendGain.gain.setValueAtTime(track === 5 ? 0.42 : 0.28, time);
      gain.connect(sendGain);
      sendGain.connect(delayBus.input);
    }
    const revSend = this._sendToMusicReverb(gain, 0.22, time);

    osc.onended = () => {
      try {
        filter.disconnect();
        gain.disconnect();
        panner?.disconnect();
        sendGain?.disconnect();
        revSend?.disconnect();
      } catch (e) {}
    };

    const stopAt = time + safeDur + 0.02;
    osc.start(time);
    osc.stop(stopAt);
    osc2.start(time);
    osc2.stop(stopAt);
  },

  playHouseChord(freqs, time, dur, energy = 0.8) {
    const dest = this._getMusicDest(true);
    if (!this.ctx || this.muted || !dest || !freqs?.length) return;
    const safeDur = Math.max(0.06, dur);
    const bright = 0.82 + energy * 0.38;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.setValueAtTime(2.8, time);
    filter.frequency.setValueAtTime(2900 * bright, time);
    filter.frequency.exponentialRampToValueAtTime(420, time + safeDur * 0.88);

    const dist = this.ctx.createWaveShaper();
    dist.curve = this._getDistCurve("soft");
    dist.oversample = "none";

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.15, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.04, time + safeDur * 0.45);
    gain.gain.linearRampToValueAtTime(0.088, time + safeDur * 0.72);
    gain.gain.exponentialRampToValueAtTime(0.001, time + safeDur);

    const extraGains = [];
    const oscillators = freqs.map((freq, idx) => {
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, time);
      osc.detune.setValueAtTime((idx - 1.5) * 8 + (Math.random() * 4 - 2), time);
      osc.connect(dist);
      osc.start(time);
      osc.stop(time + safeDur + 0.03);

      const osc2 = this.ctx.createOscillator();
      osc2.type = "square";
      osc2.frequency.setValueAtTime(freq, time);
      osc2.detune.setValueAtTime((idx - 1.5) * -6, time);
      const osc2Gain = this.ctx.createGain();
      osc2Gain.gain.value = 0.28;
      extraGains.push(osc2Gain);
      osc2.connect(osc2Gain);
      osc2Gain.connect(dist);
      osc2.start(time);
      osc2.stop(time + safeDur + 0.03);

      return osc;
    });

    dist.connect(filter);
    filter.connect(gain);

    const pan = (Math.floor(time * 4) % 2 === 0) ? 0.24 : -0.24;
    const panner = this._connectPanTo(gain, dest, pan);
    const revSend = this._sendToMusicReverb(gain, 0.26, time);
    const delayBus = this.ensureDelayBus();
    let sendGain = null;
    if (delayBus) {
      sendGain = this.ctx.createGain();
      sendGain.gain.setValueAtTime(0.22, time);
      gain.connect(sendGain);
      sendGain.connect(delayBus.input);
    }

    if (oscillators[0]) {
      oscillators[0].onended = () => {
        try {
          extraGains.forEach(g => g.disconnect());
          dist.disconnect();
          filter.disconnect();
          gain.disconnect();
          panner?.disconnect();
          sendGain?.disconnect();
          revSend?.disconnect();
        } catch (e) {}
      };
    }
    return oscillators;
  },

  playMelodyNote(freq, time, dur, opts = {}) {
    const dest = this._getMusicDest(false);
    if (!this.ctx || this.muted || !dest || !freq) return;
    const safeDur = Math.max(0.05, dur);
    const track = this.trackIdx || 0;
    const isModern = track === 3;
    const isDowntempo = track === 4;
    const isMinimal = track === 5;
    const isAcid = track === 1;
    const isChip = track === 2;
    const energy = opts.energy ?? 0.78;
    const octaveShimmer = !!opts.octaveShimmer;
    const pan = opts.pan ?? 0;

    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const osc2Gain = this.ctx.createGain();
    const gain = this.ctx.createGain();

    // Rich dual-oscillator lead voicing tailored per genre
    if (isMinimal) {
      osc.type = "sine";
      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(freq * 2.0, time);
      osc2Gain.gain.setValueAtTime(0.18, time);
      osc2Gain.gain.exponentialRampToValueAtTime(0.02, time + safeDur * 0.65);
    } else if (isDowntempo) {
      osc.type = "sawtooth";
      const drift = rand(-7, 7);
      osc.detune.setValueAtTime(drift, time);
      osc.detune.linearRampToValueAtTime(drift + rand(-5, 5), time + safeDur);
      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(freq * 2.003, time);
      osc2.detune.setValueAtTime(rand(-10, 10), time);
      osc2.detune.linearRampToValueAtTime(rand(-8, 8), time + safeDur);
      osc2Gain.gain.value = 0.16;
    } else if (isModern) {
      osc.type = "sawtooth";
      osc.detune.setValueAtTime(7, time);
      osc2.type = "square";
      osc2.frequency.setValueAtTime(freq, time);
      osc2.detune.setValueAtTime(-8, time);
      osc2Gain.gain.value = 0.3;
    } else if (isAcid) {
      osc.type = "sawtooth";
      osc.detune.setValueAtTime(5, time);
      osc2.type = "sawtooth";
      osc2.frequency.setValueAtTime(freq, time);
      osc2.detune.setValueAtTime(-6, time);
      osc2Gain.gain.value = 0.45;
    } else if (isChip) {
      osc.type = "square";
      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(freq * 0.5, time);
      osc2Gain.gain.value = 0.32;
    } else {
      // Track 0: lush dual-detuned Synthwave analog lead
      osc.type = "sawtooth";
      osc.detune.setValueAtTime(6, time);
      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(freq, time);
      osc2.detune.setValueAtTime(-6, time);
      osc2Gain.gain.value = 0.65;
    }
    osc.frequency.setValueAtTime(freq, time);

    // Delayed musical vibrato (ramps in after note attack so pitch starts pure)
    const vibrato = this.ctx.createOscillator();
    const vibratoGain = this.ctx.createGain();
    vibrato.frequency.value = isMinimal ? 2.4 : isDowntempo ? 3.2 : isModern ? 4.2 : 5.4;
    const maxVib = isMinimal ? 2.0 : isDowntempo ? 5.5 : isModern ? 3.6 : isAcid ? 3.0 : 2.8;
    vibratoGain.gain.setValueAtTime(0.01, time);
    vibratoGain.gain.linearRampToValueAtTime(maxVib, time + Math.min(0.16, safeDur * 0.45));
    vibrato.connect(vibratoGain);
    vibratoGain.connect(osc.frequency);
    if (!isMinimal && !isChip && !isDowntempo) {
      vibratoGain.connect(osc2.frequency);
    }

    const bright = 0.85 + energy * 0.35;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    if (isDowntempo) {
      filter.frequency.setValueAtTime(1150 * bright, time);
      filter.frequency.linearRampToValueAtTime(1950 * bright, time + safeDur * 0.3);
      filter.frequency.exponentialRampToValueAtTime(420, time + safeDur);
      filter.Q.setValueAtTime(3.6, time);
    } else if (isAcid) {
      filter.frequency.setValueAtTime(2900 * bright, time);
      filter.frequency.exponentialRampToValueAtTime(620, time + safeDur);
      filter.Q.setValueAtTime(4.2, time);
    } else if (isChip) {
      filter.frequency.setValueAtTime(3600, time);
      filter.frequency.exponentialRampToValueAtTime(1600, time + safeDur);
      filter.Q.setValueAtTime(1.0, time);
    } else {
      filter.frequency.setValueAtTime((isModern ? 3200 : 2500) * bright, time);
      filter.frequency.exponentialRampToValueAtTime(isModern ? 650 : 880, time + safeDur);
      filter.Q.setValueAtTime(isModern ? 2.6 : 1.6, time);
    }

    const peakVol = isMinimal ? 0.13 : isDowntempo ? 0.125 : isChip ? 0.118 : isModern ? 0.135 : 0.128;
    gain.gain.setValueAtTime(0.001, time);
    if (isModern) {
      gain.gain.linearRampToValueAtTime(peakVol, time + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.038, time + safeDur * 0.35);
      gain.gain.linearRampToValueAtTime(peakVol * 0.72, time + safeDur * 0.65);
      gain.gain.exponentialRampToValueAtTime(0.001, time + safeDur);
    } else {
      gain.gain.linearRampToValueAtTime(peakVol, time + (isDowntempo ? 0.055 : 0.016));
      gain.gain.exponentialRampToValueAtTime(0.001, time + safeDur);
    }

    osc.connect(filter);
    osc2.connect(osc2Gain);
    osc2Gain.connect(filter);

    // Optional climax / final-lap octave shimmer layer
    let shimOsc = null;
    let shimGain = null;
    if (octaveShimmer) {
      shimOsc = this.ctx.createOscillator();
      shimOsc.type = "triangle";
      shimOsc.frequency.setValueAtTime(freq * 2, time);
      shimGain = this.ctx.createGain();
      shimGain.gain.setValueAtTime(0.22, time);
      shimGain.gain.exponentialRampToValueAtTime(0.01, time + safeDur * 0.75);
      shimOsc.connect(shimGain);
      shimGain.connect(filter);
    }

    filter.connect(gain);
    const panner = this._connectPanTo(gain, dest, pan);

    const stepDur = 60.0 / this.tempo / 4.0;
    const delayBus = this.ensureDelayBus();
    let sendGain = null;
    if (delayBus) {
      const targetDt = isDowntempo ? stepDur * 6 : stepDur * 3;
      if (delayBus.setDelayTime) delayBus.setDelayTime(targetDt, time);
      else delayBus.delay.delayTime.setTargetAtTime(clamp(targetDt, 0.05, 1.5), time, 0.04);
      delayBus.feedback.gain.setTargetAtTime(isDowntempo ? 0.42 : isMinimal ? 0.44 : isModern ? 0.32 : 0.26, time, 0.04);
      sendGain = this.ctx.createGain();
      sendGain.gain.setValueAtTime(isDowntempo ? 0.46 : isMinimal ? 0.48 : isModern ? 0.35 : 0.28, time);
      gain.connect(sendGain);
      sendGain.connect(delayBus.input);
    }
    const revSend = this._sendToMusicReverb(gain, isMinimal ? 0.38 : isDowntempo ? 0.35 : 0.24, time);

    const stopTime = time + safeDur + 0.025;
    osc.onended = () => {
      try {
        vibrato.disconnect();
        vibratoGain.disconnect();
        osc2Gain.disconnect();
        shimGain?.disconnect();
        filter.disconnect();
        gain.disconnect();
        panner?.disconnect();
        sendGain?.disconnect();
        revSend?.disconnect();
      } catch (e) {}
    };
    vibrato.start(time);
    osc.start(time);
    osc2.start(time);
    shimOsc?.start(time);
    osc.stop(stopTime);
    osc2.stop(stopTime);
    shimOsc?.stop(stopTime);
    vibrato.stop(stopTime);
  },

  playRetroKick(time, heavy = false, sidechainDepth = 0.65, sidechainRelease = 0.22) {
    const dest = this._getMusicDest(false);
    if (!this.ctx || this.muted || !dest) return;
    const track = this.trackIdx || 0;
    const isModern = track === 3 || track === 5 || heavy;

    // Pump the bass & pads cleanly out of the way of the kick transient
    this.triggerMusicSidechain(time, sidechainDepth, sidechainRelease);

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";

    if (isModern) {
      osc.frequency.setValueAtTime(175, time);
      osc.frequency.exponentialRampToValueAtTime(42, time + 0.09);
      osc.frequency.exponentialRampToValueAtTime(34, time + 0.19);
    } else {
      osc.frequency.setValueAtTime(155, time);
      osc.frequency.exponentialRampToValueAtTime(48, time + 0.085);
    }

    const peakVol = isModern ? 0.54 : 0.4;
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(peakVol, time + 0.0025);
    gain.gain.exponentialRampToValueAtTime(0.001, time + (isModern ? 0.2 : 0.115));

    osc.connect(gain);

    // Subtle transient beater click so every kick reads clearly on laptop speakers
    const clickOsc = this.ctx.createOscillator();
    const clickGain = this.ctx.createGain();
    clickOsc.type = "triangle";
    clickOsc.frequency.setValueAtTime(isModern ? 3800 : 2600, time);
    clickOsc.frequency.exponentialRampToValueAtTime(180, time + 0.014);
    clickGain.gain.setValueAtTime(0.001, time);
    clickGain.gain.linearRampToValueAtTime(isModern ? 0.16 : 0.09, time + 0.001);
    clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.022);
    clickOsc.connect(clickGain);
    clickGain.connect(dest);
    clickOsc.onended = () => { try { clickGain.disconnect(); } catch (e) {} };
    clickOsc.start(time);
    clickOsc.stop(time + 0.026);

    let dist = null;
    if (isModern) {
      dist = this.ctx.createWaveShaper();
      dist.curve = this._getDistCurve("kick");
      dist.oversample = "none";
      gain.connect(dist);
      dist.connect(dest);
    } else {
      gain.connect(dest);
    }

    osc.onended = () => {
      try { gain.disconnect(); dist?.disconnect(); } catch (e) {}
    };
    osc.start(time);
    osc.stop(time + (isModern ? 0.22 : 0.13));
  },

  playRetroHiHat(time, open = false, vel = 1.0, pan = 0) {
    const dest = this._getMusicDest(false);
    if (!this.ctx || this.muted || !dest) return;
    const buffer = this._getNoiseBuffer();
    if (!buffer) return;
    const track = this.trackIdx || 0;
    const dur = open ? 0.115 : (track === 3 || track === 5 ? 0.042 : 0.032);
    const offset = Math.random() * Math.max(0, 1.5 - dur - 0.02);

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    const baseCut = track === 3 || track === 5 ? 8400 : track === 4 ? 6200 : 7600;
    filter.frequency.setValueAtTime(baseCut + (open ? -900 : vel * 650), time);
    filter.Q.setValueAtTime(track === 3 ? 1.3 : 0.85, time);

    const gain = this.ctx.createGain();
    const vol = (track === 3 ? 0.076 : track === 5 ? 0.068 : 0.058) * clamp(vel, 0.2, 1.25);
    gain.gain.setValueAtTime(Math.max(0.001, vol), time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    src.connect(filter);
    filter.connect(gain);
    const panner = this._connectPanTo(gain, dest, pan);
    src.onended = () => {
      try { filter.disconnect(); gain.disconnect(); panner?.disconnect(); } catch (e) {}
    };

    src.start(time, offset, dur);
  },

  playRetroSnare(time, volScale = 1.0) {
    const dest = this._getMusicDest(false);
    if (!this.ctx || this.muted || !dest) return;
    const buffer = this._getNoiseBuffer();
    if (!buffer) return;
    const track = this.trackIdx || 0;
    const isModern = track === 3;
    const isSynthwave = track === 0;
    const dur = isModern ? 0.15 : isSynthwave ? 0.14 : 0.095;
    const offset = Math.random() * Math.max(0, 1.5 - dur - 0.02);

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = isModern ? "peaking" : "bandpass";
    filter.frequency.setValueAtTime(isModern ? 1900 : isSynthwave ? 1450 : 1200, time);
    if (isModern) filter.gain.setValueAtTime(6, time);
    else filter.Q.setValueAtTime(0.9, time);

    const gain = this.ctx.createGain();
    const baseVol = isModern ? 0.118 : isSynthwave ? 0.098 : 0.082;
    gain.gain.setValueAtTime(Math.max(0.001, baseVol * volScale), time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);

    // Tuned snare shell body across all tracks for punch and tone
    const bodyOsc = this.ctx.createOscillator();
    const bodyGain = this.ctx.createGain();
    bodyOsc.type = "triangle";
    bodyOsc.frequency.setValueAtTime(isModern ? 225 : 205, time);
    bodyOsc.frequency.exponentialRampToValueAtTime(118, time + 0.045);
    bodyGain.gain.setValueAtTime(0.001, time);
    bodyGain.gain.linearRampToValueAtTime((isModern ? 0.15 : 0.11) * volScale, time + 0.002);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, time + 0.068);
    bodyOsc.connect(bodyGain);
    bodyGain.connect(dest);
    bodyOsc.onended = () => { try { bodyGain.disconnect(); } catch (e) {} };
    bodyOsc.start(time);
    bodyOsc.stop(time + 0.075);

    // Hall / gated snare reverb sheen
    const revSend = volScale > 0.4 ? this._sendToMusicReverb(gain, isSynthwave ? 0.36 : 0.22, time) : null;
    src.onended = () => {
      try { filter.disconnect(); gain.disconnect(); revSend?.disconnect(); } catch (e) {}
    };
    src.start(time, offset, dur);
  },

  playRetroTom(freq, time, pan = 0) {
    const dest = this._getMusicDest(false);
    if (!this.ctx || this.muted || !dest || !freq) return;
    const dur = 0.22;
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq * 1.45, time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(45, freq * 0.72), time + dur * 0.78);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1400, time);
    filter.frequency.exponentialRampToValueAtTime(320, time + dur);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.22, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    osc.connect(filter);
    filter.connect(gain);
    const panner = this._connectPanTo(gain, dest, pan);
    const revSend = this._sendToMusicReverb(gain, 0.28, time);
    osc.onended = () => {
      try { filter.disconnect(); gain.disconnect(); panner?.disconnect(); revSend?.disconnect(); } catch (e) {}
    };
    osc.start(time);
    osc.stop(time + dur + 0.02);
  },

  playClap(time, volScale = 1.0) {
    const dest = this._getMusicDest(false);
    if (!this.ctx || this.muted || !dest) return;
    const buffer = this._getNoiseBuffer();
    if (!buffer) return;
    const pans = [-0.18, 0.0, 0.18];
    for (let l = 0; l < 3; l++) {
      const timeOffset = l * 0.011;
      const dur = l === 2 ? 0.095 : 0.055;
      const bufOffset = Math.random() * Math.max(0, 1.5 - dur - 0.02);
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(1350 + l * 380, time + timeOffset);
      filter.Q.setValueAtTime(1.9, time + timeOffset);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(Math.max(0.001, 0.078 * volScale), time + timeOffset);
      gain.gain.exponentialRampToValueAtTime(0.001, time + timeOffset + dur);
      src.connect(filter);
      filter.connect(gain);
      const panner = this._connectPanTo(gain, dest, pans[l]);
      const revSend = l === 2 ? this._sendToMusicReverb(gain, 0.28, time + timeOffset) : null;
      src.onended = () => {
        try { filter.disconnect(); gain.disconnect(); panner?.disconnect(); revSend?.disconnect(); } catch (e) {}
      };
      src.start(time + timeOffset, bufOffset, dur);
    }
  },

  playCrashCymbal(time, vol = 0.068) {
    const dest = this._getMusicDest(false);
    if (!this.ctx || this.muted || !dest) return;
    const buffer = this._getNoiseBuffer();
    if (!buffer) return;
    const dur = 0.65;
    const offset = Math.random() * Math.max(0, 1.5 - dur - 0.02);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(5400, time);
    hp.frequency.exponentialRampToValueAtTime(2600, time + dur);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.001, vol), time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    src.connect(hp);
    hp.connect(gain);
    const panner = this._connectPanTo(gain, dest, 0.14);
    const revSend = this._sendToMusicReverb(gain, 0.36, time);
    src.onended = () => {
      try { hp.disconnect(); gain.disconnect(); panner?.disconnect(); revSend?.disconnect(); } catch (e) {}
    };
    src.start(time, offset, dur);
  },

  // Dragon fire breath sound
  dragonBreath() {
    if (!this.ctx || this.muted) return;
    const buffer = this._getNoiseBuffer();
    if (!buffer) return;
    const t = this.ctx.currentTime;
    const dur = 0.5;
    const offset = Math.random() * Math.max(0, 1.5 - dur - 0.02);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(800, t);
    filter.frequency.exponentialRampToValueAtTime(120, t + dur);
    filter.Q.value = 2;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    src.onended = () => { try { filter.disconnect(); gain.disconnect(); } catch (e) {} };
    src.start(t, offset, dur);
  },

  // Japanese Taiko drum
  playTaiko(time, intensity = 0) {
    const dest = this._getMusicDest(false);
    if (!this.ctx || this.muted || !dest) return;
    if (intensity >= 0.45) {
      this.triggerMusicSidechain(time, 0.78, 0.24);
    }
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(118 - intensity * 26, time);
    osc.frequency.exponentialRampToValueAtTime(44, time + 0.14);
    g.gain.setValueAtTime(0.001, time);
    g.gain.linearRampToValueAtTime(0.36 + intensity * 0.14, time + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.36 + intensity * 0.12);
    osc.connect(g);
    g.connect(dest);
    const bodyRev = this._sendToMusicReverb(g, 0.3, time);
    osc.onended = () => {
      try { g.disconnect(); bodyRev?.disconnect(); } catch (e) {}
    };
    osc.start(time);
    osc.stop(time + 0.48);

    // Bachi stick-on-skin crack
    const buffer = this._getNoiseBuffer();
    if (!buffer) return;
    const ndur = 0.085;
    const nsrc = this.ctx.createBufferSource();
    nsrc.buffer = buffer;
    const nfilter = this.ctx.createBiquadFilter();
    nfilter.type = "bandpass";
    nfilter.frequency.value = 520 + intensity * 280;
    nfilter.Q.value = 1.1;
    const ngain = this.ctx.createGain();
    ngain.gain.setValueAtTime(0.095 + intensity * 0.045, time);
    ngain.gain.exponentialRampToValueAtTime(0.001, time + ndur);
    nsrc.connect(nfilter);
    nfilter.connect(ngain);
    ngain.connect(dest);
    const crackRev = this._sendToMusicReverb(ngain, 0.34, time);
    nsrc.onended = () => {
      try { nfilter.disconnect(); ngain.disconnect(); crackRev?.disconnect(); } catch (e) {}
    };
    nsrc.start(time, Math.random() * 0.5, ndur);
  },

  // Japanese Koto / Shamisen pluck
  playKotoPluck(freq, time, dur = 0.35, vol = 0.14, pan = 0) {
    const dest = this._getMusicDest(true);
    if (!this.ctx || this.muted || !dest || !freq) return;
    const safeDur = Math.max(0.06, dur);
    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const osc2g = this.ctx.createGain();
    const g = this.ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.018, time + 0.018);
    osc.frequency.exponentialRampToValueAtTime(freq, time + 0.055);

    // Plucked string harmonic shimmer
    osc2.type = "sawtooth";
    osc2.frequency.setValueAtTime(freq * 2, time);
    osc2g.gain.setValueAtTime(0.24, time);
    osc2g.gain.exponentialRampToValueAtTime(0.01, time + safeDur * 0.35);

    g.gain.setValueAtTime(0.001, time);
    g.gain.linearRampToValueAtTime(vol * 1.3, time + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, time + safeDur);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(3400, time);
    filter.frequency.exponentialRampToValueAtTime(850, time + safeDur * 0.65);

    osc.connect(filter);
    osc2.connect(osc2g);
    osc2g.connect(filter);
    filter.connect(g);
    const panner = this._connectPanTo(g, dest, pan);
    const revSend = this._sendToMusicReverb(g, 0.32, time);
    const delayBus = this.ensureDelayBus();
    let sendGain = null;
    if (delayBus) {
      sendGain = this.ctx.createGain();
      sendGain.gain.setValueAtTime(0.22, time);
      g.connect(sendGain);
      sendGain.connect(delayBus.input);
    }

    osc.onended = () => {
      try {
        osc2g.disconnect();
        filter.disconnect();
        g.disconnect();
        panner?.disconnect();
        revSend?.disconnect();
        sendGain?.disconnect();
      } catch (e) {}
    };
    const stopAt = time + safeDur + 0.02;
    osc.start(time);
    osc2.start(time);
    osc.stop(stopAt);
    osc2.stop(stopAt);
  },

  // Traditional Japanese flute (Shakuhachi with breathy air layer)
  playShakuhachi(freq, time, dur = 0.5, vol = 0.13, pan = 0) {
    const dest = this._getMusicDest(true);
    if (!this.ctx || this.muted || !dest || !freq) return;
    const safeDur = Math.max(0.08, dur);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * 0.985, time);
    osc.frequency.exponentialRampToValueAtTime(freq, time + Math.min(0.09, safeDur * 0.25));

    // Delayed shakuhachi breath vibrato
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 5.2;
    lfoGain.gain.setValueAtTime(0.01, time);
    lfoGain.gain.linearRampToValueAtTime(freq * 0.014, time + Math.min(0.18, safeDur * 0.45));
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1950, time);
    filter.frequency.exponentialRampToValueAtTime(680, time + safeDur);
    filter.Q.value = 1.4;

    g.gain.setValueAtTime(0.001, time);
    g.gain.linearRampToValueAtTime(vol * 1.35, time + Math.min(0.11, safeDur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.001, time + safeDur);

    osc.connect(filter);
    filter.connect(g);

    // Subtle bamboo air breath noise
    const noiseBuf = this._getNoiseBuffer();
    let breathSrc = null;
    let breathBp = null;
    let breathGain = null;
    if (noiseBuf) {
      breathSrc = this.ctx.createBufferSource();
      breathSrc.buffer = noiseBuf;
      breathBp = this.ctx.createBiquadFilter();
      breathBp.type = "bandpass";
      breathBp.frequency.value = clamp(freq * 2.2, 700, 3200);
      breathBp.Q.value = 3.2;
      breathGain = this.ctx.createGain();
      breathGain.gain.setValueAtTime(0.001, time);
      breathGain.gain.linearRampToValueAtTime(vol * 0.16, time + Math.min(0.08, safeDur * 0.25));
      breathGain.gain.exponentialRampToValueAtTime(0.001, time + safeDur * 0.85);
      breathSrc.connect(breathBp);
      breathBp.connect(breathGain);
      breathGain.connect(g);
      breathSrc.start(time, Math.random() * 0.4, safeDur);
    }

    const panner = this._connectPanTo(g, dest, pan);
    const revSend = this._sendToMusicReverb(g, 0.42, time);
    osc.onended = () => {
      try {
        lfo.disconnect();
        lfoGain.disconnect();
        filter.disconnect();
        breathBp?.disconnect();
        breathGain?.disconnect();
        g.disconnect();
        panner?.disconnect();
        revSend?.disconnect();
      } catch (e) {}
    };
    osc.start(time);
    lfo.start(time);
    osc.stop(time + safeDur + 0.02);
    lfo.stop(time + safeDur + 0.02);
  },

  // Bass drone (clean sub + warm sawtooth)
  playBassDrone(freq, time, dur = 0.6, vol = 0.08) {
    const dest = this._getMusicDest(true);
    if (!this.ctx || this.muted || !dest || !freq) return;
    const safeDur = Math.max(0.08, dur);
    const osc = this.ctx.createOscillator();
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    const g = this.ctx.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, time);
    sub.type = "sine";
    sub.frequency.setValueAtTime(freq * 0.5, time);
    subGain.gain.value = 0.65;

    g.gain.setValueAtTime(0.001, time);
    g.gain.linearRampToValueAtTime(vol * 1.3, time + 0.045);
    g.gain.exponentialRampToValueAtTime(0.001, time + safeDur);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(440, time);
    filter.frequency.exponentialRampToValueAtTime(125, time + safeDur);

    osc.connect(filter);
    filter.connect(g);
    sub.connect(subGain);
    subGain.connect(g);
    g.connect(dest);
    osc.onended = () => {
      try { filter.disconnect(); subGain.disconnect(); g.disconnect(); } catch (e) {}
    };
    const stopAt = time + safeDur + 0.02;
    osc.start(time);
    sub.start(time);
    osc.stop(stopAt);
    sub.stop(stopAt);
  },

  // Japanese pentatonic Hirajoshi (A-based): A(440), B(495), C(528), E(660), F(704)
  // Extended full 2-octave range for more melodic variety
  _jpNotes: [220.00, 247.50, 264.00, 330.00, 352.00, 440.00, 495.00, 528.00, 660.00, 704.00, 880.00, 990.00, 1056.00, 1320.00, 1408.00],
  _jpMelodyPattern: [
    // Phase 0: calm — sparse, contemplative
    [5, null, null, 7, 5, null, null, null, 7, null, 5, null, 8, null, 7, null],
    // Phase 1: building — more movement
    [5, null, 7, 8, 5, null, 7, null, 8, null, 10, null, 9, null, 7, null],
    // Phase 2: active — denser melodic line
    [5, 7, 8, 10, 8, 7, 5, null, 7, 8, 10, 9, 7, 5, 7, null],
    // Phase 3: intense — rapid arpeggios and flourishes
    [5, 7, 8, 10, 7, 5, 7, 8, 10, 9, 8, 7, 5, 7, 8, 10],
    // Phase 4: climax — octave-leaping, maximum energy
    [12, null, 10, 12, 9, 10, 8, null, 7, 8, 10, 12, 10, 9, 7, 5],
  ],
  _jpBassPattern: [
    // Phase 0: slow bass, one note per bar
    [5, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    // Phase 1: two notes per bar (quarter-note feel)
    [5, null, null, null, null, null, null, null, 3, null, null, null, null, null, null, null],
    // Phase 2: walking-ish bass
    [5, null, null, null, 3, null, null, null, 5, null, null, null, 0, null, null, null],
    // Phase 3: quarter-note pulse
    [5, null, 5, null, 3, null, 3, null, 5, null, 5, null, 0, null, 0, null],
    // Phase 4: galloping eighth-note bass (intense!)
    [5, 0, 5, 0, 3, 0, 3, 0, 5, 0, 5, 0, 0, 5, 0, 5],
  ],

  scheduleJapaneseStep(step, time) {
    const stepDur = 60.0 / this.tempo / 4.0;
    const intensity = clamp((this.tempo - 90) / 70, 0, 1);
    const bar = Math.floor(step / 16);
    const stepInBar = step % 16;

    // Much longer looping: 64 bars instead of fixed small pattern (64*16=1024 steps)
    const barInLoop = bar % 64;
    // Use bar position in the long loop to evolve the pattern further
    const loopProgress = barInLoop / 64; // 0..1 across the mega-loop

    // Taiko drum pattern — sparse at first, overwhelming at climax
    let taikoInterval = intensity < 0.2 ? 8 : (intensity < 0.4 ? 4 : (intensity < 0.7 ? 2 : 1));
    // At very high intensity, add stepping! (0.5 offset every other bar for polyrhythm)
    if (intensity > 0.85 && (bar % 2 === 1) && (stepInBar === 1 || stepInBar === 9)) {
      this.playTaiko(time, 0.9);
    }
    if ((step % taikoInterval) === 0) {
      const isAccent = (stepInBar === 0);
      this.playTaiko(time, isAccent ? Math.min(intensity * 0.7, 1.0) : intensity * 0.4);
    }

    // ---- MELODY ----
    const patIdx = Math.min(Math.floor(intensity * this._jpMelodyPattern.length), this._jpMelodyPattern.length - 1);
    const pat = this._jpMelodyPattern[patIdx];
    const noteIdx = pat[stepInBar];
    if (noteIdx !== null && noteIdx !== undefined) {
      const freq = this._jpNotes[noteIdx];
      const kotoPan = (stepInBar % 4 < 2) ? -0.26 : 0.26;
      // At low intensity, mix in shakuhachi for atmosphere (especially at bar boundaries)
      if (intensity < 0.3 && stepInBar === 0 && bar % 4 === 0) {
        this.playShakuhachi(freq * 0.5, time, 0.8, 0.10, -0.18);
      } else if (intensity > 0.7 && bar % 2 === 0 && stepInBar % 2 === 0) {
        // At high intensity, double up with a second koto an octave higher for stereo shimmer
        this.playKotoPluck(freq, time, 0.25, 0.10 + intensity * 0.04, -0.28);
        if (Math.random() > 0.35) {
          this.playKotoPluck(freq * 2, time + stepDur * 0.5, 0.2, 0.06, 0.32);
        }
      } else {
        this.playKotoPluck(freq, time, 0.35 + intensity * 0.3, 0.10 + intensity * 0.04, kotoPan);
      }
    }

    // ---- BASS ---- (evolving bassline!)
    const bassPatIdx = Math.min(Math.floor(intensity * this._jpBassPattern.length), this._jpBassPattern.length - 1);
    const bassPat = this._jpBassPattern[bassPatIdx];
    const bassNoteIdx = bassPat[stepInBar];
    if (bassNoteIdx !== null && bassNoteIdx !== undefined) {
      const bassFreq = this._jpNotes[bassNoteIdx];
      // Richer bass: sub-oscillator + drone
      this.playBassDrone(bassFreq, time, stepDur * 1.5 + intensity, 0.06 + intensity * 0.1);
    }

    // ---- SHAKUHACHI FLUTTER ---- ( atmospheric fills at transition points )
    if ((barInLoop === 15 || barInLoop === 31 || barInLoop === 47) && stepInBar === 14) {
      const fillNote = this._jpNotes[5 + Math.floor(Math.random() * 4)];
      this.playShakuhachi(fillNote, time, 0.45, 0.085, 0.22);
    }
    // Climax trills
    if (intensity > 0.82 && (stepInBar % 2 === 0)) {
      const trillNote = this._jpNotes[5 + (step % 5)];
      this.playShakuhachi(trillNote, time, 0.18, 0.065, stepInBar % 4 === 0 ? -0.25 : 0.25);
    }
  },

  // Switch between music styles
  mapStyle: "retro",

  // ---- Vocoder Title Theme: looping menu intro with a sung "Rrrrreeegulaido!" hook ----
  titleThemeActive: false,
  titleThemeTimeout: null,
  titleThemeNodes: [],
  _vocoderPlayed: false,
  playVocoderTitle() {
    if (!this.ctx || this.titleThemeActive) return;
    this.titleThemeActive = true;
    this._vocoderPlayed = true;
    this._scheduleVocoderTitleLoop();
  },
  _titleLoopCount: 0,
  _scheduleVocoderTitleLoop() {
    if (!this.ctx || !this.titleThemeActive) return;
    const ctx = this.ctx;
    const bpm = 110;
    const beat = 60 / bpm;
    const sixteenth = beat / 4;
    const totalSteps = 256; // 64 beats * 4 sixteenths = 16 bars

    this._titleThemeSources = new Set();
    this._titleThemeTimers = new Set();

    const outGain = ctx.createGain();
    outGain.gain.value = 1.35 * this.musicVolume; // Controlled by Music slider
    outGain.connect(this.master);
    let titleRevSend = null;
    if (this.reverbHighpass) {
      titleRevSend = ctx.createGain();
      titleRevSend.gain.value = 0.24;
      outGain.connect(titleRevSend);
      titleRevSend.connect(this.reverbHighpass);
    }
    outGain._revSend = titleRevSend;
    this.titleThemeNodes.push(outGain);

    if (this.musicGain) {
      const now = ctx.currentTime;
      this.musicGain.gain.cancelScheduledValues(now);
      this.musicGain.gain.setValueAtTime(Math.max(0.0001, this.musicGain.gain.value), now);
      this.musicGain.gain.linearRampToValueAtTime(this.musicBaseGain * this.musicVolume * 0.15, now + 0.15);
    }

    const note = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
    const trackSource = (src, cleanup) => {
      this._titleThemeSources?.add(src);
      src.onended = () => {
        this._titleThemeSources?.delete(src);
        try { cleanup?.(); } catch (e) {}
      };
    };
    const trackTimer = (fn, ms) => {
      const id = setTimeout(() => {
        this._titleThemeTimers?.delete(id);
        fn();
      }, Math.max(0, ms));
      this._titleThemeTimers?.add(id);
      return id;
    };

    const connectPan = (src, dest, pan = 0) => {
      if (ctx.createStereoPanner && pan !== 0) {
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        src.connect(p);
        p.connect(dest);
        return p;
      }
      src.connect(dest);
      return null;
    };

    const scheduleToneAt = (freq, time, dur, type, vol, opts = {}) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, time);
      if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), time + dur);
      filter.type = opts.filterType || "lowpass";
      filter.frequency.setValueAtTime(opts.cutoff || 1800, time);
      if (opts.cutoffEnd) filter.frequency.exponentialRampToValueAtTime(opts.cutoffEnd, time + dur);
      filter.Q.value = opts.q || 1.2;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(vol, time + (opts.attack || 0.008));
      gain.gain.setValueAtTime(vol, time + Math.max(opts.attack || 0.008, dur - (opts.release || 0.06)));
      gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      osc.connect(filter);
      filter.connect(gain);
      const panner = connectPan(gain, outGain, opts.pan || 0);
      trackSource(osc, () => { filter.disconnect(); gain.disconnect(); panner?.disconnect(); });
      osc.start(time);
      osc.stop(time + dur + 0.02);
    };

    const sharedNoiseBuf = this._getNoiseBuffer();
    const scheduleNoiseAt = (time, dur, vol, hpFreq, opts = {}) => {
      if (!sharedNoiseBuf) return;
      const safeDur = Math.min(dur, 1.45);
      const offset = Math.random() * Math.max(0, 1.5 - safeDur - 0.02);
      const src = ctx.createBufferSource();
      const hp = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      src.buffer = sharedNoiseBuf;
      hp.type = "highpass";
      hp.frequency.value = hpFreq;
      gain.gain.setValueAtTime(Math.max(0.0001, vol), time);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + safeDur);
      src.connect(hp);
      hp.connect(gain);
      const panner = connectPan(gain, outGain, opts.pan || 0);
      trackSource(src, () => { hp.disconnect(); gain.disconnect(); panner?.disconnect(); });
      src.start(time, offset, safeDur);
    };

    // ---- TALKBOX: "Rrrrreeegulaido!" ----
    const playTalkboxAt = (tStart) => {
      const dur = 4.5 * beat;
      const tbGain = ctx.createGain();
      tbGain.connect(outGain);

      const carrierGain = ctx.createGain();
      carrierGain.gain.value = 0.26;

      const saws = [-8, -4, 0, 4, 8].map(detune => {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.detune.value = detune;
        osc.frequency.setValueAtTime(note(43), tStart);
        osc.frequency.setTargetAtTime(note(42), tStart + 1.5 * beat, 0.03);
        osc.frequency.setTargetAtTime(note(40), tStart + 2.0 * beat, 0.03);
        osc.frequency.setTargetAtTime(note(38), tStart + 3.0 * beat, 0.03);
        osc.connect(carrierGain);
        trackSource(osc);
        osc.start(tStart);
        osc.stop(tStart + dur);
        return osc;
      });

      const sub = ctx.createOscillator();
      sub.type = "sawtooth";
      sub.frequency.setValueAtTime(note(31), tStart);
      sub.frequency.setTargetAtTime(note(30), tStart + 1.5 * beat, 0.03);
      sub.frequency.setTargetAtTime(note(28), tStart + 2.0 * beat, 0.03);
      sub.frequency.setTargetAtTime(note(26), tStart + 3.0 * beat, 0.03);
      const subGain = ctx.createGain();
      subGain.gain.value = 0.1;
      sub.connect(subGain);
      subGain.connect(carrierGain);
      trackSource(sub, () => { subGain.disconnect(); });
      sub.start(tStart);
      sub.stop(tStart + dur);

      const f1 = ctx.createBiquadFilter(); f1.type = "bandpass"; f1.Q.value = 6;
      const f2 = ctx.createBiquadFilter(); f2.type = "bandpass"; f2.Q.value = 4;
      const f3 = ctx.createBiquadFilter(); f3.type = "bandpass"; f3.Q.value = 3;
      carrierGain.connect(f1); carrierGain.connect(f2); carrierGain.connect(f3);

      const filterMix = ctx.createGain();
      filterMix.gain.value = 2.4;
      f1.connect(filterMix); f2.connect(filterMix); f3.connect(filterMix);

      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 3000;
      lp.Q.value = 0.2;
      filterMix.connect(lp);
      lp.connect(tbGain);

      const setFormant = (timeOffset, f1Freq, f2Freq, f3Freq, rampTime = 0.1) => {
        const t = tStart + timeOffset;
        f1.frequency.setTargetAtTime(f1Freq * 0.82, t, rampTime);
        f2.frequency.setTargetAtTime(f2Freq * 0.82, t, rampTime);
        f3.frequency.setTargetAtTime(f3Freq * 0.82, t, rampTime);
      };
      f1.frequency.setValueAtTime(320 * 0.82, tStart);
      f2.frequency.setValueAtTime(1200 * 0.82, tStart);
      f3.frequency.setValueAtTime(1500 * 0.82, tStart);
      setFormant(0.5 * beat, 270, 2300, 3000, 0.05);
      setFormant(1.5 * beat, 300, 870, 2240, 0.03);
      setFormant(2.0 * beat, 360, 1300, 2600, 0.03);
      setFormant(2.2 * beat, 730, 1090, 2440, 0.03);
      setFormant(2.5 * beat, 270, 2300, 3000, 0.05);
      setFormant(3.0 * beat, 500, 800, 2400, 0.03);

      const playBurst = (timeOffset, duration, hpFreq, lpFreq, vol) => {
        if (!sharedNoiseBuf) return;
        const t = tStart + timeOffset;
        const safeDur = Math.min(duration, 1.4);
        const src = ctx.createBufferSource();
        src.buffer = sharedNoiseBuf;
        const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = hpFreq;
        const lp2 = ctx.createBiquadFilter(); lp2.type = "lowpass"; lp2.frequency.value = lpFreq;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(vol, t + 0.01);
        env.gain.exponentialRampToValueAtTime(0.0001, t + safeDur);
        src.connect(hp); hp.connect(lp2); lp2.connect(env); env.connect(outGain);
        trackSource(src, () => { hp.disconnect(); lp2.disconnect(); env.disconnect(); });
        src.start(t, Math.random() * 0.4, safeDur);
      };
      playBurst(1.45 * beat, 0.15, 800, 2500, 0.15);
      playBurst(2.95 * beat, 0.12, 2500, 5000, 0.15);

      if (sharedNoiseBuf) {
        const rDur = Math.min(0.6 * beat, 1.4);
        const rSrc = ctx.createBufferSource();
        rSrc.buffer = sharedNoiseBuf;
        const rHp = ctx.createBiquadFilter(); rHp.type = "highpass"; rHp.frequency.value = 600;
        const rLp = ctx.createBiquadFilter(); rLp.type = "lowpass"; rLp.frequency.value = 1800;
        const rEnv = ctx.createGain();
        rEnv.gain.setValueAtTime(0.0001, tStart);
        rEnv.gain.linearRampToValueAtTime(0.045, tStart + 0.035);
        rEnv.gain.setValueAtTime(0.045, tStart + rDur * 0.45);
        rEnv.gain.linearRampToValueAtTime(0.0001, tStart + rDur);
        rSrc.connect(rHp); rHp.connect(rLp); rLp.connect(rEnv); rEnv.connect(outGain);
        trackSource(rSrc, () => { rHp.disconnect(); rLp.disconnect(); rEnv.disconnect(); });
        rSrc.start(tStart, Math.random() * 0.4, rDur);
      }

      tbGain.gain.setValueAtTime(0.0001, tStart);
      tbGain.gain.linearRampToValueAtTime(0.38, tStart + 0.1);
      tbGain.gain.setValueAtTime(0.38, tStart + dur - 0.5);
      tbGain.gain.linearRampToValueAtTime(0.0001, tStart + dur);

      if (saws[0]) {
        const prevCleanup = saws[0].onended;
        saws[0].onended = () => {
          prevCleanup?.();
          try {
            tbGain.disconnect(); filterMix.disconnect(); lp.disconnect();
            f1.disconnect(); f2.disconnect(); f3.disconnect();
            carrierGain.disconnect();
          } catch (e) {}
        };
      }
    };

    const playAngelChoirAt = (tStart) => {
      const phraseDur = 7.6 * beat;
      const choirOut = ctx.createGain();
      choirOut.gain.setValueAtTime(0.0001, tStart);
      choirOut.gain.linearRampToValueAtTime(1.2, tStart + 0.45);
      choirOut.gain.setValueAtTime(1.2, tStart + phraseDur - 0.8);
      choirOut.gain.linearRampToValueAtTime(0.0001, tStart + phraseDur);
      choirOut.connect(outGain);

      const phonemes = [
        [0.00, 0.28, [320, 1200, 1500]],
        [0.28, 0.38, [270, 2300, 3000]],
        [0.66, 0.26, [300, 870, 2240]],
        [0.92, 0.24, [360, 1300, 2600]],
        [1.16, 0.36, [730, 1090, 2440]],
        [1.52, 0.32, [270, 2300, 3000]],
        [1.84, 1.25, [500, 800, 2400]],
      ];
      const melody = [[0.00, 67], [0.66, 69], [1.16, 72], [1.84, 74], [2.75, 76]];
      const choirVoices = [
        { offset: -12, pan: -0.6, gain: 0.16 },
        { offset: -5, pan: -0.25, gain: 0.13 },
        { offset: 0, pan: 0.25, gain: 0.11 },
        { offset: 7, pan: 0.6, gain: 0.09 },
      ];

      const playChoirBurst = (timeOffset, duration, hpFreq, lpFreq, vol, pan = 0) => {
        if (!sharedNoiseBuf) return;
        const t = tStart + timeOffset;
        const safeDur = Math.min(duration, 1.4);
        const src = ctx.createBufferSource();
        const hp = ctx.createBiquadFilter();
        const lp = ctx.createBiquadFilter();
        const env = ctx.createGain();
        src.buffer = sharedNoiseBuf;
        hp.type = "highpass"; hp.frequency.value = hpFreq;
        lp.type = "lowpass"; lp.frequency.value = lpFreq;
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(vol, t + 0.012);
        env.gain.exponentialRampToValueAtTime(0.0001, t + safeDur);
        src.connect(hp); hp.connect(lp); lp.connect(env);
        const panner = connectPan(env, choirOut, pan);
        trackSource(src, () => { hp.disconnect(); lp.disconnect(); env.disconnect(); panner?.disconnect(); });
        src.start(t, Math.random() * 0.4, safeDur);
      };
      playChoirBurst(0.03, 0.22, 500, 1800, 0.025);
      playChoirBurst(0.64, 0.10, 850, 2600, 0.035);
      playChoirBurst(1.80, 0.09, 2200, 5200, 0.03);

      choirVoices.forEach((voice, voiceIdx) => {
        const voiceGain = ctx.createGain();
        voiceGain.gain.setValueAtTime(0.0001, tStart);
        voiceGain.gain.linearRampToValueAtTime(voice.gain, tStart + 0.35 + voiceIdx * 0.04);
        voiceGain.gain.setValueAtTime(voice.gain, tStart + phraseDur - 0.65);
        voiceGain.gain.linearRampToValueAtTime(0.0001, tStart + phraseDur);

        const f1 = ctx.createBiquadFilter(); f1.type = "bandpass"; f1.Q.value = 5;
        const f2 = ctx.createBiquadFilter(); f2.type = "bandpass"; f2.Q.value = 4;
        const f3 = ctx.createBiquadFilter(); f3.type = "bandpass"; f3.Q.value = 3;
        const air = ctx.createBiquadFilter(); air.type = "highshelf"; air.frequency.value = 3200; air.gain.value = 4.0;
        const warm = ctx.createBiquadFilter(); warm.type = "lowpass"; warm.frequency.value = 5200; warm.Q.value = 0.35;

        f1.frequency.setValueAtTime(phonemes[0][2][0], tStart);
        f2.frequency.setValueAtTime(phonemes[0][2][1], tStart);
        f3.frequency.setValueAtTime(phonemes[0][2][2], tStart);
        phonemes.slice(1).forEach(([phonemeStart, phonemeDur, formants]) => {
          const time = tStart + phonemeStart;
          const ramp = Math.min(0.055, phonemeDur * 0.16);
          f1.frequency.setTargetAtTime(formants[0], time, ramp);
          f2.frequency.setTargetAtTime(formants[1], time, ramp);
          f3.frequency.setTargetAtTime(formants[2], time, ramp);
        });

        const oscA = ctx.createOscillator();
        const oscB = ctx.createOscillator();
        oscA.type = "sawtooth"; oscB.type = "sawtooth";
        oscA.detune.value = -8 + voiceIdx * 2;
        oscB.detune.value = 7 - voiceIdx * 2;
        const startMidi = melody[0][1] + voice.offset;
        oscA.frequency.setValueAtTime(note(startMidi), tStart);
        oscB.frequency.setValueAtTime(note(startMidi), tStart);
        melody.slice(1).forEach(([melodyStart, midi]) => {
          const target = note(midi + voice.offset);
          oscA.frequency.setTargetAtTime(target, tStart + melodyStart, 0.08);
          oscB.frequency.setTargetAtTime(target, tStart + melodyStart, 0.1);
        });

        oscA.connect(f1); oscA.connect(f2); oscA.connect(f3);
        oscB.connect(f1); oscB.connect(f2); oscB.connect(f3);
        f1.connect(voiceGain); f2.connect(voiceGain); f3.connect(voiceGain);
        voiceGain.connect(air); air.connect(warm);
        const panner = connectPan(warm, choirOut, voice.pan);
        trackSource(oscA, () => {
          f1.disconnect(); f2.disconnect(); f3.disconnect();
          voiceGain.disconnect(); air.disconnect(); warm.disconnect(); panner?.disconnect();
          if (voiceIdx === 0) choirOut.disconnect();
        });
        trackSource(oscB);
        oscA.start(tStart); oscB.start(tStart);
        oscA.stop(tStart + phraseDur + 0.1); oscB.stop(tStart + phraseDur + 0.1);
      });
    };

    const playStringsAt = (tStart) => {
      const dur = beat * 32;
      const stringOut = ctx.createGain();
      stringOut.gain.setValueAtTime(0.0001, tStart);
      stringOut.gain.linearRampToValueAtTime(0.68, tStart + beat * 2);
      stringOut.gain.setValueAtTime(0.68, tStart + dur - beat * 2);
      stringOut.gain.linearRampToValueAtTime(0.0001, tStart + dur);
      stringOut.connect(outGain);

      const stringMelody = [
        [0, 60], [4, 62], [8, 64], [12, 67],
        [16, 69], [20, 72], [24, 74], [28, 76],
      ];
      const harmonyOffsets = [-12, -5, 0, 7];
      harmonyOffsets.forEach((offset, idx) => {
        const oscA = ctx.createOscillator();
        const oscB = ctx.createOscillator();
        const gain = ctx.createGain();
        const body = ctx.createBiquadFilter();
        const sheen = ctx.createBiquadFilter();
        oscA.type = "sawtooth"; oscB.type = "sawtooth";
        oscA.detune.value = -9 + idx * 2;
        oscB.detune.value = 8 - idx;
        const voiceLevel = 0.08 - idx * 0.005;
        gain.gain.setValueAtTime(0.0001, tStart);
        gain.gain.linearRampToValueAtTime(voiceLevel, tStart + beat * 2);
        gain.gain.setValueAtTime(voiceLevel, tStart + dur - beat * 2);
        gain.gain.linearRampToValueAtTime(0.0001, tStart + dur);
        body.type = "lowpass"; body.frequency.value = 3200 + idx * 550; body.Q.value = 0.65;
        sheen.type = "highpass"; sheen.frequency.value = 120;
        const firstNote = stringMelody[0][1] + offset;
        oscA.frequency.setValueAtTime(note(firstNote), tStart);
        oscB.frequency.setValueAtTime(note(firstNote), tStart);
        stringMelody.slice(1).forEach(([beatOffset, midi]) => {
          const target = note(midi + offset);
          oscA.frequency.setTargetAtTime(target, tStart + beat * beatOffset, 0.2);
          oscB.frequency.setTargetAtTime(target, tStart + beat * beatOffset, 0.24);
        });
        oscA.connect(body); oscB.connect(body);
        body.connect(sheen); sheen.connect(gain);
        const panner = connectPan(gain, stringOut, [-0.55, -0.18, 0.18, 0.55][idx]);
        trackSource(oscA, () => {
          body.disconnect(); sheen.disconnect(); gain.disconnect(); panner?.disconnect();
          if (idx === 0) stringOut.disconnect();
        });
        trackSource(oscB);
        oscA.start(tStart); oscB.start(tStart);
        oscA.stop(tStart + dur + 0.1); oscB.stop(tStart + dur + 0.1);
      });
    };

    const bassRoots = [33, 29, 36, 31];
    const chordProgs = [
      [45, 48, 52, 55],
      [41, 45, 48, 52],
      [48, 52, 55, 59],
      [43, 47, 50, 54],
    ];

    let step = 0;
    let nextTime = ctx.currentTime + 0.05;
    this._titleLoopCount++;

    const scheduleTitleStep = (s, time) => {
      const b = Math.floor(s / 4);
      const sub = s % 4;
      const bar = Math.floor(s / 16);
      const stepInBar = s % 16;
      const chordIdx = Math.floor((bar % 8) / 2);
      const chord = chordProgs[chordIdx];

      // Drums
      if (sub === 0) {
        scheduleToneAt(70, time, 0.25, "sine", 0.48, { freqEnd: 30, cutoff: 1000, attack: 0.002, release: 0.18 });
        scheduleNoiseAt(time, 0.04, 0.08, 800);
        if (b % 2 === 1) {
          scheduleNoiseAt(time, 0.18, 0.20, 1200, { pan: -0.05 });
          scheduleToneAt(190, time, 0.12, "triangle", 0.09, { freqEnd: 120, cutoff: 900, attack: 0.002, release: 0.1 });
        }
      } else {
        const open = sub === 2;
        scheduleNoiseAt(time, open ? 0.2 : 0.05, open ? 0.075 : 0.042, open ? 5000 : 6500, { pan: open ? 0.2 : -0.2 });
      }

      // Bass (8th notes)
      if (stepInBar % 2 === 0) {
        const i8 = stepInBar / 2;
        if (!(i8 === 7 && bar % 2 === 1)) {
          const root = bassRoots[chordIdx];
          const stepLen = (beat / 2) * 0.85;
          scheduleToneAt(note(root), time, stepLen, "sawtooth", 0.13, {
            cutoff: 520, cutoffEnd: 1050, q: 1.8, attack: 0.005, release: 0.08
          });
          if (i8 % 2 === 0) {
            scheduleToneAt(note(root - 12), time, stepLen * 1.1, "sine", 0.14, {
              cutoff: 240, q: 0.7, attack: 0.006, release: 0.09
            });
          }
        }
      }

      // Chords (every 2 bars = 32 steps)
      if (s % 32 === 0) {
        const pass = s < 128 ? 0 : 1;
        chord.forEach((m, v) => {
          scheduleToneAt(note(m), time, 8 * beat, "sawtooth", pass === 0 ? 0.042 : 0.036, {
            cutoff: 800 + v * 150, cutoffEnd: pass === 0 ? 2400 + v * 150 : 3000 + v * 180,
            q: 0.6, attack: 0.2, release: 1.2, pan: (v - 1.5) * 0.25
          });
        });
      }

      // 16th-note arp
      const m = chord[stepInBar % 4] + 12;
      scheduleToneAt(note(m), time, sixteenth * 0.6, "square", 0.03, {
        cutoff: 1800, cutoffEnd: 4500, q: 2.2, attack: 0.005, release: 0.05, pan: stepInBar % 2 ? 0.35 : -0.35
      });

      // Featured hooks
      if (s === 24 * 4) playTalkboxAt(time);
      if (s === 56 * 4) playAngelChoirAt(time);
      if (s === 32 * 4 && this._titleLoopCount >= 2) playStringsAt(time);
    };

    const tick = () => {
      if (!this.titleThemeActive || !this.ctx) return;
      const now = ctx.currentTime;
      if (now - nextTime > 0.35) nextTime = now + 0.03;
      let count = 0;
      while (nextTime < now + 0.22 && count < 8) {
        try {
          scheduleTitleStep(step, nextTime);
        } catch (e) {
          console.warn("Title theme step error", e);
        }
        nextTime += sixteenth;
        step++;
        if (step >= totalSteps) {
          step = 0;
          this._titleLoopCount++;
        }
        count++;
      }
      this.titleThemeTimeout = trackTimer(tick, 45);
    };
    tick();
  },
  stopTitleTheme(fade = true) {
    this.titleThemeActive = false;
    this._vocoderPlayed = false;
    if (this.titleThemeTimeout) {
      clearTimeout(this.titleThemeTimeout);
      this.titleThemeTimeout = null;
    }
    if (this._titleThemeTimers) {
      for (const id of this._titleThemeTimers) clearTimeout(id);
      this._titleThemeTimers.clear();
    }
    const sourcesToStop = this._titleThemeSources ? Array.from(this._titleThemeSources) : [];
    this._titleThemeSources?.clear();

    const stopSourcesNow = () => {
      for (const src of sourcesToStop) {
        try { src.stop(0); } catch (e) {}
        try { src.disconnect(); } catch (e) {}
      }
    };

    if (this.ctx && this.titleThemeNodes.length) {
      const now = this.ctx.currentTime;
      const fadeTime = fade ? 0.12 : 0.02;
      const nodes = this.titleThemeNodes.slice();
      this.titleThemeNodes = [];
      for (const node of nodes) {
        try {
          node.gain.cancelScheduledValues(now);
          node.gain.setValueAtTime(Math.max(0.0001, node.gain.value || 0.0001), now);
          node.gain.exponentialRampToValueAtTime(0.0001, now + fadeTime);
        } catch (e) {}
      }
      if (!fade) {
        stopSourcesNow();
        for (const node of nodes) {
          try { node._revSend?.disconnect(); node.disconnect(); } catch (e) {}
        }
      } else {
        setTimeout(() => {
          stopSourcesNow();
          for (const node of nodes) {
            try { node._revSend?.disconnect(); node.disconnect(); } catch (e) {}
          }
        }, (fadeTime + 0.05) * 1000);
      }
    } else {
      stopSourcesNow();
    }
    if (fade && this.ctx && this.musicGain) {
      const now = this.ctx.currentTime;
      this.musicGain.gain.cancelScheduledValues(now);
      this.musicGain.gain.setValueAtTime(Math.max(0.0001, this.musicGain.gain.value || 0.0001), now);
      this.musicGain.gain.linearRampToValueAtTime(this.musicBaseGain * this.musicVolume, now + 0.25);
    }
  },
};

export function registerSoundListeners(bus) {
  bus.on("battle:approvalPopped", ({ kart, isPlayer }) => {
    if (isPlayer) Sound.approvalPop();
    else Sound.spatialTone(kart.x, kart.y, 200, 0.14, "sawtooth", 0.12, 90);
  });
  bus.on("battle:approvalStolen", () => {
    if (Sound.approvalSteal) Sound.approvalSteal();
  });
  bus.on("battle:kartEliminated", ({ isPlayer, killConfirm }) => {
    if (!isPlayer) return;
    if (killConfirm) {
      if (Sound.killConfirm) Sound.killConfirm();
    } else {
      Sound.crash();
    }
  });
  bus.on("battle:ram", () => {
    Sound.crash();
  });
  bus.on("kart:boost", ({ kart, driftRelease }) => {
    Sound.boost();
    if (driftRelease) Sound.tone(550, 0.1, "sawtooth", 0.15, 80);
  });
  bus.on("kart:jump", () => {
    Sound.boost();
  });
  bus.on("kart:land", () => {
    Sound.tone(280, 0.06, "sine", 0.08, 140);
  });
  bus.on("kart:itemUsed", ({ kart, item }) => {
    const fx = Math.cos(kart.heading);
    const fy = Math.sin(kart.heading);
    if (item === "boost") {
      Sound.spatialTone(kart.x, kart.y, 220, 0.45, "sawtooth", 0.16, 880);
      Sound.spatialNoise(kart.x, kart.y, 0.25, 0.08, 1200);
    } else if (item === "shield") {
      Sound.spatialTone(kart.x, kart.y, 440, 0.2, "triangle", 0.12, 880);
    } else if (item === "handling") {
      Sound.spatialTone(kart.x, kart.y, 600, 0.15, "sine", 0.14, 1200);
    } else if (item === "conflict") {
      Sound.spatialTone(kart.x, kart.y, 180, 0.18, "triangle", 0.15, 60);
      Sound.spatialNoise(kart.x, kart.y, 0.15, 0.12, 300);
    } else if (item === "placebo") {
      Sound.spatialTone(kart.x, kart.y, 520, 0.14, "triangle", 0.13, 220);
      Sound.spatialNoise(kart.x, kart.y, 0.09, 0.06, 1600);
    } else if (item === "doubleblind") {
      Sound.spatialTone(kart.x, kart.y, 260, 0.28, "sawtooth", 0.12, 520);
      Sound.spatialNoise(kart.x, kart.y, 0.25, 0.08, 700);
    } else if (item === "dossier") {
      Sound.spatialTone(kart.x, kart.y, 350, 0.12, "square", 0.16, 120);
      Sound.spatialNoise(kart.x, kart.y, 0.10, 0.08, 1000);
    } else if (item === "deauth") {
      Sound.spatialTone(kart.x, kart.y, 95, 0.25, "sawtooth", 0.18, 28);
      Sound.spatialNoise(kart.x, kart.y, 0.22, 0.13, 420);
    } else if (item === "mergerequest") {
      Sound.spatialTone(kart.x, kart.y, 320, 0.16, "square", 0.14, 760);
      Sound.spatialTone(kart.x, kart.y, 640, 0.12, "triangle", 0.10, 960);
    } else if (item === "hotfix") {
      Sound.spatialTone(kart.x, kart.y, 440, 0.5, "sawtooth", 0.2, 1760);
      Sound.spatialTone(kart.x, kart.y, 220, 0.4, "square", 0.16, 880);
      Sound.spatialNoise(kart.x, kart.y, 0.3, 0.1, 2000);
    } else if (item === "fasttrack") {
      Sound.spatialTone(kart.x, kart.y, 660, 0.42, "sawtooth", 0.18, 2200);
      Sound.spatialTone(kart.x, kart.y, 330, 0.32, "square", 0.12, 990);
    }
  });
  bus.on("kart:itemPickup", ({ type }) => {
    if (type === "coin") Sound.coin();
    else if (type === "itembox") Sound.itembox();
    else if (type === "rareItem") Sound.rareItem();
  });
  bus.on("race:finished", () => {
    Sound.finish();
  });
  bus.on("race:lapCompleted", ({ kart, isFinalLap }) => {
    if (kart.isPlayer) Sound.lap();
    if (isFinalLap) Sound.finalLap();
  });
}
