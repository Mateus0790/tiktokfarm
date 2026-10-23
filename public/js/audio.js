// Som do overlay: música de fundo própria para cada jogo + efeitos sonoros.
// Tudo é sintetizado com Web Audio (sem arquivos de áudio e sem direitos autorais).

const midiFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

// Padrões de 16 passos (semicolcheias). x = toca.
const THEMES = {
  intermission: {
    bpm: 92, root: 48, scale: 'major', prog: [0, 5, 3, 4], lead: 'triangle', bass: 'sine', leadVol: 0.07, bassVol: 0.12,
    kick: 'x.......x.......', snare: '................', hat: '....x.......x...', leadRhythm: 'x...x...x.x.....', bassRhythm: 'x.......x.......', pad: true,
  },
  teams: {
    bpm: 120, root: 45, scale: 'minor', prog: [0, 5, 3, 4], lead: 'square', bass: 'sawtooth', leadVol: 0.05, bassVol: 0.09,
    kick: 'x.......x.x.....', snare: '....x.......x..x', hat: 'x.x.x.x.x.x.x.x.', leadRhythm: 'x..x..x.x..x..x.', bassRhythm: 'x.x.x.x.x.x.x.x.',
  },
  territory: {
    bpm: 128, root: 50, scale: 'major', prog: [0, 4, 5, 3], lead: 'triangle', bass: 'square', leadVol: 0.09, bassVol: 0.06,
    kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.', leadRhythm: 'x.xx.x.xx.x.x.x.', bassRhythm: 'x..x..x.x..x..x.',
  },
  towerdefense: {
    bpm: 100, root: 43, scale: 'harmonic', prog: [0, 0, 5, 4], lead: 'sawtooth', bass: 'sawtooth', leadVol: 0.035, bassVol: 0.1,
    kick: 'x.....x...x.....', snare: '........x.......', hat: 'x.xxx.xxx.xxx.x.', leadRhythm: 'x.......x...x...', bassRhythm: 'xxxxxxxxxxxxxxxx', pad: true,
  },
  race: {
    bpm: 150, root: 47, scale: 'dorian', prog: [0, 6, 5, 6], lead: 'square', bass: 'sawtooth', leadVol: 0.06, bassVol: 0.1,
    kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx', leadRhythm: 'x.x.xx.x.x.xx.x.', bassRhythm: 'x.xxx.xxx.xxx.xx',
  },
};

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Sound {
  constructor({ enabled = true, musicVolume = 0.35, sfxVolume = 0.6 } = {}) {
    this.enabled = enabled;
    this.ctx = null;
    this.track = null;
    this.lastSfx = new Map();
    this.voices = 0;
    this.musicVolume = musicVolume;
    this.sfxVolume = sfxVolume;
    if (!enabled) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      this.enabled = false;
      return;
    }
    const ctx = this.ctx;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = musicVolume;
    this.musicBus.connect(this.comp);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = sfxVolume;
    this.sfxBus.connect(this.comp);

    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // No OBS o som toca sozinho; num navegador comum é preciso um clique na página.
    const unlock = () => ctx.state === 'suspended' && ctx.resume();
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlock);
    unlock();
    this.timer = setInterval(() => this.schedule(), 25);
  }

  setVolumes({ musicVolume, sfxVolume }) {
    if (!this.ctx) return;
    if (musicVolume != null) this.musicBus.gain.value = this.musicVolume = musicVolume;
    if (sfxVolume != null) this.sfxBus.gain.value = this.sfxVolume = sfxVolume;
  }

  // ------------------------------------------------------------------ síntese
  tone(t, freq, dur, { type = 'square', vol = 0.2, attack = 0.005, slideTo = null, dest = this.sfxBus } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
    this.voices++;
    o.onended = () => {
      this.voices--;
      g.disconnect();
    };
  }

  noise(t, dur, { vol = 0.2, filter = 'lowpass', freq = 2000, slideTo = null, dest = this.sfxBus } = {}) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
    this.voices++;
    s.onended = () => {
      this.voices--;
      g.disconnect();
    };
  }

  // ------------------------------------------------------------------ efeitos
  /** Toca um efeito. Limita repetições para não virar barulheira com muitos eventos. */
  play(name, minGap = 0.06) {
    if (!this.enabled || this.ctx.state !== 'running' || this.voices > 120) return;
    const now = this.ctx.currentTime;
    if (now - (this.lastSfx.get(name) ?? -1) < minGap) return;
    this.lastSfx.set(name, now);
    const t = now + 0.01;
    const fx = SFX[name];
    if (fx) fx(this, t);
  }

  // ------------------------------------------------------------------ música
  /** Troca a música (com fade). id = 'teams' | 'territory' | 'towerdefense' | 'race' | 'intermission' */
  music(id) {
    if (!this.enabled || this.track?.id === id) return;
    const theme = THEMES[id];
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (this.track) {
      const old = this.track.gain;
      old.gain.cancelScheduledValues(t);
      old.gain.setValueAtTime(old.gain.value, t);
      old.gain.linearRampToValueAtTime(0, t + 1.2);
      setTimeout(() => old.disconnect(), 1500);
    }
    if (!theme) {
      this.track = null;
      return;
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + 1.5);
    gain.connect(this.musicBus);
    this.track = { id, theme, gain, step: 0, next: t + 0.1, seed: Math.floor(Math.random() * 1e9) };
    this.makeMelody();
  }

  makeMelody() {
    // melodia de 4 compassos que se repete; muda a cada 16 compassos
    const tr = this.track;
    const r = rng(tr.seed++);
    tr.melody = [];
    let deg = 4;
    for (let i = 0; i < 64; i++) {
      deg += Math.floor(r() * 5) - 2;
      if (deg < 0) deg = 2;
      if (deg > 9) deg = 7;
      tr.melody.push(deg);
    }
  }

  note(deg, octave) {
    const th = this.track.theme;
    const sc = SCALES[th.scale];
    const o = Math.floor(deg / sc.length);
    const d = ((deg % sc.length) + sc.length) % sc.length;
    return midiFreq(th.root + 12 * (octave + o) + sc[d]);
  }

  schedule() {
    const tr = this.track;
    if (!tr || this.ctx.state !== 'running') return;
    const ahead = this.ctx.currentTime + 0.12;
    if (tr.next < this.ctx.currentTime - 1) tr.next = this.ctx.currentTime + 0.05; // voltou de uma pausa
    const th = tr.theme;
    const stepDur = 60 / th.bpm / 4;
    while (tr.next < ahead) {
      this.playStep(tr, th, tr.step, tr.next, stepDur);
      tr.step++;
      if (tr.step % 256 === 0) this.makeMelody();
      tr.next += stepDur;
    }
  }

  playStep(tr, th, step, t, stepDur) {
    const s = step % 16;
    const bar = Math.floor(step / 16);
    const chord = th.prog[bar % th.prog.length];
    const dest = tr.gain;
    if (th.kick[s] === 'x') this.tone(t, 150, 0.18, { type: 'sine', vol: 0.5, slideTo: 40, dest });
    if (th.snare[s] === 'x') {
      this.noise(t, 0.14, { vol: 0.18, filter: 'highpass', freq: 1500, dest });
      this.tone(t, 190, 0.08, { type: 'triangle', vol: 0.08, dest });
    }
    if (th.hat[s] === 'x') this.noise(t, 0.03, { vol: s % 4 === 0 ? 0.06 : 0.035, filter: 'highpass', freq: 7000, dest });
    if (th.bassRhythm[s] === 'x') this.tone(t, this.note(chord, 0), stepDur * 1.8, { type: th.bass, vol: th.bassVol, dest });
    if (th.leadRhythm[s] === 'x') {
      const deg = chord + tr.melody[(bar % 4) * 16 + s];
      this.tone(t, this.note(deg, 2), stepDur * 2.2, { type: th.lead, vol: th.leadVol, dest });
    }
    if (th.pad && s === 0) {
      for (const k of [0, 2, 4]) this.tone(t, this.note(chord + k, 1), stepDur * 15, { type: 'triangle', vol: 0.025, attack: 0.3, dest });
    }
  }
}

// Efeitos sonoros: cada um recebe o Sound e o horário de início.
const SFX = {
  join(s, t) {
    s.tone(t, 660, 0.08, { type: 'square', vol: 0.08 });
    s.tone(t + 0.06, 990, 0.1, { type: 'square', vol: 0.08 });
  },
  like(s, t) {
    s.tone(t, 1200, 0.05, { type: 'sine', vol: 0.05, slideTo: 1600 });
  },
  gift1(s, t) {
    s.tone(t, 988, 0.08, { type: 'square', vol: 0.12 });
    s.tone(t + 0.07, 1319, 0.25, { type: 'square', vol: 0.12 });
  },
  gift2(s, t) {
    [523, 659, 784, 1047].forEach((f, i) => s.tone(t + i * 0.07, f, 0.22, { type: 'square', vol: 0.13 }));
    s.noise(t, 0.4, { vol: 0.08, filter: 'bandpass', freq: 800, slideTo: 6000 });
  },
  gift3(s, t) {
    s.noise(t, 0.6, { vol: 0.2, filter: 'bandpass', freq: 400, slideTo: 5000 });
    [392, 523, 659, 784, 1047].forEach((f, i) => s.tone(t + 0.3 + i * 0.06, f, 0.35, { type: 'sawtooth', vol: 0.09 }));
    SFX.boom(s, t + 0.6);
  },
  gift4(s, t) {
    s.noise(t, 1.2, { vol: 0.25, filter: 'bandpass', freq: 200, slideTo: 8000 });
    [262, 330, 392, 523, 659, 784, 1047, 1319].forEach((f, i) => s.tone(t + 0.5 + i * 0.05, f, 0.6, { type: 'sawtooth', vol: 0.08 }));
    SFX.boom(s, t + 1);
    SFX.boom(s, t + 1.3);
  },
  boom(s, t) {
    s.tone(t, 120, 0.6, { type: 'sine', vol: 0.6, slideTo: 30 });
    s.noise(t, 0.7, { vol: 0.35, filter: 'lowpass', freq: 1200, slideTo: 80 });
  },
  pop(s, t) {
    s.tone(t, 500, 0.06, { type: 'triangle', vol: 0.08, slideTo: 150 });
  },
  shoot(s, t) {
    s.tone(t, 900, 0.05, { type: 'square', vol: 0.025, slideTo: 300 });
  },
  hit(s, t) {
    s.noise(t, 0.05, { vol: 0.05, filter: 'bandpass', freq: 1500 });
  },
  splash(s, t) {
    s.noise(t, 0.35, { vol: 0.2, filter: 'lowpass', freq: 3000, slideTo: 200 });
    s.tone(t, 300, 0.2, { type: 'sine', vol: 0.15, slideTo: 80 });
  },
  freeze(s, t) {
    [1568, 2093, 2637, 3136].forEach((f, i) => s.tone(t + i * 0.05, f, 0.4, { type: 'sine', vol: 0.06 }));
  },
  alarm(s, t) {
    for (let i = 0; i < 3; i++) s.tone(t + i * 0.25, 440, 0.18, { type: 'sawtooth', vol: 0.08, slideTo: 660 });
  },
  hurt(s, t) {
    s.tone(t, 200, 0.2, { type: 'sawtooth', vol: 0.12, slideTo: 90 });
  },
  finish(s, t) {
    [784, 988, 1175, 1568].forEach((f, i) => s.tone(t + i * 0.08, f, 0.3, { type: 'triangle', vol: 0.15 }));
  },
  win(s, t) {
    const notes = [523, 523, 523, 659, 784, 659, 784, 1047];
    const times = [0, 0.15, 0.3, 0.45, 0.75, 1.05, 1.2, 1.4];
    notes.forEach((f, i) => s.tone(t + times[i], f, i === notes.length - 1 ? 0.9 : 0.25, { type: 'square', vol: 0.12 }));
    notes.forEach((f, i) => s.tone(t + times[i], f / 2, 0.25, { type: 'triangle', vol: 0.12 }));
  },
  lose(s, t) {
    [392, 370, 349, 330].forEach((f, i) => s.tone(t + i * 0.35, f, i === 3 ? 1 : 0.32, { type: 'sawtooth', vol: 0.1 }));
  },
  tick(s, t) {
    s.tone(t, 880, 0.08, { type: 'sine', vol: 0.15 });
  },
  go(s, t) {
    s.tone(t, 1760, 0.4, { type: 'square', vol: 0.12 });
  },
};
