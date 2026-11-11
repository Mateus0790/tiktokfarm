import { EventEmitter } from 'node:events';

// Lê o chat de uma live do YouTube sem chave de API (mesmo método da página
// "live_chat" do próprio YouTube) e converte em eventos iguais aos do TikTok:
//   comentário → 'chat'; Super Chat / Super Sticker / membro → 'gift' (com diamantes equivalentes).
// Como o do TikTok, não é oficial: se o YouTube mudar o site, pode parar até ser ajustado.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8', Cookie: 'CONSENT=YES+1; SOCS=CAI' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Valor aproximado de 1 unidade de cada moeda em dólar (só para converter Super Chat em "diamantes").
const USD_RATE = {
  USD: 1, BRL: 0.18, EUR: 1.08, GBP: 1.27, CAD: 0.73, AUD: 0.65, NZD: 0.6, MXN: 0.055, ARS: 0.001,
  CLP: 0.0011, COP: 0.00025, PEN: 0.27, UYU: 0.025, JPY: 0.0067, KRW: 0.00073, INR: 0.012, CHF: 1.12,
  SEK: 0.095, NOK: 0.093, DKK: 0.145, PLN: 0.25, TRY: 0.03, RUB: 0.011, PHP: 0.017, IDR: 0.000063, HKD: 0.13, TWD: 0.031,
};
const SYMBOLS = [
  ['R$', 'BRL'], ['US$', 'USD'], ['CA$', 'CAD'], ['A$', 'AUD'], ['NZ$', 'NZD'], ['MX$', 'MXN'], ['HK$', 'HKD'], ['NT$', 'TWD'],
  ['€', 'EUR'], ['£', 'GBP'], ['¥', 'JPY'], ['₩', 'KRW'], ['₹', 'INR'], ['₱', 'PHP'], ['₽', 'RUB'], ['$', 'USD'],
];

/** "R$ 10,00" / "$5.00" / "ARS 1.000,00" / "€2,50" → { value, currency } */
export function parseAmount(str) {
  const s = String(str || '').trim();
  let currency = null;
  const code = s.match(/\b([A-Z]{3})\b/);
  if (code && USD_RATE[code[1]]) currency = code[1];
  if (!currency) for (const [sym, cur] of SYMBOLS) if (s.includes(sym)) { currency = cur; break; }
  let num = s.replace(/[^\d.,]/g, '');
  // decide qual é o separador decimal: o último . ou , seguido de 1-2 dígitos
  const dec = num.match(/[.,](\d{1,2})$/);
  if (dec) num = num.slice(0, -dec[0].length).replace(/[.,]/g, '') + '.' + dec[1];
  else num = num.replace(/[.,]/g, '');
  return { value: Number(num) || 0, currency };
}

export function amountToDiamonds(str, diamondsPerDollar) {
  const { value, currency } = parseAmount(str);
  const usd = currency ? value * USD_RATE[currency] : 0;
  // moeda desconhecida: vale ao menos o nível 2 (10+💎), já que todo Super Chat é pago
  return Math.max(10, Math.round(usd * diamondsPerDollar));
}

// emoji padrão vira o próprio caractere; emoji personalizado do canal vira o atalho (ex.: :gato:)
const runsText = (runs = []) =>
  runs.map((r) => r.text ?? (r.emoji?.isCustomEmoji ? r.emoji.shortcuts?.[0] : r.emoji?.emojiId) ?? '').join('');
const simple = (t) => t?.simpleText ?? runsText(t?.runs);

function bestPhoto(thumbs = []) {
  const url = thumbs[thumbs.length - 1]?.url || null;
  // as fotos vêm pequenas (=s64); pedimos uma maior
  return url ? url.replace(/=s\d+-/, '=s128-').replace(/^\/\//, 'https://') : null;
}

function authorOf(r) {
  const id = r.authorExternalChannelId;
  if (!id) return null;
  return { id: `yt:${id}`, uniqueId: id, name: simple(r.authorName).replace(/^@/, '').slice(0, 24) || 'YouTube', avatar: bestPhoto(r.authorPhoto?.thumbnails), platform: 'youtube' };
}

/** Converte uma "action" do get_live_chat num evento do jogo (ou null). */
export function actionToEvent(action, diamondsPerDollar) {
  const item = action?.addChatItemAction?.item;
  if (!item) return null;
  if (item.liveChatTextMessageRenderer) {
    const r = item.liveChatTextMessageRenderer;
    const user = authorOf(r);
    return user && { id: r.id, ts: Number(r.timestampUsec) / 1000, kind: 'chat', user, text: runsText(r.message?.runs).slice(0, 200) };
  }
  if (item.liveChatPaidMessageRenderer || item.liveChatPaidStickerRenderer) {
    const sticker = Boolean(item.liveChatPaidStickerRenderer);
    const r = item.liveChatPaidMessageRenderer || item.liveChatPaidStickerRenderer;
    const user = authorOf(r);
    const amount = simple(r.purchaseAmountText);
    if (!user) return null;
    return {
      id: r.id,
      ts: Number(r.timestampUsec) / 1000,
      kind: 'gift',
      user,
      giftId: sticker ? 'yt-sticker' : 'yt-superchat',
      giftName: `${sticker ? 'Super Sticker' : 'Super Chat'} ${amount}`,
      giftImage: sticker ? bestPhoto(r.sticker?.thumbnails) : null,
      count: 1,
      diamonds: amountToDiamonds(amount, diamondsPerDollar),
      text: runsText(r.message?.runs).slice(0, 200),
    };
  }
  if (item.liveChatMembershipItemRenderer) {
    const r = item.liveChatMembershipItemRenderer;
    const user = authorOf(r);
    // membro novo ≈ US$ 2 por mês
    return user && { id: r.id, ts: Number(r.timestampUsec) / 1000, kind: 'gift', user, giftId: 'yt-member', giftName: 'Novo membro', giftImage: null, count: 1, diamonds: Math.round(2 * diamondsPerDollar) };
  }
  if (item.liveChatSponsorshipsGiftPurchaseAnnouncementRenderer) {
    const r = item.liveChatSponsorshipsGiftPurchaseAnnouncementRenderer;
    const h = r.header?.liveChatSponsorshipsHeaderRenderer || {};
    const user = authorOf({ ...h, authorExternalChannelId: r.authorExternalChannelId || h.authorExternalChannelId });
    const count = Number(runsText(h.primaryText?.runs).match(/\d+/)?.[0]) || 1;
    return user && { id: r.id, ts: Number(r.timestampUsec) / 1000, kind: 'gift', user, giftId: 'yt-gift-members', giftName: `${count} assinaturas de presente`, giftImage: null, count, diamonds: Math.round(2 * diamondsPerDollar * count) };
  }
  return null;
}

/** Lê dados da página do chat (ou da live). */
export function parsePageOptions(html) {
  const pick = (re) => html.match(re)?.[1] || null;
  return {
    apiKey: pick(/["']INNERTUBE_API_KEY["']\s*:\s*["']([^"']+)["']/),
    clientVersion: pick(/["']INNERTUBE_CLIENT_VERSION["']\s*:\s*["']([\d.]+)["']/) || pick(/["']clientVersion["']\s*:\s*["']([\d.]+)["']/),
    continuation: pick(/"reloadContinuationData"\s*:\s*\{\s*"continuation"\s*:\s*"([^"]+)"/) || pick(/"continuation"\s*:\s*"([^"]+)"/),
    isReplay: /["']isReplay["']\s*:\s*true/.test(html),
  };
}

/** Converte a resposta do get_live_chat em { events, continuation, timeoutMs }. */
export function parseChatResponse(data, diamondsPerDollar) {
  const c = data?.continuationContents?.liveChatContinuation;
  if (!c) return { events: [], continuation: null, timeoutMs: 0 };
  const events = (c.actions || []).map((a) => actionToEvent(a, diamondsPerDollar)).filter(Boolean);
  const cont = c.continuations?.[0] || {};
  const d = cont.invalidationContinuationData || cont.timedContinuationData || cont.reloadContinuationData || {};
  return { events, continuation: d.continuation || null, timeoutMs: Number(d.timeoutMs) || 0 };
}

/** "@canal", "UCxxxx", link do canal, link/ID do vídeo → URL da página da live */
export function liveUrlFor(target) {
  const t = String(target || '').trim();
  const video = t.match(/(?:v=|youtu\.be\/|\/live\/|\/shorts\/)([\w-]{11})/);
  if (video) return { videoId: video[1] };
  const channel = t.match(/(UC[\w-]{22})/);
  if (channel) return { url: `https://www.youtube.com/channel/${channel[1]}/live` };
  const handle = t.match(/@([\w.-]+)/) || [null, t.replace(/^https?:\/\/(www\.)?youtube\.com\//, '')];
  return { url: `https://www.youtube.com/@${handle[1]}/live` };
}

export class YouTubeSource extends EventEmitter {
  constructor(cfg) {
    super();
    this.cfg = cfg.youtube;
    this.target = String(this.cfg.channel || '').trim();
    this.status = { state: 'idle', message: 'Aguardando', viewers: 0, since: Date.now() };
    this.stopped = false;
    this.seen = new Set();
    this.restart = false;
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch, since: patch.state ? Date.now() : this.status.since };
    this.emit('status', this.status);
  }

  start() {
    if (!this.target) {
      this.setStatus({ state: 'disabled', message: 'YouTube desligado (preencha "youtube.channel" no config.json)' });
      return;
    }
    this.loop().catch((err) => console.error('[youtube] loop terminou com erro', err));
  }

  stop() {
    this.stopped = true;
  }

  reconnect() {
    this.restart = true;
  }

  async fetchText(url) {
    const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  }

  /** Descobre o vídeo ao vivo atual e os dados para ler o chat. */
  async resolve() {
    const where = liveUrlFor(this.target);
    let videoId = where.videoId;
    if (!videoId) {
      const html = await this.fetchText(where.url);
      videoId = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/)?.[1];
      const live = /"isLiveNow"\s*:\s*true/.test(html) || /"isLive"\s*:\s*true/.test(html) || /"isUpcoming"\s*:\s*true/.test(html);
      if (!videoId || !live) throw Object.assign(new Error('offline'), { offline: true });
    }
    const chatHtml = await this.fetchText(`https://www.youtube.com/live_chat?is_popout=1&v=${videoId}`);
    const opts = parsePageOptions(chatHtml);
    if (opts.isReplay || !opts.continuation) throw Object.assign(new Error('offline'), { offline: true });
    if (!opts.apiKey || !opts.clientVersion) throw new Error('não consegui ler a página do chat do YouTube');
    return { videoId, ...opts };
  }

  async loop() {
    while (!this.stopped) {
      this.restart = false;
      this.setStatus({ state: 'connecting', message: `Procurando a live de ${this.target}...` });
      let session;
      try {
        session = await this.resolve();
      } catch (err) {
        if (err.offline) this.setStatus({ state: 'offline', message: `${this.target} não está ao vivo no YouTube. Tentando de novo em ${this.cfg.offlineRetrySeconds}s` });
        else this.setStatus({ state: 'error', message: `Erro no YouTube: ${String(err.message).slice(0, 140)}` });
        await sleep(this.cfg.offlineRetrySeconds * 1000);
        continue;
      }
      this.setStatus({ state: 'connected', message: `Lendo o chat do YouTube (vídeo ${session.videoId})` });
      console.log(`[youtube] conectado no chat do vídeo ${session.videoId}`);
      await this.poll(session);
      if (!this.stopped) await sleep(5000);
    }
  }

  async poll(session) {
    let { continuation } = session;
    const startedAt = Date.now() - 5000; // ignora mensagens antigas que vêm no primeiro lote
    let failures = 0;
    while (!this.stopped && !this.restart && continuation) {
      let wait = 2000;
      try {
        const r = await fetch(`https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${session.apiKey}&prettyPrint=false`, {
          method: 'POST',
          headers: { ...HEADERS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: session.clientVersion } }, continuation }),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const out = parseChatResponse(await r.json(), this.cfg.diamondsPerDollar);
        failures = 0;
        continuation = out.continuation;
        for (const e of out.events) {
          if (this.seen.has(e.id) || e.ts < startedAt) continue;
          this.seen.add(e.id);
          const { id, ts, ...event } = e;
          this.emit('event', event);
        }
        if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2000));
        wait = Math.min(Math.max(out.timeoutMs || 2000, this.cfg.pollMinMs), 10000);
      } catch (err) {
        if (++failures >= 5) {
          console.warn('[youtube] muitas falhas seguidas, procurando a live de novo:', err.message);
          return;
        }
        wait = 3000 * failures;
      }
      await sleep(wait);
    }
    if (!continuation) this.setStatus({ state: 'offline', message: 'A live do YouTube terminou.' });
  }
}
