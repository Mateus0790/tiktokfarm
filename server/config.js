import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE_PATH = path.join(ROOT, 'config.example.json');
export const CONFIG_PATH = path.join(ROOT, 'config.json');

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = isObject(v) && isObject(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Não foi possível ler ${path.basename(file)}: ${err.message}`);
  }
}

/** Carrega config.example.json (padrões) + config.json (do usuário) + argumentos/variáveis de ambiente. */
export function loadConfig(argv = process.argv.slice(2)) {
  const defaults = readJson(EXAMPLE_PATH);
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.copyFileSync(EXAMPLE_PATH, CONFIG_PATH);
    console.log('[config] config.json criado a partir de config.example.json — edite com o seu usuário do TikTok.');
  }
  let cfg = deepMerge(defaults, readJson(CONFIG_PATH));

  if (process.env.TIKTOK_USERNAME) cfg.tiktokUsername = process.env.TIKTOK_USERNAME;
  if (process.env.SIGN_API_KEY) cfg.signApiKey = process.env.SIGN_API_KEY;
  if (process.env.PORT) cfg.server.port = Number(process.env.PORT);
  if (argv.includes('--sim')) cfg = deepMerge(cfg, { simulator: { enabled: true } });
  const userArg = argv.find((a) => a.startsWith('--user='));
  if (userArg) cfg.tiktokUsername = userArg.slice('--user='.length);

  cfg.tiktokUsername = String(cfg.tiktokUsername || '').replace(/^@/, '').trim();
  return cfg;
}

/** Parte da configuração que o overlay (navegador) precisa conhecer. */
export function publicConfig(cfg) {
  return {
    games: cfg.games,
    players: cfg.players,
    bots: cfg.bots,
    overlay: cfg.overlay,
    username: cfg.tiktokUsername,
  };
}
