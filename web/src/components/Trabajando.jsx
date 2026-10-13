import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { useMensajes, useRecurso } from '../lib/api.js';
import { pedirIr } from '../lib/ir.js';
import { avanceDiseno } from '../lib/avance.js';

// «Trabajando en…»: lo que JARVIS está haciendo ahora (diseños, portadas, el chat, el Laboratorio, una actualización),
// visible desde cualquier pestaña. Puedes irte a hacer otra cosa: cuando termina, sale aquí como hecho.
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const RECIENTE = 15 * 60_000;

export default function Trabajando({ onTab }) {
  const [data, recargar] = useRecurso('/api/trabajos', { trabajos: [] });
  const [abierto, setAbierto] = useState(false);
  const [hechos, setHechos] = useState([]); // { id, titulo, detalle, ir, en }
  const [ahora, setAhora] = useState(Date.now());
  const antes = useRef(new Map());
  const caja = useRef(null);
  const lista = data.trabajos;

  // Lo que deja de estar en marcha pasa a «hecho»
  useEffect(() => {
    const ids = new Set(lista.map((t) => t.id));
    const terminados = [...antes.current.values()].filter((t) => !ids.has(t.id) && t.tipo !== 'actualizar');
    if (terminados.length) setHechos((h) => [...terminados.map((t) => ({ id: `${t.id}-${Date.now()}`, titulo: t.titulo, detalle: 'Terminado', ir: t.ir, en: Date.now() })), ...h].slice(0, 8));
    antes.current = new Map(lista.map((t) => [t.id, t]));
  }, [lista]);
  // Mientras haya algo en marcha: el reloj cada segundo y se pregunta cada 4 s
  useEffect(() => {
    if (!lista.length) return undefined;
    const r = setInterval(() => setAhora(Date.now()), 1000);
    const p = setInterval(recargar, 4000);
    return () => { clearInterval(r); clearInterval(p); };
  }, [lista.length, recargar]);
  useMensajes('jarvis', (e) => { if (['pregunta', 'fin', 'error'].includes(e.tipo)) recargar(); });
  useMensajes('diseno', () => recargar());
  useMensajes('portada', (e) => setHechos((h) => [{ id: `portada-${e.diseno}`, titulo: `Portada de «${e.titulo}»`, detalle: e.comoPortada ? 'Puesta como portada del vídeo' : 'Añadida como primera imagen', ir: { tab: 'contenido', pieza: e.pieza }, en: Date.now() }, ...h.filter((x) => x.id !== `portada-${e.diseno}`)].slice(0, 8)));
  // Cerrar al pulsar fuera
  useEffect(() => {
    if (!abierto) return undefined;
    const f = (e) => { if (!caja.current?.contains(e.target)) setAbierto(false); };
    document.addEventListener('mousedown', f);
    return () => document.removeEventListener('mousedown', f);
  }, [abierto]);

  const recientes = hechos.filter((h) => ahora - h.en < RECIENTE || lista.length === 0);
  if (!lista.length && !recientes.length) return null;
  const ir = (t) => { if (!t.ir) return; setAbierto(false); onTab(t.ir.tab); pedirIr(t.ir); };
  const pct = (t) => (t.trabajo ? avanceDiseno(t.trabajo, ahora).pct : t.progreso);

  return (
    <div className="trabajando" ref={caja}>
      <button type="button" className={`trabajando-btn${lista.length ? ' activo' : ''}`} onClick={() => setAbierto(!abierto)} aria-expanded={abierto} title="Lo que está haciendo JARVIS">
        {lista.length ? <span className="punto-vivo" /> : <Icon name="check" size={13} />}
        <span className="trabajando-txt">{lista.length ? `Trabajando${lista.length > 1 ? ` (${lista.length})` : ''}` : 'Hecho'}</span>
      </button>
      {abierto && (
        <div className="trabajando-menu panel" role="dialog" aria-label="Lo que está haciendo JARVIS">
          <div className="label">{lista.length ? 'JARVIS está trabajando en' : 'Nada en marcha'}</div>
          {lista.map((t) => {
            const p = pct(t);
            return (
              <button key={t.id} type="button" className="trabajo" onClick={() => ir(t)} disabled={!t.ir}>
                <span className="trabajo-cab"><b>{t.titulo}</b>{t.desde && <small className="t-dim">{mmss(ahora - t.desde)}</small>}</span>
                {t.detalle && <small className="trabajo-det">{t.detalle}{p != null ? ` · ${p}%` : ''}</small>}
                {p != null && <span className="bar"><span style={{ width: `${p}%`, background: 'var(--accent-2)' }} /></span>}
              </button>
            );
          })}
          {recientes.length > 0 && (
            <>
              <div className="label" style={{ marginTop: 6 }}>Hecho hace poco</div>
              {recientes.map((h) => (
                <button key={h.id} type="button" className="trabajo hecho" onClick={() => ir(h)} disabled={!h.ir}>
                  <span className="trabajo-cab"><b><Icon name="check" size={12} color="var(--green)" /> {h.titulo}</b><small className="t-dim">hace {mmss(ahora - h.en)}</small></span>
                  <small className="trabajo-det">{h.detalle}</small>
                </button>
              ))}
            </>
          )}
          <p className="ayuda">Puedes seguir con otras cosas: lo que esté haciendo JARVIS sigue aunque cambies de pestaña o cierres una ventana.</p>
        </div>
      )}
    </div>
  );
}
