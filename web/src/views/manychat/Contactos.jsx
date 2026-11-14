import { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api, useRecurso } from '../../lib/api.js';
import { Avatar, fechaCorta } from './comun.jsx';
import Ficha from './Ficha.jsx';
import Pipeline from './Pipeline.jsx';

// Contactos: tabla con filtros, descarga en CSV de lo filtrado y la ficha de cada persona con todo su historial

export default function Contactos({ onChat }) {
  const [f, setF] = useState({ q: '', etiqueta: '', estado: '', automatizacion: '', desde: '', hasta: '' });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const [d, recargar, error, setD] = useRecurso(`/api/manychat/contactos?${qs}`, null);
  const releer = () => api(`/api/manychat/contactos?${qs}${qs ? '&' : ''}forzar=1`).then(setD).catch(() => {});
  const [autos] = useRecurso('/api/automatizaciones', null);
  const [viendo, setViendo] = useState(null);
  const [vista, setVistaEstado] = useState(() => { try { return localStorage.getItem('jarvis-mc-contactos-vista') === 'pipeline' ? 'pipeline' : 'lista'; } catch { return 'lista'; } });
  const setVista = (v) => { setVistaEstado(v); try { localStorage.setItem('jarvis-mc-contactos-vista', v); } catch { /* sin almacenamiento */ } };
  const hayFiltros = Object.values(f).some(Boolean);
  const [cambios, setCambios] = useState(0); // al cerrar la ficha, el pipeline se vuelve a leer
  const pon = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const automatizaciones = autos?.lista || [];
  return (
    <div className="panel panel-pad mc-contactos">
      <div className="mc-filtros mc-filtros-contactos">
        <div className="seg">
          <button className={vista === 'lista' ? 'on' : ''} onClick={() => setVista('lista')}><Icon name="layers" />Lista</button>
          <button className={vista === 'pipeline' ? 'on' : ''} onClick={() => setVista('pipeline')}><Icon name="chart" />Pipeline</button>
        </div>
        <div className="buscar-mini"><Icon name="search" size={13} /><input placeholder="Buscar por nombre o usuario" value={f.q} onChange={pon('q')} /></div>
        <select className="campo" value={f.etiqueta} onChange={pon('etiqueta')} aria-label="Etiqueta">
          <option value="">Todas las etiquetas</option>
          {(d?.etiquetas || []).map((t) => <option key={t.nombre} value={t.nombre}>{t.nombre} ({t.n})</option>)}
        </select>
        <select className="campo" value={f.automatizacion} onChange={pon('automatizacion')} aria-label="Automatización">
          <option value="">Cualquier automatización</option>
          {automatizaciones.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
        <select className="campo" value={f.estado} onChange={pon('estado')} aria-label="Estado">
          <option value="">Todos</option>
          <option value="suscrito">Suscritos</option>
          <option value="pausado">Con automatizaciones en pausa</option>
          <option value="bloqueado">Bloqueados</option>
        </select>
        <label className="mc-fecha">Alta desde <input type="date" className="campo" value={f.desde} onChange={pon('desde')} /></label>
        <label className="mc-fecha">hasta <input type="date" className="campo" value={f.hasta} onChange={pon('hasta')} /></label>
        <a className="btn" href={`/api/manychat/contactos.csv?${qs}`} download><Icon name="share" size={13} />Descargar CSV{d ? ` (${d.total})` : ''}</a>
        <button className="btn btn-sec" onClick={releer} title="Volver a leer de Zernio"><Icon name="refresh" size={13} /></button>
      </div>
      {error && <div className="caja-error">{error}</div>}
      {!d && !error && <p className="ayuda">Cargando contactos…</p>}
      {d && vista === 'pipeline' && <Pipeline soloIds={hayFiltros ? new Set(d.lista.map((c) => c.id)) : null} onAbrir={setViendo} cambios={cambios} />}
      {d && vista === 'lista' && (
        <>
          <p className="ayuda">{d.total} contacto{d.total === 1 ? '' : 's'}{d.total > d.lista.length ? ` · se ven los ${d.lista.length} más recientes (el CSV lleva todos)` : ''}</p>
          <div className="mc-tabla">
            <div className="mc-fila mc-fila-cab"><span /><span>Nombre</span><span>Recurso de entrada</span><span>Etiquetas</span><span>Último mensaje suyo</span><span>Alta</span></div>
            {d.lista.map((c) => (
              <button key={c.id} className="mc-fila" onClick={() => setViendo(c.id)}>
                <Avatar foto={c.foto} nombre={c.nombre || c.usuario} tam={32} />
                <span className="fila-c-txt"><b>{c.nombre || (c.usuario ? `@${c.usuario}` : 'Contacto desconocido')}</b><small>{c.usuario ? `@${c.usuario}` : c.canal}{c.bloqueado ? ' · ⛔ bloqueado' : c.pausado ? ' · en pausa' : ''}</small></span>
                <span className="fila-c-txt">{c.recursoEntrada ? <><b>{c.recursoEntrada.nombre}</b><small>{c.recursos.length === 1 ? '1 recurso pedido' : `${c.recursos.length} recursos pedidos`}</small></> : <small>—</small>}</span>
                <span className="auto-palabras">{c.etiquetas.slice(0, 3).map((t) => <span key={t} className="chip">{t}</span>)}{c.etiquetas.length > 3 && <small>+{c.etiquetas.length - 3}</small>}</span>
                <span>{c.ultimoRecibido ? fechaCorta(c.ultimoRecibido) : '—'}</span>
                <span>{c.creado ? new Date(c.creado).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '—'}</span>
              </button>
            ))}
            {!d.lista.length && <div className="vacio">Ningún contacto con estos filtros.</div>}
          </div>
        </>
      )}
      {viendo && <Ficha id={viendo} onClose={() => { setViendo(null); recargar(); setCambios((n) => n + 1); }} onChat={(c) => { setViendo(null); onChat(c); }} />}
    </div>
  );
}
