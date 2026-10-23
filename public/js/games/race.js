import { Game } from './base.js';
import { ARENA, drawAvatar, fitText, giftTier, lerp, rand, roundRect, text } from '../core.js';

// Corrida Maluca: cada avatar corre sozinho. Comentários e curtidas empurram,
// presentes dão turbo, escudo, raio nos líderes e teleporte.

const LANES = 16;
const TOP = ARENA.y + 90;
const LANE_H = (ARENA.y + ARENA.h - 10 - TOP) / LANES;
const START_X = 120;
const FINISH_X = 985;
const MAX_RACERS = 64;
const BASE_SPEED = 1 / 105; // ~105s para terminar sem ajuda

export class RaceGame extends Game {
  static id = 'race';
  static title = 'Corrida Maluca';
  static emoji = '🏁';

  get instructions() {
    return [
      'Comente para entrar na corrida!',
      '💬 Cada comentário e ❤️ curtida empurra seu avatar',
      'Os 3 primeiros a cruzar a linha vencem!',
    ];
  }

  get giftGuide() {
    return [
      { icon: '🌹', label: '1+💎', text: 'TURBO (mais diamantes = mais tempo)' },
      { icon: '🛡️', label: '10+💎', text: 'Pulo à frente + ESCUDO contra raios' },
      { icon: '⚡', label: '100+💎', text: 'RAIO atordoa os 5 líderes' },
      { icon: '🚀', label: '1000+💎', text: 'FOGUETE: teleporta 30% à frente' },
    ];
  }

  start() {
    this.placed = [];
    this.endIn = null;
  }

  join(user) {
    if (this.players.size >= MAX_RACERS || this.endIn != null) return null;
    const i = this.players.size;
    const lane = i % LANES;
    const sub = Math.floor(i / LANES);
    const p = {
      user,
      lane,
      sub,
      prog: 0,
      phase: rand(0, 10),
      turboT: 0,
      stunT: 0,
      shieldT: 0,
      lastChat: 0,
      place: 0,
      bump: 0,
    };
    this.players.set(user.id, p);
    return p;
  }

  active(p) {
    return !p.place;
  }

  push(p, amount) {
    if (!this.active(p) || p.stunT > 0) return;
    p.prog += amount;
    p.bump = 0.25;
  }

  onChat(p) {
    if (this.time - p.lastChat < 1) return;
    p.lastChat = this.time;
    this.push(p, 0.006);
  }
  onLike(p, count) {
    this.push(p, 0.0012 * Math.min(count, 15));
  }
  onFollow(p) {
    p.turboT = Math.max(p.turboT, 2);
  }
  onShare(p) {
    p.turboT = Math.max(p.turboT, 3);
  }

  onGift(p, gift) {
    if (!this.active(p)) return 'Já cruzou a linha! 🏆';
    const d = gift.diamonds;
    const tier = giftTier(d);
    if (tier === 1) {
      p.turboT = Math.min(12, p.turboT + 1.2 * d);
      return 'TURBO!';
    }
    if (tier === 2) {
      p.stunT = 0;
      p.prog += 0.08;
      p.shieldT = 15;
      p.turboT = Math.max(p.turboT, 3);
      return 'ESCUDO + PULO!';
    }
    if (tier === 3) {
      const leaders = [...this.players.values()]
        .filter((q) => q !== p && this.active(q))
        .sort((a, b) => b.prog - a.prog)
        .slice(0, 5);
      for (const q of leaders) {
        if (q.shieldT > 0) {
          q.shieldT = 0;
          this.fx.float(this.xOf(q), this.yOf(q) - 40, 'Escudo quebrou!', '#9be7ff', 24);
          continue;
        }
        q.stunT = 3;
        q.turboT = 0;
        this.fx.burst(this.xOf(q), this.yOf(q), '#ffe066', 16, 260);
      }
      p.prog += 0.1;
      this.fx.flash('#ffe066', 0.3);
      this.sfx('boom', 0);
      return '⚡ RAIO NOS LÍDERES!';
    }
    p.prog += 0.3;
    p.turboT = 5;
    this.fx.burst(this.xOf(p), this.yOf(p), '#ff7b00', 50, 500, 10);
    this.fx.shake(18, 0.5);
    return '🚀 FOGUETE!';
  }

  xOf(p) {
    return lerp(START_X, FINISH_X, Math.min(1, p.prog));
  }
  yOf(p) {
    const offs = [0, -16, 16, -8];
    return TOP + LANE_H * (p.lane + 0.5) + offs[p.sub % offs.length];
  }

  update(dt) {
    for (const p of this.players.values()) {
      p.bump = Math.max(0, p.bump - dt);
      p.shieldT = Math.max(0, p.shieldT - dt);
      if (!this.active(p)) continue;
      if (p.stunT > 0) {
        p.stunT -= dt;
        continue;
      }
      const wobble = 1 + Math.sin(this.time * 0.9 + p.phase) * 0.3;
      let speed = BASE_SPEED * wobble;
      if (p.turboT > 0) {
        p.turboT -= dt;
        speed *= 2.8;
        if (Math.random() < 0.5) this.fx.burst(this.xOf(p) - 26, this.yOf(p), '#ff9d00', 1, 80, 6);
      }
      p.prog += speed * dt;
      if (p.prog >= 1) {
        p.prog = 1;
        this.placed.push(p);
        p.place = this.placed.length;
        const medal = ['🥇', '🥈', '🥉'][p.place - 1] || '🏁';
        this.fx.burst(FINISH_X, this.yOf(p), '#ffe066', 40, 400, 9);
        this.sfx('finish', 0.2);
        this.mgr.notify(`${medal} ${p.user.name} cruzou a linha em ${p.place}º!`, '#ffe066');
      }
    }
    const podium = Math.min(3, this.players.size);
    if (this.endIn == null && podium > 0 && this.placed.length >= podium) this.endIn = 3;
    if (this.endIn != null) {
      this.endIn -= dt;
      if (this.endIn <= 0) this.finished = true;
    }
  }

  ranking() {
    return [...this.players.values()].sort((a, b) => (a.place || 999) - (b.place || 999) || b.prog - a.prog);
  }

  result() {
    const order = this.ranking();
    const pts = [100, 60, 40];
    const winners = order.map((p, i) => ({ user: p.user, win: i === 0, points: pts[i] ?? Math.round(5 + p.prog * 15) }));
    const first = order[0];
    return { title: first ? `🏁 ${first.user.name} venceu a corrida!` : 'Corrida encerrada', color: '#ffe066', winners };
  }

  draw(g) {
    // pista
    for (let l = 0; l < LANES; l++) {
      g.fillStyle = l % 2 ? '#3a3f4b' : '#434957';
      g.fillRect(0, TOP + l * LANE_H, 1080, LANE_H);
    }
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.setLineDash([20, 18]);
    g.lineWidth = 2;
    for (let l = 1; l < LANES; l++) {
      g.beginPath();
      g.moveTo(0, TOP + l * LANE_H);
      g.lineTo(1080, TOP + l * LANE_H);
      g.stroke();
    }
    g.setLineDash([]);
    g.fillStyle = '#fff';
    g.fillRect(START_X - 4, TOP, 6, LANES * LANE_H);
    const sq = 14;
    for (let y = 0; y * sq < LANES * LANE_H; y++)
      for (let x = 0; x < 3; x++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
        g.fillRect(FINISH_X + 20 + x * sq, TOP + y * sq, sq, Math.min(sq, LANES * LANE_H - y * sq));
      }

    // ranking ao vivo
    const order = this.ranking();
    roundRect(g, 18, ARENA.y + 8, 1044, 66, 14, 'rgba(0,0,0,0.6)');
    const medals = ['🥇', '🥈', '🥉'];
    for (let i = 0; i < 3; i++) {
      const p = order[i];
      if (!p) break;
      const x = 30 + i * 345;
      drawAvatar(g, p.user, x + 26, ARENA.y + 41, 22, '#ffe066', 3);
      text(g, `${medals[i]} ${fitText(g, p.user.name, 230, 24)}`, x + 58, ARENA.y + 42, 24, '#fff', 'left');
    }

    const showNames = this.players.size <= 32;
    // desenha de trás pra frente para os líderes ficarem por cima
    for (const p of order.slice().reverse()) {
      const x = this.xOf(p);
      const y = this.yOf(p) - (p.bump > 0 ? Math.sin((p.bump / 0.25) * Math.PI) * 8 : 0);
      const r = 25;
      if (p.shieldT > 0) {
        g.fillStyle = 'rgba(155,231,255,0.35)';
        g.beginPath();
        g.arc(x, y, r + 14, 0, Math.PI * 2);
        g.fill();
      }
      const ring = p.place === 1 ? '#ffd700' : p.place === 2 ? '#c0c0c0' : p.place === 3 ? '#cd7f32' : p.turboT > 0 ? '#ff9d00' : '#fff';
      drawAvatar(g, p.user, x, y, r, ring, 4);
      if (p.stunT > 0) text(g, '💫', x, y - r - 10, 26, '#fff', 'center', 900, false);
      if (showNames && x > START_X + 140) text(g, fitText(g, p.user.name, 130, 17), x - r - 8, y, 17, '#fff', 'right');
      else if (showNames) text(g, fitText(g, p.user.name, 130, 17), x + r + 8, y, 17, '#fff', 'left');
    }
  }
}
