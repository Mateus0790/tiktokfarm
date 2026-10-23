import { TEAMS } from '../core.js';

/**
 * Classe base dos jogos. Cada jogo implementa:
 *  - join(user, team)   → cria o jogador (retorna o jogador ou null se lotado)
 *  - onChat / onLike / onGift / onFollow / onShare
 *  - update(dt) / draw(g)
 *  - result()           → { title, color, winners: [{ user, points, win }] }
 * O gerenciador (main.js) cuida de tempo, HUD, intervalo entre jogos e presentes.
 */
export class Game {
  static id = 'base';
  static title = 'Jogo';
  static emoji = '🎮';

  constructor(mgr) {
    this.mgr = mgr;
    this.fx = mgr.fx;
    this.players = new Map();
    this.finished = false;
    this.time = 0;
  }

  /** Linhas exibidas no topo (alternam a cada poucos segundos). */
  get instructions() {
    return ['Comente qualquer coisa para entrar!'];
  }

  /** Tabela de presentes exibida embaixo: [{ icon, label, text }]. */
  get giftGuide() {
    return [];
  }

  start() {}
  join(_user, _team) {
    return null;
  }
  getPlayer(id) {
    return this.players.get(id) || null;
  }
  onChat(_p, _text) {}
  onLike(_p, _count) {}
  onGift(_p, _gift) {
    return '';
  }
  onFollow(_p) {}
  onShare(_p) {}
  update(_dt) {}
  draw(_g) {}
  /** O que um bot faz de vez em quando (padrão: curtir). */
  botAct(p) {
    this.onLike(p, 1 + Math.floor(Math.random() * 5));
  }

  /** Efeito sonoro (ver audio.js). */
  sfx(name, minGap) {
    this.mgr.sfx?.(name, minGap);
  }

  timeUp() {
    this.finished = true;
  }
  result() {
    return { title: 'Fim de jogo', color: '#fff', winners: [] };
  }

  // ---- utilidades para jogos de times
  teamCounts(nTeams = TEAMS.length) {
    const counts = new Array(nTeams).fill(0);
    for (const p of this.players.values()) counts[p.team]++;
    return counts;
  }

  /** Respeita o time pedido no chat; senão coloca no time com menos gente. */
  chooseTeam(requested, nTeams = TEAMS.length, allowed = null) {
    const ok = (t) => t != null && t < nTeams && (!allowed || allowed(t));
    if (ok(requested)) return requested;
    const counts = this.teamCounts(nTeams);
    let best = -1;
    for (let t = 0; t < nTeams; t++) if (ok(t) && (best < 0 || counts[t] < counts[best])) best = t;
    return best < 0 ? 0 : best;
  }
}
