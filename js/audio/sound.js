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
  musicBaseGain: 0.08,
  musicDuckGain: null,

  // Player 1 oscillators & gains
  engineOscP1: null,
  engineGainP1: null,
  driftOscP1: null,
  driftGainP1: null,
  rumbleOscP1: null,
  rumbleGainP1: null,

  // Player 2 oscillators & gains
  engineOscP2: null,
  engineGainP2: null,
  driftOscP2: null,
  driftGainP2: null,
  rumbleOscP2: null,
  rumbleGainP2: null,

  ensure() {
    if (this.ctx) return;
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      this.ctx = new C();
      this.master = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-18, this.ctx.currentTime);
      this.compressor.knee.setValueAtTime(18, this.ctx.currentTime);
      this.compressor.ratio.setValueAtTime(4, this.ctx.currentTime);
      this.compressor.attack.setValueAtTime(0.006, this.ctx.currentTime);
      this.compressor.release.setValueAtTime(0.16, this.ctx.currentTime);

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
      this.reverbReturn.connect(this.compressor);
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
    if (this.master) this.master.gain.value = m ? 0 : 0.45;
    env().saveSettings({ muted: this.muted });
  },
  setMusicVolume(v, opts = {}) {
    this.musicVolume = normalizeVolume(v, 0.8);
    if (this.musicGain) {
      this.musicGain.gain.value = this.musicBaseGain * this.musicVolume;
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

    if (this.ctx.createStereoPanner && pan !== 0) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = pan;
      osc.connect(g);
      g.connect(panner);
      panner.connect(this.sfxGain);
    } else {
      osc.connect(g);
      g.connect(this.sfxGain);
    }

    osc.start(t); osc.stop(t + dur + 0.02);
  },

  noise(dur = 0.18, vol = 0.18, hpFreq = 600, pan = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = hpFreq;
    const g = this.ctx.createGain();
    g.gain.value = vol;

    if (this.ctx.createStereoPanner && pan !== 0) {
      const panner = this.ctx.createStereoPanner();
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
    src.start(t);
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
    osc1.start(t); osc1.stop(t + 0.09);
    osc2.start(t); osc2.stop(t + 0.09);
    setTimeout(() => {
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
      osc.start(t); osc.stop(t + 0.37);
      osc2.start(t); osc2.stop(t + 0.37);
      setTimeout(() => {
        const t2 = this.ctx.currentTime;
        const o = this.ctx.createOscillator();
        const g2 = this.ctx.createGain();
        o.type = "square"; o.frequency.value = 1320;
        g2.gain.setValueAtTime(0.001, t2);
        g2.gain.linearRampToValueAtTime(0.18, t2 + 0.005);
        g2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.3);
        o.connect(g2); g2.connect(this.sfxGain);
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
      osc.start(t); osc.stop(t + 0.24);
    }
  },
  finish() {
    if (!this.ctx || this.muted) return;
    this.duckMusic(0.55, 700);
    const notes = [523, 659, 784, 1047, 1319, 1568];
    notes.forEach((f, i) => {
      setTimeout(() => {
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
    osc.start(t); osc.stop(t + 0.3);
    osc2.start(t); osc2.stop(t + 0.3);
  },
  // Briefly dip the music so a punchy SFX cuts through, then recover.
  // amount: 0..1 portion of music to remove at the dip; ms: recovery time.
  duckMusic(amount = 0.4, ms = 220) {
    if (!this.ctx || this.muted || !this.musicDuckGain) return;
    const g = this.musicDuckGain.gain;
    const now = this.ctx.currentTime;
    const floor = Math.max(0.12, 1 - amount);
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
    osc.start(t0); osc.stop(t0 + 0.62);
    osc2.start(t0); osc2.stop(t0 + 0.62);
    setTimeout(() => {
      const t = this.ctx.currentTime;
      [880, 1175].forEach((f, i) => {
        const o = this.ctx.createOscillator();
        const gg = this.ctx.createGain();
        o.type = "triangle"; o.frequency.value = f;
        gg.gain.setValueAtTime(0.001, t + i * 0.02);
        gg.gain.linearRampToValueAtTime(0.12, t + 0.02 + i * 0.02);
        gg.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        o.connect(gg); gg.connect(this.sfxGain);
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
    osc.start(t); osc.stop(t + 0.26);
    this.noise(0.12, 0.08, 800);
  },
  approvalSteal() {
    if (!this.ctx || this.muted) return;
    const freqs = [520, 660, 880];
    freqs.forEach((f, i) => {
      setTimeout(() => {
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
    osc.start(t); osc.stop(t + 0.1);
    this.noise(0.06, 0.08, 300);
  },

  // Dual Synthesizer Engines
  startEngine(playerIdx) {
    if (!this.ctx || this.muted) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(65, t); // low rumble
      g.gain.setValueAtTime(0.001, t);

      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(140, t);

      osc.connect(filter);
      filter.connect(g);

      // Pan Left for P1, Right for P2
      const panVal = playerIdx === 1 ? -0.45 : (playerIdx === 2 ? 0.45 : 0);
      if (this.ctx.createStereoPanner && panVal !== 0) {
        const panner = this.ctx.createStereoPanner();
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
      } else {
        this.engineOscP2 = osc;
        this.engineGainP2 = g;
      }
    } catch (e) {
      console.warn("Failed to start engine " + playerIdx, e);
    }
  },

  updateEngine(playerIdx, speed, maxSpeed, isBoosting) {
    if (!this.ctx || this.muted) return;
    const osc = playerIdx === 1 ? this.engineOscP1 : this.engineOscP2;
    const gain = playerIdx === 1 ? this.engineGainP1 : this.engineGainP2;

    if (!osc || !gain) return;
    try {
      const t = this.ctx.currentTime;
      const frac = clamp(speed / maxSpeed, 0, 1.5);
      const targetFreq = 50 + frac * 115 + (isBoosting ? 40 : 0);
      osc.frequency.setTargetAtTime(targetFreq, t, 0.06);

      const targetGain = 0.035 + frac * 0.07 + (isBoosting ? 0.03 : 0);
      gain.gain.setTargetAtTime(targetGain, t, 0.06);
    } catch (e) {}
  },

  stopEngine(playerIdx) {
    const osc = playerIdx === 1 ? this.engineOscP1 : this.engineOscP2;
    if (osc) {
      try {
        osc.stop();
        osc.disconnect();
      } catch (e) {}
      if (playerIdx === 1) {
        this.engineOscP1 = null;
        this.engineGainP1 = null;
      } else {
        this.engineOscP2 = null;
        this.engineGainP2 = null;
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
      if (this.ctx.createStereoPanner && panVal !== 0) {
        const panner = this.ctx.createStereoPanner();
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
      } else {
        this.driftOscP2 = osc;
        this.driftGainP2 = g;
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
        osc.frequency.setValueAtTime(freq, t);
        const vol = clamp((speed - 1.5) * 0.025, 0, 0.07);
        gain.gain.setTargetAtTime(vol, t, 0.05);
      }
    } else {
      this.stopDriftSqueal(playerIdx);
    }
  },

  stopDriftSqueal(playerIdx) {
    const osc = playerIdx === 1 ? this.driftOscP1 : this.driftOscP2;
    if (osc) {
      try {
        osc.stop();
        osc.disconnect();
      } catch (e) {}
      if (playerIdx === 1) {
        this.driftOscP1 = null;
        this.driftGainP1 = null;
      } else {
        this.driftOscP2 = null;
        this.driftGainP2 = null;
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
      if (this.ctx.createStereoPanner && panVal !== 0) {
        const panner = this.ctx.createStereoPanner();
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
      } else {
        this.rumbleOscP2 = osc;
        this.rumbleGainP2 = g;
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
        osc.frequency.setValueAtTime(freq, t);
        const vol = clamp((speed - 1.5) * 0.045, 0, 0.13);
        gain.gain.setTargetAtTime(vol, t, 0.05);
      }
    } else {
      this.stopRumble(playerIdx);
    }
  },

  stopRumble(playerIdx) {
    const osc = playerIdx === 1 ? this.rumbleOscP1 : this.rumbleOscP2;
    if (osc) {
      try {
        osc.stop();
        osc.disconnect();
      } catch (e) {}
      if (playerIdx === 1) {
        this.rumbleOscP1 = null;
        this.rumbleGainP1 = null;
      } else {
        this.rumbleOscP2 = null;
        this.rumbleGainP2 = null;
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
    this.isPlayingMusic = true;

    if (this.trackIdx === null || this.trackIdx === undefined) {
      this.trackIdx = Math.floor(Math.random() * this.tracks.length);
    }
    const t = this.tracks[this.trackIdx] || this.tracks[0];
    this.tempo = t.tempo;

    this.musicGain = this.ctx.createGain();
    this.musicBaseGain = this.trackIdx === 5 ? 0.09 : this.trackIdx === 3 ? 0.10 : this.trackIdx === 4 ? 0.11 : 0.08;
    this.musicGain.gain.value = this.musicBaseGain * this.musicVolume;
    this.musicGain.connect(this.musicDuckGain || this.master);

    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.stepIndex = 0;

    const lookahead = 0.150; // seconds
    const scheduleInterval = 50; // milliseconds

    const scheduler = () => {
      if (!this.isPlayingMusic) return;
      while (this.nextNoteTime < this.ctx.currentTime + lookahead) {
        this.scheduleStep(this.stepIndex, this.nextNoteTime);
        const secondsPerStep = 60.0 / this.tempo / 4.0; // 16th notes
        this.nextNoteTime += secondsPerStep;
        const loopLen = this.getLoopSteps();
        this.stepIndex = (this.stepIndex + 1) % loopLen;
      }
      this.musicInterval = setTimeout(scheduler, scheduleInterval);
    };
    scheduler();

    this.showTrackToast();

    if (this.trackIdx === 4) this.startVinylCrackle();
  },

  getLoopSteps() {
    if (this.mapStyle === "japanese") return 512;
    const track = this.trackIdx || 0;
    return (track === 4 || track === 5) ? 512 : 256;
  },

  vinylCrackleNode: null,
  vinylCrackleGain: null,

  startVinylCrackle() {
    if (!this.ctx || this.vinylCrackleNode) return;
    const bufLen = this.ctx.sampleRate * 4;
    const buffer = this.ctx.createBuffer(1, bufLen, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = Math.random() < 0.015 ? (Math.random() * 2 - 1) * 0.8 : (Math.random() * 2 - 1) * 0.01;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2500;

    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 300;

    const g = this.ctx.createGain();
    g.gain.value = 0.025;

    src.connect(hp);
    hp.connect(lp);
    lp.connect(g);
    g.connect(this.musicGain);

    src.start();
    this.vinylCrackleNode = src;
    this.vinylCrackleGain = g;
  },

  stopVinylCrackle() {
    if (this.vinylCrackleNode) {
      try { this.vinylCrackleNode.stop(); this.vinylCrackleNode.disconnect(); } catch (e) {}
      this.vinylCrackleNode = null;
    }
    if (this.vinylCrackleGain) {
      try { this.vinylCrackleGain.disconnect(); } catch (e) {}
      this.vinylCrackleGain = null;
    }
  },

  stopMusic(fade = false) {
    this.isPlayingMusic = false;
    this.stopVinylCrackle();
    if (this.musicInterval) {
      clearTimeout(this.musicInterval);
      this.musicInterval = null;
    }
    if (this.musicGain) {
      const oldGain = this.musicGain;
      if (fade && this.ctx) {
        const now = this.ctx.currentTime;
        oldGain.gain.setValueAtTime(Math.max(0.0001, oldGain.gain.value), now);
        oldGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
        setTimeout(() => { try { oldGain.disconnect(); } catch (e) {} }, 200);
      } else {
        try { oldGain.disconnect(); } catch (e) {}
      }
      this.musicGain = null;
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
    setTimeout(() => { this.startMusic(); }, 60);
  },

  scheduleStep(step, time) {
    // Select musical style per map
    if (this.mapStyle === "japanese") {
      this.scheduleJapaneseStep(step, time);
      return;
    }

    const barInLoop = Math.floor(step / 16);
    const bar = barInLoop % 8;
    const phrase = Math.floor(barInLoop / 8);
    const stepInBar = step % 16;
    const stepDur = 60.0 / this.tempo / 4.0; // length of 16th note
    const track = this.trackIdx || 0;
    const loopBars = this.getLoopSteps() / 16;
    const isFinalBar = barInLoop === loopBars - 1;

    // Reactive intensity based on player race position (0.0 = last, 1.0 = first)
    let intensity = env().getMusicIntensity();
    const playDrums = intensity > 0.25;
    const playChords = intensity > 0.15;
    const fullDrums = intensity > 0.55;

    // 1. Play bass groove (always plays, but quieter when losing)
    const bassFreq = this.getBassFreq(step);
    if (bassFreq) {
      this.playBassNote(bassFreq, time, stepDur * (track === 5 ? 0.85 : track === 3 ? 1.35 : track === 4 ? 2.8 : 1.05), step);
    }

    // 2. Melody
    const melFreq = this.getMelodyNote(step);
    if (melFreq) {
      this.playMelodyNote(melFreq, time, stepDur * (track === 5 ? 3.2 : track === 3 ? 2.6 : track === 4 ? 4.5 : 1.8));
    }

    // Phrase development layers for longer song forms.
    if (phrase > 0) {
      if (track === 0 && (stepInBar === 5 || stepInBar === 13)) {
        const note = [659.25, 783.99, 880.00, 987.77][(bar + stepInBar) % 4];
        this.playMelodyNote(note, time, stepDur * 1.2);
      } else if (track === 1 && (stepInBar === 1 || stepInBar === 9)) {
        const note = stepInBar === 1 ? 1046.50 : 1174.66;
        this.playMelodyNote(note, time, stepDur * 0.7);
      } else if (track === 2 && (stepInBar === 6 || stepInBar === 14)) {
        const note = [1046.50, 1174.66, 1318.51, 1567.98][bar % 4];
        this.playMelodyNote(note, time, stepDur * 0.8);
      } else if (track === 3 && (stepInBar === 3 || stepInBar === 11)) {
        const note = [932.33, 1046.50, 1244.51, 1396.91][bar % 4];
        this.playMelodyNote(note, time, stepDur * 1.0);
      } else if (track === 4 && phrase >= 1 && (stepInBar === 5 || stepInBar === 13)) {
        const note = [392.00, 440.00, 493.88, 523.25][(bar + phrase) % 4];
        this.playMelodyNote(note, time, stepDur * 1.6);
      }
    }

    // 2b. Chords/arps/pads
    if (playChords) {
      if (track === 0 && stepInBar === 0) {
        this.playJunoPad(this.getChordFreqs(track, bar), time, stepDur * 15);
      } else if (track === 4 && bar < 6 && (stepInBar === 0)) {
        this.playRhodesPad(this.getChordFreqs(track, bar), time, stepDur * 14);
      } else if (track === 5 && bar >= 4 && stepInBar === 0) {
        this.playDowntempoPad(this.getChordFreqs(track, bar), time, stepDur * 12);
      } else if (track === 3 && bar < 6 && (stepInBar === 2 || stepInBar === 6 || stepInBar === 10 || stepInBar === 14)) {
        this.playHouseChord(this.getChordFreqs(track, bar), time, stepDur * 2.8);
      } else if (track !== 3 && track !== 4 && bar < 6 && ((track === 1 && (stepInBar === 3 || stepInBar === 7 || stepInBar === 11 || stepInBar === 15)) || (track !== 1 && stepInBar % 4 === 1))) {
        const chordFreqs = this.getChordFreqs(track, bar);
        this.playChiptuneArp(chordFreqs, time, stepDur * 0.95);
      }
    }

    // 3. Drums (reactive: drops out when losing badly)
    if (!playDrums) {
      // silence — tension
    } else if (track === 4) {
      if (bar < 7) {
        if (stepInBar === 0 || stepInBar === 10) {
          this.playRetroKick(time, true);
        }
        if (stepInBar === 4 || stepInBar === 12) {
          this.playRetroSnare(time, 0.85);
        }
        if (bar >= 2 && (stepInBar === 7 || stepInBar === 15)) {
          this.playRetroSnare(time, 0.25);
        }
        if (bar % 2 === 0 && (stepInBar === 2 || stepInBar === 6 || stepInBar === 14)) {
          this.playRetroHiHat(time, false);
        }
        if (bar % 2 === 1 && (stepInBar === 2 || stepInBar === 8 || stepInBar === 14)) {
          this.playRetroHiHat(time, true);
        }
      }
      if (bar === 7 && stepInBar >= 8) {
        this.playRetroSnare(time, (stepInBar - 7) / 6.0);
      }
    } else if (track === 5) {
      // Minimal techno: relentless four-on-the-floor, sparse hats, builds over bars
      if (stepInBar === 0 || stepInBar === 4 || stepInBar === 8 || stepInBar === 12) {
        this.playRetroKick(time, true);
      }
      if (bar >= 2 && (stepInBar === 2 || stepInBar === 6 || stepInBar === 10 || stepInBar === 14)) {
        this.playRetroHiHat(time, false);
      }
      if (bar >= 4 && (stepInBar === 4 || stepInBar === 12)) {
        this.playRetroSnare(time, 0.45);
      }
      if (bar >= 6 && stepInBar % 2 === 1) {
        this.playRetroHiHat(time, true);
      }
      if (bar === 7 && stepInBar >= 12) {
        this.playRetroSnare(time, (stepInBar - 11) / 4.0);
        this.playClap(time, (stepInBar - 11) / 5.0);
      }
    } else if (track === 3) {
      if (bar !== 6) {
        if (stepInBar === 0 || stepInBar === 4 || stepInBar === 8 || stepInBar === 12) {
          this.playRetroKick(time, true);
        }
        if (stepInBar === 0 && bar === 0) {
          this.playCrashCymbal(time);
        }
        if (fullDrums && (stepInBar === 2 || stepInBar === 6 || stepInBar === 10 || stepInBar === 14)) {
          this.playRetroHiHat(time, true);
        }
        if (fullDrums && stepInBar % 2 === 1 && (bar >= 2)) {
          this.playRetroHiHat(time, false);
        }
        if (stepInBar === 4 || stepInBar === 12) {
          this.playClap(time, 1.0);
          this.playRetroSnare(time, 0.6);
        }
        if ((bar >= 4) && (stepInBar === 7 || stepInBar === 15)) {
          this.playRetroSnare(time, 0.3);
        }
      } else {
        if (stepInBar === 0 || stepInBar === 8) {
          this.playRetroKick(time, true);
        }
        if (stepInBar === 4 || stepInBar === 12) {
          this.playClap(time, 0.7);
        }
      }
      if (bar === 7 && stepInBar >= 8) {
        this.playRetroSnare(time, (stepInBar - 7) / 8.0);
        if (stepInBar >= 12) this.playClap(time, (stepInBar - 11) / 5.0);
      }
    } else if (bar < 6) {
      const chorus = bar === 4 || bar === 5;
      const hatSteps = track === 0 ? [2, 6, 10, 14] : track === 1 ? [3, 7, 10, 15] : [2, 5, 10, 13];
      if (fullDrums && (chorus || track === 1) && hatSteps.includes(stepInBar)) {
        this.playRetroHiHat(time);
      }

      const kickSteps = chorus ? [0, 4, 8, 12] : (track === 1 ? [0, 7, 10] : track === 2 ? [0, 6, 12] : [0, 8, 14]);
      if (kickSteps.includes(stepInBar)) {
        this.playRetroKick(time);
      }

      if (stepInBar === 4 || stepInBar === 12) {
        this.playRetroSnare(time, track === 2 ? 0.72 : 0.9);
      }
    } else if (bar === 7 && stepInBar >= 12) {
      const snareVolumeScale = (stepInBar - 11) / 4.0;
      this.playRetroSnare(time, snareVolumeScale);
    }

    // Transition riser at end of loop
    if (bar === 7 && stepInBar >= 12) {
      const progress = (stepInBar - 12) / 4.0;
      if (this.ctx && this.musicGain) {
        const dur = stepDur * (4 - (stepInBar - 12));
        const bufLen = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
        const buf = this.ctx.createBuffer(1, bufLen, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < bufLen; i++) d[i] = (Math.random() * 2 - 1) * (i / bufLen);
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        const hp = this.ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.setValueAtTime(800 + progress * 4000, time);
        hp.frequency.linearRampToValueAtTime(6000, time + dur);
        hp.Q.setValueAtTime(3.5, time);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.001, time);
        g.gain.linearRampToValueAtTime((isFinalBar ? 0.06 : 0.035) * progress, time + dur * 0.7);
        g.gain.exponentialRampToValueAtTime(0.001, time + dur);
        src.connect(hp);
        hp.connect(g);
        g.connect(this.musicGain);
        src.start(time);
      }
    }
  },

  getBassFreq(step) {
    const barInLoop = Math.floor(step / 16);
    const bar = barInLoop % 8;
    const stepInBar = step % 16;
    const track = this.trackIdx || 0;

    if (track === 0) {
      const roots = [82.41, 65.41, 73.42, 61.74, 82.41, 65.41, 55.00, 61.74];
      const patterns = [
        [1, null, null, 1.189, null, 1.498, null, null, 1, null, 1.189, null, 1.498, null, null, 1.782],
        [1, null, 1.189, null, null, 1.498, null, 1.782, 1, null, null, 1.189, null, 1.498, null, null],
        [1, null, null, 1.189, 1.498, null, 1.782, null, 1, null, 1.498, null, 1.189, null, null, 2],
        [1, null, 1.189, null, 1.498, null, null, 1.782, 1, null, 1.189, null, 1.498, null, 2, null]
      ];
      const ratio = (bar >= 6 ? [1, null, null, null, 1.189, null, null, null, 1.498, null, 1.782, null, 1, null, null, null] : patterns[bar % patterns.length])[stepInBar];
      return ratio ? roots[bar] * ratio : null;
    }

    if (track === 1) {
      const roots = [55.00, 43.65, 49.00, 41.20, 55.00, 43.65, 36.71, 41.20];
      const patterns = [
        [1, null, 1.189, null, 1.498, null, null, 1.782, 1, null, 1.189, null, 1.498, null, 1, null],
        [1, 1.498, null, 1.189, null, 1.782, null, null, 1, null, 1.189, 1.498, null, null, 1.782, null],
        [1, null, 1.189, 1.498, null, null, 1, null, 1.189, null, 1.782, null, 1, null, 1.189, 1.498],
        [1, null, 1.498, null, 1.189, null, 1, null, 1.782, null, 1.189, null, 1, null, 1.498, null]
      ];
      const ratio = (bar >= 6 ? [1, null, null, 1.189, null, null, 1.498, null, 1, null, null, 1.782, 1.498, null, null, null] : patterns[bar % patterns.length])[stepInBar];
      return ratio ? roots[bar] * ratio : null;
    }

    if (track === 2) {
      const roots = [65.41, 98.00, 55.00, 87.31, 65.41, 98.00, 87.31, 98.00];
      const patterns = [
        [1, null, 2, null, 1.5, null, 2, null, 1, null, 2, null, 1.5, null, null, 2],
        [1, null, 1.5, null, 2, null, 1.5, null, 1, null, 2, null, 1.5, null, 2, null],
        [1, null, 2, null, 1.2, null, 1.5, null, 1, null, 2, null, 1.5, null, 1.2, null],
        [1, null, 1.5, null, 2, null, null, 1.5, 1, null, 1.2, null, 1.5, null, 2, null]
      ];
      const ratio = (bar >= 6 ? [1, null, 1.5, null, null, null, 2, null, 1, null, 1.5, null, 2, null, null, null] : patterns[bar % patterns.length])[stepInBar];
      return ratio ? roots[bar] * ratio : null;
    }

    if (track === 3) {
      const roots = [43.65, 51.91, 38.89, 58.27, 43.65, 51.91, 46.25, 58.27];
      const patterns = [
        [1, null, 1, 1.5, null, null, 1, null, 1.5, null, 1, null, 2, null, 1.5, null],
        [1, null, 1, null, 1.5, null, 1, 2, null, null, 1, null, 1.5, null, 2, null],
        [1, null, 1.5, null, 1, null, 2, null, 1, null, 1.5, null, 1, 2, null, 1.5],
        [1, null, 1, null, 2, null, 1.5, null, 1, null, 1, 1.5, null, null, 2, null]
      ];
      const ratio = (bar >= 6 ? [1, null, null, null, 1.5, null, null, null, 1, null, null, null, 2, null, null, null] : patterns[bar % patterns.length])[stepInBar];
      return ratio ? roots[bar] * ratio : null;
    }

    if (track === 4) {
      const roots = [36.71, 41.20, 32.70, 36.71, 36.71, 41.20, 34.65, 41.20];
      const patterns = [
        [1, null, null, null, null, 1.5, null, null, 1, null, null, 2, null, null, null, null],
        [1, null, null, 1.5, null, null, null, null, 1, null, null, null, null, 2, null, null],
        [1, null, null, null, null, null, 1.5, null, null, null, 1, null, null, null, 2, null],
        [1, null, null, null, 1.5, null, null, 2, null, null, null, null, 1, null, null, null]
      ];
      const ratio = (bar >= 6 ? [1, null, null, null, null, null, null, null, 1.5, null, null, null, null, null, null, null] : patterns[bar % patterns.length])[stepInBar];
      return ratio ? roots[bar] * ratio : null;
    }

    if (track === 5) {
      // Regulatory Submission: F# minor, hypnotic single-note pulse
      const roots = [46.25, 46.25, 43.65, 46.25, 46.25, 43.65, 41.20, 43.65];
      const patterns = [
        [1, null, 1, null, 1, null, 1.189, null, 1, null, 1, null, 1.498, null, 1, null],
        [1, null, 1, null, 1.189, null, 1, null, 1, null, 1.498, null, 1, null, 1, null],
        [1, null, 1, 1.189, null, null, 1, null, 1.498, null, 1, null, 1, 1.189, null, null],
        [1, null, 1, null, 1, null, 1, null, 1, null, 1, null, 1, null, 1.498, null]
      ];
      const ratio = (bar >= 6 ? [1, null, 1, null, null, null, 1, null, null, null, 1.189, null, null, null, null, null] : patterns[bar % patterns.length])[stepInBar];
      return ratio ? roots[bar] * ratio : null;
    }

    return null;
  },

  getPatternNote(step, events, length = 128) {
    const idx = step % length;
    const hit = events.find(([pos]) => pos === idx);
    return hit ? hit[1] : null;
  },

  getMelodyNote(step) {
    const track = this.trackIdx || 0;
    const barInLoop = Math.floor(step / 16);
    const bar = barInLoop % 8;
    const phrase = Math.floor(barInLoop / 8);
    const stepInBar = step % 16;

    if (track === 0) {
      if (bar === 6) {
        return [440.00, null, null, 523.25, null, 659.25, null, null, 783.99, null, 659.25, null, 523.25, null, null, null][stepInBar];
      } else if (bar === 7) {
        return [493.88, null, 622.25, null, 739.99, null, null, 880.00, 987.77, null, 739.99, null, 622.25, null, 493.88, null][stepInBar];
      }
      return this.getPatternNote(step, [
        [0, 329.63], [3, 392.00], [6, 493.88], [10, 587.33], [12, 493.88], [15, 392.00],
        [17, 523.25], [20, 659.25], [23, 587.33], [26, 783.99], [29, 659.25],
        [32, 440.00], [35, 587.33], [38, 739.99], [42, 880.00], [45, 739.99], [47, 587.33],
        [49, 493.88], [52, 587.33], [55, 440.00], [58, 392.00], [61, 369.99],
        [64, 329.63], [67, 493.88], [70, 659.25], [74, 587.33], [76, 493.88], [79, 440.00],
        [81, 392.00], [84, 523.25], [87, 659.25], [90, 783.99], [93, 659.25],
        [96, 440.00], [99, 587.33], [102, 739.99], [106, 987.77], [109, 880.00], [111, 739.99],
        [113, 493.88], [116, 587.33], [119, 493.88], [122, 440.00], [125, 392.00]
      ]);
    }

    if (track === 1) {
      if (bar === 6) {
        return [587.33, null, 698.46, null, null, 880.00, null, 1046.50, 1174.66, null, 880.00, null, 698.46, null, null, null][stepInBar];
      } else if (bar === 7) {
        return [659.25, 830.61, null, 987.77, null, 1174.66, null, null, 1318.51, null, 987.77, null, 830.61, null, 659.25, null][stepInBar];
      }
      return this.getPatternNote(step, [
        [0, 440.00], [1, 523.25], [4, 659.25], [7, 587.33], [10, 523.25], [12, 659.25], [15, 783.99],
        [16, 349.23], [18, 523.25], [21, 587.33], [24, 440.00], [27, 523.25], [30, 698.46],
        [32, 392.00], [33, 493.88], [36, 659.25], [39, 587.33], [42, 493.88], [44, 587.33], [47, 783.99],
        [48, 415.30], [50, 587.33], [53, 659.25], [56, 493.88], [59, 587.33], [62, 830.61],
        [64, 440.00], [67, 523.25], [69, 659.25], [72, 783.99], [75, 659.25], [78, 587.33],
        [80, 349.23], [83, 440.00], [85, 587.33], [88, 698.46], [91, 587.33], [94, 523.25],
        [96, 392.00], [99, 493.88], [101, 659.25], [104, 783.99], [107, 659.25], [110, 587.33],
        [112, 415.30], [115, 493.88], [117, 659.25], [120, 830.61], [123, 739.99], [126, 659.25]
      ]);
    }

    if (track === 2) {
      if (bar === 6) {
        return [698.46, null, 880.00, null, 1046.50, null, null, 1318.51, 1396.91, null, 1046.50, null, 880.00, null, null, null][stepInBar];
      } else if (bar === 7) {
        return [783.99, null, 987.77, null, 1174.66, null, 1396.91, null, 1567.98, null, 1174.66, null, 987.77, null, 783.99, null][stepInBar];
      }
      return this.getPatternNote(step, [
        [0, 523.25], [2, 659.25], [5, 783.99], [8, 880.00], [11, 783.99], [14, 587.33],
        [16, 392.00], [19, 493.88], [22, 587.33], [24, 659.25], [27, 587.33], [30, 440.00],
        [32, 440.00], [34, 523.25], [37, 659.25], [40, 783.99], [43, 659.25], [46, 493.88],
        [48, 349.23], [51, 440.00], [54, 523.25], [56, 659.25], [59, 523.25], [62, 392.00],
        [64, 523.25], [67, 659.25], [69, 783.99], [72, 1046.50], [75, 880.00], [78, 659.25],
        [80, 392.00], [82, 493.88], [85, 587.33], [88, 783.99], [91, 659.25], [94, 493.88],
        [96, 440.00], [99, 523.25], [101, 659.25], [104, 880.00], [107, 783.99], [110, 659.25],
        [112, 349.23], [115, 440.00], [117, 523.25], [120, 698.46], [123, 659.25], [126, 523.25]
      ]);
    }

    if (track === 3) {
      if (bar === 6) {
        return [523.25, null, null, 622.25, null, null, 698.46, null, 783.99, null, null, 698.46, null, 622.25, null, null][stepInBar];
      } else if (bar === 7) {
        return [466.16, null, 523.25, null, 622.25, null, null, 698.46, 783.99, null, 698.46, null, 622.25, null, 523.25, null][stepInBar];
      }
      return this.getPatternNote(step, [
        [4, 523.25], [11, 622.25], [14, 698.46],
        [18, 523.25], [23, 783.99], [30, 622.25],
        [36, 466.16], [43, 622.25], [46, 698.46],
        [50, 587.33], [55, 698.46], [62, 523.25],
        [68, 523.25], [71, 622.25], [78, 783.99],
        [82, 523.25], [87, 932.33], [94, 783.99],
        [100, 466.16], [103, 622.25], [110, 698.46],
        [114, 587.33], [119, 698.46], [126, 523.25]
      ]);
    }

    if (track === 4) {
      if (bar === 6) {
        return [293.66, null, null, null, null, null, 349.23, null, null, null, null, null, 329.63, null, null, null][stepInBar];
      } else if (bar === 7) {
        return [261.63, null, null, null, 293.66, null, null, null, 329.63, null, null, null, null, null, 293.66, null][stepInBar];
      }
      return this.getPatternNote(step, [
        [0, 329.63], [7, 293.66], [14, 349.23],
        [22, 329.63], [30, 293.66],
        [36, 329.63], [44, 369.99], [50, 349.23],
        [58, 293.66],
        [66, 329.63], [74, 261.63], [80, 293.66],
        [88, 349.23], [95, 329.63],
        [100, 329.63], [110, 293.66], [118, 261.63],
        [124, 293.66]
      ]);
    }

    if (track === 5) {
      // F# minor: 32-bar minimal techno line, opening from sparse pings into an alarm motif.
      const phraseMotifs = [
        [
          [0, 369.99], [12, 493.88], [24, 415.30], [44, 329.63],
          [64, 369.99], [76, 554.37], [96, 415.30], [116, 493.88]
        ],
        [
          [128, 369.99], [134, 415.30], [140, 493.88], [148, 554.37],
          [160, 659.25], [168, 554.37], [176, 493.88], [184, 415.30],
          [192, 369.99], [204, 493.88], [212, 554.37], [220, 659.25], [236, 493.88], [248, 415.30]
        ],
        [
          [256, 739.99], [260, 659.25], [268, 554.37], [276, 493.88],
          [288, 554.37], [292, 659.25], [300, 739.99], [308, 880.00],
          [320, 739.99], [324, 659.25], [332, 554.37], [340, 493.88],
          [352, 415.30], [364, 493.88], [372, 554.37], [380, 659.25]
        ],
        [
          [384, 554.37], [388, 493.88], [392, 415.30], [396, 369.99],
          [400, 329.63], [408, 369.99], [416, 415.30], [424, 493.88],
          [432, 554.37], [436, 659.25], [440, 739.99], [444, 880.00],
          [448, 739.99], [456, 659.25], [464, 554.37], [472, 493.88],
          [480, 415.30], [488, 369.99], [496, 493.88], [504, 554.37]
        ]
      ];
      return this.getPatternNote(step, phraseMotifs[phrase] || phraseMotifs[0], 512);
    }

    return null;
  },

  playBassNote(freq, time, dur, step) {
    if (!this.ctx || !freq) return;
    const bar = Math.floor(step / 16);
    const stepInBar = step % 16;
    const track = this.trackIdx || 0;
    const isModern = track === 3;
    const isDowntempo = track === 4;

    const subOsc = this.ctx.createOscillator();
    subOsc.type = (isModern || isDowntempo) ? "sine" : "triangle";
    subOsc.frequency.setValueAtTime(freq / 2, time);

    const gritOsc = this.ctx.createOscillator();
    gritOsc.type = isModern ? "square" : "sawtooth";
    gritOsc.frequency.setValueAtTime(freq, time);
    gritOsc.detune.setValueAtTime(isDowntempo ? 15 : isModern ? 12 : 8, time);
    if (track === 1 && stepInBar % 4 !== 0) {
      const slideTime = Math.min(0.065, dur * 0.45);
      subOsc.frequency.setValueAtTime((freq / 2) * 0.92, time);
      subOsc.frequency.exponentialRampToValueAtTime(freq / 2, time + slideTime);
      gritOsc.frequency.setValueAtTime(freq * 0.92, time);
      gritOsc.frequency.exponentialRampToValueAtTime(freq, time + slideTime);
    }

    const dist = this.ctx.createWaveShaper();
    if (!this.distCurve || !this.heavyDistCurve || !this.dirtyDistCurve) {
      const n = 256;
      if (!this.distCurve) {
        const curve = new Float32Array(n);
        for (let i = 0; i < n; ++i) {
          const x = (i * 2) / n - 1;
          curve[i] = Math.tanh(x * 2.5);
        }
        this.distCurve = curve;
      }
      if (!this.heavyDistCurve) {
        const curve = new Float32Array(n);
        for (let i = 0; i < n; ++i) {
          const x = (i * 2) / n - 1;
          curve[i] = Math.tanh(x * 5.0) * 0.9 + Math.sin(x * Math.PI) * 0.1;
        }
        this.heavyDistCurve = curve;
      }
      if (!this.dirtyDistCurve) {
        const curve = new Float32Array(n);
        for (let i = 0; i < n; ++i) {
          const x = (i * 2) / n - 1;
          curve[i] = Math.sign(x) * Math.pow(Math.abs(x), 0.4) * 0.85 + Math.tanh(x * 4) * 0.15;
        }
        this.dirtyDistCurve = curve;
      }
    }
    dist.curve = isDowntempo ? this.dirtyDistCurve : isModern ? this.heavyDistCurve : this.distCurve;
    dist.oversample = "4x";

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    if (isDowntempo) {
      filter.Q.setValueAtTime(bar >= 6 ? 1.0 : 3.0, time);
      if (bar >= 6) {
        filter.frequency.setValueAtTime(350, time);
        filter.frequency.exponentialRampToValueAtTime(80, time + dur * 0.95);
      } else {
        filter.frequency.setValueAtTime(650, time);
        filter.frequency.exponentialRampToValueAtTime(100, time + dur * 0.9);
      }
    } else if (isModern) {
      filter.Q.setValueAtTime(bar >= 6 ? 2.0 : 5.5, time);
      if (bar >= 6) {
        filter.frequency.setValueAtTime(600, time);
        filter.frequency.exponentialRampToValueAtTime(120, time + dur * 0.9);
      } else {
        filter.frequency.setValueAtTime(1400, time);
        filter.frequency.exponentialRampToValueAtTime(160, time + dur * 0.8);
      }
    } else {
      filter.Q.setValueAtTime(bar >= 6 ? 1.4 : (track === 1 ? 6.2 : 2.8), time);
      if (bar >= 6) {
        filter.frequency.setValueAtTime(250, time);
        filter.frequency.exponentialRampToValueAtTime(100, time + dur * 0.95);
      } else {
        filter.frequency.setValueAtTime(track === 1 ? (stepInBar === 0 || stepInBar === 8 ? 1450 : 920) : 620, time);
        filter.frequency.exponentialRampToValueAtTime(100, time + dur * 0.85);
      }
    }

    const gain = this.ctx.createGain();
    const accent = (stepInBar === 0 || stepInBar === 8) ? 1.0 : 0.82;
    const peak = (isDowntempo ? 0.28 : isModern ? 0.32 : track === 1 ? 0.22 : 0.20) * accent;
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(peak, time + (isDowntempo ? 0.04 : isModern ? 0.005 : 0.015));
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    gritOsc.connect(dist);
    dist.connect(filter);
    subOsc.connect(filter);

    filter.connect(gain);
    gain.connect(this.musicGain);

    subOsc.start(time);
    subOsc.stop(time + dur + 0.02);
    gritOsc.start(time);
    gritOsc.stop(time + dur + 0.02);
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

  playDowntempoPad(freqs, time, dur) {
    if (!this.ctx || this.muted) return;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.setValueAtTime(0.8, time);
    filter.frequency.setValueAtTime(900, time);
    filter.frequency.linearRampToValueAtTime(1400, time + dur * 0.4);
    filter.frequency.exponentialRampToValueAtTime(400, time + dur);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.06, time + dur * 0.15);
    gain.gain.setValueAtTime(0.05, time + dur * 0.5);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    freqs.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, time);
      osc.detune.setValueAtTime((idx - 1.5) * 12 + Math.sin(idx * 2.1) * 5, time);
      const osc2 = this.ctx.createOscillator();
      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(freq * 1.002, time);
      osc2.detune.setValueAtTime((idx - 1.5) * -8, time);
      const osc2Gain = this.ctx.createGain();
      osc2Gain.gain.value = 0.6;
      osc.connect(filter);
      osc2.connect(osc2Gain);
      osc2Gain.connect(filter);
      osc.start(time);
      osc.stop(time + dur + 0.05);
      osc2.start(time);
      osc2.stop(time + dur + 0.05);
    });
    filter.connect(gain);
    if (this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.frequency.value = 0.15;
      lfoGain.gain.value = 0.3;
      lfo.connect(lfoGain);
      lfoGain.connect(panner.pan);
      lfo.start(time);
      lfo.stop(time + dur + 0.05);
      gain.connect(panner);
      panner.connect(this.musicGain);
    } else {
      gain.connect(this.musicGain);
    }
  },

  playJunoPad(freqs, time, dur) {
    if (!this.ctx || this.muted) return;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.setValueAtTime(1.2, time);
    filter.frequency.setValueAtTime(1200, time);
    filter.frequency.linearRampToValueAtTime(2200, time + dur * 0.35);
    filter.frequency.exponentialRampToValueAtTime(600, time + dur);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.038, time + dur * 0.12);
    gain.gain.setValueAtTime(0.032, time + dur * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    freqs.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, time);
      osc.detune.setValueAtTime((idx - 1) * 7 + rand(-3, 3), time);
      const osc2 = this.ctx.createOscillator();
      osc2.type = "sawtooth";
      osc2.frequency.setValueAtTime(freq, time);
      osc2.detune.setValueAtTime((idx - 1) * -7 + rand(-3, 3), time);
      osc.connect(filter);
      osc2.connect(filter);
      osc.start(time);
      osc.stop(time + dur + 0.05);
      osc2.start(time);
      osc2.stop(time + dur + 0.05);
    });
    const chorus = this.ctx.createDelay(0.03);
    chorus.delayTime.setValueAtTime(0.012, time);
    const chorusLfo = this.ctx.createOscillator();
    const chorusDepth = this.ctx.createGain();
    chorusLfo.frequency.value = 0.8;
    chorusDepth.gain.value = 0.003;
    chorusLfo.connect(chorusDepth);
    chorusDepth.connect(chorus.delayTime);
    chorusLfo.start(time);
    chorusLfo.stop(time + dur + 0.05);
    filter.connect(chorus);
    chorus.connect(gain);
    filter.connect(gain);
    gain.connect(this.musicGain);
  },

  playRhodesPad(freqs, time, dur) {
    if (!this.ctx || this.muted) return;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.05, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.025, time + dur * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    freqs.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, time);
      const osc2 = this.ctx.createOscillator();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(freq * 2, time);
      const osc2g = this.ctx.createGain();
      osc2g.gain.setValueAtTime(0.3, time);
      osc2g.gain.exponentialRampToValueAtTime(0.02, time + dur * 0.5);
      const osc3 = this.ctx.createOscillator();
      osc3.type = "sine";
      osc3.frequency.setValueAtTime(freq * 3.01, time);
      const osc3g = this.ctx.createGain();
      osc3g.gain.setValueAtTime(0.12, time);
      osc3g.gain.exponentialRampToValueAtTime(0.001, time + dur * 0.25);
      osc.connect(gain);
      osc2.connect(osc2g);
      osc2g.connect(gain);
      osc3.connect(osc3g);
      osc3g.connect(gain);
      osc.start(time);
      osc.stop(time + dur + 0.03);
      osc2.start(time);
      osc2.stop(time + dur + 0.03);
      osc3.start(time);
      osc3.stop(time + dur + 0.03);
    });
    if (this.ctx.createStereoPanner) {
      const pan = this.ctx.createStereoPanner();
      pan.pan.setValueAtTime(rand(-0.3, 0.3), time);
      gain.connect(pan);
      pan.connect(this.musicGain);
    } else {
      gain.connect(this.musicGain);
    }
  },

  playChiptuneArp(freqs, time, dur) {
    if (!this.ctx || this.muted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = "square";

    const pwmLfo = this.ctx.createOscillator();
    const pwmGain = this.ctx.createGain();
    pwmLfo.frequency.value = 3.2;
    pwmGain.gain.value = 18;
    pwmLfo.connect(pwmGain);
    pwmGain.connect(osc.detune);
    pwmLfo.start(time);
    pwmLfo.stop(time + dur + 0.02);

    const arpSpeed = 0.042;
    let t = time;
    let idx = 0;
    while (t < time + dur) {
      const freq = freqs[idx % freqs.length];
      const prevFreq = idx > 0 ? freqs[(idx - 1) % freqs.length] : freq;
      if (idx > 0 && Math.abs(freq - prevFreq) > 20) {
        osc.frequency.setValueAtTime(prevFreq, t);
        osc.frequency.exponentialRampToValueAtTime(freq, t + arpSpeed * 0.3);
      } else {
        osc.frequency.setValueAtTime(freq, t);
      }
      idx++;
      t += arpSpeed;
    }

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.05, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    osc.connect(gain);
    gain.connect(this.musicGain);

    osc.start(time);
    osc.stop(time + dur + 0.02);
  },

  playHouseChord(freqs, time, dur) {
    if (!this.ctx || this.muted) return;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.setValueAtTime(3.2, time);
    filter.frequency.setValueAtTime(3200, time);
    filter.frequency.exponentialRampToValueAtTime(450, time + dur * 0.85);

    const dist = this.ctx.createWaveShaper();
    const n = 256;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; ++i) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(x * 2.0);
    }
    dist.curve = curve;
    dist.oversample = "2x";

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.13, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.028, time + dur * 0.45);
    gain.gain.linearRampToValueAtTime(0.078, time + dur * 0.72);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    const oscillators = freqs.map((freq, idx) => {
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, time);
      osc.detune.setValueAtTime((idx - 1.5) * 8 + (Math.random() * 4 - 2), time);
      osc.connect(dist);
      osc.start(time);
      osc.stop(time + dur + 0.03);

      const osc2 = this.ctx.createOscillator();
      osc2.type = "square";
      osc2.frequency.setValueAtTime(freq, time);
      osc2.detune.setValueAtTime((idx - 1.5) * -6, time);
      const osc2Gain = this.ctx.createGain();
      osc2Gain.gain.value = 0.3;
      osc2.connect(osc2Gain);
      osc2Gain.connect(dist);
      osc2.start(time);
      osc2.stop(time + dur + 0.03);

      return osc;
    });

    dist.connect(filter);
    filter.connect(gain);

    if (this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime(0.22, time);
      gain.connect(panner);
      panner.connect(this.musicGain);
    } else {
      gain.connect(this.musicGain);
    }
    return oscillators;
  },

  playMelodyNote(freq, time, dur) {
    if (!this.ctx) return;
    const track = this.trackIdx || 0;
    const isModern = track === 3;
    const isDowntempo = track === 4;
    const isMinimal = track === 5;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = isMinimal ? "sine" : isDowntempo ? "sawtooth" : track === 1 ? "sawtooth" : isModern ? "sawtooth" : "triangle";
    osc.frequency.setValueAtTime(freq, time);
    if (isModern) osc.detune.setValueAtTime(6, time);
    if (isDowntempo) {
      const drift = rand(-7, 7);
      osc.detune.setValueAtTime(drift, time);
      osc.detune.linearRampToValueAtTime(drift + rand(-5, 5), time + dur);
    }

    const vibrato = this.ctx.createOscillator();
    const vibratoGain = this.ctx.createGain();
    vibrato.frequency.value = isMinimal ? 2.0 : isDowntempo ? 2.8 : isModern ? 3.5 : 5.4;
    vibratoGain.gain.value = isMinimal ? 1.8 : isDowntempo ? 6.0 : isModern ? 3.5 : track === 1 ? 2.8 : 2.2;

    vibrato.connect(vibratoGain);
    vibratoGain.connect(osc.frequency);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    if (isDowntempo) {
      filter.frequency.setValueAtTime(1200, time);
      filter.frequency.linearRampToValueAtTime(1800, time + dur * 0.3);
      filter.frequency.exponentialRampToValueAtTime(400, time + dur);
      filter.Q.setValueAtTime(4.0, time);
    } else {
      filter.frequency.setValueAtTime(isModern ? 2800 : 2100, time);
      filter.frequency.exponentialRampToValueAtTime(isModern ? 600 : 900, time + dur);
      if (isModern) filter.Q.setValueAtTime(2.5, time);
    }

    const peakVol = isMinimal ? 0.095 : isDowntempo ? 0.09 : track === 2 ? 0.105 : isModern ? 0.10 : 0.085;
    gain.gain.setValueAtTime(0.001, time);
    if (isModern) {
      gain.gain.linearRampToValueAtTime(peakVol, time + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.035, time + dur * 0.35);
      gain.gain.linearRampToValueAtTime(peakVol * 0.72, time + dur * 0.65);
      gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    } else {
      gain.gain.linearRampToValueAtTime(peakVol, time + (isDowntempo ? 0.06 : 0.02));
      gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    }

    vibrato.start(time);
    osc.connect(filter);

    if (isModern) {
      const osc2 = this.ctx.createOscillator();
      osc2.type = "square";
      osc2.frequency.setValueAtTime(freq, time);
      osc2.detune.setValueAtTime(-8, time);
      const osc2Gain = this.ctx.createGain();
      osc2Gain.gain.value = 0.25;
      osc2.connect(osc2Gain);
      osc2Gain.connect(filter);
      osc2.start(time);
      osc2.stop(time + dur + 0.02);
    }

    if (isDowntempo) {
      const osc2 = this.ctx.createOscillator();
      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(freq * 2.01, time);
      osc2.detune.setValueAtTime(rand(-10, 10), time);
      osc2.detune.linearRampToValueAtTime(rand(-8, 8), time + dur);
      const osc2Gain = this.ctx.createGain();
      osc2Gain.gain.value = 0.15;
      osc2.connect(osc2Gain);
      osc2Gain.connect(filter);
      osc2.start(time);
      osc2.stop(time + dur + 0.02);
    }

    filter.connect(gain);

    const stepDur = 60.0 / this.tempo / 4.0;
    const delay = this.ctx.createDelay(2.0);
    delay.delayTime.setValueAtTime(isDowntempo ? stepDur * 6 : stepDur * 3, time);

    const feedbackGain = isDowntempo ? 0.40 : isModern ? 0.30 : 0.22;
    const delayGain = this.ctx.createGain();
    delayGain.gain.setValueAtTime(feedbackGain, time);
    delayGain.gain.exponentialRampToValueAtTime(0.0001, time + dur * (isDowntempo ? 4.0 : 2.5));

    delay.connect(delayGain);
    delayGain.connect(delay);

    gain.connect(this.musicGain);
    gain.connect(delay);

    if (this.ctx.createStereoPanner) {
      const delayPanner = this.ctx.createStereoPanner();
      delayPanner.pan.setValueAtTime(isDowntempo ? -0.5 : isModern ? -0.35 : 0.4, time);
      delayGain.connect(delayPanner);
      delayPanner.connect(this.musicGain);
    } else {
      delayGain.connect(this.musicGain);
    }

    const stopTime = time + dur + 0.02;
    osc.start(time);
    osc.stop(stopTime);
    vibrato.stop(stopTime);
  },

  playRetroKick(time, heavy = false) {
    if (!this.ctx || this.muted) return;
    const track = this.trackIdx || 0;
    const isModern = track === 3 || heavy;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";

    if (isModern) {
      osc.frequency.setValueAtTime(180, time);
      osc.frequency.exponentialRampToValueAtTime(38, time + 0.12);
    } else {
      osc.frequency.setValueAtTime(150, time);
      osc.frequency.exponentialRampToValueAtTime(45, time + 0.08);
    }

    const peakVol = isModern ? 0.52 : 0.35;
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(peakVol, time + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.001, time + (isModern ? 0.18 : 0.08));

    osc.connect(gain);

    if (isModern) {
      const clickOsc = this.ctx.createOscillator();
      const clickGain = this.ctx.createGain();
      clickOsc.type = "triangle";
      clickOsc.frequency.setValueAtTime(4200, time);
      clickOsc.frequency.exponentialRampToValueAtTime(200, time + 0.015);
      clickGain.gain.setValueAtTime(0.001, time);
      clickGain.gain.linearRampToValueAtTime(0.18, time + 0.001);
      clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.025);
      clickOsc.connect(clickGain);
      clickGain.connect(this.musicGain);
      clickOsc.start(time);
      clickOsc.stop(time + 0.03);

      const dist = this.ctx.createWaveShaper();
      const n = 128;
      const curve = new Float32Array(n);
      for (let i = 0; i < n; ++i) {
        const x = (i * 2) / n - 1;
        curve[i] = Math.tanh(x * 3.5);
      }
      dist.curve = curve;
      dist.oversample = "2x";
      gain.connect(dist);
      dist.connect(this.musicGain);
    } else {
      gain.connect(this.musicGain);
    }

    osc.start(time);
    osc.stop(time + (isModern ? 0.2 : 0.095));
  },

  playRetroHiHat(time, open = false) {
    if (!this.ctx || this.muted) return;
    const track = this.trackIdx || 0;
    const dur = open ? 0.09 : (track === 3 ? 0.045 : 0.035);
    const bufferSize = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const env = open ? Math.pow(1 - i / bufferSize, 1.5) : (1 - i / bufferSize);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(track === 3 ? 8500 : 7500, time);
    filter.Q.setValueAtTime(track === 3 ? 1.2 : 0.7, time);

    const gain = this.ctx.createGain();
    const vol = track === 3 ? 0.06 : 0.04;
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);

    src.start(time);
  },

  playRetroSnare(time, volScale = 1.0) {
    if (!this.ctx) return;
    const track = this.trackIdx || 0;
    const isModern = track === 3;
    const dur = isModern ? 0.14 : 0.08;
    const bufferSize = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const env = isModern ? Math.pow(1 - i / bufferSize, 1.8) : Math.pow(1 - i / bufferSize, 2);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = isModern ? "peaking" : "bandpass";
    filter.frequency.setValueAtTime(isModern ? 1800 : 1000, time);
    if (isModern) filter.gain.setValueAtTime(6, time);

    const gain = this.ctx.createGain();
    const baseVol = isModern ? 0.09 : 0.05;
    gain.gain.setValueAtTime(baseVol * volScale, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    src.connect(filter);
    filter.connect(gain);

    if (isModern) {
      const bodyOsc = this.ctx.createOscillator();
      const bodyGain = this.ctx.createGain();
      bodyOsc.type = "triangle";
      bodyOsc.frequency.setValueAtTime(220, time);
      bodyOsc.frequency.exponentialRampToValueAtTime(120, time + 0.04);
      bodyGain.gain.setValueAtTime(0.001, time);
      bodyGain.gain.linearRampToValueAtTime(0.12 * volScale, time + 0.002);
      bodyGain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
      bodyOsc.connect(bodyGain);
      bodyGain.connect(this.musicGain);
      bodyOsc.start(time);
      bodyOsc.stop(time + 0.07);
    }

    gain.connect(this.musicGain);
    src.start(time);
  },

  playClap(time, volScale = 1.0) {
    if (!this.ctx || this.muted) return;
    const layers = 3;
    for (let l = 0; l < layers; l++) {
      const offset = l * 0.012;
      const dur = 0.065;
      const bufferSize = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2.5);
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(1400 + l * 400, time + offset);
      filter.Q.setValueAtTime(2.0, time + offset);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.06 * volScale, time + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, time + offset + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.musicGain);
      src.start(time + offset);
    }
  },

  playCrashCymbal(time) {
    if (!this.ctx || this.muted) return;
    const dur = 0.45;
    const bufferSize = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 1.8);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(5000, time);
    hp.frequency.exponentialRampToValueAtTime(2800, time + dur);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.06, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    src.connect(hp);
    hp.connect(gain);
    gain.connect(this.musicGain);
    src.start(time);
  },

  // Dragon fire breath sound
  dragonBreath() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const dur = 0.5;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = 1 - i / len;
      data[i] = (Math.random() * 2 - 1) * env * (0.3 + 0.7 * (i / len));
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(800, t);
    filter.frequency.exponentialRampToValueAtTime(120, t + dur);
    filter.Q.value = 2;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    src.start(t);
  },

  // Japanese Taiko drum
  playTaiko(time, intensity = 0) {
    if (!this.ctx || this.muted) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(110 - intensity * 30, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    g.gain.setValueAtTime(0.001, time);
    g.gain.linearRampToValueAtTime(0.28 + intensity * 0.1, time + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.35 + intensity * 0.1);
    osc.connect(g);
    g.connect(this.musicGain);
    osc.start(time);
    osc.stop(time + 0.4);

    // Noise crack
    const ndur = 0.08;
    const nlen = Math.max(1, Math.floor(this.ctx.sampleRate * ndur));
    const nbuf = this.ctx.createBuffer(1, nlen, this.ctx.sampleRate);
    const ndata = nbuf.getChannelData(0);
    for (let i = 0; i < nlen; i++) ndata[i] = (Math.random() * 2 - 1) * (1 - i / nlen);
    const nsrc = this.ctx.createBufferSource();
    nsrc.buffer = nbuf;
    const nfilter = this.ctx.createBiquadFilter();
    nfilter.type = "lowpass";
    nfilter.frequency.value = 400 + intensity * 200;
    const ngain = this.ctx.createGain();
    ngain.gain.setValueAtTime(0.08 + intensity * 0.04, time);
    ngain.gain.exponentialRampToValueAtTime(0.001, time + ndur);
    nsrc.connect(nfilter);
    nfilter.connect(ngain);
    ngain.connect(this.musicGain);
    nsrc.start(time);
  },

  // Japanese Koto / Shamisen pluck
  playKotoPluck(freq, time, dur = 0.35, vol = 0.14) {
    if (!this.ctx || this.muted) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, time);
    g.gain.setValueAtTime(0.001, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);

    // Quick pitch bend (pluck attack)
    osc.frequency.exponentialRampToValueAtTime(freq * 1.015, time + 0.02);
    osc.frequency.exponentialRampToValueAtTime(freq, time + 0.06);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2800, time);
    filter.frequency.exponentialRampToValueAtTime(900, time + dur * 0.6);

    osc.connect(filter);
    filter.connect(g);
    g.connect(this.musicGain);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  },

  // Traditional Japanese flute (Shakuhachi-ish)
  playShakuhachi(freq, time, dur = 0.5, vol = 0.13) {
    if (!this.ctx || this.muted) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, time);
    // Shakuhachi breath wobble
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 5.5;
    lfoGain.gain.value = freq * 0.015;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1800, time);
    filter.frequency.exponentialRampToValueAtTime(600, time + dur);
    filter.Q.value = 1.5;

    g.gain.setValueAtTime(0.001, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);

    osc.connect(filter);
    filter.connect(g);
    g.connect(this.musicGain);
    osc.start(time);
    lfo.start(time);
    osc.stop(time + dur + 0.02);
    lfo.stop(time + dur + 0.02);
  },

  // Bass drone (intensifies)
  playBassDrone(freq, time, dur = 0.6, vol = 0.08) {
    if (!this.ctx || this.muted) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, time);
    g.gain.setValueAtTime(0.001, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(400, time);
    filter.frequency.exponentialRampToValueAtTime(120, time + dur);

    osc.connect(filter);
    filter.connect(g);
    g.connect(this.musicGain);
    osc.start(time);
    osc.stop(time + dur + 0.02);
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
      // At low intensity, mix in shakuhachi for atmosphere (especially at bar boundaries)
      if (intensity < 0.3 && stepInBar === 0 && bar % 4 === 0) {
        this.playShakuhachi(freq * 0.5, time, 0.8, 0.10);
      } else if (intensity > 0.7 && bar % 2 === 0 && stepInBar % 2 === 0) {
        // At high intensity, double up with a second koto an octave higher for shimmer
        this.playKotoPluck(freq, time, 0.25, 0.10 + intensity * 0.04);
        if (Math.random() > 0.35) {
          this.playKotoPluck(freq * 2, time + stepDur * 0.5, 0.2, 0.06);
        }
      } else {
        this.playKotoPluck(freq, time, 0.35 + intensity * 0.3, 0.10 + intensity * 0.04);
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
      this.playShakuhachi(fillNote, time, 0.45, 0.08);
    }
    // Climax trills
    if (intensity > 0.82 && (stepInBar % 2 === 0)) {
      const trillNote = this._jpNotes[5 + (step % 5)];
      this.playShakuhachi(trillNote, time, 0.18, 0.065);
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
    const t0 = ctx.currentTime + 0.05;
    const bpm = 110;
    const beat = 60 / bpm;
    const sixteenth = beat / 4;
    const themeDur = beat * 64; // 16 bars: talkbox pass, then angel-choir pass
    this._titleLoopCount++;

    const outGain = ctx.createGain();
    outGain.gain.value = 0.15; // Lowered overall volume
    outGain.connect(this.master);
    this.titleThemeNodes.push(outGain);
    setTimeout(() => {
      const idx = this.titleThemeNodes.indexOf(outGain);
      if (idx >= 0) this.titleThemeNodes.splice(idx, 1);
      try { outGain.disconnect(); } catch (e) {}
    }, themeDur * 1000 + 500);

    if (this.musicGain) {
      const now = ctx.currentTime;
      this.musicGain.gain.cancelScheduledValues(now);
      this.musicGain.gain.setValueAtTime(Math.max(0.0001, this.musicGain.gain.value), now);
      this.musicGain.gain.linearRampToValueAtTime(this.musicBaseGain * this.musicVolume * 0.15, now + 0.15);
    }

    const note = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
    const connectPan = (src, dest, pan = 0) => {
      if (ctx.createStereoPanner && pan !== 0) {
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        src.connect(p);
        p.connect(dest);
      } else {
        src.connect(dest);
      }
    };

    const scheduleTone = (freq, start, dur, type, vol, opts = {}) => {
      const time = t0 + start;
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
      connectPan(gain, outGain, opts.pan || 0);
      osc.start(time);
      osc.stop(time + dur + 0.02);
    };

    const scheduleNoise = (start, dur, vol, hpFreq, opts = {}) => {
      const time = t0 + start;
      const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, opts.decay || 1.2);
      const src = ctx.createBufferSource();
      const hp = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      src.buffer = buffer;
      hp.type = "highpass";
      hp.frequency.value = hpFreq;
      gain.gain.setValueAtTime(vol, time);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      src.connect(hp);
      hp.connect(gain);
      connectPan(gain, outGain, opts.pan || 0);
      src.start(time);
    };

    // Drums: 64 beats
    const kick = (start) => {
      scheduleTone(70, start, 0.25, "sine", 0.45, { freqEnd: 30, cutoff: 1000, attack: 0.002, release: 0.18 });
      scheduleNoise(start, 0.04, 0.08, 800, { decay: 5 });
    };
    const snare = (start) => {
      scheduleNoise(start, 0.18, 0.18, 1200, { pan: -0.05, decay: 1.5 });
      scheduleTone(190, start, 0.12, "triangle", 0.08, { freqEnd: 120, cutoff: 900, attack: 0.002, release: 0.1 });
    };
    const hat = (start, open = false) => {
      scheduleNoise(start, open ? 0.2 : 0.05, open ? 0.07 : 0.04, open ? 5000 : 6500, { pan: open ? 0.2 : -0.2, decay: open ? 1.2 : 4.0 });
    };

    for (let b = 0; b < 64; b++) {
      kick(b * beat);
      if (b % 2 === 1) snare(b * beat);
      for (let h = 0; h < 4; h++) {
        if (h !== 0) hat(b * beat + h * sixteenth, h === 2);
      }
    }

    // Bass: Am - F - C - G (8 beats each)
    const bassRoots = [33, 29, 36, 31];
    for (let bar = 0; bar < 16; bar++) {
      const root = bassRoots[Math.floor((bar % 8) / 2)];
      for (let i = 0; i < 8; i++) {
        if (i === 7 && bar % 2 === 1) continue; // syncopation rest
        scheduleTone(note(root), bar * 4 * beat + i * (beat / 2), beat / 2 * 0.85, "sawtooth", 0.12, {
          cutoff: 450, cutoffEnd: 900, q: 1.8, attack: 0.005, release: 0.08
        });
      }
    }

    // Chords: Am7 - Fmaj7 - Cmaj7 - G
    const chordProgs = [
      [45, 48, 52, 55], // Am7
      [41, 45, 48, 52], // Fmaj7
      [48, 52, 55, 59], // Cmaj7
      [43, 47, 50, 54], // G
    ];
    for (let pass = 0; pass < 2; pass++) {
      chordProgs.forEach((chord, idx) => {
        chord.forEach((m, v) => {
          scheduleTone(note(m), (pass * 32 + idx * 8) * beat, 8 * beat, "sawtooth", pass === 0 ? 0.035 : 0.03, {
            cutoff: 800 + v * 150, cutoffEnd: pass === 0 ? 2400 + v * 150 : 3000 + v * 180,
            q: 0.6, attack: 0.2, release: 1.2, pan: (v - 1.5) * 0.25
          });
        });
      });
    }

    // Arp: 16th notes
    for (let bar = 0; bar < 16; bar++) {
      const chord = chordProgs[Math.floor((bar % 8) / 2)];
      for (let i = 0; i < 16; i++) {
        const m = chord[i % 4] + 12; // up an octave
        scheduleTone(note(m), bar * 4 * beat + i * sixteenth, sixteenth * 0.6, "square", 0.025, {
          cutoff: 1800, cutoffEnd: 4500, q: 2.2, attack: 0.005, release: 0.05, pan: i % 2 ? 0.35 : -0.35
        });
      }
    }

    // ---- TALKBOX: "Rrrrreeegulaido!" ----
    const playTalkbox = (startBeat) => {
      const tStart = t0 + startBeat * beat;
      const dur = 4.5 * beat;
      const tbGain = ctx.createGain();
      tbGain.connect(outGain);

      // 1. Carrier (Vocal Cords)
      const carrierGain = ctx.createGain();
      carrierGain.gain.value = 0.24;

      const saws = [-8, -4, 0, 4, 8].map(detune => {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.detune.value = detune;
        osc.start(tStart);
        osc.stop(tStart + dur);

        // Melody: G2(43) -> F#2(42) -> E2(40) -> D2(38).
        // This is low enough to feel robotic, but still has usable harmonics for speech.
        osc.frequency.setValueAtTime(note(43), tStart);
        osc.frequency.setTargetAtTime(note(42), tStart + 1.5 * beat, 0.03);
        osc.frequency.setTargetAtTime(note(40), tStart + 2.0 * beat, 0.03);
        osc.frequency.setTargetAtTime(note(38), tStart + 3.0 * beat, 0.03);

        osc.connect(carrierGain);
        return osc;
      });

      // Add a sub-oscillator for extra body
      const sub = ctx.createOscillator();
      sub.type = "sawtooth"; // Changed to sawtooth for less harshness than square
      sub.start(tStart);
      sub.stop(tStart + dur);
      // Sub supports the voice an octave below without becoming pure rumble.
      sub.frequency.setValueAtTime(note(31), tStart);
      sub.frequency.setTargetAtTime(note(30), tStart + 1.5 * beat, 0.03);
      sub.frequency.setTargetAtTime(note(28), tStart + 2.0 * beat, 0.03);
      sub.frequency.setTargetAtTime(note(26), tStart + 3.0 * beat, 0.03);
      const subGain = ctx.createGain();
      subGain.gain.value = 0.1;
      sub.connect(subGain);
      subGain.connect(carrierGain);

      // 2. Formant Filters (Mouth/Throat)
      const f1 = ctx.createBiquadFilter(); f1.type = "bandpass"; f1.Q.value = 6;
      const f2 = ctx.createBiquadFilter(); f2.type = "bandpass"; f2.Q.value = 4;
      const f3 = ctx.createBiquadFilter(); f3.type = "bandpass"; f3.Q.value = 3;

      carrierGain.connect(f1);
      carrierGain.connect(f2);
      carrierGain.connect(f3);

      const filterMix = ctx.createGain();
      filterMix.gain.value = 2.4;
      f1.connect(filterMix);
      f2.connect(filterMix);
      f3.connect(filterMix);

      // Lowpass to remove shrillness
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 3000;
      lp.Q.value = 0.2;
      filterMix.connect(lp);
      lp.connect(tbGain);

      // Formant Automation (lowered slightly for a deeper voice)
      const setFormant = (timeOffset, f1Freq, f2Freq, f3Freq, rampTime = 0.1) => {
        const t = tStart + timeOffset;
        f1.frequency.setTargetAtTime(f1Freq * 0.82, t, rampTime);
        f2.frequency.setTargetAtTime(f2Freq * 0.82, t, rampTime);
        f3.frequency.setTargetAtTime(f3Freq * 0.82, t, rampTime);
      };

      // Initial Rrrrr
      f1.frequency.setValueAtTime(320 * 0.82, tStart);
      f2.frequency.setValueAtTime(1200 * 0.82, tStart);
      f3.frequency.setValueAtTime(1500 * 0.82, tStart);

      setFormant(0.5 * beat, 270, 2300, 3000, 0.05); // eee
      setFormant(1.5 * beat, 300, 870, 2240, 0.03);  // gu
      setFormant(2.0 * beat, 360, 1300, 2600, 0.03); // l
      setFormant(2.2 * beat, 730, 1090, 2440, 0.03); // a
      setFormant(2.5 * beat, 270, 2300, 3000, 0.05); // i
      setFormant(3.0 * beat, 500, 800, 2400, 0.03);  // do

      // 3. Consonants (Noise Bursts)
      const playBurst = (timeOffset, duration, hpFreq, lpFreq, vol) => {
        const t = tStart + timeOffset;
        const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for(let i=0; i<len; i++) data[i] = Math.random() * 2 - 1;

        const src = ctx.createBufferSource();
        src.buffer = buf;

        const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = hpFreq;
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = lpFreq;

        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(vol, t + 0.01);
        env.gain.exponentialRampToValueAtTime(0.0001, t + duration);

        // Connect consonants directly to outGain to bypass the talkbox lowpass filter
        src.connect(hp); hp.connect(lp); lp.connect(env); env.connect(outGain);
        src.start(t);
      };

      // 'g' burst (harder, more mid-heavy)
      playBurst(1.45 * beat, 0.15, 800, 2500, 0.15);
      // 'd' burst (sharper, higher)
      playBurst(2.95 * beat, 0.12, 2500, 5000, 0.15);

      // 'R' rolling noise
      const rDur = 0.6 * beat;
      const rLen = Math.floor(ctx.sampleRate * rDur);
      const rBuf = ctx.createBuffer(1, rLen, ctx.sampleRate);
      const rData = rBuf.getChannelData(0);
      for(let i=0; i<rLen; i++) rData[i] = Math.random() * 2 - 1;
      const rSrc = ctx.createBufferSource();
      rSrc.buffer = rBuf;
      const rHp = ctx.createBiquadFilter(); rHp.type = "highpass"; rHp.frequency.value = 600;
      const rLp = ctx.createBiquadFilter(); rLp.type = "lowpass"; rLp.frequency.value = 1800;
      const rEnv = ctx.createGain();
      rEnv.gain.setValueAtTime(0.0001, tStart);
      rEnv.gain.linearRampToValueAtTime(0.045, tStart + 0.035);
      rEnv.gain.setValueAtTime(0.045, tStart + rDur * 0.45);
      rEnv.gain.linearRampToValueAtTime(0.0001, tStart + rDur);

      rSrc.connect(rHp); rHp.connect(rLp); rLp.connect(rEnv); rEnv.connect(outGain);
      rSrc.start(tStart);

      // Overall amplitude envelope (kept low to sit nicely in the mix)
      tbGain.gain.setValueAtTime(0.0001, tStart);
      tbGain.gain.linearRampToValueAtTime(0.36, tStart + 0.1);
      tbGain.gain.setValueAtTime(0.36, tStart + dur - 0.5);
      tbGain.gain.linearRampToValueAtTime(0.0001, tStart + dur);

      // Disconnect all nodes after the phrase ends to prevent ringing into next loop
      setTimeout(() => {
        try { tbGain.disconnect(); filterMix.disconnect(); lp.disconnect();
              f1.disconnect(); f2.disconnect(); f3.disconnect();
              carrierGain.disconnect(); } catch(e) {}
      }, (tStart - ctx.currentTime + dur + 0.1) * 1000);
    };

    const playAngelChoir = (startBeat) => {
      const tStart = t0 + startBeat * beat;
      const phraseDur = 7.6 * beat;
      const choirOut = ctx.createGain();
      choirOut.gain.setValueAtTime(0.0001, tStart);
      choirOut.gain.linearRampToValueAtTime(1.2, tStart + 0.45);
      choirOut.gain.setValueAtTime(1.2, tStart + phraseDur - 0.8);
      choirOut.gain.linearRampToValueAtTime(0.0001, tStart + phraseDur);
      choirOut.connect(outGain);

      const phonemes = [
        [0.00, 0.28, [320, 1200, 1500]],  // Rrr
        [0.28, 0.38, [270, 2300, 3000]],  // ee
        [0.66, 0.26, [300, 870, 2240]],   // gu
        [0.92, 0.24, [360, 1300, 2600]],  // l
        [1.16, 0.36, [730, 1090, 2440]],  // a
        [1.52, 0.32, [270, 2300, 3000]],  // i
        [1.84, 1.25, [500, 800, 2400]],   // do
      ];
      const melody = [
        [0.00, 67],
        [0.66, 69],
        [1.16, 72],
        [1.84, 74],
        [2.75, 76],
      ];
      const choirVoices = [
        { offset: -12, pan: -0.6, gain: 0.16 },
        { offset: -5, pan: -0.25, gain: 0.13 },
        { offset: 0, pan: 0.25, gain: 0.11 },
        { offset: 7, pan: 0.6, gain: 0.09 },
      ];

      const playChoirBurst = (timeOffset, duration, hpFreq, lpFreq, vol, pan = 0) => {
        const t = tStart + timeOffset;
        const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.8);

        const src = ctx.createBufferSource();
        const hp = ctx.createBiquadFilter();
        const lp = ctx.createBiquadFilter();
        const env = ctx.createGain();
        src.buffer = buf;
        hp.type = "highpass";
        hp.frequency.value = hpFreq;
        lp.type = "lowpass";
        lp.frequency.value = lpFreq;
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(vol, t + 0.012);
        env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        src.connect(hp);
        hp.connect(lp);
        lp.connect(env);
        connectPan(env, choirOut, pan);
        src.start(t);
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
        oscA.type = "sawtooth";
        oscB.type = "sawtooth";
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
        voiceGain.connect(air);
        air.connect(warm);
        connectPan(warm, choirOut, voice.pan);
        oscA.start(tStart); oscB.start(tStart);
        oscA.stop(tStart + phraseDur + 0.1); oscB.stop(tStart + phraseDur + 0.1);
      });

      setTimeout(() => {
        try { choirOut.disconnect(); } catch (e) {}
      }, (tStart - ctx.currentTime + phraseDur + 0.2) * 1000);
    };

    const playStrings = () => {
      if (this._titleLoopCount < 2) return;
      const stringOut = ctx.createGain();
      stringOut.gain.setValueAtTime(0.0001, t0 + beat * 32);
      stringOut.gain.linearRampToValueAtTime(0.68, t0 + beat * 34);
      stringOut.gain.setValueAtTime(0.68, t0 + themeDur - beat * 2);
      stringOut.gain.linearRampToValueAtTime(0.0001, t0 + themeDur);
      stringOut.connect(outGain);

      const stringMelody = [
        [32, 60], [36, 62], [40, 64], [44, 67],
        [48, 69], [52, 72], [56, 74], [60, 76],
      ];
      const harmonyOffsets = [-12, -5, 0, 7];
      harmonyOffsets.forEach((offset, idx) => {
        const oscA = ctx.createOscillator();
        const oscB = ctx.createOscillator();
        const gain = ctx.createGain();
        const body = ctx.createBiquadFilter();
        const sheen = ctx.createBiquadFilter();
        oscA.type = "sawtooth";
        oscB.type = "sawtooth";
        oscA.detune.value = -9 + idx * 2;
        oscB.detune.value = 8 - idx;
        const voiceLevel = 0.08 - idx * 0.005;
        gain.gain.setValueAtTime(0.0001, t0 + beat * 32);
        gain.gain.linearRampToValueAtTime(voiceLevel, t0 + beat * 34);
        gain.gain.setValueAtTime(voiceLevel, t0 + themeDur - beat * 2);
        gain.gain.linearRampToValueAtTime(0.0001, t0 + themeDur);
        body.type = "lowpass";
        body.frequency.value = 3200 + idx * 550;
        body.Q.value = 0.65;
        sheen.type = "highpass";
        sheen.frequency.value = 120;
        const firstNote = stringMelody[0][1] + offset;
        oscA.frequency.setValueAtTime(note(firstNote), t0 + beat * stringMelody[0][0]);
        oscB.frequency.setValueAtTime(note(firstNote), t0 + beat * stringMelody[0][0]);
        stringMelody.slice(1).forEach(([beatOffset, midi]) => {
          const target = note(midi + offset);
          oscA.frequency.setTargetAtTime(target, t0 + beat * beatOffset, 0.2);
          oscB.frequency.setTargetAtTime(target, t0 + beat * beatOffset, 0.24);
        });
        oscA.connect(body);
        oscB.connect(body);
        body.connect(sheen);
        sheen.connect(gain);
        connectPan(gain, stringOut, [-0.55, -0.18, 0.18, 0.55][idx]);
        oscA.start(t0 + beat * 32);
        oscB.start(t0 + beat * 32);
        oscA.stop(t0 + themeDur + 0.1);
        oscB.stop(t0 + themeDur + 0.1);
      });

      setTimeout(() => {
        try { stringOut.disconnect(); } catch (e) {}
      }, themeDur * 1000 + 300);
    };

    // Play "Regulaido" at beat 24 (start of the G chord)
    playTalkbox(24);
    // Second pass: angel choir response on the same harmonic moment.
    playAngelChoir(56);
    playStrings();

    // Schedule next loop iteration seamlessly
    this.titleThemeTimeout = setTimeout(() => {
      this._scheduleVocoderTitleLoop();
    }, themeDur * 1000 - 80);
  },
  stopTitleTheme(fade = true) {
    this.titleThemeActive = false;
    this._vocoderPlayed = false;
    if (this.titleThemeTimeout) {
      clearTimeout(this.titleThemeTimeout);
      this.titleThemeTimeout = null;
    }
    if (this.ctx && this.titleThemeNodes.length) {
      const now = this.ctx.currentTime;
      const fadeTime = fade ? 0.12 : 0.025;
      for (const node of this.titleThemeNodes) {
        try {
          node.gain.cancelScheduledValues(now);
          node.gain.setValueAtTime(Math.max(0.0001, node.gain.value || 0.0001), now);
          node.gain.exponentialRampToValueAtTime(0.0001, now + fadeTime);
          setTimeout(() => { try { node.disconnect(); } catch (e) {} }, (fadeTime + 0.05) * 1000);
        } catch (e) {}
      }
      this.titleThemeNodes = [];
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
