import { useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { api, useRecurso } from '../lib/api.js';
import { Modal } from './contenido/comun.jsx';

// Estrategia: el calendario de marketing por semanas (atraer audiencia, semana educativa o de venta, con su
// objetivo, táctica y campaña) y qué tipo de contenido toca cada día en directo, post y stories.

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const fecha = (s) => { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d); };
const corta = (s) => { const d = fecha(s); return `${d.getDate()} ${MES_CORTO[d.getMonth()]}`; };
const masDias = (s, n) => { const d = fecha(s); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
// Una semana es del mes en el que cae su jueves (como el calendario de marketing)
const mesDeSemana = (lunes) => fecha(masDias(lunes, 3)).getMonth();

function ChipTipo({ e, apagado = false, onClick, title }) {
  return (
    <button type="button" className={`est-chip${apagado ? ' apagado' : ''}`} style={{ '--c': e.color }} onClick={onClick} title={title}>
      <i />{e.nombre}
    </button>
  );
}

// La tabla de la semana: directo, post y stories de lunes a domingo. editable: cada celda es un campo
function Tabla({ filas, nombresFilas, dias, editable = false, onCambio, fechas = null, piezas = null, color }) {
  const cambiar = (fila, i, v) => onCambio({ ...filas, [fila]: filas[fila].map((x, j) => (j === i ? v : x)) });
  return (
    <div className="est-tabla-caja">
      <table className="est-tabla" style={{ '--c': color }}>
        <thead>
          <tr><th />{dias.map((d, i) => <th key={d}>{d}{fechas && <small>{corta(fechas[i])}</small>}</th>)}</tr>
        </thead>
        <tbody>
          {nombresFilas.map((f) => (
            <tr key={f.id}>
              <th>{f.nombre}</th>
              {dias.map((d, i) => (
                <td key={d} className={filas[f.id][i] ? '' : 'vacia'}>
                  {editable
                    ? <textarea className="est-celda" rows={2} value={filas[f.id][i]} onChange={(e) => cambiar(f.id, i, e.target.value)} placeholder="—" maxLength={120} />
                    : filas[f.id][i] || <span className="t-dim">—</span>}
                </td>
              ))}
            </tr>
          ))}
          {piezas && (
            <tr className="est-piezas">
              <th>En Contenido</th>
              {fechas.map((f) => (
                <td key={f}>
                  {(piezas.get(f) || []).map((p) => <span key={p.id} className="est-pieza" title={`${p.titulo} · ${p.estado}`}>{p.titulo}</span>)}
                  {!(piezas.get(f) || []).length && <span className="t-dim">Nada</span>}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Una semana: qué es (estructura, objetivo, táctica, campaña), qué toca cada día y lo que ya hay en Contenido
function Semana({ lunes, data, onClose, recargarAnio }) {
  const [r, recargar] = useRecurso(`/api/estrategia/semana/${lunes}`, null);
  const [f, setF] = useState(null);
  const [celdas, setCeldas] = useState(null); // la tabla propia de esta semana mientras se edita
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState('');
  const [indicaciones, setIndicaciones] = useState('');
  useEffect(() => { if (r && !f) setF({ tipo: r.semana.porDefecto ? null : r.semana.tipo, objetivo: r.semana.objetivo || '', detalle: r.semana.detalle || '', tactica: r.semana.tactica || '', campana: r.semana.campana || '', notas: r.semana.notas || '' }); }, [r]); // eslint-disable-line react-hooks/exhaustive-deps
  // Mientras JARVIS planifica la semana, se mira cada pocos segundos
  useEffect(() => {
    if (!r?.planificando) return undefined;
    const t = setInterval(recargar, 4000);
    return () => clearInterval(t);
  }, [r?.planificando, recargar]);

  if (!r || !f) return <Modal titulo="Semana" onClose={onClose} ancho={1100}><div className="t-dim">Cargando…</div></Modal>;
  const s = r.semana;
  const tipo = f.tipo || (data.objetivos.find((o) => o.id === f.objetivo)?.tipo) || 'atraer';
  const e = data.estructuras[tipo];
  const fechas = Array.from({ length: 7 }, (_, i) => masDias(s.lunes, i));
  const piezas = new Map();
  for (const p of r.piezas) piezas.set(p.fecha, [...(piezas.get(p.fecha) || []), p]);
  const filas = celdas || (s.propia && tipo === s.tipo ? s.filas : e.filas);

  const guardar = async (extra = {}) => {
    setOcupado('guardar'); setAviso(null);
    try {
      await api(`/api/estrategia/semana/${s.lunes}`, { method: 'PUT', body: { ...f, tipo: f.tipo, objetivo: f.objetivo || null, ...extra } });
      setCeldas(null); recargar(); recargarAnio();
      setAviso({ tipo: 'ok', texto: 'Semana guardada.' });
    } catch (err) { setAviso({ tipo: 'error', texto: err.message }); }
    setOcupado('');
  };
  const crearPiezas = async () => {
    const huecos = [];
    fechas.forEach((_, i) => data.filas.forEach((fl) => { if (filas[fl.id][i]) huecos.push({ dia: i, fila: fl.id }); }));
    setOcupado('piezas'); setAviso(null);
    try {
      await guardar();
      const x = await api(`/api/estrategia/semana/${s.lunes}/piezas`, { method: 'POST', body: { huecos } });
      setAviso({ tipo: 'ok', texto: x.creadas ? `${x.creadas} ${x.creadas === 1 ? 'idea creada' : 'ideas creadas'} en Contenido, cada una en su día.` : 'Ya estaban todas creadas.' });
      recargar();
    } catch (err) { setAviso({ tipo: 'error', texto: err.message }); }
    setOcupado('');
  };
  const conJarvis = async () => {
    setOcupado('jarvis'); setAviso(null);
    try {
      await guardar();
      await api(`/api/estrategia/semana/${s.lunes}/jarvis`, { method: 'POST', body: { indicaciones } });
      setIndicaciones('');
      recargar();
    } catch (err) { setAviso({ tipo: 'error', texto: err.message }); }
    setOcupado('');
  };

  return (
    <Modal titulo={<><span className="est-punto" style={{ background: e.color }} />Semana del {corta(s.lunes)} al {corta(s.domingo)}</>} onClose={onClose} ancho={1180} cerrarFuera={false} clase="est-semana">
      <div className="est-semana-datos">
        <div className="est-campo est-ancho">
          <span className="label">Qué semana es</span>
          <div className="est-chips">
            {data.objetivos.map((o) => (
              <button type="button" key={o.id} className={`chip${f.objetivo === o.id ? ' chip-acento' : ''}`} onClick={() => setF({ ...f, objetivo: f.objetivo === o.id ? '' : o.id, tipo: f.objetivo === o.id ? f.tipo : o.tipo })}>{o.nombre}</button>
            ))}
          </div>
        </div>
        <div className="est-campo est-ancho">
          <span className="label">Estructura de contenido</span>
          <div className="est-chips">
            {Object.values(data.estructuras).map((x) => <ChipTipo key={x.id} e={x} apagado={tipo !== x.id} onClick={() => setF({ ...f, tipo: x.id })} title={x.etiqueta} />)}
          </div>
        </div>
        <label className="est-campo"><span className="label">Detalle del objetivo</span>
          <input className="campo" value={f.detalle} onChange={(ev) => setF({ ...f, detalle: ev.target.value })} placeholder="Propósito de Año Nuevo" maxLength={120} />
        </label>
        <label className="est-campo"><span className="label">Táctica</span>
          <input className="campo" list="est-tacticas" value={f.tactica} onChange={(ev) => setF({ ...f, tactica: ev.target.value })} placeholder="Retargeting + contenido orgánico" maxLength={160} />
          <datalist id="est-tacticas">{data.tacticas.map((t) => <option key={t} value={t} />)}</datalist>
        </label>
        <label className="est-campo"><span className="label">Campaña o game plan</span>
          <input className="campo" value={f.campana} onChange={(ev) => setF({ ...f, campana: ev.target.value })} placeholder="Estrategia de Año Nuevo" maxLength={120} />
        </label>
        <label className="est-campo est-ancho"><span className="label">Notas (objeciones, testimonios, oferta…)</span>
          <textarea className="campo" rows={2} value={f.notas} onChange={(ev) => setF({ ...f, notas: ev.target.value })} placeholder={tipo === 'vender' ? 'Objeciones que vas a rebatir, mensaje de la oferta, testimonios y sus días…' : tipo === 'educar' ? 'Los problemas y creencias que vas a trabajar cada día…' : 'Temas o ideas para esta semana…'} />
        </label>
      </div>

      <div className="est-semana-cab">
        <div>
          <b>{e.nombre}</b>{e.etiqueta && <span className="t-dim"> · {e.etiqueta}</span>}
          <div className="ayuda">Posts: {e.posts} · Stories: {e.stories}</div>
        </div>
        <div className="est-semana-btns">
          {celdas ? (
            <>
              <button type="button" className="link-btn" onClick={() => setCeldas(null)}>Cancelar</button>
              <button type="button" className="btn btn-sec" onClick={() => guardar({ celdas, tipo })} disabled={Boolean(ocupado)}>Guardar los cambios de esta semana</button>
            </>
          ) : (
            <>
              {s.propia && <button type="button" className="link-btn" onClick={() => guardar({ celdas: null })}>Volver a la estructura</button>}
              <button type="button" className="link-btn" onClick={() => setCeldas(filas)}><Icon name="pen" size={12} /> Cambiar solo esta semana</button>
            </>
          )}
        </div>
      </div>
      <Tabla filas={filas} nombresFilas={data.filas} dias={data.dias} editable={Boolean(celdas)} onCambio={setCeldas} fechas={fechas} piezas={piezas} color={e.color} />
      {e.pasos?.length > 0 && <ol className="est-pasos">{e.pasos.map((p) => <li key={p}>{p}</li>)}</ol>}

      {r.planificando && <div className="aviso">JARVIS está planificando esta semana: las piezas irán apareciendo en Contenido, cada una en su día.</div>}
      {aviso && <div className={`aviso ${aviso.tipo}`}>{aviso.texto}</div>}
      <div className="est-jarvis">
        <input className="campo" value={indicaciones} onChange={(ev) => setIndicaciones(ev.target.value)} placeholder="Opcional para JARVIS: el tema de la semana, la oferta, qué testimonios tienes…" />
        <button type="button" className="btn" onClick={conJarvis} disabled={Boolean(ocupado) || r.planificando}><Icon name="sparkle" size={14} />{ocupado === 'jarvis' ? 'Enviando…' : 'Que JARVIS proponga los temas'}</button>
      </div>
      <div className="modal-pie">
        <button type="button" className="btn btn-sec" onClick={crearPiezas} disabled={Boolean(ocupado)} title="Una idea en Contenido por cada hueco, con su día y lo que toca como título">
          <Icon name="plus" size={14} />{ocupado === 'piezas' ? 'Creando…' : 'Crear las ideas de la semana'}
        </button>
        <div className="est-semana-btns">
          {!s.porDefecto && <button type="button" className="link-btn" onClick={async () => { await api(`/api/estrategia/semana/${s.lunes}`, { method: 'DELETE' }); recargarAnio(); onClose(); }}>Vaciar la semana</button>}
          <button type="button" className="btn" onClick={() => guardar()} disabled={Boolean(ocupado)}>{ocupado === 'guardar' ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </Modal>
  );
}

// Una estructura (atraer, educar, vender): su resumen, su tabla, sus tipos de contenido y, si se quiere, cambiarla
function Estructura({ e, data, recargar }) {
  const [editando, setEditando] = useState(null);
  const [error, setError] = useState('');
  const empezar = () => setEditando({ ...e, tiposTxt: (e.tipos || []).map((t) => `${t.nombre}: ${t.descripcion}`).join('\n'), pasosTxt: (e.pasos || []).join('\n') });
  const guardar = async () => {
    setError('');
    const tipos = editando.tiposTxt.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf(':'); return i > 0 ? { nombre: l.slice(0, i).trim(), descripcion: l.slice(i + 1).trim() } : { nombre: l, descripcion: '' }; });
    try {
      await api(`/api/estrategia/estructuras/${e.id}`, { method: 'PUT', body: { nombre: editando.nombre, etiqueta: editando.etiqueta, resumen: editando.resumen, posts: editando.posts, stories: editando.stories, filas: editando.filas, tipos, pasos: editando.pasosTxt.split('\n').map((l) => l.trim()).filter(Boolean) } });
      setEditando(null); recargar();
    } catch (err) { setError(err.message); }
  };
  const restaurar = async () => {
    if (!window.confirm(`¿Volver a la estructura de serie de «${e.nombre}»? Se pierden tus cambios en ella.`)) return;
    await api(`/api/estrategia/estructuras/${e.id}`, { method: 'DELETE' }); recargar();
  };
  if (editando) {
    const campo = (k, ph, max = 120) => <input className="campo" value={editando[k]} onChange={(ev) => setEditando({ ...editando, [k]: ev.target.value })} placeholder={ph} maxLength={max} />;
    return (
      <div className="est-estructura" style={{ '--c': e.color }}>
        <div className="est-editar">
          <label className="est-campo"><span className="label">Nombre</span>{campo('nombre', 'Semana de venta', 60)}</label>
          <label className="est-campo"><span className="label">Para qué es</span>{campo('etiqueta', 'Conversión', 60)}</label>
          <label className="est-campo est-ancho"><span className="label">Resumen</span><textarea className="campo" rows={3} value={editando.resumen} onChange={(ev) => setEditando({ ...editando, resumen: ev.target.value })} /></label>
          <label className="est-campo"><span className="label">Posts</span>{campo('posts', 'Nivel de conciencia alto (4-5)')}</label>
          <label className="est-campo"><span className="label">Stories</span>{campo('stories', 'Storytelling a nivel 4-5')}</label>
        </div>
        <Tabla filas={editando.filas} nombresFilas={data.filas} dias={data.dias} editable onCambio={(filas) => setEditando({ ...editando, filas })} color={e.color} />
        <div className="est-editar">
          <label className="est-campo est-ancho"><span className="label">Tipos de contenido (uno por línea, «Nombre: qué es»)</span><textarea className="campo" rows={5} value={editando.tiposTxt} onChange={(ev) => setEditando({ ...editando, tiposTxt: ev.target.value })} /></label>
          <label className="est-campo est-ancho"><span className="label">Cómo prepararla (un paso por línea)</span><textarea className="campo" rows={3} value={editando.pasosTxt} onChange={(ev) => setEditando({ ...editando, pasosTxt: ev.target.value })} /></label>
        </div>
        {error && <div className="aviso error">{error}</div>}
        <div className="modal-pie">
          <button type="button" className="link-btn" onClick={() => setEditando(null)}>Cancelar</button>
          <button type="button" className="btn" onClick={guardar}>Guardar la estructura</button>
        </div>
      </div>
    );
  }
  return (
    <div className="est-estructura" style={{ '--c': e.color }}>
      <div className="est-estructura-cab">
        <div>
          <h3><span className="est-punto" style={{ background: e.color }} />{e.nombre}{e.etiqueta && <span className="t-dim"> · {e.etiqueta}</span>}</h3>
          <p className="ayuda">{e.resumen}</p>
          <div className="est-niveles"><span><b>Posts:</b> {e.posts}</span><span><b>Stories:</b> {e.stories}</span></div>
        </div>
        <div className="est-semana-btns">
          {e.cambiada && <button type="button" className="link-btn" onClick={restaurar}>Volver a la de serie</button>}
          <button type="button" className="btn btn-sec" onClick={empezar}><Icon name="pen" size={13} />Cambiar</button>
        </div>
      </div>
      <Tabla filas={e.filas} nombresFilas={data.filas} dias={data.dias} color={e.color} />
      {(e.tipos?.length > 0 || e.pasos?.length > 0) && (
        <div className="est-tipos">
          {e.pasos?.length > 0 && <div><span className="label">Cómo prepararla</span><ol>{e.pasos.map((p) => <li key={p}>{p}</li>)}</ol></div>}
          {e.tipos?.length > 0 && <div><span className="label">Tipos de contenido</span><dl>{e.tipos.map((t) => <div key={t.nombre}><dt>{t.nombre}</dt><dd>{t.descripcion}</dd></div>)}</dl></div>}
        </div>
      )}
    </div>
  );
}

export default function Estrategia() {
  const [anio, setAnio] = useState(() => new Date().getFullYear());
  const [data, recargar, error] = useRecurso(`/api/estrategia?anio=${anio}`, null);
  const [abierta, setAbierta] = useState(null);
  const [verEstructura, setVerEstructura] = useState('atraer');
  const porMes = useMemo(() => {
    const m = Array.from({ length: 12 }, () => []);
    for (const s of data?.semanas || []) {
      if (fecha(masDias(s.lunes, 3)).getFullYear() === anio) m[mesDeSemana(s.lunes)].push(s);
    }
    return m;
  }, [data, anio]);

  if (!data) return <section className="panel panel-pad">{error ? <div className="aviso error">No se ha podido cargar la estrategia: {error}</div> : <div className="t-dim">Cargando estrategia…</div>}</section>;
  const est = data.estructuras;
  const objetivo = (s) => data.objetivos.find((o) => o.id === s.objetivo)?.nombre;
  const esta = data.semanas.find((s) => s.lunes === data.estaSemana);

  return (
    <div className="est-vista">
      <section className="panel panel-pad est-cab">
        <div>
          <span className="label">Estrategia</span>
          <h2>Qué publicar cada día</h2>
          <p className="ayuda">Marca cada semana de tu calendario de marketing como semana para <b style={{ color: est.atraer.color }}>atraer audiencia</b>, <b style={{ color: est.educar.color }}>educativa</b> (prepara la venta) o <b style={{ color: est.vender.color }}>de venta</b>, y JARVIS sabe qué toca cada día en directo, post y stories. Sin marcar, una semana es «semana tipo» (atraer).</p>
        </div>
        {esta && (
          <button type="button" className="est-esta" style={{ '--c': est[esta.tipo].color }} onClick={() => setAbierta(esta.lunes)}>
            <span className="label">Esta semana</span>
            <b>{est[esta.tipo].nombre}</b>
            <small>{objetivo(esta) || (esta.porDefecto ? 'Semana tipo' : '')}{esta.detalle ? ` · ${esta.detalle}` : ''}</small>
          </button>
        )}
      </section>

      <div className="est-principios">
        {data.principios.map((p) => <div key={p.titulo} className="panel panel-pad"><b>{p.titulo}</b><span className="ayuda">{p.texto}</span></div>)}
      </div>

      <section className="panel panel-pad">
        <div className="panel-head">
          <div className="est-anio">
            <button type="button" className="icon-btn" onClick={() => setAnio((a) => a - 1)} aria-label="Año anterior">‹</button>
            <h2>Calendario de marketing {anio}</h2>
            <button type="button" className="icon-btn" onClick={() => setAnio((a) => a + 1)} aria-label="Año siguiente">›</button>
          </div>
          <div className="est-leyenda">{Object.values(est).map((e) => <span key={e.id}><i style={{ background: e.color }} />{e.nombre}</span>)}</div>
        </div>
        <div className="est-meses">
          {porMes.map((semanas, m) => (
            <div key={MESES[m]} className="est-mes">
              <div className="est-mes-nombre">{MESES[m]}</div>
              {semanas.map((s, i) => {
                const e = est[s.tipo];
                return (
                  <button type="button" key={s.lunes} className={`est-fila${s.porDefecto ? ' por-defecto' : ''}${s.lunes === data.estaSemana ? ' hoy' : ''}`} style={{ '--c': e.color }} onClick={() => setAbierta(s.lunes)}>
                    <span className="est-fila-s">S{i + 1}</span>
                    <span className="est-fila-fechas">{corta(s.lunes)} – {corta(s.domingo)}</span>
                    <span className="est-fila-tipo"><i />{e.nombre}</span>
                    <span className="est-fila-obj">{objetivo(s) || (s.porDefecto ? <span className="t-dim">Sin marcar (semana tipo)</span> : '')}{s.detalle ? ` · ${s.detalle}` : ''}</span>
                    <span className="est-fila-tac">{s.tactica || ''}</span>
                    <span className="est-fila-camp">{s.campana || ''}{s.propia ? ' ✎' : ''}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      <section className="panel panel-pad">
        <div className="panel-head">
          <div><span className="label">Estructuras de semana</span><div className="ayuda" style={{ marginTop: 3 }}>Qué toca cada día en cada tipo de semana. Puedes cambiarlas a tu medida.</div></div>
          <div className="seg seg-mini" role="group" aria-label="Estructura">
            {Object.values(est).map((e) => <button key={e.id} type="button" className={verEstructura === e.id ? 'on' : ''} onClick={() => setVerEstructura(e.id)}>{e.nombre}</button>)}
          </div>
        </div>
        <Estructura key={verEstructura + (est[verEstructura].cambiada ? '-c' : '')} e={est[verEstructura]} data={data} recargar={recargar} />
      </section>

      {abierta && <Semana key={abierta} lunes={abierta} data={data} onClose={() => setAbierta(null)} recargarAnio={recargar} />}
    </div>
  );
}
