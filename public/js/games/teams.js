import { Game } from './base.js';
import { ARENA, TEAMS, SpatialGrid, bar, clamp, dist2, drawAvatar, giftTier, rand, roundRect, text, fitText } from '../core.js';

// Guerra dos Reinos: 4 times, cada um com um castelo. O avatar de cada pessoa é um
// herói que luta sozinho. Curtidas viram soldados, presentes viram poderes.

const CASTLE_HP = 4000;
const CASTLE_POS = [
  { x: 190, y: 560 },
  { x: 890, y: 560 },
  { x: 190, y: 1360 },
  { x: 890, y: 1360 },
];
const MAX_MINIONS_PER_TEAM = 70;
const BOUNDS = { x0: 30, x1: 1050, y0: 430, y1: 1490 };
const LIKES_PER_MINION = 5;

export class TeamsGame extends Game {
  static id = 'teams';
  static title = 'Guerra dos Reinos';
  static emoji = '⚔️';

  get instructions() {
    return [
      'Comente 1 🔴  2 🔵  3 🟢  4 🟡 para escolher seu reino',
      'Seu avatar luta sozinho! ❤️ Curtidas = soldados',
      'Destrua os castelos inimigos — o último reino de pé vence!',
    ];
  }

  get giftGuide() {
    return [
      { icon: '🌹', label: '1+💎', text: 'Herói sobe de nível + soldados' },
      { icon: '🎁', label: '10+💎', text: 'Herói GIGANTE + cura o castelo' },
      { icon: '☄️', label: '100+💎', text: 'METEORO no castelo inimigo (revive o seu)' },
      { icon: '🐉', label: '1000+💎', text: 'DRAGÃO: arrasa todos os inimigos' },
    ];
  }

  start() {
    this.castles = TEAMS.map((t, i) => ({
      team: i,
      x: CASTLE_POS[i].x,
      y: CASTLE_POS[i].y,
      r: 80,
      hp: CASTLE_HP,
      max: CASTLE_HP,
      alive: true,
      hitT: 0,
      shotCd: rand(0, 1),
    }));
    this.units = [];
    this.meteors = [];
    this.arrows = [];
    this.grid = new SpatialGrid(90);
    this.near = [];
    this.likeAcc = new Map();
    this.minionCount = [0, 0, 0, 0];
  }

  // ------------------------------------------------------------ jogadores
  join(user, team) {
    if (this.castles.filter((c) => c.alive).length <= 1) return null;
    team = this.chooseTeam(team, 4, (t) => this.castles[t].alive);
    const p = { user, team, level: 1, giantT: 0, hero: null, respawn: 0, damage: 0, kills: 0 };
    this.players.set(user.id, p);
    this.spawnHero(p);
    return p;
  }

  heroStats(p) {
    const giant = p.giantT > 0;
    const lv = Math.min(p.level, 60);
    return {
      maxHp: (110 + lv * 22) * (giant ? 2.5 : 1),
      dmg: (14 + lv * 3) * (giant ? 2.2 : 1),
      r: Math.min(30 + lv * 0.6, 44) * (giant ? 1.7 : 1),
      speed: giant ? 80 : 95,
    };
  }

  spawnHero(p) {
    const c = this.castles[p.team];
    if (!c.alive) return;
    const s = this.heroStats(p);
    const u = {
      kind: 'hero',
      p,
      team: p.team,
      x: c.x + rand(-70, 70),
      y: c.y + rand(-70, 70),
      r: s.r,
      hp: s.maxHp,
      maxHp: s.maxHp,
      dmg: s.dmg,
      speed: s.speed,
      target: null,
      retarget: 0,
      atkCd: rand(0, 0.5),
      dead: false,
    };
    this.units.push(u);
    p.hero = u;
  }

  refreshHero(p, heal = true) {
    const u = p.hero;
    if (!u || u.dead) return;
    const s = this.heroStats(p);
    const frac = u.hp / u.maxHp;
    Object.assign(u, { maxHp: s.maxHp, dmg: s.dmg, r: s.r, speed: s.speed });
    u.hp = heal ? s.maxHp : s.maxHp * frac;
  }

  spawnMinions(team, n, near) {
    const c = this.castles[team];
    if (!c.alive) return 0;
    n = Math.min(n, MAX_MINIONS_PER_TEAM - this.minionCount[team]);
    for (let i = 0; i < n; i++) {
      const o = near && !near.dead ? near : c;
      this.units.push({
        kind: 'minion',
        p: near?.p || null,
        team,
        x: o.x + rand(-50, 50),
        y: o.y + rand(-50, 50),
        r: 13,
        hp: 45,
        maxHp: 45,
        dmg: 8,
        speed: 115,
        target: null,
        retarget: 0,
        atkCd: rand(0, 0.5),
        dead: false,
      });
      this.minionCount[team]++;
    }
    return n;
  }

  onLike(p, count) {
    const acc = (this.likeAcc.get(p.user.id) || 0) + count;
    const n = Math.floor(acc / LIKES_PER_MINION);
    this.likeAcc.set(p.user.id, acc % LIKES_PER_MINION);
    if (n > 0) this.spawnMinions(p.team, n, p.hero);
  }

  onFollow(p) {
    p.level += 2;
    this.refreshHero(p);
    this.fx.float(p.hero?.x ?? 540, (p.hero?.y ?? 900) - 50, '+2 níveis', '#fff');
  }

  onShare(p) {
    this.spawnMinions(p.team, 8, p.hero);
  }

  onGift(p, gift) {
    const d = gift.diamonds;
    const tier = giftTier(d);
    const c = this.castles[p.team];
    const color = TEAMS[p.team].color;

    if (!c.alive) {
      if (tier < 3) return 'Reino destruído… 100💎 revive!';
      c.alive = true;
      c.hp = c.max * 0.5;
      this.fx.ring(c.x, c.y, color, 260);
      this.fx.burst(c.x, c.y, color, 60, 500);
      for (const q of this.players.values()) if (q.team === p.team) this.spawnHero(q);
      this.mgr.notify(`✨ ${p.user.name} reviveu o reino ${TEAMS[p.team].name}!`, color);
      return 'REVIVEU O REINO!';
    }

    if (tier === 1) {
      p.level += d;
      if (!p.hero || p.hero.dead) {
        p.respawn = 0;
        this.spawnHero(p);
      }
      this.refreshHero(p);
      this.spawnMinions(p.team, Math.min(2 * d, 20), p.hero);
      this.fx.float(p.hero.x, p.hero.y - 50, `+${d} nível`, '#ffe066');
      return `Herói nível ${p.level}`;
    }
    if (tier === 2) {
      p.level += 3 + Math.floor(d / 10);
      p.giantT = 20;
      if (!p.hero || p.hero.dead) this.spawnHero(p);
      this.refreshHero(p);
      c.hp = Math.min(c.max, c.hp + 400);
      this.spawnMinions(p.team, 12, p.hero);
      this.fx.ring(p.hero.x, p.hero.y, color, 180);
      return 'HERÓI GIGANTE!';
    }
    if (tier === 3) {
      const enemies = this.castles.filter((e) => e.alive && e.team !== p.team);
      const target = enemies.sort((a, b) => b.hp - a.hp)[0];
      if (target) this.meteors.push({ x: target.x, y: target.y, t: 0, dur: 0.9, dmg: 900 + d, p });
      c.hp = Math.min(c.max, c.hp + 600);
      this.spawnMinions(p.team, 20, p.hero);
      return 'METEORO!';
    }
    // tier 4 — Dragão
    for (const e of this.castles)
      if (e.alive && e.team !== p.team) this.meteors.push({ x: e.x, y: e.y, t: 0, dur: rand(0.6, 1.2), dmg: 1600, p, wipe: true });
    for (const u of this.units) if (u.team !== p.team && u.kind === 'minion') this.killUnit(u, p);
    c.hp = c.max;
    this.fx.flash('#ff7b00', 0.5);
    this.fx.shake(25, 0.8);
    return '🐉 DRAGÃO!!!';
  }

  // ------------------------------------------------------------ simulação
  killUnit(u, killer) {
    if (u.dead) return;
    u.dead = true;
    if (u.kind === 'minion') this.minionCount[u.team]--;
    if (killer) killer.kills++;
    this.fx.burst(u.x, u.y, TEAMS[u.team].color, u.kind === 'hero' ? 18 : 6, 220, u.kind === 'hero' ? 8 : 5);
    if (u.kind === 'hero') u.p.respawn = 4;
  }

  damageCastle(c, amount, attacker) {
    if (!c.alive) return;
    c.hp -= amount;
    c.hitT = 0.15;
    if (attacker) attacker.damage += amount;
    if (c.hp <= 0) this.destroyCastle(c, attacker);
  }

  destroyCastle(c, attacker) {
    c.alive = false;
    c.hp = 0;
    for (const u of this.units) if (u.team === c.team) this.killUnit(u, null);
    const t = TEAMS[c.team];
    this.fx.burst(c.x, c.y, t.color, 90, 650, 12);
    this.fx.ring(c.x, c.y, '#fff', 320, 0.8);
    this.fx.shake(30, 0.7);
    this.mgr.notify(`🏰 O reino ${t.name} caiu!${attacker ? ` (golpe final: ${attacker.user.name})` : ''}`, t.color);
    if (this.castles.filter((k) => k.alive).length <= 1) this.finished = true;
  }

  findTarget(u) {
    let best = null;
    let bestD = 260 * 260;
    for (const o of this.grid.query(u.x, u.y, 260, this.near)) {
      if (o.team === u.team || o.dead) continue;
      const d = dist2(u.x, u.y, o.x, o.y);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (best) return best;
    bestD = Infinity;
    for (const c of this.castles) {
      if (!c.alive || c.team === u.team) continue;
      const d = dist2(u.x, u.y, c.x, c.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  update(dt) {
    this.grid.clear();
    for (const u of this.units) if (!u.dead) this.grid.insert(u);

    for (const p of this.players.values()) {
      if (p.giantT > 0) {
        p.giantT -= dt;
        if (p.giantT <= 0) this.refreshHero(p, false);
      }
      if (p.hero?.dead && p.respawn > 0) {
        p.respawn -= dt;
        if (p.respawn <= 0) this.spawnHero(p);
      }
    }

    for (const u of this.units) {
      if (u.dead) continue;
      u.retarget -= dt;
      if (u.retarget <= 0 || !u.target || u.target.dead || u.target.alive === false) {
        u.target = this.findTarget(u);
        u.retarget = rand(0.25, 0.45);
      }
      const t = u.target;
      if (t) {
        const dx = t.x - u.x;
        const dy = t.y - u.y;
        const d = Math.hypot(dx, dy) || 1;
        const reach = u.r + t.r + 4;
        if (d > reach) {
          u.x += (dx / d) * u.speed * dt;
          u.y += (dy / d) * u.speed * dt;
        } else {
          u.atkCd -= dt;
          if (u.atkCd <= 0) {
            u.atkCd = 0.5;
            const hit = u.dmg * 0.5;
            const owner = u.p;
            if (t.kind) {
              t.hp -= hit;
              if (Math.random() < 0.3) this.fx.burst(t.x, t.y, '#fff', 3, 120, 4);
              if (t.hp <= 0) this.killUnit(t, owner);
            } else {
              this.damageCastle(t, hit, owner);
            }
          }
        }
      }
      // separação simples para não empilhar
      for (const o of this.grid.query(u.x, u.y, u.r * 2, this.near)) {
        if (o === u || o.dead) continue;
        const dx = u.x - o.x;
        const dy = u.y - o.y;
        const min = u.r + o.r;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0.01 && d2 < min * min) {
          const d = Math.sqrt(d2);
          const push = ((min - d) / d) * 0.25;
          u.x += dx * push;
          u.y += dy * push;
        }
      }
      u.x = clamp(u.x, BOUNDS.x0, BOUNDS.x1);
      u.y = clamp(u.y, BOUNDS.y0, BOUNDS.y1);
    }

    // castelos atiram flechas em quem chega perto
    for (const c of this.castles) {
      c.hitT = Math.max(0, c.hitT - dt);
      if (!c.alive) continue;
      c.shotCd -= dt;
      if (c.shotCd > 0) continue;
      c.shotCd = 0.7;
      let target = null;
      let bestD = 200 * 200;
      for (const o of this.grid.query(c.x, c.y, 200, this.near)) {
        if (o.team === c.team || o.dead) continue;
        const d = dist2(c.x, c.y, o.x, o.y);
        if (d < bestD) {
          bestD = d;
          target = o;
        }
      }
      if (target) {
        this.arrows.push({ x0: c.x, y0: c.y - 40, x1: target.x, y1: target.y, t: 0.15, color: TEAMS[c.team].color });
        target.hp -= 16;
        if (target.hp <= 0) this.killUnit(target, null);
      }
    }
    for (const a of this.arrows) a.t -= dt;
    this.arrows = this.arrows.filter((a) => a.t > 0);

    for (const m of this.meteors) {
      m.t += dt;
      if (m.t >= m.dur && !m.done) {
        m.done = true;
        const c = this.castles.find((k) => k.x === m.x && k.y === m.y);
        this.fx.burst(m.x, m.y, '#ff9d00', 70, 600, 11);
        this.fx.ring(m.x, m.y, '#ffdd55', 280);
        this.fx.shake(22, 0.5);
        for (const u of this.grid.query(m.x, m.y, 230, this.near))
          if (u.team !== m.p.team && dist2(u.x, u.y, m.x, m.y) < 230 * 230) this.killUnit(u, m.p);
        if (c) this.damageCastle(c, m.dmg, m.p);
      }
    }
    this.meteors = this.meteors.filter((m) => !m.done);
    if (this.units.length > 600) this.units = this.units.filter((u) => !u.dead);
    else if (Math.random() < 0.05) this.units = this.units.filter((u) => !u.dead);
  }

  timeUp() {
    this.finished = true;
  }

  result() {
    const alive = this.castles.filter((c) => c.alive);
    const pool = alive.length ? alive : this.castles;
    const win = pool.slice().sort((a, b) => b.hp / b.max - a.hp / a.max)[0];
    const t = TEAMS[win.team];
    const winners = [...this.players.values()]
      .map((p) => ({ user: p.user, win: p.team === win.team, points: Math.round((p.team === win.team ? 50 : 5) + p.damage / 40 + p.kills * 2) }))
      .sort((a, b) => b.win - a.win || b.points - a.points);
    return { title: `${t.emoji} Reino ${t.name} venceu!`, color: t.color, winners };
  }

  // ------------------------------------------------------------ desenho
  drawCastle(g, c) {
    const t = TEAMS[c.team];
    const x = c.x;
    const y = c.y;
    g.save();
    if (!c.alive) g.globalAlpha = 0.35;
    const col = c.hitT > 0 ? '#fff' : t.color;
    // base
    roundRect(g, x - 70, y - 40, 140, 90, 10, t.dark);
    roundRect(g, x - 60, y - 30, 120, 70, 8, col);
    // torres
    for (const sx of [-70, 40]) {
      roundRect(g, x + sx, y - 85, 30, 70, 6, t.dark);
      for (let i = 0; i < 2; i++) g.fillRect(x + sx + i * 18, y - 97, 12, 14);
    }
    roundRect(g, x - 20, y - 105, 40, 80, 6, t.dark);
    g.fillStyle = t.dark;
    g.beginPath();
    g.moveTo(x - 26, y - 105);
    g.lineTo(x, y - 140);
    g.lineTo(x + 26, y - 105);
    g.fill();
    roundRect(g, x - 16, y + 5, 32, 45, 14, '#2b1a10');
    g.restore();
    const count = [...this.players.values()].filter((p) => p.team === c.team).length;
    if (c.alive) {
      bar(g, x - 80, y + 60, 160, 16, c.hp / c.max, t.color);
      text(g, `👥 ${count}`, x, y + 92, 24);
    } else text(g, '💀', x, y - 10, 70);
  }

  draw(g) {
    // chão
    g.fillStyle = '#1d3b2a';
    g.fillRect(ARENA.x, ARENA.y + 70, ARENA.w, ARENA.h - 70);
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.lineWidth = 2;
    for (let x = 0; x <= ARENA.w; x += 90) {
      g.beginPath();
      g.moveTo(x, ARENA.y + 70);
      g.lineTo(x, ARENA.y + ARENA.h);
      g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.04)';
    g.beginPath();
    g.arc(540, 960, 180, 0, Math.PI * 2);
    g.fill();

    // placar dos reinos
    for (const c of this.castles) {
      const t = TEAMS[c.team];
      const x = 12 + c.team * 266;
      roundRect(g, x, ARENA.y + 4, 254, 58, 14, c.alive ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.25)', t.color, 3);
      text(g, `${t.emoji} ${t.name}`, x + 127, ARENA.y + 22, 24, c.alive ? '#fff' : '#888');
      bar(g, x + 14, ARENA.y + 40, 226, 12, c.hp / c.max, t.color);
    }

    for (const c of this.castles) this.drawCastle(g, c);

    // soldados
    for (const u of this.units) {
      if (u.dead || u.kind !== 'minion') continue;
      g.fillStyle = TEAMS[u.team].dark;
      g.beginPath();
      g.arc(u.x, u.y, u.r + 3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = TEAMS[u.team].color;
      g.beginPath();
      g.arc(u.x, u.y, u.r, 0, Math.PI * 2);
      g.fill();
    }

    // heróis (avatares)
    const heroes = this.units.filter((u) => !u.dead && u.kind === 'hero');
    const showNames = heroes.length <= 40;
    for (const u of heroes) {
      const t = TEAMS[u.team];
      drawAvatar(g, u.p.user, u.x, u.y, u.r, t.color);
      bar(g, u.x - u.r, u.y - u.r - 16, u.r * 2, 7, u.hp / u.maxHp, '#3dff7a');
      if (u.p.level > 1) {
        g.fillStyle = '#111';
        g.beginPath();
        g.arc(u.x + u.r * 0.8, u.y + u.r * 0.8, 15, 0, Math.PI * 2);
        g.fill();
        text(g, String(u.p.level), u.x + u.r * 0.8, u.y + u.r * 0.8 + 1, 16, '#ffe066', 'center', 900, false);
      }
      if (showNames || u.p.giantT > 0) text(g, fitText(g, u.p.user.name, 140, 18), u.x, u.y + u.r + 18, 18);
    }

    for (const a of this.arrows) {
      g.strokeStyle = a.color;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(a.x0, a.y0);
      g.lineTo(a.x1, a.y1);
      g.stroke();
    }

    for (const m of this.meteors) {
      const k = clamp(m.t / m.dur, 0, 1);
      const mx = m.x - 300 * (1 - k);
      const my = m.y - 900 * (1 - k);
      g.fillStyle = '#ff8c1a';
      g.beginPath();
      g.arc(mx, my, 34, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,200,80,0.5)';
      g.beginPath();
      g.arc(mx - 25 * (1 - k), my - 60 * (1 - k), 26, 0, Math.PI * 2);
      g.fill();
      text(g, '☄️', mx, my, 60, '#fff', 'center', 900, false);
    }
  }
}
