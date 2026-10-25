import { useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { api, useRecurso } from '../lib/api.js';
import { diaLargo } from '../lib/fechas.js';
import { BotonCopiar } from './contenido/comun.jsx';
import { redDe } from '../lib/redes.js';
import { TuSemana } from './inicio/Semana.jsx';
import JarvisPresencia from '../components/JarvisPresencia.jsx';
import { escuchar, reconocimientoDisponible } from '../lib/voz.js';

// ---------- Qué se publica hoy ----------
const ESTADO_IG = {
  publicado: { label: 'Publicado en IG', color: 'var(--green)' },
  publicando: { label: 'Publicando…', color: 'var(--cyan)' },
  programado: { label: 'Se publica sola', color: 'var(--accent-2)' },
  error: { label: 'Error al publicar', color: 'var(--red)' },
};
const COLOR_ESTADO = { idea: 'var(--blue)', guion: 'var(--purple)', grabar: 'var(--orange)', editar: 'var(--pink)', listo: 'var(--cyan)', publicado: 'var(--green)', pendiente: 'var(--orange)' };

// Descarga los archivos de una pieza (uno detrás de otro) para subirlos a mano
const descargar = (archivos) => archivos.forEach((a, i) => setTimeout(() => {
  const el = document.createElement('a');
  el.href = a.url; el.download = a.nombre || ''; document.body.appendChild(el); el.click(); el.remove();
}, i * 400));

function PublicaHoy({ items = [], ir, alCambiar }) {
  const [error, setError] = useState(null);
  const hechas = items.filter((p) => p.estado === 'publicado').length;
  const marcar = async (e, p) => {
    e.stopPropagation(); setError(null);
    try {
      if (p.tipo === 'version') await api(`/api/publicar/versiones/${p.id}`, { method: 'PATCH', body: { publicado: true } });
      else await api(`/api/piezas/${p.id}`, { method: 'PATCH', body: { estado: 'publicado' } });
      alCambiar?.();
    } catch (err) { setError(err.message); }
  };
  const parar = (e) => e.stopPropagation();
  return (
    <div className="panel panel-pad">
      <div className="panel-head">
        <span className="label">Hoy se publica</span>
        {items.length ? <span className="ayuda">{hechas}/{items.length} publicado</span> : null}
      </div>
      {error && <div className="aviso-error">{error}</div>}
      {!items.length && <div className="vacio mini-vacio">Nada programado para hoy. Tapa el hueco en «Tu semana».</div>}
      <div className="hoy-lista">
        {items.map((p) => {
          const ig = p.instagram && ESTADO_IG[p.instagram];
          const publicada = p.estado === 'publicado';
          // Si Instagram la publica sola, no hace falta marcarla
          const sola = ['programado', 'publicando', 'publicado'].includes(p.instagram);
          return (
            <div key={`${p.tipo}-${p.id}`} className="hoy-fila" role="button" tabIndex={0} onClick={() => ir?.('contenido')} onKeyDown={(e) => e.key === 'Enter' && ir?.('contenido')} title={p.error || 'Abrir'}>
              <span className="time">{p.hora || '—'}</span>
              <span className="hoy-txt">
                <b>{p.titulo}</b>
                <small>{p.tipo === 'version' ? `Versión para ${redDe(p.red).nombre}` : p.formato || 'Pieza'}</small>
                {p.redes?.length > 0 && <span className="hoy-redes">También en {p.redes.map((v) => `${redDe(v.red).corto}${v.estado === 'publicado' ? ' ✓' : ''}`).join(', ')}</span>}
              </span>
              <span className="hoy-estados">
                <span className="tag-estado" style={{ '--c': COLOR_ESTADO[p.estado] || 'var(--muted)' }}>{p.etiqueta}</span>
                {ig && <span className="tag-estado" style={{ '--c': ig.color }}>{ig.label}</span>}
                {p.leadmagnet != null && (p.leadmagnet ? <BotonCopiar texto={p.leadmagnet} etiqueta="Copiar lead magnet" className="tag-estado lm-copiar" /> : <span className="tag-estado" style={{ '--c': 'var(--orange)' }}>Lead magnet sin enlace</span>)}
              </span>
              {!publicada && (
                <span className="hoy-acciones" onClick={parar} onKeyDown={parar}>
                  {p.tipo === 'version' && p.texto && <BotonCopiar texto={p.texto} etiqueta="Copiar texto" className="link-btn" />}
                  {p.tipo === 'pieza' && p.caption && <BotonCopiar texto={p.caption} etiqueta="Copiar caption" className="link-btn" />}
                  {p.tipo === 'pieza' && p.archivos?.length > 0 && <button type="button" className="link-btn" onClick={() => descargar(p.archivos)}>Descargar{p.archivos.length > 1 ? ` (${p.archivos.length})` : ''}</button>}
                  {!sola && <button type="button" className="btn btn-sec btn-mini" onClick={(e) => marcar(e, p)}>Marcar publicada</button>}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AvisoInstagram() {
  const [e] = useRecurso('/api/instagram/estado', null);
  if (!e?.caducada) return null;
  return <div className="aviso error ig-aviso" style={{ marginBottom: 14 }}><Icon name="instagram" size={14} /><span>Meta ha cortado la conexión con Instagram (@{e.username}): no se publica ni se sincroniza nada hasta que la vuelvas a conectar.</span><a className="link-btn" href="#instagram">Volver a conectar</a></div>;
}

export default function Inicio({ data, onAsk, acciones = {}, recargar = () => {} }) {
  const [q, setQ] = useState('');
  const [escuchando, setEscuchando] = useState(false);
  const [avisoVoz, setAvisoVoz] = useState('');
  const escucha = useRef(null);
  useEffect(() => () => escucha.current?.parar(), []);
  const submit = (text) => {
    const t = (text ?? q).trim();
    if (!t) return;
    onAsk?.(t);
    setQ('');
  };
  // Hablarle a JARVIS desde Inicio: lo que dices pasa al chat y te contesta allí
  const micro = () => {
    if (escuchando) { escucha.current?.parar(); return; }
    setAvisoVoz('');
    setEscuchando(true);
    escucha.current = escuchar({ onParcial: setQ, onFinal: (t) => submit(t), onError: setAvisoVoz, onFin: () => setEscuchando(false) });
  };

  // Inicio: JARVIS, lo que se publica hoy y tu semana. Nada más (actualizar y conectar Claude Code, en el menú de arriba)
  return (
    <>
      <AvisoInstagram />
      <section className="home-simple">
        <div className="panel hero jarvis-hero">
          <JarvisPresencia estado={escuchando ? 'escuchando' : 'listo'} texto={avisoVoz || (escuchando ? (q ? `“${q}”` : 'Te escucho…') : 'Pregúntame, pídeme un guion o apunta una idea.')}
            sub={data.fecha ? diaLargo(data.fecha) : 'Tu sistema operativo de contenido'} onMicro={micro} microDisponible={reconocimientoDisponible}>
            <form className="ask ask-inicio" onSubmit={(e) => { e.preventDefault(); submit(); }}>
              <Icon name="search" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pregúntale a JARVIS lo que quieras…" aria-label="Pregúntale a JARVIS" />
              <button className="ask-send" type="submit" aria-label="Enviar"><Icon name="send" size={15} /></button>
            </form>
          </JarvisPresencia>
        </div>
        <PublicaHoy items={data.publicaHoy} ir={acciones.ir} alCambiar={recargar} />
      </section>
      <TuSemana semana={data.semana} recargar={recargar} ir={acciones.ir} />
    </>
  );
}
