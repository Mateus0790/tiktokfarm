import { Game } from './base.js';
import { ARENA, drawAvatar, fitText, giftTier, roundRect, text } from '../core.js';

// Base dos jogos de chat (Quiz e Adivinha a Palavra): cada pessoa só tem uma
// pontuação. Presentes dão multiplicador para o próximo acerto e ajudas.

const LIKES_PER_POINT = 20;
const MAX_LIKE_POINTS = 20;

export class ScoreGame extends Game {
  join(user) {
    const p = { user, score: 0, mult: 1, likeAcc: 0, likePoints: 0, correct: 0 };
    this.players.set(user.id, p);
    return p;
  }

  /** Ajuda para todo mundo (eliminar alternativa / revelar letra). Implementado em cada jogo. */
  helpAll() {
    return false;
  }

  /** Soma pontos de um acerto (aplica e consome o multiplicador). */
  award(p, base) {
    const pts = Math.round(base * p.mult);
    p.score += pts;
    p.correct++;
    p.mult = 1;
    return pts;
  }

  onLike(p, count) {
    p.likeAcc += count;
    while (p.likeAcc >= LIKES_PER_POINT && p.likePoints < MAX_LIKE_POINTS) {
      p.likeAcc -= LIKES_PER_POINT;
      p.likePoints++;
      p.score++;
    }
  }

  onFollow(p) {
    p.score += 10;
  }

  onShare(p) {
    p.score += 15;
  }

  onGift(p, gift) {
    const tier = giftTier(gift.diamonds);
    if (tier === 1) {
      p.mult = Math.min(5, p.mult + 1);
      return `Próximo acerto vale x${p.mult}`;
    }
    if (tier === 2) {
      p.mult = Math.max(p.mult, 3);
      this.helpAll();
      return `x${p.mult} + ${this.helpLabel}`;
    }
    if (tier === 3) {
      p.score += 50;
      p.mult = Math.max(p.mult, 3);
      this.helpAll();
      return `+50 pontos + x${p.mult}`;
    }
    p.score += 300;
    p.mult = 5;
    this.fx.flash('#ffd700', 0.4);
    return '+300 pontos + x5!';
  }

  ranking() {
    return [...this.players.values()].sort((a, b) => b.score - a.score || b.correct - a.correct);
  }

  result() {
    const order = this.ranking();
    const top = order[0];
    const winners = order.map((p, i) => ({ user: p.user, win: i === 0 && p.score > 0, points: Math.round(p.score / 10) + (i === 0 ? 30 : 0) }));
    const title = top && top.score > 0 ? `${this.constructor.emoji} ${top.user.name} venceu com ${top.score} pontos!` : 'Ninguém pontuou dessa vez!';
    return { title, color: '#ffe066', winners };
  }

  /** Placar com os 4 primeiros, em duas colunas. */
  drawScoreboard(g, y) {
    const top = this.ranking().slice(0, 4);
    roundRect(g, 20, y, 1040, ARENA.y + ARENA.h - y - 10, 22, 'rgba(10,10,30,0.75)', 'rgba(255,255,255,0.12)', 3);
    text(g, '🏆 PLACAR', 540, y + 28, 26, '#ffe066');
    top.forEach((p, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 50 + col * 520;
      const yy = y + 72 + row * 54;
      text(g, `${i + 1}º`, x, yy, 24, '#ffe066', 'left');
      drawAvatar(g, p.user, x + 68, yy, 20, '#fff', 3);
      text(g, fitText(g, p.user.name, 240, 24, 800), x + 98, yy, 24, '#fff', 'left', 800);
      text(g, `${p.score}${p.mult > 1 ? ` (x${p.mult})` : ''}`, x + 470, yy, 24, p.mult > 1 ? '#ffb347' : '#ccc', 'right', 800);
    });
    if (!top.length) text(g, 'Ninguém pontuou ainda — participe pelo chat!', 540, y + 100, 26, '#aaa', 'center', 700);
  }
}
