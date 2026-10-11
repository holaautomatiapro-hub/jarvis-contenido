import Icon from '../../components/Icon.jsx';

// Estados del pipeline (los mismos que usan Hermes y Claude Code por el MCP)
export const ESTADOS = [
  { id: 'idea', label: 'Idea', color: 'var(--blue)', icon: 'bulb', ayuda: 'Por desarrollar' },
  { id: 'guion', label: 'Guion', color: 'var(--purple)', icon: 'pen', ayuda: 'Escribiendo el guion' },
  { id: 'grabar', label: 'Grabar', color: 'var(--orange)', icon: 'mic', ayuda: 'Listos para grabar' },
  { id: 'editar', label: 'Editar', color: 'var(--pink)', icon: 'layers', ayuda: 'Grabados, por editar' },
  { id: 'listo', label: 'Listo', color: 'var(--cyan)', icon: 'calendar', ayuda: 'Listos para publicar' },
  { id: 'publicado', label: 'Publicado', color: 'var(--green)', icon: 'checkCircle', ayuda: 'Ya están en redes' },
];
export const estadoDe = (id) => ESTADOS.find((e) => e.id === id) || ESTADOS[0];

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

// Sube un archivo al PC (data/contenido) tal cual, sin formularios
export async function subirArchivo(f) {
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
