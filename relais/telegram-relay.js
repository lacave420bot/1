/*
 * Relais Telegram pour La Cave ✨️ — Cloudflare Worker
 * ---------------------------------------------------
 * Problème résolu : l'application est un fichier HTML unique, servi tel quel au
 * navigateur. Tout ce qu'il contient est lisible par n'importe quel visiteur —
 * y compris le token du bot. Ce relais garde le token côté serveur : l'appli
 * n'envoie plus que le texte à publier, le relais y ajoute le token.
 *
 * ── Déploiement ────────────────────────────────────────────────────────────
 * 1. dash.cloudflare.com → Workers & Pages → Create → Worker → coller ce fichier
 * 2. Settings → Variables and Secrets, ajouter en type « Secret » :
 *      BOT_TOKEN    le token @BotFather (le seul endroit où il doit vivre)
 *      RELAY_KEY    une phrase au hasard, à recopier dans l'admin de l'appli
 *      CHAT_SELLER  ton chat ID (celui des commandes)
 *    Facultatif :
 *      CHAT_STOCK   chat/canal des alertes stock (défaut : CHAT_SELLER)
 *      SITE_PREFIX  ex. https://lacave420bot.github.io — n'autorise que les
 *                   boutons pointant vers ton site (voir plus bas)
 * 3. Déployer, copier l'URL (https://xxx.workers.dev), la coller dans
 *    Admin → Notifications Telegram → « URL du relais », avec la même RELAY_KEY.
 * 4. Vider le champ Token dans l'admin, exporter, redéployer. Le fichier publié
 *    ne contient alors plus aucun secret irremplaçable.
 *
 * ── Ce que le relais protège, et ce qu'il ne protège pas ───────────────────
 * Protégé : le token. Il ne quitte jamais Cloudflare, personne ne peut prendre
 * le contrôle du bot ni lire les conversations.
 * Non protégé : RELAY_KEY est dans le fichier publié, donc lisible. Quelqu'un
 * qui la récupère peut faire envoyer des messages PAR ton bot — mais seulement
 * vers tes chats ou vers des clients ayant déjà démarré le bot, et seulement
 * sous les formes prévues ici. Aucun risque pour le bot lui-même : il suffit de
 * changer RELAY_KEY des deux côtés pour couper l'accès, sans toucher au token.
 * C'est tout l'intérêt : une clé jetable au lieu d'un secret irremplaçable.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

const json = (obj, status) =>
  new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...CORS }
  });

/* Destination : « seller » et « stock » sont résolus ici, jamais fournis par le
   client. Un identifiant numérique reste accepté — l'appli prévient aussi les
   clients sur leur propre chat — mais il doit être purement numérique. */
function resolveChat(to, env) {
  const v = String(to == null ? '' : to).trim();
  if (v === '' || v === 'seller') return String(env.CHAT_SELLER || '');
  if (v === 'stock') return String(env.CHAT_STOCK || env.CHAT_SELLER || '');
  return /^-?\d{1,20}$/.test(v) ? v : null;
}

/* Les boutons peuvent porter une URL. Sans garde-fou, quelqu'un qui aurait la
   clé pourrait faire envoyer un lien de hameçonnage par ton bot. Si SITE_PREFIX
   est défini, seuls les liens vers ton propre site passent. */
function buttonsAllowed(markup, env) {
  const prefix = String(env.SITE_PREFIX || '').trim();
  if (!markup) return true;
  const rows = markup.inline_keyboard;
  if (!Array.isArray(rows)) return false;
  let n = 0;
  for (const row of rows) {
    if (!Array.isArray(row)) return false;
    for (const b of row) {
      if (++n > 8 || !b || typeof b.text !== 'string' || b.text.length > 120) return false;
      const url = b.url || (b.web_app && b.web_app.url);
      if (url === undefined) return false;
      if (typeof url !== 'string' || url.length > 2000) return false;
      if (!/^https:\/\//.test(url)) return false;
      if (prefix && url.indexOf(prefix) !== 0) return false;
    }
  }
  return true;
}

async function toTelegram(env, method, body, headers) {
  const r = await fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/' + method, {
    method: 'POST', body, headers
  });
  const data = await r.json().catch(() => null);
  // On rend la réponse ET le code de Telegram tels quels. L'appli distingue les
  // échecs définitifs (401 token révoqué, 400 chat invalide) des pannes
  // passagères (5xx) pour ne réessayer que dans le second cas : masquer le code
  // derrière un 502 générique lui ferait réessayer un token mort trois fois.
  return json(data || { ok: false, description: 'réponse illisible (HTTP ' + r.status + ')' }, r.status);
}

async function handleMessage(request, env) {
  let p;
  try { p = await request.json(); } catch (e) { return json({ ok: false, description: 'JSON invalide' }, 400); }

  if (!env.RELAY_KEY || p.key !== env.RELAY_KEY) return json({ ok: false, description: 'clé refusée' }, 403);

  const text = typeof p.text === 'string' ? p.text : '';
  if (!text.trim()) return json({ ok: false, description: 'texte vide' }, 400);
  if (text.length > 4096) return json({ ok: false, description: 'texte trop long' }, 400);

  const chat = resolveChat(p.to, env);
  if (!chat) return json({ ok: false, description: 'destinataire invalide' }, 400);

  if (!buttonsAllowed(p.reply_markup, env)) return json({ ok: false, description: 'boutons refusés' }, 400);

  const body = { chat_id: chat, text };
  if (p.reply_markup) body.reply_markup = p.reply_markup;
  if (p.parse_mode === 'HTML' || p.parse_mode === 'Markdown') body.parse_mode = p.parse_mode;
  if (p.disable_web_page_preview === true) body.disable_web_page_preview = true;

  return toTelegram(env, 'sendMessage', JSON.stringify(body), { 'Content-Type': 'application/json' });
}

/* Envoi du fichier du site (export admin). Le corps multipart est transmis tel
   quel : on remplace seulement chat_id, que le client n'a pas à choisir. */
async function handleDocument(request, env) {
  const form = await request.formData().catch(() => null);
  if (!form) return json({ ok: false, description: 'formulaire invalide' }, 400);

  if (!env.RELAY_KEY || form.get('key') !== env.RELAY_KEY) return json({ ok: false, description: 'clé refusée' }, 403);

  const chat = resolveChat(form.get('to'), env);
  if (!chat) return json({ ok: false, description: 'destinataire invalide' }, 400);

  const file = form.get('document');
  if (!file) return json({ ok: false, description: 'document manquant' }, 400);

  const out = new FormData();
  out.append('chat_id', chat);
  out.append('document', file, form.get('filename') || 'index.html');
  const caption = form.get('caption');
  if (caption) out.append('caption', String(caption).slice(0, 1024));

  return toTelegram(env, 'sendDocument', out);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST') return json({ ok: false, description: 'POST attendu' }, 405);
    if (!env.BOT_TOKEN) return json({ ok: false, description: 'BOT_TOKEN absent du Worker' }, 500);

    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    if (path === '/document') return handleDocument(request, env);
    return handleMessage(request, env);
  }
};
