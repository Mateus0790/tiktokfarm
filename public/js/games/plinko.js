import { ScoreGame } from './scoregame.js';
import { ARENA, drawAvatar, fitText, giftTier, rand, roundRect, text } from '../core.js';

// Plinko: cada comentário solta uma bolinha com o seu avatar no topo. Ela quica
// nos pinos e cai numa casa de pontos (as das pontas valem mais). Presentes soltam
// bolinhas de ouro que multiplicam os pontos. Quem somar mais pontos vence.

const PEG_R = 8;
const BALL_R = 18;
const ROW_Y0 = ARENA.y + 150;
const ROW_DY = 70;
const ROWS = 11;
const COL_DX = 84;
const SLOT_TOP = ROW_Y0 + ROWS * ROW_DY - 20;
const SLOT_BOTTOM = ARENA.y + ARENA.h - 30;
const VALUES = [50, 20, 10, 5, 2, 1, 2, 5, 10, 20, 50];
const SLOT_W = 1040 / VALUES.length;
const MAX_BALLS = 160;
const LIKES_PER_DROP = 15;

const PEGS = (() => {
  const out = [];
  // simétrico em volta do centro (540): linhas pares 36..1044, ímpares 78..1002
  for (let r = 0; r < ROWS; r++) {
    const off = r % 2 ? COL_DX / 2 : 0;
    for (let k = -6; k <= 6; k++) {
      const x = 540 + off + k * COL_DX;
      if (x >= 30 && x <= 1050) out.push({ x, y: ROW_Y0 + r * ROW_DY, hitT: 0 });
    }
  }
  return out;
})();

const slotColor = (v) => (v >= 50 ? '#ffd700' : v >= 20 ? '#ff7b00' : v >= 10 ? '#ff4d5e' : v >= 5 ? '#8a5cff' : '#3d8bff');

export class PlinkoGame extends ScoreGame {
  static id = 'plinko';
  static title = 'Plinko';
  static emoji = '🎯';

  get instructions() {
    return ['Comente para soltar sua bolinha!', 'As casas das pontas valem mais pontos', `❤️ ${LIKES_PER_DROP} curtidas = uma bolinha extra`];
  }

  get giftGuide() {
    return [
      { icon: '🌹', label: '1+💎', text: 'Bolinhas de ouro (x2) — uma por diamante, até 5' },
      { icon: '🪙', label: '10+💎', text: '3 bolinhas de ouro x3' },
      { icon: '🔮', label: '100+💎', text: 'MEGA BOLA x5 + 3 bolinhas x3' },
      { icon: '🌧️', label: '1000+💎', text: 'CHUVA DE OURO: 10 bolinhas x10' },
    ];
  }

  start() {
    this.balls = [];
    this.slotFlash = VALUES.map(() => 0);
    for (const peg of PEGS) peg.hitT = 0;
  }

  join(user) {
    const p = super.join(user);
    p.credits = 0;
    p.lastDrop = -99;
    this.drop(p);
    return p;
  }

  inFlight(p) {
    return this.balls.some((b) => b.p === p && !b.bonus && !b.landed);
  }

  drop(p, { mult = 1, bonus = false, big = false } = {}) {
    if (this.balls.length >= MAX_BALLS) return false;
    this.balls.push({ p, x: 540 + rand(-160, 160), y: ARENA.y + 95, vx: rand(-40, 40), vy: 0, r: big ? 30 : BALL_R, mult, bonus, landed: false, ttl: 0.4 });
    if (!bonus) p.lastDrop = this.time;
    return true;
  }

  /** Bolinha normal: uma por vez para cada pessoa (as de presente não contam). */
  tryDrop(p) {
    if (this.inFlight(p) || this.time - p.lastDrop < 1.5) return false;
    return this.drop(p);
  }

  onChat(p) {
    if (!this.tryDrop(p)) p.credits = Math.min(3, p.credits + 1);
  }

  onLike(p, count) {
    p.likeAcc += count;
    while (p.likeAcc >= LIKES_PER_DROP) {
      p.likeAcc -= LIKES_PER_DROP;
      p.credits = Math.min(3, p.credits + 1);
    }
  }

  onFollow(p) {
    this.drop(p, { mult: 2, bonus: true });
  }

  onShare(p) {
    for (let i = 0; i < 2; i++) this.drop(p, { mult: 2, bonus: true });
  }

  onGift(p, gift) {
    const d = gift.diamonds;
    const tier = giftTier(d);
    if (tier === 1) {
      const n = Math.min(5, d);
      for (let i = 0; i < n; i++) this.drop(p, { mult: 2, bonus: true });
      return `${n} bolinha${n > 1 ? 's' : ''} de ouro x2`;
    }
    if (tier === 2) {
      for (let i = 0; i < 3; i++) this.drop(p, { mult: 3, bonus: true });
      return '3 bolinhas x3!';
    }
    if (tier === 3) {
      this.drop(p, { mult: 5, bonus: true, big: true });
      for (let i = 0; i < 3; i++) this.drop(p, { mult: 3, bonus: true });
      return '🔮 MEGA BOLA!';
    }
    for (let i = 0; i < 10; i++) this.drop(p, { mult: 10, bonus: true });
    this.fx.flash('#ffd700', 0.5);
    this.sfx('boom', 0);
    return '🌧️ CHUVA DE OURO!';
  }

  botAct(p) {
    if (Math.random() < 0.6) this.tryDrop(p);
  }

  land(b, slot) {
    const value = VALUES[slot] * b.mult;
    b.p.score += value;
    this.slotFlash[slot] = 0.6;
    this.fx.float(b.x, SLOT_TOP - 20, `+${value}`, value >= 50 ? '#ffd700' : '#fff', value >= 50 ? 40 : 30);
    if (VALUES[slot] >= 20) {
      this.fx.burst(b.x, SLOT_TOP + 40, slotColor(VALUES[slot]), 30, 400, 8);
      this.sfx('finish', 0.15);
    } else this.sfx('pop', 0.05);
  }

  update(dt) {
    for (const peg of PEGS) peg.hitT = Math.max(0, peg.hitT - dt);
    this.slotFlash = this.slotFlash.map((f) => Math.max(0, f - dt));
    for (const p of this.players.values()) if (p.credits > 0 && this.tryDrop(p)) p.credits--;

    const steps = 2;
    const h = dt / steps;
    for (const b of this.balls) {
      if (b.landed) {
        b.ttl -= dt;
        continue;
      }
      for (let s = 0; s < steps; s++) {
        b.vy += 1200 * h;
        b.x += b.vx * h;
        b.y += b.vy * h;
        if (b.y < SLOT_TOP) {
          for (const peg of PEGS) {
            const dx = b.x - peg.x;
            const dy = b.y - peg.y;
            const min = b.r + PEG_R;
            const d2 = dx * dx + dy * dy;
            if (d2 >= min * min) continue;
            const d = Math.sqrt(d2) || 1;
            const nx = dx / d;
            const ny = dy / d;
            b.x = peg.x + nx * min;
            b.y = peg.y + ny * min;
            const vn = b.vx * nx + b.vy * ny;
            if (vn < 0) {
              b.vx -= 1.45 * vn * nx;
              b.vy -= 1.45 * vn * ny;
            }
            b.vx += rand(-35, 35); // um pouco de sorte em cada pino
            peg.hitT = 0.15;
          }
          if (b.x < 20 + b.r || b.x > 1060 - b.r) {
            b.x = Math.min(1060 - b.r, Math.max(20 + b.r, b.x));
            b.vx = -b.vx * 0.5;
          }
        } else {
          // dentro da casa: fica presa entre as divisórias
          b.slot ??= Math.min(VALUES.length - 1, Math.max(0, Math.floor((b.x - 20) / SLOT_W)));
          const left = 20 + b.slot * SLOT_W + b.r;
          const right = 20 + (b.slot + 1) * SLOT_W - b.r;
          b.x = Math.min(right, Math.max(left, b.x));
          b.vx *= 0.8;
          if (b.y >= SLOT_BOTTOM - b.r) {
            this.land(b, b.slot);
            b.landed = true;
            break;
          }
        }
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > 900) {
          b.vx *= 900 / sp;
          b.vy *= 900 / sp;
        }
      }
    }
    this.balls = this.balls.filter((b) => !b.landed || b.ttl > 0);
  }

  draw(g) {
    g.fillStyle = '#121a3a';
    g.fillRect(ARENA.x, ARENA.y + 70, ARENA.w, ARENA.h - 70);

    // ranking ao vivo
    const top = this.ranking().slice(0, 3);
    roundRect(g, 18, ARENA.y + 8, 1044, 58, 14, 'rgba(0,0,0,0.6)');
    if (!top.length) text(g, '🎯 Comente para soltar sua bolinha!', 540, ARENA.y + 37, 28, '#b8ffcf', 'center', 800);
    top.forEach((p, i) => {
      const x = 30 + i * 345;
      drawAvatar(g, p.user, x + 24, ARENA.y + 37, 20, '#ffe066', 3);
      text(g, `${['🥇', '🥈', '🥉'][i]} ${fitText(g, p.user.name, 170, 22)} ${p.score}`, x + 52, ARENA.y + 38, 22, '#fff', 'left');
    });

    // pinos
    for (const peg of PEGS) {
      g.fillStyle = peg.hitT > 0 ? '#ffe066' : 'rgba(255,255,255,0.85)';
      g.beginPath();
      g.arc(peg.x, peg.y, PEG_R + (peg.hitT > 0 ? 3 : 0), 0, Math.PI * 2);
      g.fill();
    }

    // casas de pontos
    VALUES.forEach((v, i) => {
      const x = 20 + i * SLOT_W;
      g.globalAlpha = 0.35 + this.slotFlash[i];
      roundRect(g, x + 3, SLOT_TOP, SLOT_W - 6, SLOT_BOTTOM - SLOT_TOP, 10, slotColor(v));
      g.globalAlpha = 1;
      text(g, String(v), x + SLOT_W / 2, SLOT_BOTTOM - 22, 30, '#fff');
    });

    // bolinhas
    for (const b of this.balls) {
      if (b.landed) continue;
      drawAvatar(g, b.p.user, b.x, b.y, b.r, b.mult > 1 ? '#ffd700' : '#ffffff', b.mult > 1 ? 5 : 3);
      if (b.mult > 1) text(g, `x${b.mult}`, b.x + b.r, b.y - b.r, 18, '#ffd700');
    }
  }
}
