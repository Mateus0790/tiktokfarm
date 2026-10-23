// Proxy de fotos de perfil: usado pelo overlay só quando a foto não carrega direto
// do CDN. Aceita apenas domínios de imagem do TikTok/ByteDance e do YouTube/Google.

const ALLOWED_HOSTS = /(^|\.)(tiktokcdn\.com|tiktokcdn-us\.com|tiktokcdn-eu\.com|ibyteimg\.com|byteimg\.com|muscdn\.com|tiktokv\.com|ggpht\.com|googleusercontent\.com|ytimg\.com)$/i;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 400;
const cache = new Map(); // url → { type, body }

export async function avatarHandler(req, res) {
  let url;
  try {
    url = new URL(String(req.query.url || ''));
  } catch {
    return res.status(400).end();
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.test(url.hostname)) return res.status(403).end();

  const key = url.href;
  let hit = cache.get(key);
  if (!hit) {
    try {
      const r = await fetch(key, {
        signal: AbortSignal.timeout(8000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Referer: 'https://www.tiktok.com/',
        },
      });
      const type = r.headers.get('content-type') || '';
      if (!r.ok || !type.startsWith('image/')) return res.status(502).end();
      const body = Buffer.from(await r.arrayBuffer());
      if (body.length > MAX_BYTES) return res.status(502).end();
      hit = { type, body };
      cache.set(key, hit);
      if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
    } catch {
      return res.status(504).end();
    }
  }
  res.set('Content-Type', hit.type);
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(hit.body);
}
