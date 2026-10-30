import { useEffect, useRef, useState } from 'react';
import { alternarNegrita } from '../lib/negrita.js';

// Caption con barra: B pone en negrita lo seleccionado (negrita Unicode, la que se ve en Instagram;
// otra vez B la quita; Ctrl+B también), 😀 abre los emojis, que se insertan donde está el cursor, y «Crear con IA»
// (si se pasa onIA) pide a JARVIS un caption con tu voz; si ya había texto, lo usa de base y se puede deshacer.

export const EMOJIS = [
  { id: 'frecuentes', icono: '⭐', nombre: 'Para captions', l: ['👇', '👉', '✅', '❌', '🔥', '💪', '🚀', '💡', '📌', '⚠️', '🎯', '📈', '💬', '📩', '🔗', '🎁', '⏰', '🙌', '👀', '✨', '💥', '⬇️', '➡️', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'] },
  { id: 'caras', icono: '😀', nombre: 'Caras', l: ['😀', '😁', '😂', '🤣', '😅', '😊', '😍', '🥰', '😎', '🤩', '🤔', '🤯', '😱', '😬', '🙃', '😉', '😏', '😴', '🥵', '🥶', '😤', '😭', '🤗', '🤫', '🫠', '🙄', '😇', '🤓'] },
  { id: 'manos', icono: '👍', nombre: 'Manos y gente', l: ['👍', '👎', '👏', '🙏', '🤝', '✌️', '🤞', '👊', '✊', '🫶', '❤️‍🔥', '💯', '🧠', '🫵', '☝️', '👋', '🤙', '💁', '🙋', '🏃', '🏋️', '🧘', '🚴', '🤸'] },
  { id: 'fitness', icono: '🏋️', nombre: 'Entreno y comida', l: ['🏋️‍♂️', '🏋️‍♀️', '💪', '🦵', '🥇', '🏆', '⏱️', '🔋', '🥗', '🥩', '🍗', '🥚', '🍳', '🥑', '🍎', '🍌', '🥤', '💧', '☕', '🍫', '🛌', '⚖️', '📏', '🩺'] },
  { id: 'negocio', icono: '💼', nombre: 'Negocio', l: ['💼', '💰', '💸', '💶', '📊', '📉', '🧾', '📅', '🗓️', '📝', '📚', '🎓', '🤖', '💻', '📱', '📲', '🎥', '🎬', '🎙️', '📸', '🧩', '🛠️', '🔑', '🔒'] },
  { id: 'simbolos', icono: '❤️', nombre: 'Símbolos', l: ['❤️', '🖤', '🤍', '💙', '💚', '💛', '🧡', '💜', '⚡', '🌟', '⭐', '☀️', '🌙', '🔴', '🟢', '🟡', '🔵', '⚫', '⚪', '▪️', '✔️', '➕', '➖', '❗', '❓', '‼️', '🆕', '🆓', '🔝', '🔛'] },
];
const LS = 'jarvis-emojis-recientes';
const leerRecientes = () => { try { return JSON.parse(localStorage.getItem(LS) || '[]').slice(0, 16); } catch { return []; } };

export default function CampoCaption({ value, onChange, rows = 6, placeholder, onIA }) {
  const ref = useRef(null);
  const caja = useRef(null);
  const seleccion = useRef(null);
  const [abierto, setAbierto] = useState(false);
  const [cat, setCat] = useState('frecuentes');
  const [recientes, setRecientes] = useState(leerRecientes);
  const [ia, setIa] = useState({ estado: '', anterior: null, error: '', nota: '' });

  const conIA = async () => {
    setIa({ estado: 'escribiendo', anterior: null, error: '' });
    try {
      // onIA devuelve el texto, o { texto, nota } (p. ej. «ha usado escuchado el vídeo y 2 imágenes»)
      const r = await onIA();
      const texto = typeof r === 'string' ? r : r.texto;
      setIa({ estado: '', anterior: value, error: '', nota: typeof r === 'string' ? '' : r.nota || '' });
      onChange(texto);
    } catch (e) { setIa({ estado: '', anterior: null, error: e.message || 'No se ha podido crear el caption' }); }
  };

  // Tras cambiar el texto desde la barra, devolver el cursor (o la selección) a su sitio
  useEffect(() => {
    const s = seleccion.current;
    if (!s || !ref.current) return;
    seleccion.current = null;
    ref.current.focus();
    ref.current.setSelectionRange(s[0], s[1]);
  }, [value]);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e) => { if (!caja.current?.contains(e.target)) setAbierto(false); };
    const esc = (e) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc); };
  }, [abierto]);

  const negrita = () => {
    const t = ref.current;
    if (!t) return;
    let [a, b] = [t.selectionStart, t.selectionEnd];
    if (a === b) {
      // Sin selección: la palabra donde está el cursor
      while (a > 0 && !/\s/.test(value[a - 1])) a--;
      while (b < value.length && !/\s/.test(value[b])) b++;
      if (a === b) return;
    }
    const nuevo = alternarNegrita(value.slice(a, b));
    seleccion.current = [a, a + nuevo.length];
    onChange(value.slice(0, a) + nuevo + value.slice(b));
  };

  const emoji = (e) => {
    const t = ref.current;
    const a = t ? t.selectionStart : value.length;
    const b = t ? t.selectionEnd : value.length;
    seleccion.current = [a + e.length, a + e.length];
    onChange(value.slice(0, a) + e + value.slice(b));
    const r = [e, ...recientes.filter((x) => x !== e)].slice(0, 16);
    setRecientes(r);
    try { localStorage.setItem(LS, JSON.stringify(r)); } catch { /* sin almacenamiento */ }
  };

  const teclas = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); negrita(); }
  };

  const grupos = recientes.length ? [{ id: 'recientes', icono: '🕘', nombre: 'Recientes', l: recientes }, ...EMOJIS] : EMOJIS;
  const actual = grupos.find((g) => g.id === cat) || grupos[0];

  return (
    <div className="caption-c" ref={caja}>
      <div className="caption-barra">
        <button type="button" className="caption-btn caption-b" onMouseDown={(e) => e.preventDefault()} onClick={negrita} title="Negrita (Ctrl+B): selecciona el texto y pulsa. Se ve en negrita en Instagram">B</button>
        <button type="button" className={`caption-btn${abierto ? ' on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setAbierto((x) => !x)} title="Emojis" aria-expanded={abierto}>😀</button>
        {onIA && <button type="button" className="caption-btn caption-ia" onClick={conIA} disabled={ia.estado === 'escribiendo'} title="JARVIS escribe el caption con tu voz (si ya hay texto, lo usa de base)"><span>✨</span>{ia.estado === 'escribiendo' ? 'Leyendo el contenido y escribiendo…' : value.trim() ? 'Mejorar con IA' : 'Crear con IA'}</button>}
        {ia.anterior !== null
          ? <span className="caption-ayuda" title={ia.nota}>Caption de JARVIS{ia.nota ? ` (${ia.nota})` : ''} · <button type="button" className="link-btn" onClick={() => { onChange(ia.anterior); setIa({ estado: '', anterior: null, error: '' }); }}>Deshacer</button></span>
          : <span className="caption-ayuda">{ia.error ? <span className="caption-error">{ia.error}</span> : <>Selecciona y pulsa <b>B</b> para negrita · también vale **así**</>}</span>}
      </div>
      {abierto && (
        <div className="caption-emojis panel" role="dialog" aria-label="Emojis">
          <div className="caption-cats">
            {grupos.map((g) => (
              <button type="button" key={g.id} className={g.id === actual.id ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => setCat(g.id)} title={g.nombre}>{g.icono}</button>
            ))}
          </div>
          <div className="caption-cat-nombre">{actual.nombre}</div>
          <div className="caption-rejilla">
            {actual.l.map((e) => <button type="button" key={e} onMouseDown={(ev) => ev.preventDefault()} onClick={() => emoji(e)}>{e}</button>)}
          </div>
        </div>
      )}
      <textarea ref={ref} className="campo" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={teclas} placeholder={placeholder} />
    </div>
  );
}
