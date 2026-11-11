import { Game } from './base.js';
import { ARENA, TEAMS, clamp, drawAvatar, fitText, giftTier, roundRect, text } from '../core.js';

// Cabo de Guerra: time Vermelho x time Azul. Cada curtida, comentário e presente
// puxa a corda para o seu lado. Quem arrastar a marca até a sua linha vence a
// rodada; melhor de 3.

const ROPE_Y = 930;
const HALF = 380; // distância do centro até a linha de vitória
const ROUND_TIME = 60;
const PULL_K = 0.01; // quanto cada "unidade" de puxão move a corda
const DRAG = 2; // a corda perde velocidade sozinha
const SIDES = [0, 1]; // índices em TEAMS: Vermelho (esquerda) e Azul (direita)

export class TugGame extends Game {
  static id = 'tug';
  static title = 'Cabo de Guerra';
  static emoji = '🪢';

  get instructions() {
    return ['Comente 1 🔴 ou 2 🔵 para escolher seu time', '❤️ Cada curtida e 💬 comentário puxa a corda!', 'Arraste a marca até a sua linha. Melhor de 3!'];
  }

  get giftGuide() {
    return [
      { icon: '🌹', label: '1+💎', text: 'Puxão (mais diamantes = mais forte)' },
      { icon: '💪', label: '10+💎', text: 'PUXÃO FORTE' },
      { icon: '🦍', label: '100+💎', text: 'PUXÃO DE GORILA (quase decide a rodada)' },
      { icon: '🚜', label: '1000+💎', text: 'TRATOR: arrasta a corda até a sua linha' },
    ];
  }

  start() {
    this.pos = 0; // -1 = vitória do Vermelho, +1 = vitória do Azul
    this.vel = 0;
    this.wins = [0, 0];
    this.round = 1;
    this.roundT = ROUND_TIME;
    this.pause = 0; // comemoração entre rodadas
    this.rate = [0, 0]; // força recente de cada time (para a animação)
    this.lastWinner = null;
    this.pending = []; // presentes recebidos entre rodadas, aplicados quando a próxima começa
  }

  join(user, team) {
    const t = this.chooseTeam(team, 2);
    const p = { user, team: t, pulled: 0, chatT: -99, pullT: 0 };
    this.players.set(user.id, p);
    return p;
  }

  pull(p, amount) {
    if (this.pause > 0) return;
    const dir = p.team === 0 ? -1 : 1;
    this.vel += dir * amount * PULL_K;
    this.rate[p.team] += amount;
    p.pulled += amount;
    p.pullT = 0.3;
  }

  onLike(p, count) {
    this.pull(p, Math.min(count, 15) * 0.6);
  }

  onChat(p) {
    if (this.time - p.chatT < 1) return;
    p.chatT = this.time;
    this.pull(p, 3);
  }

  onFollow(p) {
    this.pull(p, 15);
  }

  onShare(p) {
    this.pull(p, 20);
  }

  onGift(p, gift) {
    const d = gift.diamonds;
    const tier = giftTier(d);
    const color = TEAMS[SIDES[p.team]].color;
    const [x, y] = [540 + this.pos * HALF, ROPE_Y];
    if (this.pause > 0) {
      if (this.over) return 'Fim de jogo!';
      const amount = [0, d * 6, 40 + d, 100 + d * 0.2, 320][tier];
      this.pending.push({ p, amount });
      return 'Vale na próxima rodada!';
    }
    if (tier === 1) {
      this.pull(p, d * 6);
      return 'Puxão!';
    }
    if (tier === 2) {
      this.pull(p, 40 + d);
      this.fx.burst(x, y, color, 30, 400, 8);
      return '💪 PUXÃO FORTE!';
    }
    if (tier === 3) {
      this.pull(p, 100 + d * 0.2);
      this.fx.burst(x, y, color, 60, 600, 10);
      this.fx.shake(14, 0.4);
      this.sfx('boom', 0.1);
      return '🦍 PUXÃO DE GORILA!';
    }
    this.pull(p, 320);
    this.fx.flash(color, 0.4);
    this.fx.shake(25, 0.7);
    this.sfx('boom', 0);
    return '🚜 TRATOR!';
  }

  winRound(team) {
    this.wins[team]++;
    this.lastWinner = team;
    const t = TEAMS[SIDES[team]];
    this.mgr.notify(`🏆 Time ${t.name} venceu a rodada ${this.round}!`, t.color);
    this.fx.burst(540 + (team === 0 ? -HALF : HALF), ROPE_Y, t.color, 80, 600, 10);
    this.sfx('finish', 0);
    if (this.wins[team] >= 2) {
      this.pause = 3;
      this.over = true;
    } else this.pause = 4;
  }

  update(dt) {
    this.rate = this.rate.map((r) => r * Math.exp(-1.5 * dt));
    for (const p of this.players.values()) p.pullT = Math.max(0, p.pullT - dt);

    if (this.pause > 0) {
      this.pause -= dt;
      if (this.pause <= 0) {
        if (this.over) {
          this.finished = true;
          return;
        }
        this.round++;
        this.pos = 0;
        this.vel = 0;
        this.roundT = ROUND_TIME;
        for (const { p, amount } of this.pending.splice(0)) this.pull(p, amount);
      }
      return;
    }

    this.vel *= Math.exp(-DRAG * dt);
    this.pos += this.vel * dt;
    this.roundT -= dt;
    if (this.pos <= -1) {
      this.pos = -1;
      this.winRound(0);
    } else if (this.pos >= 1) {
      this.pos = 1;
      this.winRound(1);
    } else if (this.roundT <= 0) {
      // tempo da rodada acabou: vence quem está com a corda do seu lado
      if (Math.abs(this.pos) > 0.02) this.winRound(this.pos < 0 ? 0 : 1);
      else this.roundT = 10; // empate total: mais 10 segundos
    }
  }

  timeUp() {
    this.finished = true;
  }

  winnerTeam() {
    if (this.wins[0] !== this.wins[1]) return this.wins[0] > this.wins[1] ? 0 : 1;
    return this.pos <= 0 ? 0 : 1;
  }

  result() {
    const w = this.winnerTeam();
    const t = TEAMS[SIDES[w]];
    const winners = [...this.players.values()]
      .map((p) => ({ user: p.user, win: p.team === w, points: Math.round((p.team === w ? 40 : 5) + p.pulled / 5) }))
      .sort((a, b) => b.win - a.win || b.points - a.points);
    return { title: `🪢 Time ${t.name} venceu o cabo de guerra! (${this.wins[0]} x ${this.wins[1]})`, color: t.color, winners };
  }

  teamList(team) {
    return [...this.players.values()].filter((p) => p.team === team).sort((a, b) => b.pulled - a.pulled);
  }

  draw(g) {
    // chão: grama dos lados, lama no meio
    g.fillStyle = '#2f6b3a';
    g.fillRect(ARENA.x, ARENA.y + 70, ARENA.w, ARENA.h - 70);
    g.fillStyle = '#6b4a2b';
    g.beginPath();
    g.ellipse(540, ROPE_Y + 40, 150, 260, 0, 0, Math.PI * 2);
    g.fill();
    for (const [team, sx] of [
      [0, 540 - HALF],
      [1, 540 + HALF],
    ]) {
      g.fillStyle = TEAMS[SIDES[team]].color;
      g.globalAlpha = 0.8;
      g.fillRect(sx - 5, ARENA.y + 160, 10, ARENA.h - 180);
      g.globalAlpha = 1;
    }

    // placar
    roundRect(g, 18, ARENA.y + 8, 1044, 64, 14, 'rgba(0,0,0,0.6)');
    const L = TEAMS[SIDES[0]];
    const R = TEAMS[SIDES[1]];
    text(g, `${L.emoji} ${L.name}`, 40, ARENA.y + 40, 30, L.color, 'left');
    text(g, `${R.name} ${R.emoji}`, 1040, ARENA.y + 40, 30, R.color, 'right');
    text(g, `${this.wins[0]}  x  ${this.wins[1]}`, 540, ARENA.y + 40, 40, '#fff');
    text(g, this.pause > 0 ? (this.over ? 'FIM!' : `Rodada ${this.round + 1} já vai começar`) : `Rodada ${this.round} · ⏱ ${Math.ceil(Math.max(0, this.roundT))}s`, 540, ARENA.y + 110, 28, '#ffe066');

    // corda
    const cx = 540 + this.pos * HALF;
    g.strokeStyle = '#d9b77a';
    g.lineWidth = 16;
    g.beginPath();
    g.moveTo(40, ROPE_Y);
    g.lineTo(1040, ROPE_Y);
    g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 3;
    for (let x = 40; x < 1040; x += 24) {
      g.beginPath();
      g.moveTo(x, ROPE_Y - 7);
      g.lineTo(x + 12, ROPE_Y + 7);
      g.stroke();
    }
    // marca do centro da corda
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(cx, ROPE_Y - 10);
    g.lineTo(cx - 22, ROPE_Y - 60);
    g.lineTo(cx + 22, ROPE_Y - 60);
    g.fill();
    g.fillStyle = this.pos < -0.02 ? L.color : this.pos > 0.02 ? R.color : '#ffe066';
    g.beginPath();
    g.arc(cx, ROPE_Y, 22, 0, Math.PI * 2);
    g.fill();

    // barra de força (quem está puxando mais agora)
    const total = this.rate[0] + this.rate[1];
    const share = total > 0.5 ? this.rate[0] / total : 0.5;
    roundRect(g, 140, ROPE_Y + 330, 800, 26, 13, R.color);
    roundRect(g, 140, ROPE_Y + 330, Math.max(26, 800 * share), 26, 13, L.color);
    text(g, '💪 FORÇA AGORA', 540, ROPE_Y + 375, 22, '#fff', 'center', 800);

    // times segurando a corda (os que mais puxaram ficam na frente)
    for (const team of [0, 1]) {
      const list = this.teamList(team);
      const shown = list.slice(0, 10);
      const dir = team === 0 ? -1 : 1;
      const lean = clamp(this.rate[team] / 40, 0, 1) * 10;
      shown.forEach((p, i) => {
        const x = cx + dir * (90 + i * 44);
        if (x < 30 || x > 1050) return;
        const y = ROPE_Y + (i % 2 ? 46 : -46) - (p.pullT > 0 ? 8 : 0);
        const r = i < 3 ? 26 : 21;
        drawAvatar(g, p.user, x + dir * lean, y, r, TEAMS[SIDES[team]].color, 4);
        if (i < 3) text(g, fitText(g, p.user.name, 110, 15), x + dir * lean, y + (i % 2 ? 1 : -1) * (r + 14), 15);
      });
      const extra = list.length - shown.length;
      const tx = team === 0 ? 110 : 970;
      text(g, `👥 ${list.length}${extra > 0 ? ` (+${extra})` : ''}`, tx, ROPE_Y - 150, 28, TEAMS[SIDES[team]].color);
    }

    if (this.pause > 0 && this.lastWinner != null) {
      const t = TEAMS[SIDES[this.lastWinner]];
      text(g, `${t.emoji} ${t.name.toUpperCase()} VENCEU A RODADA!`, 540, ROPE_Y - 230, 46, t.color);
    }
  }
}

