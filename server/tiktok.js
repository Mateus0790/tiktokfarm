import { EventEmitter } from 'node:events';
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';
import { GiftStreakTracker, normalizeGift, normalizeUser } from './normalize.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Mantém a conexão com a live do TikTok viva para sempre:
 * - se a live ainda não começou, tenta de novo a cada `offlineRetrySeconds`;
 * - se cair/terminar, reconecta sozinho;
 * - watchdog: se ficar muito tempo sem nenhum evento, força a reconexão.
 *
 * Emite: 'event' (evento normalizado) e 'status' ({ state, message, viewers, roomId }).
 */
export class TikTokSource extends EventEmitter {
  constructor(cfg) {
    super();
    this.cfg = cfg;
    this.username = cfg.tiktokUsername;
    this.gifts = new GiftStreakTracker();
    this.status = { state: 'idle', message: 'Aguardando', viewers: 0, roomId: null, since: Date.now() };
    this.conn = null;
    this.stopped = false;
    this.lastEventAt = Date.now();
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch, since: patch.state ? Date.now() : this.status.since };
    this.emit('status', this.status);
  }

  start() {
    if (!this.username || this.username === 'seu_usuario_aqui') {
      this.setStatus({ state: 'disabled', message: 'Configure "tiktokUsername" no config.json' });
      return;
    }
    this.loop().catch((err) => console.error('[tiktok] loop terminou com erro', err));
  }

  async stop() {
    this.stopped = true;
    try {
      await this.conn?.disconnect();
    } catch {}
  }

  /** Força uma reconexão (botão no painel). */
  async reconnect() {
    try {
      await this.conn?.disconnect();
    } catch {}
  }

  async loop() {
    const t = this.cfg.tiktok;
    while (!this.stopped) {
      this.setStatus({ state: 'connecting', message: `Conectando em @${this.username}...` });
      try {
        await this.connectOnce();
        if (!this.stopped) {
          this.setStatus({ state: 'reconnecting', message: 'Conexão perdida, reconectando...' });
          await sleep(t.reconnectDelaySeconds * 1000);
        }
      } catch (err) {
        const msg = String(err?.message || err);
        const offline = /offline|not.*live|isn't live|UserOffline|room ?id/i.test(msg) || err?.name === 'UserOfflineError';
        if (offline) {
          this.setStatus({ state: 'offline', message: `@${this.username} não está ao vivo. Tentando de novo em ${t.offlineRetrySeconds}s` });
          await sleep(t.offlineRetrySeconds * 1000);
        } else {
          console.warn('[tiktok] erro ao conectar:', msg);
          this.setStatus({ state: 'error', message: `Erro: ${msg.slice(0, 160)}` });
          await sleep(Math.max(t.reconnectDelaySeconds, 20) * 1000);
        }
      }
    }
  }

  connectOnce() {
    return new Promise((resolve, reject) => {
      const options = { processInitialData: false, enableExtendedGiftInfo: false };
      if (this.cfg.signApiKey) options.signApiKey = this.cfg.signApiKey;
      const conn = new TikTokLiveConnection(this.username, options);
      this.conn = conn;

      let connected = false;
      let watchdog = null;
      const finish = () => {
        clearInterval(watchdog);
        conn.removeAllListeners();
        if (this.conn === conn) this.conn = null;
        resolve();
      };

      this.attachHandlers(conn);
      conn.on(ControlEvent.DISCONNECTED, () => connected && finish());
      conn.on(WebcastEvent.STREAM_END, () => {
        this.setStatus({ state: 'offline', message: 'A live terminou.' });
        conn.disconnect().catch(() => {});
      });
      conn.on(ControlEvent.ERROR, (e) => {
        const info = e?.info || e?.exception?.message || e;
        console.warn('[tiktok] erro:', String(info).slice(0, 200));
      });

      conn
        .connect()
        .then((state) => {
          connected = true;
          this.lastEventAt = Date.now();
          this.setStatus({ state: 'connected', message: `Conectado na live de @${this.username}`, roomId: state?.roomId || null });
          console.log(`[tiktok] conectado (room ${state?.roomId})`);
          const limit = this.cfg.tiktok.watchdogMinutes * 60_000;
          watchdog = setInterval(() => {
            if (Date.now() - this.lastEventAt > limit) {
              console.warn('[tiktok] watchdog: nenhum evento recebido, reconectando');
              conn.disconnect().catch(() => {});
              finish();
            }
          }, 30_000);
        })
        .catch((err) => {
          conn.removeAllListeners();
          if (this.conn === conn) this.conn = null;
          reject(err);
        });
    });
  }

  attachHandlers(conn) {
    const send = (kind, data, extra = {}) => {
      this.lastEventAt = Date.now();
      const user = normalizeUser(data?.user);
      if (!user) return;
      this.emit('event', { kind, user, ...extra });
    };

    conn.on(WebcastEvent.CHAT, (d) => send('chat', d, { text: String(d.comment || '').slice(0, 200) }));
    conn.on(WebcastEvent.LIKE, (d) => send('like', d, { count: Math.max(1, Number(d.likeCount) || 1) }));
    conn.on(WebcastEvent.FOLLOW, (d) => send('follow', d));
    conn.on(WebcastEvent.SHARE, (d) => send('share', d));
    conn.on(WebcastEvent.MEMBER, (d) => send('enter', d));
    conn.on(WebcastEvent.GIFT, (d) => {
      const count = this.gifts.delta(d);
      if (count > 0) send('gift', d, normalizeGift(d, count));
      else this.lastEventAt = Date.now();
    });
    conn.on(WebcastEvent.ROOM_USER, (d) => {
      this.lastEventAt = Date.now();
      const viewers = Number(d.viewerCount) || 0;
      if (viewers !== this.status.viewers) this.setStatus({ viewers });
    });
  }
}
