import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { loadConfig, publicConfig, ROOT } from './config.js';
import { TikTokSource } from './tiktok.js';
import { Simulator, fakeUser } from './simulator.js';
import { LeaderboardStore } from './store.js';
import { avatarHandler } from './avatar.js';

process.on('uncaughtException', (err) => console.error('[erro não tratado]', err));
process.on('unhandledRejection', (err) => console.error('[promise rejeitada]', err));

const cfg = loadConfig();
const store = new LeaderboardStore();
const tiktok = new TikTokSource(cfg);
const simulator = new Simulator(cfg.simulator);

const session = { startedAt: Date.now(), events: 0, diamonds: 0, gifters: new Map() };
let lastGameState = null;

// ---------------------------------------------------------------- HTTP
const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(ROOT, 'public'), { maxAge: 0 }));
app.get('/', (_req, res) => res.redirect('/admin.html'));
app.get('/avatar', avatarHandler);
app.get('/health', (_req, res) => res.json({ ok: true, tiktok: tiktok.status.state, uptime: process.uptime() }));

const server = http.createServer(app);

// ---------------------------------------------------------------- WebSocket
const wss = new WebSocketServer({
  server,
  path: '/ws',
  // Bloqueia sites externos abertos no seu navegador de controlarem o painel.
  verifyClient: ({ origin, req }) => {
    if (!origin || origin === 'null') return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  },
});
const overlays = new Set();
const previews = new WeakSet(); // prévia do painel: nunca vira o overlay principal
const admins = new Set();
let primary = null;

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(set, msg) {
  const data = JSON.stringify(msg);
  for (const ws of set) if (ws.readyState === 1) ws.send(data);
}

// Só um overlay (o "principal") reporta resultados para o ranking.
// Os outros (ex.: uma prévia aberta no navegador) apenas mostram o jogo.
function electPrimary() {
  if (primary && overlays.has(primary)) return;
  primary = [...overlays].find((ws) => !previews.has(ws)) || null;
  for (const ws of overlays) send(ws, { t: 'primary', primary: ws === primary });
}

function leaderboardMsg() {
  return { t: 'leaderboard', top: store.top(10) };
}

function statusMsg() {
  const topGifters = [...session.gifters.values()].sort((a, b) => b.diamonds - a.diamonds).slice(0, 5);
  return {
    t: 'status',
    tiktok: tiktok.status,
    username: cfg.tiktokUsername,
    simulator: simulator.running,
    overlays: overlays.size,
    game: lastGameState,
    leaderboard: store.top(10),
    session: { startedAt: session.startedAt, events: session.events, diamonds: session.diamonds, topGifters },
    games: cfg.games.rotation,
  };
}

wss.on('connection', (ws, req) => {
  const role = new URL(req.url, 'http://x').searchParams.get('role');
  if (role === 'admin') {
    admins.add(ws);
    send(ws, statusMsg());
  } else {
    overlays.add(ws);
    if (role === 'preview') previews.add(ws);
    send(ws, { t: 'init', config: publicConfig(cfg), leaderboard: store.top(10) });
    electPrimary();
    send(ws, { t: 'primary', primary: ws === primary });
  }

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (overlays.has(ws)) onOverlayMessage(ws, msg);
    else if (admins.has(ws)) onAdminMessage(msg);
  });

  ws.on('close', () => {
    overlays.delete(ws);
    admins.delete(ws);
    if (ws === primary) {
      primary = null;
      electPrimary();
    }
  });
});

function onOverlayMessage(ws, msg) {
  if (ws !== primary) return;
  if (msg.t === 'state') {
    lastGameState = msg.state;
  } else if (msg.t === 'result') {
    store.addResult(msg.winners);
    broadcast(overlays, leaderboardMsg());
  }
}

function onAdminMessage(msg) {
  switch (msg.action) {
    case 'skip':
    case 'reload':
      broadcast(overlays, { t: 'control', action: msg.action });
      break;
    case 'play':
      broadcast(overlays, { t: 'control', action: 'play', game: msg.game });
      break;
    case 'simulator':
      msg.enabled ? simulator.start() : simulator.stop();
      break;
    case 'reconnect':
      tiktok.reconnect();
      break;
    case 'resetLeaderboard':
      store.reset();
      broadcast(overlays, leaderboardMsg());
      break;
    case 'simulate':
      simulateEvent(msg);
      break;
  }
  broadcast(admins, statusMsg());
}

const testUsers = new Map();
function simulateEvent(msg) {
  const name = String(msg.name || '').trim().slice(0, 24);
  let user;
  if (name) {
    user = testUsers.get(name) || { ...fakeUser(testUsers.size), name, uniqueId: name };
    testUsers.set(name, user);
  } else {
    user = simulator.users[Math.floor(Math.random() * simulator.users.length)];
  }
  const kind = msg.kind;
  if (kind === 'gift') {
    const diamonds = Math.max(1, Number(msg.diamonds) || 1);
    handleEvent({ kind, user, giftId: 0, giftName: msg.giftName || `${diamonds} diamantes`, giftImage: null, count: 1, diamonds });
  } else if (kind === 'like') handleEvent({ kind, user, count: Number(msg.count) || 10 });
  else if (kind === 'chat') handleEvent({ kind, user, text: String(msg.text || 'entrei') });
  else if (kind === 'follow' || kind === 'share') handleEvent({ kind, user });
}

// ---------------------------------------------------------------- Eventos
function handleEvent(e) {
  session.events++;
  if (e.kind === 'gift') {
    session.diamonds += e.diamonds;
    const g = session.gifters.get(e.user.id) || { name: e.user.name, avatar: e.user.avatar, diamonds: 0 };
    g.diamonds += e.diamonds;
    session.gifters.set(e.user.id, g);
    if (!String(e.user.id).startsWith('sim')) store.addDiamonds(e.user, e.diamonds);
  }
  broadcast(overlays, { t: 'event', e });
}

tiktok.on('event', handleEvent);
simulator.on('event', handleEvent);
tiktok.on('status', (s) => {
  console.log(`[tiktok] ${s.state}: ${s.message}`);
  broadcast(admins, statusMsg());
  broadcast(overlays, { t: 'tiktok', status: s });
});
setInterval(() => broadcast(admins, statusMsg()), 2000).unref();

// ---------------------------------------------------------------- Início
server.listen(cfg.server.port, cfg.server.host, () => {
  const base = `http://${cfg.server.host === '0.0.0.0' ? 'localhost' : cfg.server.host}:${cfg.server.port}`;
  console.log('');
  console.log('  TikTok Farm rodando!');
  console.log(`  Overlay (OBS, 1080x1920): ${base}/overlay.html`);
  console.log(`  Painel de controle:       ${base}/admin.html`);
  console.log(`  Usuário TikTok:           @${cfg.tiktokUsername}`);
  console.log('');
  tiktok.start();
  if (cfg.simulator.enabled) {
    console.log('  [simulador] ligado — eventos falsos sendo gerados.');
    simulator.start();
  }
});

function shutdown() {
  console.log('Encerrando...');
  store.save();
  tiktok.stop().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
