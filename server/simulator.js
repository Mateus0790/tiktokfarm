import { EventEmitter } from 'node:events';
import { amountToDiamonds } from './youtube.js';

// Gera espectadores e eventos falsos para testar os jogos sem estar ao vivo.

const FIRST = ['Ana', 'Leo', 'Bia', 'Caio', 'Duda', 'Enzo', 'Gabi', 'Hugo', 'Isa', 'Joao', 'Lara', 'Malu', 'Nina', 'Otto', 'Pedro', 'Rafa', 'Sofia', 'Theo', 'Vivi', 'Yuri', 'Zeca', 'Luna', 'Davi', 'Clara'];
const LAST = ['gamer', 'top', '2009', 'zika', 'br', 'pro', 'ofc', 'tv', 'xd', 'real', '777', 'plays'];
const GIFTS = [
  { name: 'Rosa', diamonds: 1, weight: 50 },
  { name: 'TikTok', diamonds: 1, weight: 20 },
  { name: 'Dedo Coração', diamonds: 5, weight: 12 },
  { name: 'Sorvete', diamonds: 1, weight: 10 },
  { name: 'Rosquinha', diamonds: 30, weight: 5 },
  { name: 'Chapéu', diamonds: 99, weight: 3 },
  { name: 'Coroa', diamonds: 199, weight: 1.5 },
  { name: 'Leão', diamonds: 1000, weight: 0.4 },
];
const CHATS = ['1', '2', '3', '4', 'azul', 'vermelho', 'verde', 'amarelo', 'bora!!', 'vai time', 'kkkkk', 'entrei', 'quero jogar', 'go go go', 'a', 'b', 'c', 'd', 'banana', 'gato', 'pizza', 'leão', 'foguete'];

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function weighted(list) {
  const total = list.reduce((s, g) => s + g.weight, 0);
  let r = Math.random() * total;
  for (const g of list) if ((r -= g.weight) <= 0) return g;
  return list[0];
}

export function fakeUser(i, platform = 'tiktok') {
  const name = `${pick(FIRST)}_${pick(LAST)}`;
  const id = `sim${i}_${Math.floor(Math.random() * 1e6)}`;
  return { id, uniqueId: name.toLowerCase(), name, avatar: `https://api.dicebear.com/9.x/thumbs/png?size=128&seed=${id}`, platform };
}

export class Simulator extends EventEmitter {
  constructor(cfg) {
    super();
    this.cfg = cfg;
    this.users = Array.from({ length: cfg.viewers }, (_, i) => this.newUser(i));
    this.timer = null;
  }

  /** Com YouTube ligado, ~30% dos espectadores falsos vêm do YouTube. */
  newUser(i) {
    return fakeUser(i, this.cfg.youtube && Math.random() < 0.3 ? 'youtube' : 'tiktok');
  }

  get running() {
    return Boolean(this.timer);
  }

  start() {
    if (this.timer) return;
    const interval = 1000 / Math.max(0.2, this.cfg.eventsPerSecond);
    this.timer = setInterval(() => this.tick(), interval);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    // Viewers vão "chegando" aos poucos e alguns vão embora.
    if (Math.random() < 0.02) this.users[Math.floor(Math.random() * this.users.length)] = this.newUser(Date.now());
    const user = pick(this.users);
    const r = Math.random();
    if (user.platform === 'youtube') {
      // YouTube não tem curtidas pelo chat: só comentários e Super Chats
      if (r < 0.9) this.emit('event', { kind: 'chat', user, text: pick(CHATS) });
      else {
        const amount = pick(['R$ 5,00', 'R$ 10,00', 'R$ 20,00', 'R$ 50,00', 'US$ 2.00', 'R$ 200,00']);
        this.emit('event', { kind: 'gift', user, giftId: 'yt-superchat', giftName: `Super Chat ${amount}`, giftImage: null, count: 1, diamonds: amountToDiamonds(amount, this.cfg.diamondsPerDollar || 75) });
      }
      return;
    }
    if (r < 0.35) this.emit('event', { kind: 'chat', user, text: pick(CHATS) });
    else if (r < 0.8) this.emit('event', { kind: 'like', user, count: Math.ceil(rand(1, 15)) });
    else if (r < 0.95) {
      const g = weighted(GIFTS);
      const count = g.diamonds === 1 ? Math.ceil(rand(1, 6)) : 1;
      this.emit('event', { kind: 'gift', user, giftId: 0, giftName: g.name, giftImage: null, count, diamonds: g.diamonds * count });
    } else if (r < 0.98) this.emit('event', { kind: 'follow', user });
    else this.emit('event', { kind: 'share', user });
  }
}
