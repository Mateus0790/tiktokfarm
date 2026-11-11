import { ScoreGame } from './scoregame.js';
import { ARENA, bar, content, drawAvatar, fitText, normalizeText, pick, roundRect, shuffle, text, wrapLines } from '../core.js';

// Quiz Show: perguntas de múltipla escolha. Todo mundo responde comentando
// A, B, C ou D (ou o texto da alternativa). Quem acerta mais rápido ganha mais.

const QUESTION_TIME = 15;
const REVEAL_TIME = 5;
const LETTERS = ['A', 'B', 'C', 'D'];
const COLORS = ['#ff4d5e', '#3d8bff', '#2ee67a', '#ffc93d'];

export class QuizGame extends ScoreGame {
  static id = 'quiz';
  static title = 'Quiz Show';
  static emoji = '🧠';

  get instructions() {
    return ['Comente A, B, C ou D para responder!', 'Quem acerta mais rápido ganha mais pontos', 'Só vale a primeira resposta de cada pergunta'];
  }

  get giftGuide() {
    return [
      { icon: '🌹', label: '1+💎', text: 'Próximo acerto vale x2 (acumula até x5)' },
      { icon: '🎁', label: '10+💎', text: 'x3 + elimina uma alternativa errada' },
      { icon: '💰', label: '100+💎', text: '+50 pontos + x3 + elimina uma errada' },
      { icon: '👑', label: '1000+💎', text: '+300 pontos + x5' },
    ];
  }

  get helpLabel() {
    return 'eliminou uma errada';
  }

  start() {
    this.deck = [];
    this.num = 0;
    this.nextQuestion();
  }

  nextQuestion() {
    if (!this.deck.length) this.deck = shuffle(content.perguntas.slice());
    const q = this.deck.pop() || { c: 'Quiz', q: 'Sem perguntas carregadas (veja content/perguntas.json)', a: ['Ok', 'Tá', 'Beleza', 'Certo'] };
    this.q = q;
    this.options = shuffle(q.a.slice(0, 4).map((t, i) => ({ t, ok: i === 0, voters: [], removed: false })));
    this.answers = new Map();
    this.state = 'question';
    this.t = QUESTION_TIME;
    this.winnersNow = [];
    this.num++;
  }

  parseAnswer(text) {
    const n = normalizeText(text);
    const letter = n.match(/^(?:letra |alternativa |e a |e )?([abcd])$/);
    if (letter) return letter[1].charCodeAt(0) - 97;
    const i = this.options.findIndex((o) => normalizeText(o.t) === n);
    return i >= 0 ? i : null;
  }

  answer(p, idx) {
    if (this.state !== 'question' || this.answers.has(p.user.id) || idx == null || idx >= this.options.length) return;
    this.answers.set(p.user.id, { p, idx, left: this.t });
    this.options[idx].voters.push(p.user);
    this.sfx('pop', 0.05);
  }

  onChat(p, text) {
    this.answer(p, this.parseAnswer(text));
  }

  botAct(p) {
    if (this.state !== 'question' || this.answers.has(p.user.id) || Math.random() < 0.5) return;
    const right = this.options.findIndex((o) => o.ok);
    const alive = this.options.map((o, i) => i).filter((i) => !this.options[i].removed);
    this.answer(p, Math.random() < 0.55 ? right : pick(alive));
  }

  helpAll() {
    if (this.state !== 'question') return false;
    const wrong = this.options.filter((o) => !o.ok && !o.removed);
    if (wrong.length <= 1) return false;
    pick(wrong).removed = true;
    this.sfx('freeze', 0.1);
    return true;
  }

  reveal() {
    this.state = 'reveal';
    this.t = REVEAL_TIME;
    const right = this.options.findIndex((o) => o.ok);
    const hits = [...this.answers.values()].filter((a) => a.idx === right).sort((a, b) => b.left - a.left);
    this.winnersNow = hits.map((a) => ({ user: a.p.user, pts: this.award(a.p, 50 + Math.round((50 * a.left) / QUESTION_TIME)) }));
    this.sfx(hits.length ? 'finish' : 'hurt', 0);
    if (hits.length) this.mgr.notify(`✅ ${hits.length} acertaram! Mais rápido: ${hits[0].p.user.name}`, '#2ee67a');
  }

  update(dt) {
    this.t -= dt;
    const sec = Math.ceil(this.t);
    if (this.state === 'question' && sec <= 3 && sec > 0 && sec !== this.lastTick) {
      this.lastTick = sec;
      this.sfx('tick', 0);
    }
    if (this.t > 0) return;
    if (this.state === 'question') this.reveal();
    else this.nextQuestion();
  }

  draw(g) {
    const total = this.answers.size;
    // topo: número da pergunta, categoria e tempo
    roundRect(g, 20, ARENA.y + 8, 1040, 64, 16, 'rgba(10,10,30,0.75)');
    text(g, `🧠 Pergunta ${this.num}`, 45, ARENA.y + 40, 30, '#fff', 'left');
    text(g, `📚 ${this.q.c || 'Geral'}`, 1035, ARENA.y + 40, 28, '#7fd4ff', 'right');
    const frac = this.state === 'question' ? this.t / QUESTION_TIME : 0;
    bar(g, 20, ARENA.y + 82, 1040, 14, frac, frac < 0.3 ? '#ff6b6b' : '#8a5cff');

    // pergunta
    let size = 48;
    let lines = wrapLines(g, this.q.q, 960, size);
    while (lines.length > 3 && size > 30) lines = wrapLines(g, this.q.q, 960, (size -= 4));
    roundRect(g, 20, ARENA.y + 110, 1040, 200, 24, 'rgba(255,255,255,0.95)');
    const y0 = ARENA.y + 210 - ((lines.length - 1) * size * 1.15) / 2;
    lines.forEach((l, i) => text(g, l, 540, y0 + i * size * 1.15, size, '#1b1037', 'center', 900, false));

    // alternativas
    this.options.forEach((o, i) => {
      const y = ARENA.y + 330 + i * 118;
      const revealed = this.state === 'reveal';
      g.globalAlpha = o.removed || (revealed && !o.ok) ? 0.35 : 1;
      roundRect(g, 20, y, 1040, 104, 20, 'rgba(10,10,30,0.85)', revealed && o.ok ? '#2ee67a' : COLORS[i], revealed && o.ok ? 8 : 4);
      const share = total ? o.voters.length / total : 0;
      if (share > 0) roundRect(g, 24, y + 4, Math.max(20, 1032 * share), 96, 18, COLORS[i] + '55');
      g.fillStyle = COLORS[i];
      g.beginPath();
      g.arc(78, y + 52, 34, 0, Math.PI * 2);
      g.fill();
      text(g, LETTERS[i], 78, y + 54, 38, '#fff');
      text(g, fitText(g, o.t, 600, 38, 800), 130, y + 52, 38, '#fff', 'left', 800);
      if (o.removed) {
        g.strokeStyle = '#ff4d5e';
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(40, y + 52);
        g.lineTo(1040, y + 52);
        g.stroke();
      }
      // quem escolheu (últimos 5)
      o.voters.slice(-5).forEach((u, k) => drawAvatar(g, u, 770 + k * 40, y + 52, 18, COLORS[i], 3));
      text(g, revealed && o.ok ? '✅' : String(o.voters.length), 1030, y + 52, 34, '#fff', 'right');
      g.globalAlpha = 1;
    });

    // situação da rodada
    const sy = ARENA.y + 812;
    if (this.state === 'question') {
      text(g, `💬 Comente A, B, C ou D!  ·  ${total} resposta${total === 1 ? '' : 's'}`, 540, sy + 20, 32, '#b8ffcf', 'center', 800);
    } else {
      const n = this.winnersNow.length;
      text(g, n ? `✅ ${n} acertaram!` : '❌ Ninguém acertou!', 540, sy + 20, 36, n ? '#2ee67a' : '#ff6b6b');
      this.winnersNow.slice(0, 6).forEach((w, k) => {
        const x = 540 + (k - (Math.min(n, 6) - 1) / 2) * 165;
        drawAvatar(g, w.user, x, sy + 85, 30, '#2ee67a', 4);
        text(g, `+${w.pts}`, x, sy + 135, 22, '#ffe066');
      });
    }
    this.drawScoreboard(g, ARENA.y + 985);
  }
}

