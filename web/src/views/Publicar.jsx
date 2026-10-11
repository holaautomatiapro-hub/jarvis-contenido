import { useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { api, useMensajes, useRecurso } from '../lib/api.js';
import { fechaCorta } from '../lib/formato.js';
import { estadoDe, useFases } from './contenido/comun.jsx';

const DIA = 86400000;
const lunes = (d = new Date()) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setTime(x.getTime() - ((x.getDay() + 6) % 7) * DIA); return x; };
const iso = (d) => d.toLocaleDateString('sv-SE');

function Insignia({ red, size = 30, apagada }) {
  return (
    <span className={`insignia${apagada ? ' apagada' : ''}`} style={{ width: size, height: size, '--c': red.color }} title={red.nombre}>
      {red.corto.slice(0, 2).toUpperCase()}
    </span>
  );
}

// "1 Post" en el centro y las redes alrededor, como en el esquema de la diapositiva
function Hub({ pieza, redes, versiones, seleccion, onSeleccion }) {
  const n = redes.length;
  const pos = redes.map((_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: 50 + Math.cos(a) * 41, y: 50 + Math.sin(a) * 40 };
  });
  const porRed = Object.fromEntries(versiones.map((v) => [v.red, v]));
  return (
    <div className="hub">
      <svg className="hub-lineas" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {pos.map((p, i) => <line key={i} x1="50" y1="50" x2={p.x} y2={p.y} className={porRed[redes[i].id] ? 'on' : ''} />)}
      </svg>
      <div className="hub-centro">
        <div className="hub-img"><Icon name="layers" size={22} /></div>
        <b>1 Post</b>
        <span>{pieza ? pieza.titulo : 'Elige una pieza'}</span>
        <small>{versiones.length ? `${versiones.length} versiones` : 'Sin versiones aún'}</small>
      </div>
      {redes.map((r, i) => {
        const v = porRed[r.id];
        return (
          <button key={r.id} className={`hub-nodo${v ? ' on' : ''}${seleccion === r.id ? ' sel' : ''}`} style={{ left: `${pos[i].x}%`, top: `${pos[i].y}%` }} onClick={() => v && onSeleccion(r.id)} disabled={!v} aria-label={`${r.nombre}${v ? '' : ' (sin versión)'}`}>
            <Insignia red={r} apagada={!v} />
            <span>{r.corto}</span>
            {v?.estado === 'publicado' && <i className="hub-ok">✓</i>}
          </button>
        );
      })}
    </div>
  );
}

function Version({ v, red, onCambio }) {
  const [copiado, setCopiado] = useState(false);
  const [f, setF] = useState(v.fecha || '');
  const [h, setH] = useState(v.hora || '');
  useEffect(() => { setF(v.fecha || ''); setH(v.hora || ''); }, [v.id, v.fecha, v.hora]);
  const copiar = async () => {
    await navigator.clipboard?.writeText([v.titulo, v.texto, v.extra].filter(Boolean).join('\n\n'));
    setCopiado(true); setTimeout(() => setCopiado(false), 1500);
  };
  const guardarFecha = async () => { await api(`/api/publicar/versiones/${v.id}`, { method: 'PATCH', body: { fecha: f || null, hora: h || null } }); onCambio(); };
  const marcar = async () => { await api(`/api/publicar/versiones/${v.id}`, { method: 'PATCH', body: { publicado: v.estado !== 'publicado' } }); onCambio(); };
  return (
    <div className="version">
      <div className="version-cab">
        <Insignia red={red} size={34} />
        <div>
          <b>{red.nombre}</b>
          <small>{v.formato || ''}{v.estado === 'publicado' ? ` · publicado ${fechaCorta(v.publicado.replace(' ', 'T'))}` : ''}</small>
        </div>
        <button className="btn btn-sec" onClick={copiar}>{copiado ? '✓ Copiado' : 'Copiar'}</button>
      </div>
      {v.titulo && <div className="version-titulo">{v.titulo}</div>}
      <pre className="version-texto">{v.texto}</pre>
      {v.extra && <div className="version-extra">{v.extra}</div>}
      {v.notas && <div className="version-notas"><Icon name="pen" size={12} /> {v.notas}</div>}
      <div className="version-pie">
        <label>Publicar el <input type="date" className="campo" value={f} onChange={(e) => setF(e.target.value)} /></label>
        <input type="time" className="campo" value={h} onChange={(e) => setH(e.target.value)} aria-label="Hora" />
        <button className="link-btn" onClick={guardarFecha} disabled={f === (v.fecha || '') && h === (v.hora || '')}>Programar</button>
        <button className={`btn ${v.estado === 'publicado' ? 'btn-sec' : ''}`} onClick={marcar}>{v.estado === 'publicado' ? 'Desmarcar' : 'Marcar como publicado'}</button>
      </div>
    </div>
  );
}

function Calendario({ data, redes, semana, setSemana, onElegir }) {
  const dias = Array.from({ length: 7 }, (_, i) => new Date(semana.getTime() + i * DIA));
  const red = (id) => redes.find((r) => r.id === id);
  const hoy = iso(new Date());
  return (
    <div className="panel panel-pad">
      <div className="panel-head">
        <span className="label">Calendario de publicaciones</span>
        <div className="seg">
          <button onClick={() => setSemana(new Date(semana.getTime() - 7 * DIA))} aria-label="Semana anterior">←</button>
          <button className="on" onClick={() => setSemana(lunes())}>{fechaCorta(dias[0])} – {fechaCorta(dias[6])}</button>
          <button onClick={() => setSemana(new Date(semana.getTime() + 7 * DIA))} aria-label="Semana siguiente">→</button>
        </div>
      </div>
      <div className="semana">
        {dias.map((d) => {
          const f = iso(d);
          const vs = data.versiones.filter((v) => v.fecha === f);
          return (
            <div key={f} className={`dia${f === hoy ? ' hoy' : ''}`}>
              <div className="dia-cab">{d.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '')} <b>{d.getDate()}</b></div>
              {vs.map((v) => (
                <button key={v.id} className={`evento${v.estado === 'publicado' ? ' hecho' : ''}`} onClick={() => onElegir(v)} style={{ '--c': red(v.red)?.color }}>
                  <span>{v.hora || ''} {red(v.red)?.corto}</span>
                  <b>{v.pieza_titulo}</b>
                </button>
              ))}
            </div>
          );
        })}
      </div>
      {data.sinFecha.length > 0 && (
        <div className="sin-fecha">
          <span className="label">Listas sin fecha</span>
          <div className="sin-fecha-lista">
            {data.sinFecha.slice(0, 12).map((v) => (
              <button key={v.id} className="evento" onClick={() => onElegir(v)} style={{ '--c': red(v.red)?.color }}>
                <span>{red(v.red)?.corto}</span><b>{v.pieza_titulo}</b>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Publicar() {
  useFases();
  const [semana, setSemana] = useState(lunes);
  const desde = iso(semana), hasta = iso(new Date(semana.getTime() + 6 * DIA));
  const [data, recargar] = useRecurso(`/api/publicar?desde=${desde}&hasta=${hasta}`, null);
  const [piezaId, setPiezaId] = useState(null);
  const [nueva, setNueva] = useState('');
  const [redesSel, setRedesSel] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [redSel, setRedSel] = useState(null);
  const [progreso, setProgreso] = useState(null);
  const [aviso, setAviso] = useState(null);

  const cargarDetalle = (id = piezaId) => { if (id) api(`/api/publicar/piezas/${id}`).then(setDetalle).catch(() => setDetalle(null)); else setDetalle(null); };
  useEffect(() => { cargarDetalle(); }, [piezaId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (data && redesSel == null) setRedesSel(data.porDefecto); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (data && piezaId == null && data.piezas[0]) setPiezaId(data.piezas[0].id); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Progreso en directo de JARVIS mientras adapta
  useMensajes('jarvis', (e) => {
    if (e.conversacion !== 'publicar') return;
    if (e.tipo === 'pregunta') setProgreso({ texto: 'JARVIS está adaptando tu pieza…', herramientas: [] });
    if (e.tipo === 'herramienta') setProgreso((p) => ({ ...(p || {}), herramientas: [...(p?.herramientas || []), e.nombre] }));
    if (e.tipo === 'fin') { setProgreso(null); setAviso({ tipo: 'ok', texto: 'Versiones listas. Revísalas, cópialas y prográmalas.' }); recargar(); cargarDetalle(); }
    if (e.tipo === 'error') { setProgreso(null); setAviso({ tipo: 'error', texto: e.mensaje }); }
  });
  useMensajes('cambio', () => cargarDetalle());

  const versiones = detalle?.versiones || [];
  const redesHub = useMemo(() => {
    if (!data) return [];
    const ids = new Set([...(redesSel || []), ...versiones.map((v) => v.red)]);
    return data.redes.filter((r) => ids.has(r.id));
  }, [data, redesSel, versiones]);

  if (!data) return <section className="panel soon"><div className="t-dim">Cargando…</div></section>;

  const adaptar = async () => {
    setAviso(null);
    try {
      const r = await api('/api/publicar/adaptar', { method: 'POST', body: piezaId === 'nueva' ? { texto: nueva, redes: redesSel } : { piezaId, redes: redesSel } });
      setProgreso({ texto: 'JARVIS está adaptando tu pieza…', herramientas: [] });
      if (piezaId === 'nueva') { setNueva(''); setPiezaId(r.pieza.id); }
      recargar();
    } catch (e) { setAviso({ tipo: 'error', texto: e.message }); }
  };
  const toggle = (id) => setRedesSel((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  const vSel = versiones.find((v) => v.red === redSel) || versiones[0];
  const elegirDelCalendario = (v) => { setPiezaId(v.pieza_id); setRedSel(v.red); };

  return (
    <section className="pub-vista">
      <div className="panel panel-pad pub-crear">
        <div className="pub-titulo">
          <h2>Crea una vez. <span>Publica en todos lados.</span></h2>
          <p>JARVIS convierte una idea en Reel, Carrusel, Short, Post o Historia, adaptada a cada red. Tú revisas, copias y publicas.</p>
        </div>
        <div className="pub-form">
          <label className="pub-campo">
            <span className="label">Pieza</span>
            <select className="campo" value={piezaId ?? ''} onChange={(e) => { setPiezaId(e.target.value === 'nueva' ? 'nueva' : Number(e.target.value)); setRedSel(null); }}>
              {data.piezas.map((p) => <option key={p.id} value={p.id}>{p.titulo} · {estadoDe(p.estado).label}{p.versiones ? ` · ${p.versiones} versiones` : ''}</option>)}
              <option value="nueva">+ Nueva idea…</option>
            </select>
          </label>
          {piezaId === 'nueva' && <textarea className="campo" rows={3} value={nueva} onChange={(e) => setNueva(e.target.value)} placeholder="Escribe la idea: JARVIS la guarda en el pipeline y la adapta" />}
          <div className="pub-campo">
            <span className="label">Redes</span>
            <div className="redes-chips">
              {data.redes.map((r) => (
                <button key={r.id} className={`red-chip${redesSel?.includes(r.id) ? ' on' : ''}`} onClick={() => toggle(r.id)} style={{ '--c': r.color }}>
                  <span className="red-punto" />{r.nombre}
                </button>
              ))}
            </div>
          </div>
          <div className="pub-acciones">
            <button className="btn" onClick={adaptar} disabled={Boolean(progreso) || data.trabajando || !redesSel?.length || (piezaId === 'nueva' && !nueva.trim()) || !piezaId}>
              <Icon name="sparkle" size={14} />{progreso || data.trabajando ? 'Adaptando…' : versiones.length ? 'Regenerar versiones' : 'Adaptar con JARVIS'}
            </button>
            {progreso && <span className="ayuda">{progreso.texto}{progreso.herramientas.length ? ` · ${[...new Set(progreso.herramientas)].join(', ')}` : ''}</span>}
          </div>
          {aviso && <div className={`aviso ${aviso.tipo}`}>{aviso.texto}<button className="link-btn" onClick={() => setAviso(null)}>Cerrar</button></div>}
        </div>
      </div>

      <div className="pub-medio">
        <div className="panel panel-pad">
          <Hub pieza={detalle?.pieza} redes={redesHub} versiones={versiones} seleccion={vSel?.red} onSeleccion={setRedSel} />
        </div>
        <div className="panel panel-pad pub-version">
          {vSel
            ? <Version v={vSel} red={data.redes.find((r) => r.id === vSel.red)} onCambio={() => { cargarDetalle(); recargar(); }} />
            : <div className="vacio">Elige las redes y pulsa “Adaptar con JARVIS”. Aquí verás cada versión lista para copiar.</div>}
          {versiones.length > 1 && (
            <div className="version-tabs">
              {versiones.map((v) => { const r = data.redes.find((x) => x.id === v.red); return <button key={v.id} className={v.red === vSel?.red ? 'on' : ''} onClick={() => setRedSel(v.red)}><Insignia red={r} size={20} />{r.corto}{v.estado === 'publicado' ? ' ✓' : ''}</button>; })}
            </div>
          )}
        </div>
      </div>

      <Calendario data={data.calendario} redes={data.redes} semana={semana} setSemana={setSemana} onElegir={elegirDelCalendario} />
    </section>
  );
}
