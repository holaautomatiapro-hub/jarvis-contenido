import path from 'node:path';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Contraseña de JARVIS (opcional): con JARVIS_CLAVE en .env, para entrar hace falta iniciar sesión. Sirve para que
// cada persona tenga su JARVIS (p. ej. dos en el mismo VPS) sin que el otro pueda abrirlo, aunque esté en la misma red.
//   · El navegador: una cookie firmada (180 días). Cambiar la contraseña cierra todas las sesiones.
//   · El propio servidor (el MCP de Claude Code, los scripts): la clave local, un archivo que solo lee su dueño.
//   · El conector de Claude Code del ordenador: su token (va dentro del archivo que se descarga desde Inicio).
// Sin JARVIS_CLAVE, todo sigue como siempre (solo Tailscale).

export const COOKIE = 'jarvis_sesion';
const DIA = 24 * 60 * 60_000;
const DURACION = 180 * DIA;

// scrypt:sal:hash (sin $ para que el .env no lo malinterprete)
export function hashClave(clave) {
  const sal = randomBytes(16).toString('hex');
  return `scrypt:${sal}:${scryptSync(String(clave).normalize('NFC'), sal, 32).toString('hex')}`;
}
export function claveCorrecta(clave, guardada) {
  const [tipo, sal, hash] = String(guardada || '').split(':');
  if (tipo !== 'scrypt' || !sal || !hash) return false;
  const a = scryptSync(String(clave || '').normalize('NFC'), sal, 32);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// Un secreto aleatorio guardado en la carpeta de datos (solo lo puede leer el usuario de JARVIS)
function secreto(dataDir, nombre) {
  const f = path.join(dataDir, nombre);
  try { const s = readFileSync(f, 'utf8').trim(); if (s.length >= 32) return s; } catch { /* se crea */ }
  mkdirSync(dataDir, { recursive: true });
  const s = randomBytes(32).toString('hex');
  writeFileSync(f, s, { mode: 0o600 });
  return s;
}
// La clave local que usan el MCP y los scripts de este mismo servidor (cabecera x-jarvis-local)
export const claveLocal = (dataDir) => secreto(dataDir, 'local.key');

const igual = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const leerCookie = (cabecera, nombre) => String(cabecera || '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === nombre)?.slice(1).join('=') || null;

export function createAcceso({ dataDir, env = process.env, ahora = () => Date.now() }) {
  const guardada = () => String(env.JARVIS_CLAVE || '');
  const activa = () => guardada().startsWith('scrypt:');
  const llave = () => secreto(dataDir, 'sesion.key');
  // Todo lo firmado depende también de la contraseña: si cambia, las sesiones y el token del conector dejan de valer
  const firma = (txt) => createHmac('sha256', llave()).update(`${txt}|${guardada()}`).digest('base64url');

  const nuevaSesion = () => { const exp = ahora() + DURACION; return `${exp}.${firma(`sesion:${exp}`)}`; };
  function sesionValida(cabeceras) {
    const v = leerCookie(cabeceras.cookie, COOKIE);
    if (!v) return false;
    const [exp, f] = v.split('.');
    return Number(exp) > ahora() && Boolean(f) && igual(f, firma(`sesion:${exp}`));
  }
  const tokenConector = () => firma('conector');
  // Para descargar el conector desde PowerShell (sin cookie): un enlace que vale una hora
  const enlaceDescarga = () => { const exp = ahora() + 60 * 60_000; return `${exp}.${firma(`descarga:${exp}`)}`; };
  const descargaValida = (t) => { const [exp, f] = String(t || '').split('.'); return Number(exp) > ahora() && Boolean(f) && igual(f, firma(`descarga:${exp}`)); };

  function autorizado(req) {
    if (!activa()) return true;
    const h = req.headers;
    if (h['x-jarvis-local'] && igual(h['x-jarvis-local'], claveLocal(dataDir))) return true;
    const bearer = /^Bearer\s+(.+)$/i.exec(h.authorization || '')?.[1];
    if (bearer && igual(bearer, tokenConector())) return true;
    return sesionValida(h);
  }

  // Frenar a quien prueba contraseñas: tras 5 fallos seguidos, cada intento espera más (hasta 15 min)
  let fallos = 0, bloqueoHasta = 0;
  function entrar(clave) {
    if (!activa()) return { ok: true };
    if (ahora() < bloqueoHasta) return { ok: false, espera: Math.ceil((bloqueoHasta - ahora()) / 1000) };
    if (!claveCorrecta(clave, guardada())) {
      fallos += 1;
      if (fallos >= 5) bloqueoHasta = ahora() + Math.min(15 * 60_000, 30_000 * 2 ** (fallos - 5));
      return { ok: false };
    }
    fallos = 0; bloqueoHasta = 0;
    return { ok: true, cookie: nuevaSesion() };
  }
  const cabeceraCookie = (valor, req) => {
    const segura = req.headers['x-forwarded-proto'] === 'https' || !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(String(req.headers.host || ''));
    return `${COOKIE}=${valor}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${valor ? Math.round(DURACION / 1000) : 0}${segura ? '; Secure' : ''}`;
  };

  // Lo que se puede pedir sin sesión: la página de entrar, el estado del servidor y los archivos de la interfaz
  const LIBRE = /^\/(api\/(health|login)$|assets\/|favicon|icon|manifest|apple-touch)/;
  function middleware(req, res, next) {
    if (autorizado(req) || LIBRE.test(req.path)) return next();
    if (req.path === '/puente/jarvis-puente.mjs' && descargaValida(req.query.t)) return next();
    if (req.path.startsWith('/api/') || req.path.startsWith('/puente/')) return res.status(401).json({ error: 'Inicia sesión en JARVIS', sesion: true });
    return res.status(401).set('Cache-Control', 'no-store').type('html').send(paginaEntrar(env.JARVIS_NOMBRE));
  }

  return { activa, autorizado, sesionValida, entrar, cabeceraCookie, middleware, tokenConector, enlaceDescarga, descargaValida };
}

// La página para entrar (sin la interfaz: no se descarga nada de JARVIS hasta tener sesión)
export function paginaEntrar(nombre = '') {
  const titulo = nombre ? `JARVIS · ${String(nombre).replace(/[<>&"]/g, '')}` : 'JARVIS';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title><meta name="color-scheme" content="dark light">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;background:#050a17;color:#e8edf7;padding:16px}
form{width:min(360px,100%);background:#0b1328;border:1px solid #1e2a47;border-radius:16px;padding:28px 24px;display:flex;flex-direction:column;gap:14px;box-shadow:0 20px 60px rgba(0,0,0,.4)}
h1{margin:0;font-size:20px;letter-spacing:.32em;font-weight:800}h1 i{color:#3b82f6;font-style:normal}p{margin:0;color:#8a97b2;font-size:13px}
input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid #24304f;background:#060c1c;color:inherit;font-size:15px}input:focus{outline:2px solid #3b82f6;border-color:transparent}
button{padding:12px;border:0;border-radius:10px;background:#2563eb;color:#fff;font-weight:600;font-size:15px;cursor:pointer}button:disabled{opacity:.6}
.error{color:#f87171;font-size:13px;min-height:1em}
@media (prefers-color-scheme:light){body{background:#eef2f9;color:#0b1328}form{background:#fff;border-color:#d8e0ee;box-shadow:0 20px 60px rgba(15,23,42,.12)}input{background:#f7f9fc;border-color:#d8e0ee}p{color:#5b6b85}}
</style></head><body>
<form id="f"><h1>JARVIS<i>.</i></h1><p>${nombre ? `El JARVIS de ${String(nombre).replace(/[<>&"]/g, '')}. ` : ''}Escribe tu contraseña para entrar.</p>
<input id="c" type="password" autocomplete="current-password" placeholder="Contraseña" autofocus required>
<button id="b">Entrar</button><div class="error" id="e"></div></form>
<script>
document.getElementById('f').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const b = document.getElementById('b'), e = document.getElementById('e');
  b.disabled = true; e.textContent = '';
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clave: document.getElementById('c').value }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) return location.reload();
    e.textContent = d.error || 'No se ha podido entrar';
  } catch { e.textContent = 'No llego a JARVIS'; }
  b.disabled = false;
});
</script></body></html>`;
}
