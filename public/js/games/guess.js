import { ScoreGame } from './scoregame.js';
import { ARENA, bar, content, drawAvatar, editDistance, fitText, normalizeText, pick, roundRect, shuffle, text } from '../core.js';

// Adivinha a Palavra (estilo Gartic): aparece a categoria e os espaços da palavra.
// Com o tempo surgem letras e uma dica em emoji. Os 3 primeiros a escrever a
// palavra no chat pontuam (quanto menos letras reveladas, mais pontos).

const ROUND_TIME = 40;
const SHOW_TIME = 5;
const LETTER_TIMES = [8, 24, 30, 35]; // segundos após o início em que uma letra aparece
const EMOJI_TIME = 16;
const PRIZES = [100, 70, 50];

const isLetter = (ch) => /[\p{L}\p{N}]/u.test(ch);

export class GuessGame extends ScoreGame {
  static id = 'guess';
  static title = 'Adivinha a Palavra';
  static emoji = '✏️';

  get instructions() {
    return ['Adivinhe a palavra e escreva no chat!', 'Letras e uma dica em emoji aparecem com o tempo', 'Os 3 primeiros a acertar ganham pontos'];
  }

  get giftGuide() {
    return [
      { icon: '🌹', label: '1+💎', text: 'Próximo acerto vale x2 (acumula até x5)' },
      { icon: '🔤', label: '10+💎', text: 'x3 + revela uma letra para todos' },
      { icon: '💰', label: '100+💎', text: '+50 pontos + x3 + revela uma letra' },
      { icon: '👑', label: '1000+💎', text: '+300 pontos + x5' },
    ];
  }

  get helpLabel() {
    return 'revelou uma letra';
  }

  start() {
    this.deck = [];
    this.num = 0;
    this.nextRound();
  }

  nextRound() {
    if (!this.deck.length) this.deck = shuffle(content.palavras.slice());
    this.word = this.deck.pop() || { c: 'Palavra', w: 'tiktok', e: '🎵' };
    this.chars = [...this.word.w.toUpperCase()];
    this.target = normalizeText(this.word.w).replace(/ /g, '');
    this.letterIdx = this.chars.map((ch, i) => (isLetter(ch) ? i : -1)).filter((i) => i >= 0);
    this.maxReveal = Math.max(1, Math.floor(this.letterIdx.length / 2));
    this.revealed = new Set();
    this.emojiShown = false;
    this.correct = [];
    this.guesses = [];
    this.state = 'guess';
    this.t = ROUND_TIME;
    this.num++;
  }

  revealLetter(force = false) {
    const hidden = this.letterIdx.filter((i) => !this.revealed.has(i));
    if (hidden.length <= 1 || (!force && this.revealed.size >= this.maxReveal)) return false;
    // a primeira letra revelada é sempre a inicial
    this.revealed.add(this.revealed.size === 0 && !this.revealed.has(this.letterIdx[0]) ? this.letterIdx[0] : pick(hidden));
    this.sfx('tick', 0.1);
    return true;
  }

  helpAll() {
    return this.state === 'guess' && this.revealLetter(true);
  }

  isRight(text) {
    const tokens = normalizeText(text).split(' ').filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      let joined = '';
      for (let j = i; j < Math.min(tokens.length, i + 3); j++) if ((joined += tokens[j]) === this.target) return true;
    }
    return false;
  }

  guess(p, text) {
    if (this.state !== 'guess' || this.correct.some((c) => c.user.id === p.user.id)) return;
    if (this.isRight(text)) {
      const base = Math.max(30, PRIZES[this.correct.length] - this.revealed.size * 8 - (this.emojiShown ? 10 : 0));
      this.correct.push({ user: p.user, pts: this.award(p, base) });
      const medal = ['🥇', '🥈', '🥉'][this.correct.length - 1];
      this.mgr.notify(`${medal} ${p.user.name} acertou a palavra!`, '#2ee67a');
      this.sfx('finish', 0);
      if (this.correct.length >= PRIZES.length) this.endRound();
      return;
    }
    const n = normalizeText(text);
    if (!n || n.length > 24) return;
    const close = this.target.length >= 4 && editDistance(n.replace(/ /g, ''), this.target) <= 1;
    this.guesses.push({ user: p.user, text: String(text).slice(0, 18), close, t: 0 });
    if (this.guesses.length > 6) this.guesses.shift();
  }

  onChat(p, text) {
    this.guess(p, text);
  }

  botAct(p) {
    if (this.state !== 'guess' || Math.random() < 0.6) return;
    const knows = this.revealed.size >= 2 && Math.random() < 0.25;
    this.guess(p, knows ? this.word.w : pick(content.palavras.length ? content.palavras : [{ w: 'hmm' }]).w);
  }

  endRound() {
    this.state = 'show';
    this.t = SHOW_TIME;
    if (!this.correct.length) this.sfx('hurt', 0);
  }

  update(dt) {
    this.t -= dt;
    for (const g of this.guesses) g.t += dt;
    if (this.state === 'show') {
      if (this.t <= 0) this.nextRound();
      return;
    }
    const elapsed = ROUND_TIME - this.t;
    if (!this.emojiShown && elapsed >= EMOJI_TIME) {
      this.emojiShown = true;
      this.sfx('freeze', 0);
    }
    while (this.revealed.size < LETTER_TIMES.filter((s) => elapsed >= s).length && this.revealLetter()) {}
    const sec = Math.ceil(this.t);
    if (sec <= 3 && sec > 0 && sec !== this.lastTick) {
      this.lastTick = sec;
      this.sfx('tick', 0);
    }
    if (this.t <= 0) this.endRound();
  }

  draw(g) {
    roundRect(g, 20, ARENA.y + 8, 1040, 64, 16, 'rgba(10,10,30,0.75)');
    text(g, `✏️ Rodada ${this.num}`, 45, ARENA.y + 40, 30, '#fff', 'left');
    text(g, `${this.chars.filter(isLetter).length} letras`, 1035, ARENA.y + 40, 28, '#7fd4ff', 'right');
    const frac = this.state === 'guess' ? this.t / ROUND_TIME : 0;
    bar(g, 20, ARENA.y + 82, 1040, 14, frac, frac < 0.3 ? '#ff6b6b' : '#8a5cff');

    // categoria + palavra escondida
    text(g, `Categoria: ${this.word.c}`, 540, ARENA.y + 150, 44, '#ffe066');
    const n = this.chars.length;
    const box = Math.min(84, 1000 / n);
    const x0 = 540 - (n * box) / 2 + box / 2;
    const show = this.state === 'show';
    this.chars.forEach((ch, i) => {
      const x = x0 + i * box;
      const y = ARENA.y + 280;
      if (!isLetter(ch)) {
        text(g, ch, x, y, box * 0.8, '#fff');
        return;
      }
      const open = show || this.revealed.has(i);
      roundRect(g, x - box * 0.42, y - box * 0.55, box * 0.84, box * 1.1, 12, open ? (show ? '#2ee67a' : '#ffffff') : 'rgba(255,255,255,0.15)');
      if (open) text(g, ch, x, y + 3, box * 0.7, show ? '#fff' : '#1b1037', 'center', 900, show);
    });

    // dica em emoji
    const ey = ARENA.y + 450;
    if (this.emojiShown || show) {
      roundRect(g, 390, ey - 90, 300, 180, 30, 'rgba(255,255,255,0.1)');
      text(g, this.word.e || '❓', 540, ey + 5, 120, '#fff', 'center', 900, false);
    } else if (this.state === 'guess') {
      const left = Math.ceil(EMOJI_TIME - (ROUND_TIME - this.t));
      text(g, `💡 Dica em emoji em ${left}s`, 540, ey, 34, '#aaa', 'center', 800);
    }

    // quem acertou
    const cy = ARENA.y + 620;
    if (this.correct.length) {
      this.correct.forEach((c, k) => {
        const x = 540 + (k - (this.correct.length - 1) / 2) * 330;
        drawAvatar(g, c.user, x - 90, cy, 34, '#2ee67a', 4);
        text(g, ['🥇', '🥈', '🥉'][k], x - 125, cy - 30, 34, '#fff', 'center', 900, false);
        text(g, fitText(g, c.user.name, 160, 26, 800), x - 45, cy - 12, 26, '#fff', 'left', 800);
        text(g, `+${c.pts}`, x - 45, cy + 22, 26, '#ffe066', 'left');
      });
    } else {
      text(g, show ? `❌ Ninguém acertou! Era ${this.word.w.toUpperCase()}` : '✍️ Escreva a palavra no chat!', 540, cy, 34, show ? '#ff6b6b' : '#b8ffcf', 'center', 800);
    }

    // chutes recentes
    const gy = ARENA.y + 740;
    this.guesses.forEach((gs, k) => {
      const col = k % 2;
      const row = Math.floor(k / 2);
      const x = 40 + col * 520;
      const y = gy + row * 66;
      g.globalAlpha = Math.max(0.3, 1 - gs.t / 12);
      roundRect(g, x, y, 480, 54, 27, gs.close ? 'rgba(255,157,0,0.35)' : 'rgba(255,255,255,0.08)');
      drawAvatar(g, gs.user, x + 30, y + 27, 20, '#fff', 2);
      text(g, fitText(g, gs.text, 300, 26, 800), x + 62, y + 28, 26, '#fff', 'left', 800);
      if (gs.close) text(g, '🔥 Quase!', x + 465, y + 28, 24, '#ffb347', 'right');
      g.globalAlpha = 1;
    });

    this.drawScoreboard(g, ARENA.y + 985);
  }
}
