// Utilitários compartilhados por todos os jogos: constantes, avatares, desenho e efeitos.

export const W = 1080;
export const H = 1920;

// Área de jogo (deixa espaço para a interface do TikTok em cima e embaixo).
export const ARENA = { x: 0, y: 340, w: 1080, h: 1160 };

export const FONT = "'Segoe UI', 'Arial Rounded MT Bold', 'Arial Black', Arial, sans-serif";

export const TEAMS = [
  { id: 0, name: 'Vermelho', color: '#ff4d5e', dark: '#9e1f2d', emoji: '🔴', keys: ['1', 'vermelho', 'red'] },
  { id: 1, name: 'Azul', color: '#3d8bff', dark: '#1a4aa0', emoji: '🔵', keys: ['2', 'azul', 'blue'] },
  { id: 2, name: 'Verde', color: '#2ee67a', dark: '#14874a', emoji: '🟢', keys: ['3', 'verde', 'green'] },
  { id: 3, name: 'Amarelo', color: '#ffc93d', dark: '#a87b0c', emoji: '🟡', keys: ['4', 'amarelo', 'yellow'] },
];

/** "1", "azul", "time azul", "#2"... → id do time, ou null. */
export function parseTeam(text) {
  const words = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  for (const t of TEAMS) if (words.some((w) => t.keys.includes(w))) return t.id;
  return null;
}

/** Nível do presente pelo total de diamantes. */
export function giftTier(diamonds) {
  if (diamonds >= 1000) return 4;
  if (diamonds >= 100) return 3;
  if (diamonds >= 10) return 2;
  return 1;
}

export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
export function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function hashColor(str) {
  let h = 0;
  for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 70% 55%)`;
}

// ------------------------------------------------------------------ Avatares
// Cada avatar vira um "sprite" circular de 128px pré-renderizado, então desenhar
// centenas por quadro é barato. Enquanto a foto carrega, mostramos a inicial.

const SPRITE = 128;
const sprites = new Map();

function initialsSprite(user) {
  const c = document.createElement('canvas');
  c.width = c.height = SPRITE;
  const g = c.getContext('2d');
  g.fillStyle = hashColor(user.id);
  g.beginPath();
  g.arc(SPRITE / 2, SPRITE / 2, SPRITE / 2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = `900 ${SPRITE * 0.5}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText((user.isBot ? '🤖' : (user.name || '?').trim()[0] || '?').toUpperCase(), SPRITE / 2, SPRITE / 2 + 4);
  return c;
}

export function avatarSprite(user) {
  let s = sprites.get(user.id);
  if (s) {
    if (user.avatar && !s.ok && !s.loading && s.src !== user.avatar) loadPhoto(user, s);
    return s.canvas;
  }
  s = { canvas: initialsSprite(user), src: null, ok: false, loading: false, at: performance.now() };
  sprites.set(user.id, s);
  if (user.avatar) loadPhoto(user, s);
  if (sprites.size > 1500) pruneSprites();
  return s.canvas;
}

function loadPhoto(user, s) {
  s.loading = true;
  s.src = user.avatar;
  const img = new Image();
  img.referrerPolicy = 'no-referrer';
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = SPRITE;
    const g = c.getContext('2d');
    g.beginPath();
    g.arc(SPRITE / 2, SPRITE / 2, SPRITE / 2, 0, Math.PI * 2);
    g.clip();
    g.drawImage(img, 0, 0, SPRITE, SPRITE);
    s.canvas = c;
    s.ok = true;
    s.loading = false;
  };
  img.onerror = () => {
    s.loading = false;
  };
  img.src = user.avatar;
}

function pruneSprites() {
  const old = [...sprites.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 500);
  for (const [id] of old) sprites.delete(id);
}

/** Desenha o avatar redondo com borda colorida. */
export function drawAvatar(g, user, x, y, r, ring = '#fff', ringW = Math.max(3, r * 0.14)) {
  if (ringW > 0) {
    g.fillStyle = ring;
    g.beginPath();
    g.arc(x, y, r + ringW, 0, Math.PI * 2);
    g.fill();
  }
  g.drawImage(avatarSprite(user), x - r, y - r, r * 2, r * 2);
}

// ------------------------------------------------------------------ Texto / formas
export function text(g, str, x, y, size, color = '#fff', align = 'center', weight = 900, stroke = true) {
  g.font = `${weight} ${size}px ${FONT}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  if (stroke) {
    g.lineJoin = 'round';
    g.lineWidth = Math.max(3, size * 0.16);
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.strokeText(str, x, y);
  }
  g.fillStyle = color;
  g.fillText(str, x, y);
}

export function fitText(g, str, maxW, size, weight = 900) {
  g.font = `${weight} ${size}px ${FONT}`;
  if (g.measureText(str).width <= maxW) return str;
  while (str.length > 1 && g.measureText(str + '…').width > maxW) str = str.slice(0, -1);
  return str + '…';
}

export function roundRect(g, x, y, w, h, r, fill, stroke, lw = 3) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  if (fill) {
    g.fillStyle = fill;
    g.fill();
  }
  if (stroke) {
    g.lineWidth = lw;
    g.strokeStyle = stroke;
    g.stroke();
  }
}

export function bar(g, x, y, w, h, frac, color, bg = 'rgba(0,0,0,0.5)') {
  roundRect(g, x, y, w, h, h / 2, bg);
  if (frac > 0) roundRect(g, x, y, Math.max(h, w * clamp(frac, 0, 1)), h, h / 2, color);
}

// ------------------------------------------------------------------ Efeitos
export class Effects {
  constructor() {
    this.particles = [];
    this.floaters = [];
    this.rings = [];
    this.shakeT = 0;
    this.shakeMag = 0;
    this.flashT = 0;
    this.flashColor = '#fff';
  }

  burst(x, y, color, n = 16, speed = 260, size = 7) {
    if (this.particles.length > 1500) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * rand(0.3, 1);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.4, 0.9), max: 0.9, color, size: size * rand(0.5, 1.2) });
    }
  }

  float(x, y, str, color = '#fff', size = 34) {
    if (this.floaters.length > 80) this.floaters.shift();
    this.floaters.push({ x, y, str, color, size, life: 1.3 });
  }

  ring(x, y, color, maxR = 200, life = 0.6) {
    this.rings.push({ x, y, color, r: 0, maxR, life, max: life });
  }

  shake(mag = 12, t = 0.35) {
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeT = Math.max(this.shakeT, t);
  }

  flash(color = '#fff', t = 0.25) {
    this.flashColor = color;
    this.flashT = t;
  }

  update(dt) {
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy = p.vy * 0.96 + 300 * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const f of this.floaters) {
      f.y -= 70 * dt;
      f.life -= dt;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);
    for (const r of this.rings) {
      r.life -= dt;
      r.r = r.maxR * (1 - r.life / r.max);
    }
    this.rings = this.rings.filter((r) => r.life > 0);
    this.shakeT = Math.max(0, this.shakeT - dt);
    this.flashT = Math.max(0, this.flashT - dt);
  }

  shakeOffset() {
    if (this.shakeT <= 0) return [0, 0];
    return [rand(-1, 1) * this.shakeMag, rand(-1, 1) * this.shakeMag];
  }

  draw(g) {
    for (const r of this.rings) {
      g.globalAlpha = clamp(r.life / r.max, 0, 1);
      g.strokeStyle = r.color;
      g.lineWidth = 10;
      g.beginPath();
      g.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      g.stroke();
    }
    for (const p of this.particles) {
      g.globalAlpha = clamp(p.life / p.max, 0, 1);
      g.fillStyle = p.color;
      g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    g.globalAlpha = 1;
    for (const f of this.floaters) {
      g.globalAlpha = clamp(f.life, 0, 1);
      text(g, f.str, f.x, f.y, f.size, f.color);
    }
    g.globalAlpha = 1;
  }

  drawFlash(g) {
    if (this.flashT <= 0) return;
    g.globalAlpha = clamp(this.flashT * 2, 0, 0.6);
    g.fillStyle = this.flashColor;
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ Grade espacial
/** Grade para achar vizinhos rápido (evita O(n²) com centenas de unidades). */
export class SpatialGrid {
  constructor(cell = 80) {
    this.cell = cell;
    this.map = new Map();
  }
  clear() {
    this.map.clear();
  }
  key(cx, cy) {
    return cx * 10007 + cy;
  }
  insert(o) {
    const k = this.key(Math.floor(o.x / this.cell), Math.floor(o.y / this.cell));
    let list = this.map.get(k);
    if (!list) this.map.set(k, (list = []));
    list.push(o);
  }
  query(x, y, r, out = []) {
    out.length = 0;
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const list = this.map.get(this.key(cx, cy));
        if (list) for (const o of list) out.push(o);
      }
    return out;
  }
}
