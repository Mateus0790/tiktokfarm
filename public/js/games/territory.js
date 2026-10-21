import { Game } from './base.js';
import { ARENA, TEAMS, clamp, drawAvatar, fitText, giftTier, pick, rand, roundRect, text } from '../core.js';

// Domínio de Territórios: cada avatar é uma bolinha que quica pelo mapa pintando
// o chão com a cor do seu time. Quem tiver mais território no fim vence.

const CELL = 40;
const COLS = 27;
const ROWS = 27;
const GX = 0;
const GY = ARENA.y + 80;
const MAX_PLAYERS = 140;

export class TerritoryGame extends Game {
  static id = 'territory';
  static title = 'Domínio de Territórios';
  static emoji = '🎨';

  get instructions() {
    return [
      'Comente 1 🔴  2 🔵  3 🟢  4 🟡 para entrar num time',
      'Seu avatar pinta o mapa sozinho! ❤️ Curtidas = velocidade',
      'O time com mais território no fim vence!',
    ];
  }

  get giftGuide() {
    return [
      { icon: '🌹', label: '1+💎', text: 'Pincel gigante + turbo' },
      { icon: '💣', label: '10+💎', text: 'BOMBA DE TINTA ao seu redor' },
      { icon: '🌊', label: '100+💎', text: 'TSUNAMI no território do time líder' },
      { icon: '👑', label: '1000+💎', text: 'DOMINAÇÃO: pinta uma faixa do mapa' },
    ];
  }

  start() {
    this.cells = new Int8Array(COLS * ROWS).fill(-1);
    this.flash = new Float32Array(COLS * ROWS);
    this.counts = [0, 0, 0, 0];
    this.waves = [];
  }

  join(user, team) {
    if (this.players.size >= MAX_PLAYERS) return null;
    team = this.chooseTeam(team, 4);
    const a = rand(0, Math.PI * 2);
    const p = {
      user,
      team,
      x: rand(GX + 60, GX + COLS * CELL - 60),
      y: rand(GY + 60, GY + ROWS * CELL - 60),
      dir: a,
      r: 26,
      brushT: 0,
      boostT: 0,
      painted: 0,
    };
    this.players.set(user.id, p);
    return p;
  }

  setCell(i, team, p) {
    const old = this.cells[i];
    if (old === team) return;
    if (old >= 0) this.counts[old]--;
    this.cells[i] = team;
    this.counts[team]++;
    this.flash[i] = 1;
    if (p) p.painted++;
  }

  paintCircle(x, y, radius, team, p) {
    const c0 = clamp(Math.floor((x - radius - GX) / CELL), 0, COLS - 1);
    const c1 = clamp(Math.floor((x + radius - GX) / CELL), 0, COLS - 1);
    const r0 = clamp(Math.floor((y - radius - GY) / CELL), 0, ROWS - 1);
    const r1 = clamp(Math.floor((y + radius - GY) / CELL), 0, ROWS - 1);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const cx = GX + c * CELL + CELL / 2;
        const cy = GY + r * CELL + CELL / 2;
        if ((cx - x) ** 2 + (cy - y) ** 2 <= radius * radius) this.setCell(r * COLS + c, team, p);
      }
  }

  bomb(x, y, radius, p) {
    const color = TEAMS[p.team].color;
    this.paintCircle(x, y, radius, p.team, p);
    this.fx.ring(x, y, color, radius * 1.3, 0.7);
    this.fx.burst(x, y, color, 40, radius * 3, 10);
    this.fx.shake(10, 0.3);
  }

  onLike(p, count) {
    p.boostT = Math.min(5, p.boostT + 0.4 + count * 0.05);
  }
  onFollow(p) {
    this.bomb(p.x, p.y, CELL * 2.5, p);
  }
  onShare(p) {
    this.bomb(p.x, p.y, CELL * 3.5, p);
  }

  onGift(p, gift) {
    const d = gift.diamonds;
    const tier = giftTier(d);
    if (tier === 1) {
      p.brushT = Math.min(40, p.brushT + 6 + d * 2);
      p.boostT = Math.min(8, p.boostT + 2 + d);
      return 'Pincel gigante!';
    }
    if (tier === 2) {
      p.brushT = Math.min(40, p.brushT + 15);
      this.bomb(p.x, p.y, CELL * (4 + Math.min(3, d / 30)), p);
      return 'BOMBA DE TINTA!';
    }
    if (tier === 3) {
      // ataca a área do time líder (que não seja o seu)
      const leader = [0, 1, 2, 3].filter((t) => t !== p.team).sort((a, b) => this.counts[b] - this.counts[a])[0];
      const owned = [];
      for (let i = 0; i < this.cells.length; i++) if (this.cells[i] === leader) owned.push(i);
      const i = owned.length ? pick(owned) : Math.floor(Math.random() * this.cells.length);
      const x = GX + (i % COLS) * CELL + CELL / 2;
      const y = GY + Math.floor(i / COLS) * CELL + CELL / 2;
      this.bomb(x, y, CELL * 7.5, p);
      this.bomb(p.x, p.y, CELL * 4, p);
      return 'TSUNAMI DE TINTA!';
    }
    const row = clamp(Math.floor((p.y - GY) / CELL), 4, ROWS - 5);
    this.waves.push({ p, row0: row - 5, row1: row + 5, col: 0, acc: 0 });
    this.fx.flash(TEAMS[p.team].color, 0.4);
    return '👑 DOMINAÇÃO!';
  }

  update(dt) {
    const w = COLS * CELL;
    const h = ROWS * CELL;
    for (const p of this.players.values()) {
      p.brushT = Math.max(0, p.brushT - dt);
      p.boostT = Math.max(0, p.boostT - dt);
      p.dir += rand(-1.2, 1.2) * dt; // um pouco de "vontade própria"
      const speed = 230 * (p.boostT > 0 ? 1.7 : 1);
      p.x += Math.cos(p.dir) * speed * dt;
      p.y += Math.sin(p.dir) * speed * dt;
      if (p.x < GX + p.r || p.x > GX + w - p.r) {
        p.dir = Math.PI - p.dir;
        p.x = clamp(p.x, GX + p.r, GX + w - p.r);
      }
      if (p.y < GY + p.r || p.y > GY + h - p.r) {
        p.dir = -p.dir;
        p.y = clamp(p.y, GY + p.r, GY + h - p.r);
      }
      this.paintCircle(p.x, p.y, p.brushT > 0 ? 70 : 32, p.team, p);
    }

    for (const wv of this.waves) {
      wv.acc += dt * 30; // colunas por segundo
      while (wv.acc >= 1 && wv.col < COLS) {
        wv.acc -= 1;
        for (let r = wv.row0; r <= wv.row1; r++) this.setCell(r * COLS + wv.col, wv.p.team, wv.p);
        this.fx.burst(GX + wv.col * CELL, GY + ((wv.row0 + wv.row1) / 2) * CELL, TEAMS[wv.p.team].color, 4, 300, 8);
        wv.col++;
      }
    }
    this.waves = this.waves.filter((wv) => wv.col < COLS);

    for (let i = 0; i < this.flash.length; i++) if (this.flash[i] > 0) this.flash[i] = Math.max(0, this.flash[i] - dt * 3);
  }

  result() {
    const order = [0, 1, 2, 3].sort((a, b) => this.counts[b] - this.counts[a]);
    const t = TEAMS[order[0]];
    const pct = Math.round((this.counts[order[0]] / this.cells.length) * 100);
    const winners = [...this.players.values()]
      .map((p) => ({ user: p.user, win: p.team === t.id, points: Math.round((p.team === t.id ? 50 : 5) + p.painted / 8) }))
      .sort((a, b) => b.win - a.win || b.points - a.points);
    return { title: `${t.emoji} Time ${t.name} dominou ${pct}% do mapa!`, color: t.color, winners };
  }

  draw(g) {
    // barra de domínio
    const total = this.cells.length;
    let x = 20;
    const bw = 1040;
    roundRect(g, 18, ARENA.y + 8, bw + 4, 54, 14, 'rgba(0,0,0,0.6)');
    for (let t = 0; t < 4; t++) {
      const w = (this.counts[t] / total) * bw;
      if (w < 1) continue;
      g.fillStyle = TEAMS[t].color;
      g.fillRect(x, ARENA.y + 10, w, 50);
      if (w > 90) text(g, `${Math.round((this.counts[t] / total) * 100)}%`, x + w / 2, ARENA.y + 36, 28);
      x += w;
    }

    // mapa
    g.fillStyle = '#151a2e';
    g.fillRect(GX, GY, COLS * CELL, ROWS * CELL);
    for (let i = 0; i < this.cells.length; i++) {
      const o = this.cells[i];
      const cx = GX + (i % COLS) * CELL;
      const cy = GY + Math.floor(i / COLS) * CELL;
      if (o >= 0) {
        g.fillStyle = TEAMS[o].color;
        g.globalAlpha = 0.75;
        g.fillRect(cx + 1, cy + 1, CELL - 2, CELL - 2);
        if (this.flash[i] > 0) {
          g.globalAlpha = this.flash[i] * 0.8;
          g.fillStyle = '#fff';
          g.fillRect(cx + 1, cy + 1, CELL - 2, CELL - 2);
        }
        g.globalAlpha = 1;
      } else {
        g.fillStyle = 'rgba(255,255,255,0.035)';
        g.fillRect(cx + 1, cy + 1, CELL - 2, CELL - 2);
      }
    }

    const showNames = this.players.size <= 40;
    for (const p of this.players.values()) {
      const t = TEAMS[p.team];
      if (p.brushT > 0) {
        g.fillStyle = t.color;
        g.globalAlpha = 0.25;
        g.beginPath();
        g.arc(p.x, p.y, 70, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      }
      drawAvatar(g, p.user, p.x, p.y, p.r, p.boostT > 0 ? '#fff' : t.dark, 5);
      if (showNames) text(g, fitText(g, p.user.name, 130, 17), p.x, p.y + p.r + 16, 17);
    }
  }
}
