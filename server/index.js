import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { loadConfig, publicConfig, ROOT } from './config.js';
import { TikTokSource } from './tiktok.js';
import { YouTubeSource, amountToDiamonds } from './youtube.js';
import { Simulator, fakeUser } from './simulator.js';
import { LeaderboardStore } from './store.js';
import { avatarHandler } from './avatar.js';

process.on('uncaughtException', (err) => console.error('[erro não tratado]', err));
process.on('unhandledRejection', (err) => console.error('[promise rejeitada]', err));

const cfg = loadConfig();
const store = new LeaderboardStore();
const tiktok = new TikTokSource(cfg);
const youtube = new YouTubeSource(cfg);
const simulator = new Simulator({ ...cfg.simulator, youtube: Boolean(cfg.youtube.channel), diamondsPerDollar: cfg.youtube.diamondsPerDollar });

const session = { startedAt: Date.now(), events: 0, diamonds: 0, gifters: new Map() };
let lastGameState = null;
let standby = false; // jogos parados (tela de encerramento), programa continua aberto

// Código de saída que avisa o start-windows.bat / start.sh para NÃO reiniciar.
const EXIT_STOP = 10;

// ---------------------------------------------------------------- HTTP
const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(ROOT, 'public'), { maxAge: 0 }));
app.get('/', (_req, res) => res.redirect('/admin.html'));
app.get('/avatar', avatarHandler);
// Encerrar pelo atalho encerrar-windows.bat. O cabeçalho extra impede que um site
// qualquer aberto no navegador consiga desligar o programa.
app.post('/api/shutdown', (req, res) => {
  if (req.get('X-TikTokFarm') !== '1') return res.status(403).end();
  res.json({ ok: true });
  shutdown(EXIT_STOP);
});
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
    youtube: youtube.status,
    youtubeChannel: cfg.youtube.channel,
    username: cfg.tiktokUsername,
    simulator: simulator.running,
    overlays: overlays.size,
    game: lastGameState,
    leaderboard: store.top(10),
    session: { startedAt: session.startedAt, events: session.events, diamonds: session.diamonds, topGifters },
    games: cfg.games.rotation,
    standby,
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
    send(ws, { t: 'init', config: publicConfig(cfg), leaderboard: store.top(10), standby });
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
    case 'standby':
      standby = Boolean(msg.enabled);
      broadcast(overlays, { t: 'control', action: 'standby', enabled: standby });
      console.log(standby ? '[painel] jogos parados' : '[painel] jogos retomados');
      break;
    case 'shutdown':
      shutdown(EXIT_STOP);
      return;
    case 'reconnect':
      tiktok.reconnect();
      youtube.reconnect();
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
  const platform = msg.platform === 'youtube' || msg.kind === 'superchat' ? 'youtube' : 'tiktok';
  let user;
  if (name) {
    const key = `${platform}:${name}`;
    user = testUsers.get(key) || { ...fakeUser(testUsers.size), name, uniqueId: name, platform };
    testUsers.set(key, user);
  } else {
    user = { ...simulator.users[Math.floor(Math.random() * simulator.users.length)] };
    user.platform = platform;
  }
  const kind = msg.kind;
  if (kind === 'superchat') {
    const amount = String(msg.amount || 'R$ 10,00');
    handleEvent({ kind: 'gift', user, giftId: 'yt-superchat', giftName: `Super Chat ${amount}`, giftImage: null, count: 1, diamonds: amountToDiamonds(amount, cfg.youtube.diamondsPerDollar) });
  } else if (kind === 'gift') {
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
youtube.on('event', handleEvent);
youtube.on('status', (s) => {
  console.log(`[youtube] ${s.state}: ${s.message}`);
  broadcast(admins, statusMsg());
  broadcast(overlays, { t: 'youtube', status: s });
});
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
  console.log(`  Canal YouTube:            ${cfg.youtube.channel || '(desligado)'}`);
  console.log('');
  tiktok.start();
  youtube.start();
  if (cfg.simulator.enabled) {
    console.log('  [simulador] ligado — eventos falsos sendo gerados.');
    simulator.start();
  }
});

let shuttingDown = false;
function shutdown(code = EXIT_STOP) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Encerrando o TikTok Farm...');
  broadcast(overlays, { t: 'shutdown' });
  broadcast(admins, { t: 'shutdown' });
  simulator.stop();
  youtube.stop();
  store.save();
  const exit = () => process.exit(code);
  // dá um instante para as mensagens chegarem ao overlay/painel
  setTimeout(() => tiktok.stop().finally(exit), 300);
  setTimeout(exit, 3000).unref();
}
// Ctrl+C / fechar o terminal também encerra de vez (sem reiniciar).
process.on('SIGINT', () => shutdown(EXIT_STOP));
process.on('SIGTERM', () => shutdown(EXIT_STOP));
