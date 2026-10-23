import { ARENA, Effects, H, TEAMS, W, bar, clamp, drawAvatar, fitText, fmtTime, giftTier, parseTeam, rand, roundRect, shuffle, text } from './core.js';
import { TeamsGame } from './games/teams.js';
import { TerritoryGame } from './games/territory.js';
import { TowerDefenseGame } from './games/towerdefense.js';
import { RaceGame } from './games/race.js';
import { Sound } from './audio.js';

const GAMES = { teams: TeamsGame, territory: TerritoryGame, towerdefense: TowerDefenseGame, race: RaceGame };

const DEFAULT_CONFIG = {
  games: { rotation: Object.keys(GAMES), shuffle: false, intermissionSeconds: 14, durations: {} },
  players: { autoJoinOnEnter: false, carryOverMinutes: 5 },
  bots: { enabled: true, minPlayers: 8 },
  overlay: { autoReloadHours: 6, giftGuideY: 1515, feedY: 1770 },
  sound: { enabled: true, musicVolume: 0.35, sfxVolume: 0.6 },
  username: '',
};

const BOT_NAMES = ['Robô Zé', 'Bip Bop', 'R2-Dú', 'Tchuca Bot', 'Botinho', 'Mecha Ana', 'Ciborgue', 'Chip', 'Pixel', 'Nano', 'Turbo Bot', 'Rex 3000'];

class GameManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.cfg = DEFAULT_CONFIG;
    this.fx = new Effects();
    this.users = new Map(); // id → { ...user, lastSeen, teamPref }
    this.game = null;
    this.phase = 'boot';
    this.phaseT = 3;
    this.timeLeft = 0;
    this.lastResult = null;
    this.nextId = null;
    this.forcedNext = null;
    this.rotationIdx = -1;
    this.rotation = [];
    this.feed = [];
    this.banners = [];
    this.banner = null;
    this.pendingGifts = [];
    this.leaderboard = [];
    this.primary = false;
    this.tiktok = null;
    this.ws = null;
    this.bots = [];
    this.botTimers = new Map();
    this.instrIdx = 0;
    this.instrT = 0;
    this.bootAt = performance.now();
    this.bg = this.makeBackground();
    this.sound = null;
    this.isPreview = new URLSearchParams(location.search).has('preview');
    this.connect();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    setInterval(() => this.reportState(), 2000);
  }

  // ------------------------------------------------------------------ servidor
  connect() {
    if (location.protocol === 'file:') return;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?role=${new URLSearchParams(location.search).has('preview') ? 'preview' : 'overlay'}`);
    this.ws = ws;
    ws.onmessage = (m) => {
      let msg;
      try {
        msg = JSON.parse(m.data);
      } catch {
        return;
      }
      this.onServer(msg);
    };
    ws.onclose = () => {
      this.ws = null;
      setTimeout(() => this.connect(), 2000);
    };
  }

  send(msg) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  onServer(msg) {
    switch (msg.t) {
      case 'init':
        this.cfg = {
          ...DEFAULT_CONFIG,
          ...msg.config,
          games: { ...DEFAULT_CONFIG.games, ...msg.config.games },
          players: { ...DEFAULT_CONFIG.players, ...msg.config.players },
          bots: { ...DEFAULT_CONFIG.bots, ...msg.config.bots },
          overlay: { ...DEFAULT_CONFIG.overlay, ...msg.config.overlay },
          sound: { ...DEFAULT_CONFIG.sound, ...msg.config.sound },
        };
        this.initSound();
        this.leaderboard = msg.leaderboard || [];
        this.rotation = [];
        break;
      case 'primary':
        this.primary = msg.primary;
        break;
      case 'leaderboard':
        this.leaderboard = msg.top || [];
        break;
      case 'tiktok':
        this.tiktok = msg.status;
        break;
      case 'event':
        this.onEvent(msg.e);
        break;
      case 'control':
        this.onControl(msg);
        break;
    }
  }

  onControl(msg) {
    if (msg.action === 'reload') location.reload();
    if (msg.action === 'play' && GAMES[msg.game]) this.forcedNext = msg.game;
    if (msg.action === 'skip' || msg.action === 'play') {
      if (this.phase === 'playing') this.endGame();
      else {
        // durante o carregamento inicial o pedido fica guardado para o pickNext()
        if (this.forcedNext && this.phase === 'intermission') {
          this.nextId = this.forcedNext;
          this.forcedNext = null;
          this.preview = new GAMES[this.nextId](this);
        }
        this.phaseT = Math.min(this.phaseT, 1);
      }
    }
  }

  reportState() {
    if (!this.primary) return;
    const G = this.game && GAMES[this.game.constructor.id];
    this.send({
      t: 'state',
      state: {
        phase: this.phase,
        game: this.phase === 'playing' ? G?.id : null,
        title: this.phase === 'playing' ? G?.title : null,
        timeLeft: Math.round(this.phase === 'playing' ? this.timeLeft : this.phaseT),
        players: this.phase === 'playing' ? this.game.players.size : 0,
        bots: this.bots.length,
        next: this.nextId ? GAMES[this.nextId].title : null,
      },
    });
  }

  // ------------------------------------------------------------------ eventos do TikTok
  remember(user, e) {
    // Atualiza o mesmo objeto (em vez de criar outro) para que os jogadores já
    // em jogo também recebam a foto/nome quando eles chegarem num evento posterior.
    let u = this.users.get(user.id);
    if (!u) {
      u = { ...user };
      this.users.set(user.id, u);
    } else {
      if (user.name) u.name = user.name;
      if (user.avatar) u.avatar = user.avatar;
    }
    u.lastSeen = performance.now();
    if (e.kind === 'chat') {
      const t = parseTeam(e.text);
      if (t != null) u.teamPref = t;
    }
    if (this.users.size > 5000) {
      const old = [...this.users.values()].sort((a, b) => a.lastSeen - b.lastSeen).slice(0, 1000);
      for (const o of old) this.users.delete(o.id);
    }
    return u;
  }

  onEvent(e) {
    if (!e?.user?.id) return;
    const u = this.remember(e.user, e);

    if (e.kind === 'follow') this.addFeed(`💖 ${u.name} seguiu!`, '#ff7bd5');
    if (e.kind === 'share') this.addFeed(`📢 ${u.name} compartilhou a live!`, '#7fd4ff');

    if (this.phase !== 'playing' || !this.game) {
      if (e.kind === 'gift') {
        if (this.pendingGifts.length < 100) this.pendingGifts.push(e);
        this.showGift(u, e, 'Vale para o próximo jogo!');
      }
      return;
    }

    let p = this.game.getPlayer(u.id);
    const wantsJoin = e.kind !== 'enter' || this.cfg.players.autoJoinOnEnter;
    if (!p && wantsJoin) p = this.joinPlayer(u, e.kind === 'chat' ? parseTeam(e.text) : null);

    if (e.kind === 'gift') {
      const label = p ? this.game.onGift(p, e) : 'Jogo lotado!';
      this.showGift(u, e, label);
      return;
    }
    if (!p) return;
    if (e.kind === 'chat') this.game.onChat(p, e.text || '');
    else if (e.kind === 'like') {
      this.game.onLike(p, e.count || 1);
      this.sfx('like', 0.25);
    }
    else if (e.kind === 'follow') this.game.onFollow(p);
    else if (e.kind === 'share') this.game.onShare(p);
  }

  // ------------------------------------------------------------------ som
  initSound() {
    const cfg = this.cfg.sound;
    // a prévia do painel fica muda para não tocar o som em dobro
    if (this.isPreview || !cfg.enabled) return;
    if (this.sound) this.sound.setVolumes(cfg);
    else this.sound = new Sound(cfg);
    this.sound.music(this.phase === 'playing' && this.game ? this.game.constructor.id : 'intermission');
  }

  sfx(name, minGap) {
    this.sound?.play(name, minGap);
  }

  joinPlayer(u, team) {
    const p = this.game.join(u, team ?? u.teamPref ?? null);
    if (p && !u.isBot) {
      const t = p.team != null ? ` ${TEAMS[p.team].emoji} ${TEAMS[p.team].name}` : '';
      this.addFeed(`➕ ${u.name} entrou${t}`, '#b8ffcf');
      this.sfx('join', 0.15);
    }
    return p;
  }

  showGift(u, e, label) {
    const tier = giftTier(e.diamonds);
    this.sfx(`gift${tier}`, tier >= 3 ? 0.4 : 0.08);
    const desc = `${e.giftName}${e.count > 1 ? ` x${e.count}` : ''} (${e.diamonds}💎)`;
    this.addFeed(`🎁 ${u.name}: ${desc}${label ? ` → ${label}` : ''}`, '#ffe066');
    if (tier >= 2 || this.banners.length < 2) {
      let img = null;
      if (e.giftImage) {
        img = new Image();
        img.referrerPolicy = 'no-referrer';
        img.src = e.giftImage;
      }
      this.banners.push({ user: u, desc, label, tier, img });
      if (this.banners.length > 12) this.banners.splice(0, this.banners.length - 12);
    }
  }

  addFeed(str, color = '#fff') {
    this.feed.push({ str, color, t: 0 });
    if (this.feed.length > 4) this.feed.shift();
  }

  notify(str, color) {
    this.addFeed(str, color);
  }

  // ------------------------------------------------------------------ fluxo dos jogos
  pickNext() {
    if (this.forcedNext) {
      const id = this.forcedNext;
      this.forcedNext = null;
      return id;
    }
    const list = this.cfg.games.rotation.filter((id) => GAMES[id]);
    if (!list.length) list.push(...Object.keys(GAMES));
    if (!this.rotation.length || this.rotationIdx >= this.rotation.length - 1) {
      this.rotation = this.cfg.games.shuffle ? shuffle(list.slice()) : list.slice();
      this.rotationIdx = -1;
    }
    this.rotationIdx++;
    return this.rotation[this.rotationIdx];
  }

  startIntermission(result) {
    this.phase = 'intermission';
    this.lastResult = result;
    this.phaseT = result ? this.cfg.games.intermissionSeconds : 6;
    this.nextId = this.pickNext();
    this.preview = new GAMES[this.nextId](this);
    this.game = null;
    this.bots = [];
    this.lastTick = null;
    this.sound?.music('intermission');
    if (result) this.sfx(result.lost ? 'lose' : 'win');
  }

  startGame() {
    const hours = this.cfg.overlay.autoReloadHours;
    if (hours > 0 && performance.now() - this.bootAt > hours * 3600_000) {
      location.reload(); // evita vazamento de memória em transmissões de dias seguidos
      return;
    }
    const Cls = GAMES[this.nextId] || GAMES.race;
    this.game = new Cls(this);
    this.game.start();
    this.phase = 'playing';
    this.sound?.music(Cls.id);
    this.sfx('go');
    this.timeLeft = this.cfg.games.durations[Cls.id] || 180;
    this.instrIdx = 0;
    this.instrT = 0;

    // quem interagiu nos últimos minutos já entra automaticamente
    const limit = performance.now() - this.cfg.players.carryOverMinutes * 60_000;
    const recent = [...this.users.values()].filter((u) => !u.isBot && u.lastSeen >= limit).sort((a, b) => b.lastSeen - a.lastSeen);
    for (const u of recent.slice(0, 80)) this.game.join(u, u.teamPref ?? null);

    // bots para a tela nunca ficar vazia
    if (this.cfg.bots.enabled) {
      const need = Math.max(0, this.cfg.bots.minPlayers - this.game.players.size);
      for (let i = 0; i < need; i++) {
        const bot = { id: `bot:${i}`, name: BOT_NAMES[i % BOT_NAMES.length], avatar: null, isBot: true };
        if (this.game.join(bot, null)) this.bots.push(bot);
      }
      for (const b of this.bots) this.botTimers.set(b.id, rand(1, 4));
    }

    // presentes recebidos durante o intervalo
    const gifts = this.pendingGifts.splice(0);
    for (const e of gifts) {
      const u = this.users.get(e.user.id) || e.user;
      const p = this.game.getPlayer(u.id) || this.joinPlayer(u, null);
      if (p) this.game.onGift(p, e);
    }
  }

  endGame() {
    if (!this.game) return;
    let result;
    try {
      result = this.game.result();
    } catch (err) {
      console.error(err);
      result = { title: 'Fim de jogo', color: '#fff', winners: [] };
    }
    result.game = this.game.constructor.id;
    if (this.primary) {
      const winners = result.winners
        .filter((w) => !w.user.isBot)
        .slice(0, 200)
        .map((w) => ({ user: { id: w.user.id, name: w.user.name, avatar: w.user.avatar }, points: w.points, win: w.win }));
      this.send({ t: 'result', game: result.game, winners });
    }
    this.fx.flash('#fff', 0.3);
    this.startIntermission(result);
  }

  // ------------------------------------------------------------------ loop
  frame(now) {
    const dt = clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    try {
      this.update(dt);
      this.draw();
    } catch (err) {
      // um erro num jogo nunca pode travar a live: pula para o próximo
      console.error(err);
      this.game = null;
      this.startIntermission({ title: 'Próximo jogo!', color: '#fff', winners: [] });
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  update(dt) {
    this.fx.update(dt);
    for (const f of this.feed) f.t += dt;
    this.updateBanner(dt);

    if (this.phase === 'boot') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.startIntermission(null);
      return;
    }
    if (this.phase === 'intermission') {
      this.phaseT -= dt;
      const sec = Math.ceil(this.phaseT);
      if (sec <= 3 && sec > 0 && sec !== this.lastTick) {
        this.lastTick = sec;
        this.sfx('tick');
      }
      if (this.phaseT <= 0) this.startGame();
      return;
    }

    this.game.time += dt;
    this.timeLeft -= dt;
    this.instrT += dt;
    if (this.instrT > 5) {
      this.instrT = 0;
      this.instrIdx++;
    }
    for (const b of this.bots) {
      const t = this.botTimers.get(b.id) - dt;
      if (t <= 0) {
        const p = this.game.getPlayer(b.id);
        if (p) this.game.onLike(p, Math.ceil(rand(1, 6)));
        this.botTimers.set(b.id, rand(1.5, 5));
      } else this.botTimers.set(b.id, t);
    }
    this.game.update(dt);
    if (this.timeLeft <= 0 && !this.game.finished) this.game.timeUp();
    if (this.game.finished) this.endGame();
  }

  updateBanner(dt) {
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t >= this.banner.dur) this.banner = null;
    }
    if (!this.banner && this.banners.length) {
      const b = this.banners.shift();
      b.t = 0;
      b.dur = this.banners.length > 4 ? 1.4 : b.tier >= 3 ? 3.5 : 2.6;
      this.banner = b;
      if (b.tier >= 2) this.fx.burst(540, 1000, '#ffe066', 30 * b.tier, 500, 9);
    }
  }

  // ------------------------------------------------------------------ desenho
  makeBackground() {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#1b1037');
    grad.addColorStop(0.5, '#10183a');
    grad.addColorStop(1, '#0b0f24');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.05;
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    for (let i = -H; i < W; i += 60) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + H, H);
      g.stroke();
    }
    return c;
  }

  draw() {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.bg, 0, 0);

    const [sx, sy] = this.fx.shakeOffset();
    g.save();
    g.translate(sx, sy);
    if (this.phase === 'playing' && this.game) {
      g.save();
      g.beginPath();
      g.rect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
      g.clip();
      this.game.draw(g);
      g.restore();
    }
    this.fx.draw(g);
    g.restore();

    if (this.phase === 'playing' && this.game) {
      this.drawHeader(g);
      this.drawGiftGuide(g, this.game.giftGuide);
    } else if (this.phase === 'intermission') {
      this.drawIntermission(g);
    } else {
      text(g, '🎮 Carregando...', W / 2, H / 2, 60);
    }
    this.drawFeed(g);
    this.drawBanner(g);
    this.drawStatus(g);
    this.fx.drawFlash(g);
  }

  drawHeader(g) {
    const G = this.game.constructor;
    const total = this.cfg.games.durations[G.id] || 180;
    roundRect(g, 20, 150, 1040, 180, 26, 'rgba(10,10,30,0.82)', 'rgba(255,255,255,0.15)', 3);
    text(g, `${G.emoji} ${G.title}`, 50, 200, 52, '#fff', 'left');
    text(g, `⏱ ${fmtTime(this.timeLeft)}`, 1030, 200, 46, this.timeLeft < 15 ? '#ff6b6b' : '#ffe066', 'right');
    bar(g, 50, 238, 980, 14, this.timeLeft / total, '#8a5cff');
    const lines = this.game.instructions;
    const line = lines[this.instrIdx % lines.length];
    const a = clamp(Math.min(this.instrT, 5 - this.instrT) * 4, 0, 1);
    g.globalAlpha = a;
    text(g, fitText(g, line, 990, 34, 800), 540, 293, 34, '#fff', 'center', 800);
    g.globalAlpha = 1;
    text(g, `👥 ${this.game.players.size}`, 1030, 120, 30, '#fff', 'right');
  }

  drawGiftGuide(g, guide, y = this.cfg.overlay.giftGuideY) {
    if (!guide?.length) return;
    const h = 56 + guide.length * 42;
    roundRect(g, 20, y, 1040, h, 22, 'rgba(10,10,30,0.82)', 'rgba(255,224,102,0.5)', 3);
    text(g, '🎁 PRESENTES DÃO PODERES', 540, y + 30, 28, '#ffe066');
    guide.forEach((row, i) => {
      const ry = y + 74 + i * 42;
      text(g, row.icon, 60, ry, 30, '#fff', 'center', 900, false);
      text(g, row.label, 95, ry, 26, '#ffe066', 'left');
      text(g, fitText(g, row.text, 800, 26, 700), 215, ry, 26, '#fff', 'left', 700);
    });
  }

  drawFeed(g) {
    const y0 = this.cfg.overlay.feedY;
    this.feed.forEach((f, i) => {
      const a = clamp(Math.min(f.t * 4, (12 - f.t) / 2), 0, 1);
      if (a <= 0) return;
      g.globalAlpha = a;
      const y = y0 + i * 40;
      roundRect(g, 20, y - 18, 1040, 36, 12, 'rgba(0,0,0,0.5)');
      text(g, fitText(g, f.str, 1000, 24, 800), 40, y, 24, f.color, 'left', 800);
      g.globalAlpha = 1;
    });
  }

  drawBanner(g) {
    const b = this.banner;
    if (!b) return;
    const k = Math.min(b.t * 5, (b.dur - b.t) * 5, 1);
    const scale = 0.6 + 0.4 * clamp(k, 0, 1);
    g.save();
    g.globalAlpha = clamp(k, 0, 1);
    g.translate(540, 1000);
    g.scale(scale, scale);
    const colors = ['#8a5cff', '#8a5cff', '#ff7b00', '#ff3d7f', '#ffd700'];
    roundRect(g, -470, -100, 940, 200, 30, 'rgba(10,10,30,0.9)', colors[b.tier], 6);
    drawAvatar(g, b.user, -370, 0, 70, colors[b.tier], 6);
    text(g, fitText(g, b.user.name, 560, 40), -270, -50, 40, '#fff', 'left');
    text(g, fitText(g, `enviou ${b.desc}`, 560, 30, 700), -270, -2, 30, '#ddd', 'left', 700);
    if (b.label) text(g, fitText(g, b.label, 560, 44), -270, 50, 44, '#ffe066', 'left');
    if (b.img?.complete && b.img.naturalWidth) g.drawImage(b.img, 360, -50, 90, 90);
    g.restore();
  }

  drawIntermission(g) {
    g.fillStyle = 'rgba(5,5,20,0.55)';
    g.fillRect(0, 0, W, H);
    const r = this.lastResult;
    let y = 220;
    if (r) {
      text(g, '🏆 RESULTADO', 540, y, 56, '#ffe066');
      text(g, fitText(g, r.title, 1000, 44), 540, y + 75, 44, r.color || '#fff');
      const podium = r.winners.slice(0, 3);
      const xs = podium.length === 1 ? [540] : podium.length === 2 ? [380, 700] : [540, 260, 820];
      const sizes = [95, 75, 75];
      const medals = ['🥇', '🥈', '🥉'];
      podium.forEach((w, i) => {
        const x = xs[i];
        const yy = y + 260 + (i ? 40 : 0);
        drawAvatar(g, w.user, x, yy, sizes[i], ['#ffd700', '#c0c0c0', '#cd7f32'][i], 8);
        text(g, medals[i], x - sizes[i] * 0.75, yy - sizes[i] * 0.75, 50, '#fff', 'center', 900, false);
        text(g, fitText(g, w.user.name, 260, 30), x, yy + sizes[i] + 34, 30);
        text(g, `+${w.points} pts`, x, yy + sizes[i] + 72, 26, '#ffe066');
      });
      y += 520;
    } else {
      text(g, '🎮 JOGOS AO VIVO', 540, y + 40, 70, '#ffe066');
      text(g, 'Comente, curta e mande presentes para jogar!', 540, y + 130, 36);
      y += 260;
    }

    // ranking geral
    const top = this.leaderboard.slice(0, 5);
    if (top.length) {
      roundRect(g, 120, y, 840, 70 + top.length * 58, 24, 'rgba(10,10,30,0.8)', 'rgba(255,255,255,0.15)', 3);
      text(g, '⭐ RANKING GERAL', 540, y + 36, 32, '#7fd4ff');
      top.forEach((e, i) => {
        const yy = y + 100 + i * 58;
        text(g, `${i + 1}º`, 180, yy, 30, '#ffe066');
        drawAvatar(g, { id: e.id, name: e.name, avatar: e.avatar }, 250, yy, 22, '#fff', 3);
        text(g, fitText(g, e.name, 420, 28, 800), 290, yy, 28, '#fff', 'left', 800);
        text(g, `${e.points} pts · ${e.wins} 🏆`, 920, yy, 26, '#ccc', 'right', 700);
      });
      y += 100 + top.length * 58;
    }

    // próximo jogo
    const N = GAMES[this.nextId];
    if (N) {
      y = Math.max(y + 30, 1150);
      text(g, 'PRÓXIMO JOGO', 540, y, 32, '#aaa');
      text(g, `${N.emoji} ${N.title}`, 540, y + 65, 62, '#fff');
      const preview = this.preview;
      text(g, fitText(g, preview.instructions[0], 1000, 32, 800), 540, y + 130, 32, '#b8ffcf', 'center', 800);
      text(g, `Começa em ${Math.ceil(this.phaseT)}`, 540, y + 205, 52, '#ffe066');
      this.drawGiftGuide(g, preview.giftGuide);
    }
  }

  drawStatus(g) {
    const s = this.tiktok;
    if (!s || s.state === 'connected') return;
    const msg = s.state === 'disabled' ? '⚙️ Modo teste (sem TikTok)' : s.state === 'offline' ? '⏳ Aguardando a live começar...' : '🔌 Conectando ao chat do TikTok...';
    g.globalAlpha = 0.7;
    text(g, msg, 30, 120, 22, '#ddd', 'left', 700);
    g.globalAlpha = 1;
  }
}

window.manager = new GameManager(document.getElementById('game'));
