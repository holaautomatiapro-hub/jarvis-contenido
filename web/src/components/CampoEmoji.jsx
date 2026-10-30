import { useEffect, useRef, useState } from 'react';
import { EMOJIS } from './CampoCaption.jsx';

// Un campo de texto (o de una línea, con «linea») con botón 😀: los emojis se insertan donde está el cursor
const LS = 'jarvis-emojis-recientes';
const leerRecientes = () => { try { return JSON.parse(localStorage.getItem(LS) || '[]').slice(0, 16); } catch { return []; } };

export default function CampoEmoji({ value, onChange, linea = false, rows = 3, ...resto }) {
  const ref = useRef(null);
  const caja = useRef(null);
  const cursor = useRef(null);
  const [abierto, setAbierto] = useState(false);
  const [cat, setCat] = useState('frecuentes');
  const [recientes, setRecientes] = useState(leerRecientes);
  const texto = value || '';

  useEffect(() => {
    const c = cursor.current;
    if (c == null || !ref.current) return;
    cursor.current = null;
    ref.current.focus();
    ref.current.setSelectionRange(c, c);
  }, [value]);
  useEffect(() => {
    if (!abierto) return undefined;
    const fuera = (e) => { if (!caja.current?.contains(e.target)) setAbierto(false); };
    const esc = (e) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc); };
  }, [abierto]);

  const poner = (e) => {
    const t = ref.current;
    const a = t ? t.selectionStart : texto.length;
    const b = t ? t.selectionEnd : texto.length;
    const nuevo = texto.slice(0, a) + e + texto.slice(b);
    if (resto.maxLength && nuevo.length > resto.maxLength) return;
    cursor.current = a + e.length;
    onChange(nuevo);
    const r = [e, ...recientes.filter((x) => x !== e)].slice(0, 16);
    setRecientes(r);
    try { localStorage.setItem(LS, JSON.stringify(r)); } catch { /* sin almacenamiento */ }
  };
  const grupos = recientes.length ? [{ id: 'recientes', icono: '🕘', nombre: 'Recientes', l: recientes }, ...EMOJIS] : EMOJIS;
  const actual = grupos.find((g) => g.id === cat) || grupos[0];
  const Campo = linea ? 'input' : 'textarea';

  return (
    <div className={`campo-emoji${linea ? ' linea' : ''}`} ref={caja}>
      <Campo ref={ref} className="campo" value={texto} onChange={(e) => onChange(e.target.value)} {...(linea ? {} : { rows })} {...resto} />
      <button type="button" className={`campo-emoji-btn${abierto ? ' on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setAbierto((x) => !x)} title="Emojis" aria-label="Emojis" aria-expanded={abierto}>😀</button>
      {abierto && (
        <div className="caption-emojis panel campo-emoji-caja" role="dialog" aria-label="Emojis">
          <div className="caption-cats">
            {grupos.map((g) => <button type="button" key={g.id} className={g.id === actual.id ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => setCat(g.id)} title={g.nombre}>{g.icono}</button>)}
          </div>
          <div className="caption-cat-nombre">{actual.nombre}</div>
          <div className="caption-rejilla">
            {actual.l.map((e) => <button type="button" key={e} onMouseDown={(ev) => ev.preventDefault()} onClick={() => poner(e)}>{e}</button>)}
          </div>
        </div>
      )}
    </div>
  );
}
