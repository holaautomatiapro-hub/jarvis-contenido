import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';

// Mensajes de JARVIS a tu Telegram, con el mismo bot de Hermes: el código para confirmar una publicación y el aviso
// cuando sale. JARVIS solo ENVÍA (sendMessage / sendPhoto): no lee el chat, así que no choca con Hermes, que es quien
// recibe tus mensajes. Y como los mensajes que manda el bot no le llegan a Hermes, la IA nunca ve el código.
//
// De dónde saca el bot y tu chat: TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID del .env de JARVIS, o los del .env de Hermes
// (TELEGRAM_BOT_TOKEN y TELEGRAM_HOME_CHANNEL, o el primer usuario de TELEGRAM_ALLOWED_USERS).

export class TelegramError extends Error {
  constructor(m) { super(m); this.publico = true; }
}

const API = 'https://api.telegram.org';
const MAX_TEXTO = 4000;

export function configTelegram({ env = process.env } = {}) {
  let hermes = {};
  const home = env.HERMES_HOME || path.join(os.homedir(), '.hermes');
  try { hermes = dotenv.parse(readFileSync(path.join(home, '.env'), 'utf8')); } catch { /* sin Hermes */ }
  const token = String(env.TELEGRAM_BOT_TOKEN || hermes.TELEGRAM_BOT_TOKEN || '').trim();
  const primerUsuario = String(hermes.TELEGRAM_ALLOWED_USERS || '').split(',').map((x) => x.trim()).find((x) => /^-?\d+$/.test(x));
  const chat = String(env.TELEGRAM_CHAT_ID || hermes.TELEGRAM_HOME_CHANNEL || primerUsuario || '').trim();
  return { token: /^\d+:[\w-]{20,}$/.test(token) ? token : null, chat: /^-?\d+$/.test(chat) ? chat : null };
}

export function createTelegram({ env = process.env, fetchImpl = fetch, config = () => configTelegram({ env }) } = {}) {
  const configurado = () => { const c = config(); return Boolean(c.token && c.chat); };

  async function llamar(metodo, cuerpo) {
    const { token, chat } = config();
    if (!token || !chat) throw new TelegramError('JARVIS no puede escribirte por Telegram: falta el bot de Hermes (hermes gateway setup) o tu chat.');
    const esForm = cuerpo instanceof FormData;
    if (esForm) cuerpo.set('chat_id', chat);
    let r;
    try {
      r = await fetchImpl(`${API}/bot${token}/${metodo}`, {
        method: 'POST', signal: AbortSignal.timeout(60_000),
        ...(esForm ? { body: cuerpo } : { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chat, ...cuerpo }) }),
      });
    } catch {
      throw new TelegramError('No he podido conectar con Telegram.'); // sin el error original: llevaría el token en la URL
    }
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw new TelegramError(`Telegram no ha aceptado el mensaje${d.description ? `: ${String(d.description).slice(0, 200)}` : ''}`);
    return d.result;
  }

  const enviar = (texto) => llamar('sendMessage', { text: String(texto).slice(0, MAX_TEXTO), disable_web_page_preview: true });

  // Las fotos de la pieza (hasta 10, como un álbum) para que veas qué se va a publicar
  async function enviarFotos(rutas) {
    const lista = rutas.slice(0, 10);
    if (!lista.length) return;
    const form = new FormData();
    if (lista.length === 1) {
      form.set('photo', new Blob([readFileSync(lista[0])]), path.basename(lista[0]));
      await llamar('sendPhoto', form);
      return;
    }
    form.set('media', JSON.stringify(lista.map((_, i) => ({ type: 'photo', media: `attach://f${i}` }))));
    lista.forEach((r, i) => form.set(`f${i}`, new Blob([readFileSync(r)]), path.basename(r)));
    await llamar('sendMediaGroup', form);
  }

  return { configurado, enviar, enviarFotos };
}
