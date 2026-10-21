import { Game } from './base.js';
import { ARENA, bar, clamp, dist2, drawAvatar, fitText, giftTier, rand, roundRect, text } from '../core.js';

// Defesa do Castelo (cooperativo): cada pessoa vira uma torre com o próprio avatar
// e atira sozinha nos monstros que descem pelo caminho. Presentes deixam as torres
// mais fortes ou soltam poderes no mapa inteiro.

const PATH = [
  { x: -40, y: 470 },
  { x: 920, y: 470 },
  { x: 920, y: 740 },
  { x: 160, y: 740 },
  { x: 160, y: 1010 },
  { x: 920, y: 1010 },
  { x: 920, y: 1270 },
  { x: 540, y: 1270 },
  { x: 540, y: 1360 },
];
const CASTLE = { x: 540, y: 1405, hp: 1500 };

function buildPath() {
  const segs = [];
  let total = 0;
  for (let i = 0; i < PATH.length - 1; i++) {
    const a = PATH[i];
    const b = PATH[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segs.push({ a, b, len, start: total });
    total += len;
  }
  return { segs, total };
}
const ROUTE = buildPath();

function pointAt(d) {
  for (const s of ROUTE.segs) {
    if (d <= s.start + s.len) {
      const k = (d - s.start) / s.len;
      return { x: s.a.x + (s.b.x - s.a.x) * k, y: s.a.y + (s.b.y - s.a.y) * k };
    }
  }
  return { x: CASTLE.x, y: CASTLE.y };
}

function distToPath(x, y) {
  let best = Infinity;
  for (const s of ROUTE.segs) {
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const k = clamp(((x - s.a.x) * dx + (y - s.a.y) * dy) / (dx * dx + dy * dy), 0, 1);
    best = Math.min(best, Math.hypot(x - (s.a.x + dx * k), y - (s.a.y + dy * k)));
  }
  return best;
}

// Vagas para torres: pontos da grade longe o suficiente do caminho e do castelo.
const SLOTS = (() => {
  const out = [];
  for (let y = ARENA.y + 160; y <= 1450; y += 68)
    for (let x = 60; x <= 1020; x += 80) {
      if (distToPath(x, y) < 62) continue;
      if (Math.hypot(x - CASTLE.x, y - CASTLE.y) < 150) continue;
      out.push({ x, y, d: distToPath(x, y) });
    }
  // as vagas mais perto do caminho são preenchidas primeiro
  return out.sort((a, b) => a.d - b.d);
})();

export class TowerDefenseGame extends Game {
  static id = 'towerdefense';
  static title = 'Defesa do Castelo';
  static emoji = '🏰';

  get instructions() {
    return [
      'Comente para virar uma TORRE e defender o castelo!',
      'Sua torre atira sozinha. ❤️ Curtidas = tiro rápido',
      'Todos juntos: sobrevivam às ondas de monstros!',
    ];
  }

  get giftGuide() {
    return [
      { icon: '🌹', label: '1+💎', text: 'Sua torre sobe de nível' },
      { icon: '❄️', label: '10+💎', text: 'CONGELA todos os monstros + 5 níveis' },
      { icon: '✈️', label: '100+💎', text: 'BOMBARDEIO no mapa + cura o castelo' },
      { icon: '☢️', label: '1000+💎', text: 'NUKE: limpa tudo + castelo novo' },
    ];
  }

  start() {
    this.castleHp = CASTLE.hp;
    this.enemies = [];
    this.shots = [];
    this.wave = 0;
    this.waveQueue = [];
    this.spawnCd = 0;
    this.nextWaveT = 4;
    this.freezeT = 0;
    this.slotsUsed = new Set();
    this.lost = false;
    this.totalKills = 0;
  }

  join(user) {
    const slot = SLOTS.find((s, i) => !this.slotsUsed.has(i));
    if (!slot) return null;
    const idx = SLOTS.indexOf(slot);
    this.slotsUsed.add(idx);
    const p = { user, slot: idx, x: slot.x, y: slot.y, level: 1, cd: rand(0, 1), rapidT: 0, kills: 0, damage: 0, pop: 0.6 };
    this.players.set(user.id, p);
    this.fx.burst(p.x, p.y, '#7fd4ff', 14, 200);
    return p;
  }

  stats(p) {
    const lv = Math.min(p.level, 80);
    return {
      range: 170 + Math.min(lv * 4, 140),
      dmg: 9 + lv * 4.5,
      rate: (0.8 + Math.min(lv * 0.04, 1.4)) * (p.rapidT > 0 ? 2 : 1),
    };
  }

  // ------------------------------------------------------------ ondas
  queueWave() {
    this.wave++;
    const n = this.wave;
    const count = 6 + n * 3;
    const hp = 40 * Math.pow(1.22, n);
    for (let i = 0; i < count; i++) {
      const fast = n >= 3 && i % 3 === 0;
      this.waveQueue.push({
        hp: fast ? hp * 0.6 : hp,
        speed: (fast ? 135 : 80) + n * 2.5,
        r: fast ? 18 : 24,
        color: fast ? '#ffb347' : '#b05cff',
        dmg: 25,
        emoji: fast ? '🦇' : '👾',
      });
    }
    if (n % 5 === 0) this.waveQueue.push({ hp: hp * 18, speed: 55, r: 46, color: '#ff3355', dmg: 250, emoji: '👹', boss: true });
    this.mgr.notify(n % 5 === 0 ? `👹 Onda ${n}: CHEFÃO chegando!` : `🌊 Onda ${n} chegando!`, '#ffb347');
  }

  spawnEnemy(spec) {
    this.enemies.push({ ...spec, maxHp: spec.hp, d: 0, x: PATH[0].x, y: PATH[0].y, dead: false, hitT: 0 });
  }

  damage(e, amount, p) {
    if (e.dead) return;
    e.hp -= amount;
    e.hitT = 0.1;
    if (p) p.damage += amount;
    if (e.hp <= 0) {
      e.dead = true;
      this.totalKills++;
      if (p) p.kills++;
      this.fx.burst(e.x, e.y, e.color, e.boss ? 60 : 10, e.boss ? 500 : 200);
      if (e.boss) {
        this.fx.shake(20, 0.5);
        this.mgr.notify(`💥 Chefão derrotado${p ? ` por ${p.user.name}` : ''}!`, '#ff3355');
      }
    }
  }

  // ------------------------------------------------------------ interação
  onLike(p, count) {
    p.rapidT = Math.min(6, p.rapidT + 0.5 + count * 0.1);
  }
  onFollow(p) {
    p.level += 2;
    p.pop = 0.6;
  }
  onShare(p) {
    p.level += 3;
    p.pop = 0.6;
  }

  onGift(p, gift) {
    const d = gift.diamonds;
    const tier = giftTier(d);
    p.pop = 0.8;
    if (tier === 1) {
      p.level += d;
      this.fx.float(p.x, p.y - 50, `+${d} nível`, '#ffe066');
      return `Torre nível ${p.level}`;
    }
    if (tier === 2) {
      p.level += 5;
      this.freezeT = 6;
      this.fx.flash('#9be7ff', 0.4);
      return '❄️ CONGELOU TUDO!';
    }
    if (tier === 3) {
      p.level += 8;
      for (const e of this.enemies) {
        this.damage(e, 600 + d * 2, p);
        this.fx.ring(e.x, e.y, '#ffb347', 90, 0.5);
      }
      this.castleHp = Math.min(CASTLE.hp, this.castleHp + 300);
      this.fx.shake(18, 0.6);
      return '✈️ BOMBARDEIO!';
    }
    p.level += 15;
    for (const e of this.enemies) this.damage(e, e.hp, p);
    this.waveQueue.length = 0;
    this.castleHp = CASTLE.hp;
    for (const q of this.players.values()) q.level += 3;
    this.fx.flash('#fff', 0.7);
    this.fx.shake(35, 1);
    return '☢️ NUKE!!!';
  }

  // ------------------------------------------------------------ simulação
  update(dt) {
    if (this.lost) return;
    this.freezeT = Math.max(0, this.freezeT - dt);

    // controle das ondas
    if (!this.waveQueue.length && !this.enemies.some((e) => !e.dead)) {
      this.nextWaveT -= dt;
      if (this.nextWaveT <= 0) {
        this.queueWave();
        this.nextWaveT = 4;
      }
    }
    if (this.waveQueue.length) {
      this.spawnCd -= dt;
      if (this.spawnCd <= 0) {
        this.spawnEnemy(this.waveQueue.shift());
        this.spawnCd = Math.max(0.25, 0.9 - this.wave * 0.03);
      }
    }

    for (const e of this.enemies) {
      if (e.dead) continue;
      e.hitT = Math.max(0, e.hitT - dt);
      if (this.freezeT <= 0) e.d += e.speed * dt;
      const pos = pointAt(e.d);
      e.x = pos.x;
      e.y = pos.y;
      if (e.d >= ROUTE.total) {
        e.dead = true;
        this.castleHp -= e.dmg;
        this.fx.burst(CASTLE.x, CASTLE.y - 30, '#ff4d5e', 20, 300);
        this.fx.shake(12, 0.3);
        if (this.castleHp <= 0) {
          this.castleHp = 0;
          this.lost = true;
          this.finished = true;
          this.fx.burst(CASTLE.x, CASTLE.y, '#ff4d5e', 120, 700, 12);
          return;
        }
      }
    }

    // torres atiram no monstro mais avançado dentro do alcance
    for (const p of this.players.values()) {
      p.rapidT = Math.max(0, p.rapidT - dt);
      p.pop = Math.max(0, p.pop - dt);
      p.cd -= dt;
      if (p.cd > 0) continue;
      const s = this.stats(p);
      let target = null;
      for (const e of this.enemies) {
        if (e.dead || dist2(p.x, p.y, e.x, e.y) > s.range * s.range) continue;
        if (!target || e.d > target.d) target = e;
      }
      if (!target) continue;
      p.cd = 1 / s.rate;
      this.shots.push({ x0: p.x, y0: p.y, x1: target.x, y1: target.y, t: 0.12, lv: p.level });
      this.damage(target, s.dmg, p);
    }

    for (const s of this.shots) s.t -= dt;
    this.shots = this.shots.filter((s) => s.t > 0);
    this.enemies = this.enemies.filter((e) => !e.dead);
  }

  result() {
    const winners = [...this.players.values()]
      .map((p) => ({ user: p.user, win: !this.lost, points: Math.round((this.lost ? 5 : 40) + p.kills * 2 + p.damage / 200) }))
      .sort((a, b) => b.points - a.points);
    const title = this.lost ? `💀 O castelo caiu na onda ${this.wave}!` : `🏆 Castelo salvo! ${this.wave} ondas sobrevividas`;
    return { title, color: this.lost ? '#ff4d5e' : '#2ee67a', winners };
  }

  // ------------------------------------------------------------ desenho
  draw(g) {
    g.fillStyle = '#243b1f';
    g.fillRect(ARENA.x, ARENA.y + 70, ARENA.w, ARENA.h - 70);

    // caminho
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const [w, c] of [
      [92, '#5b4630'],
      [76, '#8a6d47'],
    ]) {
      g.strokeStyle = c;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(PATH[0].x, PATH[0].y);
      for (const pt of PATH) g.lineTo(pt.x, pt.y);
      g.stroke();
    }
    g.lineCap = 'butt';

    // castelo
    const cx = CASTLE.x;
    const cy = CASTLE.y;
    roundRect(g, cx - 110, cy - 50, 220, 90, 12, '#6b7a8f');
    for (const sx of [-110, -30, 50]) roundRect(g, sx + cx, cy - 95, 60, 60, 8, '#8796ab');
    roundRect(g, cx - 22, cy - 5, 44, 45, 16, '#2b1a10');
    text(g, '🏰', cx, cy - 135, 54, '#fff', 'center', 900, false);

    // HUD do jogo
    roundRect(g, 18, ARENA.y + 8, 1044, 58, 14, 'rgba(0,0,0,0.6)');
    text(g, `🌊 Onda ${this.wave}`, 120, ARENA.y + 37, 30);
    text(g, `💀 ${this.totalKills}`, 300, ARENA.y + 37, 30);
    bar(g, 400, ARENA.y + 22, 640, 30, this.castleHp / CASTLE.hp, this.castleHp / CASTLE.hp > 0.35 ? '#2ee67a' : '#ff4d5e');
    text(g, `Castelo ${Math.ceil(this.castleHp)}/${CASTLE.hp}`, 720, ARENA.y + 38, 22);

    // monstros
    for (const e of this.enemies) {
      g.fillStyle = e.hitT > 0 ? '#fff' : this.freezeT > 0 ? '#9be7ff' : e.color;
      g.beginPath();
      g.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      g.fill();
      text(g, e.emoji, e.x, e.y + 2, e.r * 1.3, '#fff', 'center', 900, false);
      if (e.hp < e.maxHp) bar(g, e.x - e.r, e.y - e.r - 12, e.r * 2, 6, e.hp / e.maxHp, '#ff4d5e');
    }

    // torres
    const showNames = this.players.size <= 36;
    for (const p of this.players.values()) {
      const lv = p.level;
      const ring = lv >= 30 ? '#ff4dd2' : lv >= 15 ? '#ffc93d' : lv >= 5 ? '#7fd4ff' : '#ffffff';
      const r = 30 + p.pop * 14;
      roundRect(g, p.x - 34, p.y - 8, 68, 44, 10, '#4a4f5c');
      drawAvatar(g, p.user, p.x, p.y - 6, r, ring, 5);
      if (p.rapidT > 0) {
        g.strokeStyle = 'rgba(255,90,90,0.8)';
        g.lineWidth = 4;
        g.beginPath();
        g.arc(p.x, p.y - 6, r + 9, 0, Math.PI * 2);
        g.stroke();
      }
      roundRect(g, p.x + 12, p.y + 14, 36, 24, 8, '#111');
      text(g, String(lv), p.x + 30, p.y + 26, 17, '#ffe066', 'center', 900, false);
      if (showNames) text(g, fitText(g, p.user.name, 110, 16), p.x, p.y + 50, 16);
    }

    for (const s of this.shots) {
      g.strokeStyle = s.lv >= 15 ? '#ffc93d' : '#7fd4ff';
      g.lineWidth = s.lv >= 15 ? 7 : 4;
      g.beginPath();
      g.moveTo(s.x0, s.y0 - 6);
      g.lineTo(s.x1, s.y1);
      g.stroke();
    }

    if (this.freezeT > 0) {
      g.fillStyle = 'rgba(155,231,255,0.12)';
      g.fillRect(ARENA.x, ARENA.y + 70, ARENA.w, ARENA.h - 70);
    }
  }
}
