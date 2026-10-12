import { useEffect, useState } from 'react';
import Icon from '../../components/Icon.jsx';

// Fases del pipeline (las mismas que usan Hermes y Claude Code por el MCP). Se pueden configurar:
// las carga App desde /api/pipeline y cualquier vista las lee con useFases().
const FASES_BASE = [
  { id: 'idea', label: 'Idea', color: 'var(--blue)', icon: 'bulb', ayuda: 'Por desarrollar', sistema: true },
  { id: 'guion', label: 'Guion', color: 'var(--purple)', icon: 'pen', ayuda: 'Escribiendo el guion' },
  { id: 'grabar', label: 'Grabar', color: 'var(--orange)', icon: 'mic', ayuda: 'Listos para grabar' },
  { id: 'editar', label: 'Editar', color: 'var(--pink)', icon: 'layers', ayuda: 'Grabados, por editar' },
  { id: 'listo', label: 'Listo', color: 'var(--cyan)', icon: 'calendar', ayuda: 'Listos para publicar', sistema: true },
  { id: 'publicado', label: 'Publicado', color: 'var(--green)', icon: 'checkCircle', ayuda: 'Ya están en redes', sistema: true },
];
let fases = FASES_BASE;
const oyentesFases = new Set();
export function ponerFases(lista) {
  if (!Array.isArray(lista) || !lista.length) return;
  fases = lista;
  oyentesFases.forEach((f) => f());
}
export function useFases() {
  const [, refrescar] = useState(0);
  useEffect(() => {
    const f = () => refrescar((n) => n + 1);
    oyentesFases.add(f);
    return () => oyentesFases.delete(f);
  }, []);
  return fases;
}
export const estadoDe = (id) => fases.find((e) => e.id === id) || { id, label: id || '—', color: 'var(--muted)', icon: 'layers', ayuda: '' };

export const TIPOS = [
  { id: 'Reel', corto: 'Reel' },
  { id: 'Carrusel', corto: 'Carr.' },
  { id: 'Post', corto: 'Post' },
  { id: 'Story', corto: 'Story' },
  { id: 'Short', corto: 'Short' },
  { id: 'Reel split', corto: 'Split' },
  { id: 'B-roll', corto: 'B-roll' },
];
// El formato es texto libre (Hermes puede escribir "reel" o "carrusel"): se compara sin mayúsculas
export const tipoDe = (formato) => TIPOS.find((t) => t.id.toLowerCase() === String(formato || '').trim().toLowerCase());
export const textoTipo = (formato) => tipoDe(formato)?.id || formato || 'Sin tipo';
export const esStory = (p) => tipoDe(p.formato)?.id === 'Story';
export const MAX_CAPTION = 2200;

export const esVideo = (a) => /^video\//.test(a?.mime || '');
export const tamanoLegible = (b) => (b < 1024 ** 2 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 ** 2).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MB`);
// "mi_reel-final.mp4" → "mi reel final"
export const tituloDeArchivo = (n) => n.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Sin título';
export const ordenNatural = (a, b) => a.localeCompare(b, 'es', { numeric: true });

const EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm' };
export const mimeDe = (f) => (/^(image|video)\//.test(f.type) ? f.type : EXT[f.name.split('.').pop().toLowerCase()] || '');
export const esMedio = (f) => !f.name.startsWith('.') && Boolean(mimeDe(f));

// La API de Instagram solo publica fotos en JPG: PNG y WebP se convierten en el navegador al subirlas.
// Si el navegador no puede leer la imagen (p. ej. HEIC), se sube tal cual.
async function aJpg(f) {
  if (!/^image\/(png|webp)$/.test(f.type)) return f;
  try {
    const img = await createImageBitmap(f);
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.92));
    return blob ? new File([blob], f.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : f;
  } catch { return f; }
}

// Sube un archivo al PC (data/contenido) tal cual, sin formularios
export async function subirArchivo(original) {
  const f = await aJpg(original);
  const r = await fetch(`/api/contenido/archivos?nombre=${encodeURIComponent(f.name)}&mime=${encodeURIComponent(mimeDe(f))}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: f,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `No se pudo subir «${f.name}»`);
  return d;
}
export const borrarArchivo = (a) => fetch(a.url, { method: 'DELETE' }).catch(() => {});

export function Miniatura({ p, className = '', onClick }) {
  const a = p.archivos?.[0];
  return (
    <div className={`miniatura-c ${className}`} onClick={onClick}>
      {a ? (esVideo(a) ? <video src={`${a.url}#t=0.1`} preload="metadata" muted playsInline /> : <img src={a.url} alt="" loading="lazy" />)
        : <span className="sin-archivo"><Icon name={estadoDe(p.estado).icon} size={16} color={estadoDe(p.estado).color} /></span>}
    </div>
  );
}

export function ChipEstado({ id }) {
  const e = estadoDe(id);
  return <span className="chip-est" style={{ '--c': e.color }}><i />{e.label}</span>;
}

export function Modal({ titulo, onClose, ancho = 560, children, cerrarFuera = true, clase = '' }) {
  return (
    <div className="modal-fondo" onMouseDown={(e) => cerrarFuera && e.target === e.currentTarget && onClose()}>
      <div className={`panel modal ${clase}`} style={{ width: `min(${ancho}px, 100%)` }} role="dialog" aria-modal="true" aria-label={typeof titulo === 'string' ? titulo : undefined}>
        <div className="panel-head">
          <span className="modal-titulo">{titulo}</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Copiar un enlace al portapapeles (con aviso de «Copiado» un momento)
export function BotonCopiar({ texto, etiqueta = 'Copiar', className = 'btn btn-sec' }) {
  const [ok, setOk] = useState(false);
  const copiar = async (e) => {
    e.preventDefault(); e.stopPropagation();
    try { await navigator.clipboard.writeText(texto); } catch {
      const t = document.createElement('textarea'); t.value = texto; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
    }
    setOk(true); setTimeout(() => setOk(false), 1500);
  };
  return <button type="button" className={className} onClick={copiar} disabled={!texto} title={texto}>{ok ? '✓ Copiado' : etiqueta}</button>;
}

// ¿Lleva lead magnet? Casilla y, si sí, su enlace con botón para copiarlo
export function CampoLeadMagnet({ activo, url, onCambio }) {
  return (
    <div className="campo-lm">
      <label className="lm-check">
        <input type="checkbox" checked={activo} onChange={(e) => onCambio({ leadmagnet: e.target.checked, leadmagnet_url: e.target.checked ? url : '' })} />
        <Icon name="target" size={13} />Lleva lead magnet
      </label>
      {activo && (
        <div className="fila" style={{ marginBottom: 0 }}>
          <input className="campo" value={url} onChange={(e) => onCambio({ leadmagnet: true, leadmagnet_url: e.target.value })} placeholder="https://… (el enlace que mandas a quien comenta o escribe)" aria-label="Enlace del lead magnet" />
          <BotonCopiar texto={/^https?:\/\//i.test(url) ? url : ''} />
        </div>
      )}
    </div>
  );
}

// Marca pequeña en listas y calendario: pulsarla copia el enlace
export function MarcaLeadMagnet({ p }) {
  const [ok, setOk] = useState(false);
  if (!p.leadmagnet) return null;
  const copiar = async (e) => {
    e.stopPropagation();
    if (!p.leadmagnet_url) return;
    try { await navigator.clipboard.writeText(p.leadmagnet_url); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* sin portapapeles */ }
  };
  return (
    <span className={`lm-marca${ok ? ' ok' : ''}`} role="button" tabIndex={0} onClick={copiar} title={p.leadmagnet_url ? `Lead magnet: ${p.leadmagnet_url} (pulsa para copiar)` : 'Lleva lead magnet (sin enlace todavía)'}>
      {ok ? '✓' : <Icon name="target" size={10} />}
    </span>
  );
}
