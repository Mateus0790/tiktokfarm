import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const DATA_DIR = path.join(ROOT, 'data');
const FILE = path.join(DATA_DIR, 'leaderboard.json');

/** Ranking geral salvo em disco (sobrevive a reinícios do PC/servidor). */
export class LeaderboardStore {
  constructor() {
    this.users = {};
    this.saveTimer = null;
    try {
      this.users = JSON.parse(fs.readFileSync(FILE, 'utf8')).users || {};
    } catch {}
  }

  entry(user) {
    const e = (this.users[user.id] ||= { name: user.name, avatar: null, points: 0, wins: 0, diamonds: 0 });
    e.name = user.name || e.name;
    if (user.avatar) e.avatar = user.avatar;
    return e;
  }

  addResult(winners) {
    for (const w of winners || []) {
      // bots e usuários do simulador não entram no ranking
      if (!w?.user?.id || w.user.isBot || String(w.user.id).startsWith('sim')) continue;
      const e = this.entry(w.user);
      e.points += Math.max(0, Math.round(Number(w.points) || 0));
      if (w.win) e.wins += 1;
    }
    this.scheduleSave();
  }

  addDiamonds(user, diamonds) {
    this.entry(user).diamonds += diamonds;
    this.scheduleSave();
  }

  top(n = 10) {
    return Object.entries(this.users)
      .map(([id, e]) => ({ id, ...e }))
      .sort((a, b) => b.points - a.points)
      .slice(0, n);
  }

  reset() {
    this.users = {};
    this.scheduleSave();
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 3000);
  }

  save() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ users: this.users }));
      fs.renameSync(tmp, FILE);
    } catch (err) {
      console.warn('[store] falha ao salvar ranking:', err.message);
    }
  }
}
