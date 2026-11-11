import { Game } from './base.js';
import { ARENA, SpatialGrid, clamp, drawAvatar, fitText, giftTier, rand, roundRect, text } from '../core.js';

// Sumô na Arena (cada um por si): os avatares ficam numa plataforma redonda sobre
// a lava e se trombam sozinhos. A plataforma encolhe com o tempo. Quem cai está
// eliminado; o último de pé vence. Curtidas = investida, presentes = poderes.

const C = { x: 540, y: 935 };
const R0 = 470;
const RMIN = 140;
const SHRINK_AFTER = 20; // segundos com a arena cheia antes de começar a encolher
const SHRINK_SPEED = 2.6; // px por segundo
const MAX_PLAYERS = 120;
const FALL_TIME = 0.7;

export class SumoGame extends Game {
  static id = 'sumo';
  static title = 'Sumô na Arena';
  static emoji = '🤼';

  get instructions() {
    return ['Comente para entrar na arena!', '❤️ Curtidas = investida contra o inimigo mais perto', 'Não caia na lava! O último de pé vence'];
  }

  get giftGuide() {
    return [
      { icon: '🌹', label: '1+💎', text: 'Fica mais pesado e firme' },
      { icon: '💥', label: '10+💎', text: 'ONDA DE CHOQUE empurra quem está perto' },
      { icon: '🛡️', label: '100+💎', text: 'ESCUDO 12s + onda gigante (revive se caiu)' },
      { icon: '🌋', label: '1000+💎', text: 'TERREMOTO joga todo mundo pra borda' },
    ];
  }

  start() {
    this.R = R0;
    this.grid = new SpatialGrid(110);
    this.near = [];
    this.order = []; // eliminados, na ordem em que caíram
    this.everJoined = 0;
    this.endIn = null;
  }

  get alive() {
    return [...this.players.values()].filter((p) => p.alive);
  }

  get closed() {
    return this.R < R0 * 0.65 || this.endIn != null;
  }

  join(user) {
    if (this.closed || this.players.size >= MAX_PLAYERS) return null;
    const a = rand(0, Math.PI * 2);
    const d = Math.sqrt(Math.random()) * this.R * 0.6;
    const p = {
      user,
      x: C.x + Math.cos(a) * d,
      y: C.y + Math.sin(a) * d,
      vx: 0,
      vy: 0,
      mass: 1,
      alive: true,
      fall: 0,
      shieldT: 0,
      anchorT: 0,
      think: rand(0, 1),
      tx: C.x,
      ty: C.y,
      lastHit: null,
      lastHitT: -99,
      chatT: -99,
      knock: 0,
      place: 0,
    };
    this.players.set(user.id, p);
    this.everJoined++;
    return p;
  }

  radius(p) {
    return 24 * Math.sqrt(p.mass);
  }

  effMass(p) {
    return p.mass * (p.anchorT > 0 ? 3 : 1) * (p.shieldT > 0 ? 2 : 1);
  }

  nearestFoe(p, range = 350) {
    let best = null;
    let bestD = range * range;
    for (const o of this.grid.query(p.x, p.y, range, this.near)) {
      if (o === p || !o.alive) continue;
      const d = (o.x - p.x) ** 2 + (o.y - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  /** Investida: impulso na direção do inimigo mais próximo (ou do centro, se estiver na borda). */
  dash(p, power) {
    if (!p.alive) return;
    const foe = this.nearestFoe(p);
    const edge = Math.hypot(p.x - C.x, p.y - C.y) > this.R * 0.75;
    const tx = foe && !edge ? foe.x : C.x;
    const ty = foe && !edge ? foe.y : C.y;
    const d = Math.hypot(tx - p.x, ty - p.y) || 1;
    const imp = power / Math.sqrt(p.mass);
    p.vx += ((tx - p.x) / d) * imp;
    p.vy += ((ty - p.y) / d) * imp;
    this.fx.burst(p.x, p.y, '#fff', 4, 120, 4);
  }

  shockwave(p, radius, power) {
    this.fx.ring(p.x, p.y, '#ffb347', radius, 0.5);
    this.fx.shake(10, 0.3);
    this.sfx('boom', 0.1);
    for (const o of this.grid.query(p.x, p.y, radius, this.near)) {
      if (o === p || !o.alive) continue;
      const dx = o.x - p.x;
      const dy = o.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > radius) continue;
      const k = (power * (1 - d / radius)) / this.effMass(o);
      o.vx += (dx / d) * k;
      o.vy += (dy / d) * k;
      o.lastHit = p;
      o.lastHitT = this.time;
    }
  }

  onLike(p, count) {
    this.dash(p, Math.min(650, 140 + count * 30));
  }

  onChat(p) {
    if (this.time - p.chatT < 1) return;
    p.chatT = this.time;
    this.dash(p, 220);
  }

  onFollow(p) {
    p.mass = Math.min(4, p.mass + 0.3);
  }

  onShare(p) {
    if (p.alive) this.shockwave(p, 200, 600);
  }

  onGift(p, gift) {
    const d = gift.diamonds;
    const tier = giftTier(d);
    if (!p.alive) {
      if (tier < 3 || this.alive.length < 2) return 'Eliminado… 100💎 revive!';
      Object.assign(p, { alive: true, fall: 0, place: 0, x: C.x + rand(-40, 40), y: C.y + rand(-40, 40), vx: 0, vy: 0, shieldT: 6 });
      this.order = this.order.filter((q) => q !== p);
      this.fx.ring(p.x, p.y, '#7fe9ff', 200);
      this.mgr.notify(`✨ ${p.user.name} voltou para a arena!`, '#7fe9ff');
      return 'VOLTOU PRA ARENA!';
    }
    if (tier === 1) {
      p.mass = Math.min(4, p.mass + 0.12 * d);
      p.anchorT = Math.max(p.anchorT, 4);
      return `Mais pesado (${p.mass.toFixed(1)}x)`;
    }
    if (tier === 2) {
      p.mass = Math.min(4, p.mass + 0.4);
      this.shockwave(p, 260, 950);
      return 'ONDA DE CHOQUE!';
    }
    if (tier === 3) {
      p.shieldT = 12;
      this.shockwave(p, 380, 1250);
      return 'ESCUDO + ONDA GIGANTE!';
    }
    p.shieldT = 10;
    for (const o of this.alive) {
      if (o === p) continue;
      const dx = o.x - C.x;
      const dy = o.y - C.y;
      const dd = Math.hypot(dx, dy) || 1;
      const k = 1100 / this.effMass(o);
      o.vx += (dx / dd) * k;
      o.vy += (dy / dd) * k;
      o.lastHit = p;
      o.lastHitT = this.time;
    }
    this.fx.flash('#ff5a1f', 0.5);
    this.fx.shake(30, 0.9);
    this.sfx('boom', 0);
    return '🌋 TERREMOTO!';
  }

  eliminate(p) {
    const alive = this.alive.length;
    p.alive = false;
    p.fall = FALL_TIME;
    p.place = alive;
    this.order.push(p);
    this.fx.burst(p.x, p.y, '#ff7b00', 24, 300, 8);
    this.sfx('pop', 0.05);
    const killer = p.lastHit && this.time - p.lastHitT < 3 && p.lastHit !== p ? p.lastHit : null;
    if (killer) killer.knock++;
    if (alive <= 6) this.mgr.notify(`🔥 ${p.user.name} caiu na lava${killer ? ` (empurrão de ${killer.user.name})` : ''}! Restam ${alive - 1}`, '#ff9d00');
  }

  update(dt) {
    if (this.time > SHRINK_AFTER) this.R = Math.max(RMIN, this.R - SHRINK_SPEED * dt);
    const alive = this.alive;

    this.grid.clear();
    for (const p of alive) this.grid.insert(p);

    for (const p of alive) {
      p.shieldT = Math.max(0, p.shieldT - dt);
      p.anchorT = Math.max(0, p.anchorT - dt);
      // "cérebro": às vezes persegue alguém, às vezes passeia
      p.think -= dt;
      if (p.think <= 0) {
        p.think = rand(0.6, 1.6);
        const foe = Math.random() < 0.45 ? this.nearestFoe(p, 300) : null;
        if (foe) {
          p.tx = foe.x;
          p.ty = foe.y;
        } else {
          const a = rand(0, Math.PI * 2);
          const d = Math.sqrt(Math.random()) * this.R * 0.5;
          p.tx = C.x + Math.cos(a) * d;
          p.ty = C.y + Math.sin(a) * d;
        }
      }
      let ax = p.tx - p.x;
      let ay = p.ty - p.y;
      const al = Math.hypot(ax, ay) || 1;
      ax = (ax / al) * 300;
      ay = (ay / al) * 300;
      const dc = Math.hypot(p.x - C.x, p.y - C.y);
      if (dc > this.R * 0.8) {
        ax += ((C.x - p.x) / dc) * 520;
        ay += ((C.y - p.y) / dc) * 520;
      }
      p.vx += ax * dt;
      p.vy += ay * dt;
      const fr = Math.exp(-1.8 * dt);
      p.vx *= fr;
      p.vy *= fr;
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 750) {
        p.vx *= 750 / sp;
        p.vy *= 750 / sp;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    // trombadas
    for (const a of alive) {
      const ra = this.radius(a);
      for (const b of this.grid.query(a.x, a.y, ra + 60, this.near)) {
        if (b === a || !b.alive || b.user.id < a.user.id) continue;
        const rb = this.radius(b);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        const min = ra + rb;
        if (d2 >= min * min || d2 < 0.01) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const ma = this.effMass(a);
        const mb = this.effMass(b);
        const overlap = min - d;
        a.x -= nx * overlap * (mb / (ma + mb));
        a.y -= ny * overlap * (mb / (ma + mb));
        b.x += nx * overlap * (ma / (ma + mb));
        b.y += ny * overlap * (ma / (ma + mb));
        const vrel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vrel < 0) {
          const j = (-(1 + 0.9) * vrel) / (1 / ma + 1 / mb) + 40;
          a.vx -= (j / ma) * nx;
          a.vy -= (j / ma) * ny;
          b.vx += (j / mb) * nx;
          b.vy += (j / mb) * ny;
          if (-vrel > 250) {
            this.sfx('hit', 0.06);
            this.fx.burst((a.x + b.x) / 2, (a.y + b.y) / 2, '#fff', 5, 160, 4);
          }
        }
        a.lastHit = b;
        a.lastHitT = this.time;
        b.lastHit = a;
        b.lastHitT = this.time;
      }
    }

    // borda: escudo segura; sem escudo, cai na lava
    for (const p of alive) {
      const dx = p.x - C.x;
      const dy = p.y - C.y;
      const d = Math.hypot(dx, dy) || 1;
      const r = this.radius(p);
      if (p.shieldT > 0 && d > this.R - r) {
        p.x = C.x + (dx / d) * (this.R - r);
        p.y = C.y + (dy / d) * (this.R - r);
        const out = (p.vx * dx + p.vy * dy) / d;
        if (out > 0) {
          p.vx -= (dx / d) * out * 1.5;
          p.vy -= (dy / d) * out * 1.5;
        }
      } else if (d > this.R + r * 0.2) this.eliminate(p);
    }

    for (const p of this.players.values()) {
      if (!p.alive && p.fall > 0) {
        p.fall -= dt;
        p.x += p.vx * dt * 0.3;
        p.y += p.vy * dt * 0.3;
      }
    }

    const left = this.alive.length;
    if (this.endIn == null && this.everJoined >= 2 && left <= 1) this.endIn = 2.5;
    if (this.endIn != null) {
      this.endIn -= dt;
      if (this.endIn <= 0) this.finished = true;
    }
  }

  ranking() {
    const alive = this.alive.sort((a, b) => Math.hypot(a.x - C.x, a.y - C.y) - Math.hypot(b.x - C.x, b.y - C.y));
    return [...alive, ...this.order.slice().reverse()];
  }

  result() {
    const order = this.ranking();
    const pts = [100, 60, 40];
    const winners = order.map((p, i) => ({ user: p.user, win: i === 0, points: (pts[i] ?? 5) + p.knock * 10 }));
    const first = order[0];
    const many = this.alive.length > 1;
    const title = !first ? 'Arena vazia!' : many ? `⏱️ Tempo! ${first.user.name} ficou firme no centro` : `🤼 ${first.user.name} é o campeão da arena!`;
    return { title, color: '#ffb347', winners };
  }

  draw(g) {
    // lava
    const lava = g.createRadialGradient(C.x, C.y, RMIN, C.x, C.y, 900);
    lava.addColorStop(0, '#ff6a00');
    lava.addColorStop(0.5, '#a51c00');
    lava.addColorStop(1, '#2a0500');
    g.fillStyle = lava;
    g.fillRect(ARENA.x, ARENA.y + 70, ARENA.w, ARENA.h - 70);
    g.globalAlpha = 0.25;
    for (let i = 0; i < 14; i++) {
      const a = i * 2.4 + this.time * 0.3;
      const rr = 520 + ((i * 37) % 80);
      g.fillStyle = '#ffd36b';
      g.beginPath();
      g.arc(C.x + Math.cos(a) * rr, C.y + Math.sin(a) * rr * 0.8, 10 + (i % 4) * 5 + Math.sin(this.time * 2 + i) * 4, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    // plataforma
    g.fillStyle = '#3b4252';
    g.beginPath();
    g.arc(C.x, C.y, this.R + 12, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#5b6475';
    g.beginPath();
    g.arc(C.x, C.y, this.R, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 3;
    for (let r = 60; r < this.R; r += 70) {
      g.beginPath();
      g.arc(C.x, C.y, r, 0, Math.PI * 2);
      g.stroke();
    }
    const shrinking = this.time > SHRINK_AFTER && this.R > RMIN;
    g.strokeStyle = shrinking ? `rgba(255,207,107,${0.6 + Math.sin(this.time * 8) * 0.4})` : '#ffcf6b';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(C.x, C.y, this.R, 0, Math.PI * 2);
    g.stroke();

    // jogadores (quem está caindo encolhe e some)
    for (const p of this.players.values()) {
      if (p.alive || p.fall <= 0) continue;
      g.globalAlpha = clamp(p.fall / FALL_TIME, 0, 1);
      drawAvatar(g, p.user, p.x, p.y, this.radius(p) * g.globalAlpha, '#ff7b00', 3);
      g.globalAlpha = 1;
    }
    const alive = this.alive;
    const showNames = alive.length <= 30;
    for (const p of alive) {
      const r = this.radius(p);
      if (p.shieldT > 0) {
        g.fillStyle = 'rgba(127,233,255,0.3)';
        g.beginPath();
        g.arc(p.x, p.y, r + 12, 0, Math.PI * 2);
        g.fill();
      }
      drawAvatar(g, p.user, p.x, p.y, r, p.shieldT > 0 ? '#7fe9ff' : p.anchorT > 0 ? '#ffd700' : '#ffffff', 4);
      if (showNames) text(g, fitText(g, p.user.name, 130, 17), p.x, p.y + r + 16, 17);
    }

    // placar
    roundRect(g, 18, ARENA.y + 8, 1044, 58, 14, 'rgba(0,0,0,0.6)');
    text(g, `🤼 De pé: ${alive.length}`, 40, ARENA.y + 37, 30, '#fff', 'left');
    const best = [...this.players.values()].sort((a, b) => b.knock - a.knock)[0];
    if (best?.knock) text(g, `💥 Mais derrubadas: ${fitText(g, best.user.name, 260, 26)} (${best.knock})`, 1040, ARENA.y + 37, 26, '#ffb347', 'right');
    else if (this.closed) text(g, '🚫 Arena fechada para novos jogadores', 1040, ARENA.y + 37, 24, '#ddd', 'right', 700);
  }
}
