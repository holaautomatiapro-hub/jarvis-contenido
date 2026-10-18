import { useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { api, useRecurso } from '../lib/api.js';
import { Modal } from './contenido/comun.jsx';
import { colorCategoria } from '../lib/categorias.js';

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

// Un botón de la estrategia: su categoría (LM, Viral, Educar…) y, debajo, su nota si la tiene
export function Boton({ x, onClick, title }) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag type={onClick ? 'button' : undefined} className="est-boton" style={{ '--cat': colorCategoria(x.c) }} onClick={onClick} title={title || (x.n ? `${x.c} · ${x.n}` : x.c)}>
      <b>{x.c}</b>{x.n && <small>{x.n}</small>}
    </Tag>
  );
}

// El menú de un botón (o de uno nuevo): elegir la categoría, escribir una nota o quitarlo
function MenuBoton({ x, categorias, onElegir, onQuitar, onCerrar, pos }) {
  const [nota, setNota] = useState(x?.n || '');
  const [otra, setOtra] = useState('');
  useEffect(() => {
    const f = (e) => { if (!e.target.closest?.('.est-menu')) onCerrar(); };
    const t = setTimeout(() => document.addEventListener('mousedown', f), 0);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', f); };
  }, [onCerrar]);
  const elegir = (c) => onElegir({ c, ...(nota.trim() ? { n: nota.trim() } : {}) });
  return (
    <div className="est-menu" role="dialog" style={pos}>
      <div className="est-menu-cats">
        {categorias.map((c) => (
          <button type="button" key={c} className={`est-boton${x?.c === c ? ' sel' : ''}`} style={{ '--cat': colorCategoria(c) }} onClick={() => elegir(c)}><b>{c}</b></button>
        ))}
      </div>
      <input className="campo" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota (opcional): «Problema 1», «con CTA»…" maxLength={120}
        onKeyDown={(e) => { if (e.key === 'Enter' && x?.c) { e.preventDefault(); elegir(x.c); } }} />
      <div className="est-menu-pie">
        <input className="campo" value={otra} onChange={(e) => setOtra(e.target.value)} placeholder="Otro botón…" maxLength={30}
          onKeyDown={(e) => { if (e.key === 'Enter' && otra.trim()) { e.preventDefault(); elegir(otra.trim()); } }} />
        {x?.c && <button type="button" className="link-btn" onClick={() => elegir(x.c)}>Guardar nota</button>}
        {onQuitar && <button type="button" className="link-btn rojo" onClick={onQuitar}>Quitar</button>}
      </div>
    </div>
  );
}

// La tabla de la semana: directo, post y stories de lunes a domingo, con sus botones. editable: se añaden,
// cambian y quitan botones en cada hueco
function Tabla({ filas, nombresFilas, dias, editable = false, onCambio, fechas = null, piezas = null, color, categorias = {} }) {
  const [menu, setMenu] = useState(null); // { fila, dia, i, pos } (i = null: uno nuevo)
  // El menú va fijo en pantalla, debajo del hueco (dentro de la tabla se cortaría)
  const abrir = (e, m) => {
    const r = e.currentTarget.closest('td').getBoundingClientRect();
    setMenu({ ...m, pos: { left: Math.max(8, Math.min(window.innerWidth - 268, r.left + r.width / 2 - 130)), top: Math.max(8, Math.min(r.bottom + 4, window.innerHeight - 230)) } });
  };
  const poner = (fila, dia, lista) => onCambio({ ...filas, [fila]: filas[fila].map((x, j) => (j === dia ? lista : x)) });
  const elegir = (nuevo) => {
    const { fila, dia, i } = menu;
    const lista = [...filas[fila][dia]];
    if (i == null) lista.push(nuevo); else lista[i] = nuevo;
    poner(fila, dia, lista);
    setMenu(null);
  };
  const quitar = () => {
    const { fila, dia, i } = menu;
    poner(fila, dia, filas[fila][dia].filter((_, j) => j !== i));
    setMenu(null);
  };
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
              {dias.map((d, i) => {
                const lista = filas[f.id][i] || [];
                const abierto = menu && menu.fila === f.id && menu.dia === i;
                return (
                  <td key={d} className={`${lista.length ? '' : 'vacia'}${editable ? ' editable' : ''}`}>
                    <div className="est-botones">
                      {lista.map((x, j) => <Boton key={`${x.c}-${j}`} x={x} onClick={editable ? (e) => abrir(e, { fila: f.id, dia: i, i: j }) : undefined} />)}
                      {!lista.length && !editable && <span className="t-dim">—</span>}
                      {editable && lista.length < 6 && <button type="button" className="est-mas" onClick={(e) => abrir(e, { fila: f.id, dia: i, i: null })} aria-label="Añadir botón">+</button>}
                    </div>
                    {abierto && <MenuBoton x={menu.i != null ? lista[menu.i] : null} categorias={categorias[f.id] || []} onElegir={elegir} onQuitar={menu.i != null ? quitar : null} onCerrar={() => setMenu(null)} pos={menu.pos} />}
                  </td>
                );
              })}
            </tr>
          ))}
          {piezas && (
            <tr className="est-piezas">
              <th>En Contenido</th>
              {fechas.map((f) => (
                <td key={f}>
                  {(piezas.get(f) || []).map((p) => <span key={p.id} className="est-pieza" style={p.categoria ? { '--cat': colorCategoria(p.categoria) } : undefined} title={`${p.titulo} · ${p.estado}`}>{p.titulo}</span>)}
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

// Los botones que se pueden poner en cada fila (posts, stories, directos): añadir y quitar
function Categorias({ data, recargar }) {
  const [nuevo, setNuevo] = useState({});
  const [error, setError] = useState('');
  const guardar = async (fila, lista) => {
    setError('');
    try { await api('/api/estrategia/categorias', { method: 'PUT', body: { [fila]: lista } }); recargar(); } catch (e) { setError(e.message); }
  };
  return (
    <div className="est-categorias">
      {data.filas.map((f) => (
        <div key={f.id} className="est-categorias-fila">
          <span className="label">{f.id === 'post' ? 'Publicaciones' : f.nombre}</span>
          <div className="est-botones">
            {data.categorias[f.id].map((c) => (
              <span key={c} className="est-boton" style={{ '--cat': colorCategoria(c) }}>
                <b>{c}</b>
                <button type="button" className="est-boton-x" onClick={() => guardar(f.id, data.categorias[f.id].filter((x) => x !== c))} aria-label={`Quitar ${c}`}>×</button>
              </span>
            ))}
            <form onSubmit={(e) => { e.preventDefault(); const v = (nuevo[f.id] || '').trim(); if (v) { guardar(f.id, [...data.categorias[f.id], v]); setNuevo({ ...nuevo, [f.id]: '' }); } }}>
              <input className="campo est-nueva-cat" value={nuevo[f.id] || ''} onChange={(e) => setNuevo({ ...nuevo, [f.id]: e.target.value })} placeholder="+ Añadir" maxLength={30} />
            </form>
          </div>
        </div>
      ))}
      {error && <div className="aviso error">{error}</div>}
    </div>
  );
}

// Una semana: qué es (estructura, objetivo, táctica, campaña), qué toca cada día y lo que ya hay en Contenido
function Semana({ lunes, data, onClose, recargarAnio }) {
  const [r, recargar] = useRecurso(`/api/estrategia/semana/${lunes}`, null);
  const [f, setF] = useState(null);
  const [celdas, setCeldas] = useState(null); // la tabla de esta semana tal como se ha cambiado aquí
  const [guardadoDias, setGuardadoDias] = useState('');
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
  // Los días se guardan solos al tocarlos (antes había que darle a otro botón y se perdían)
  const cambiarDias = async (nuevas) => {
    setCeldas(nuevas); setGuardadoDias('guardando');
    try {
      await api(`/api/estrategia/semana/${s.lunes}`, { method: 'PUT', body: { celdas: nuevas, tipo } });
      setGuardadoDias('ok'); recargarAnio();
    } catch (err) { setGuardadoDias(''); setAviso({ tipo: 'error', texto: err.message }); }
  };
  const volverAEstructura = async () => {
    await api(`/api/estrategia/semana/${s.lunes}`, { method: 'PUT', body: { celdas: null } });
    setCeldas(null); setGuardadoDias(''); recargar(); recargarAnio();
  };
  const cambiarTipo = (t) => { setF({ ...f, tipo: t }); if (t !== tipo) setCeldas(null); };

  const guardar = async (extra = {}) => {
    setOcupado('guardar'); setAviso(null);
    try {
      // Si ha cambiado la estructura, los días pasan a ser los de la nueva (salvo los que se hayan tocado aquí)
      const dias = celdas ? { celdas, tipo } : tipo !== s.tipo && s.propia ? { celdas: null } : {};
      await api(`/api/estrategia/semana/${s.lunes}`, { method: 'PUT', body: { ...f, tipo: f.tipo, objetivo: f.objetivo || null, ...dias, ...extra } });
      recargar(); recargarAnio();
      setAviso({ tipo: 'ok', texto: 'Semana guardada.' });
    } catch (err) { setAviso({ tipo: 'error', texto: err.message }); }
    setOcupado('');
  };
  const crearPiezas = async () => {
    setOcupado('piezas'); setAviso(null);
    try {
      await guardar();
      const x = await api(`/api/estrategia/semana/${s.lunes}/piezas`, { method: 'POST', body: {} });
      setAviso({ tipo: 'ok', texto: x.creadas ? `${x.creadas} ${x.creadas === 1 ? 'hueco pasado' : 'huecos pasados'} al calendario de Contenido, cada uno en su día. Ábrelos allí para ir metiendo el contenido.` : 'Ya estaba todo en el calendario (los días que ya han pasado no se pasan).' });
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
              <button type="button" key={o.id} className={`chip${f.objetivo === o.id ? ' chip-acento' : ''}`} onClick={() => { const nuevo = f.objetivo === o.id ? '' : o.id; const t = nuevo ? o.tipo : f.tipo; setF({ ...f, objetivo: nuevo, tipo: t }); if ((t || 'atraer') !== tipo) setCeldas(null); }}>{o.nombre}</button>
            ))}
          </div>
        </div>
        <div className="est-campo est-ancho">
          <span className="label">Estructura de contenido</span>
          <div className="est-chips">
            {Object.values(data.estructuras).map((x) => <ChipTipo key={x.id} e={x} apagado={tipo !== x.id} onClick={() => cambiarTipo(x.id)} title={x.etiqueta} />)}
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
          <span className="ayuda">{guardadoDias === 'guardando' ? 'Guardando…' : guardadoDias === 'ok' ? '✓ Guardado solo para esta semana' : 'Pulsa + para añadir un botón, o uno para cambiarlo. Se guarda solo.'}</span>
          {(celdas || (s.propia && tipo === s.tipo)) && <button type="button" className="link-btn" onClick={volverAEstructura}>Volver a la estructura</button>}
        </div>
      </div>
      <Tabla filas={filas} nombresFilas={data.filas} dias={data.dias} editable onCambio={cambiarDias} fechas={fechas} piezas={piezas} color={e.color} categorias={data.categorias} />
      {e.pasos?.length > 0 && <ol className="est-pasos">{e.pasos.map((p) => <li key={p}>{p}</li>)}</ol>}

      {r.planificando && <div className="aviso">JARVIS está planificando esta semana: las piezas irán apareciendo en Contenido, cada una en su día.</div>}
      {aviso && <div className={`aviso ${aviso.tipo}`}>{aviso.texto}</div>}
      <div className="est-jarvis">
        <input className="campo" value={indicaciones} onChange={(ev) => setIndicaciones(ev.target.value)} placeholder="Opcional para JARVIS: el tema de la semana, la oferta, qué testimonios tienes…" />
        <button type="button" className="btn" onClick={conJarvis} disabled={Boolean(ocupado) || r.planificando}><Icon name="sparkle" size={14} />{ocupado === 'jarvis' ? 'Enviando…' : 'Que JARVIS proponga los temas'}</button>
      </div>
      <div className="modal-pie">
        <button type="button" className="btn btn-sec" onClick={crearPiezas} disabled={Boolean(ocupado)} title="Cada botón pasa al calendario de Contenido como un hueco en su día, para ir metiendo el contenido">
          <Icon name="calendar" size={14} />{ocupado === 'piezas' ? 'Pasando…' : 'Pasar al calendario'}
        </button>
        <div className="est-semana-btns">
          {!s.porDefecto && <button type="button" className="link-btn" onClick={async () => { await api(`/api/estrategia/semana/${s.lunes}`, { method: 'DELETE' }); recargarAnio(); onClose(); }}>Vaciar la semana</button>}
          <button type="button" className="btn" onClick={() => guardar()} disabled={Boolean(ocupado)}>{ocupado === 'guardar' ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </Modal>
  );
}

// Varias semanas a la vez (un mes, o 2-3 semanas): solo se cambia lo que se toca; los días, si se marca
function SemanasJuntas({ lunes, data, onClose, onHecho }) {
  const [f, setF] = useState({ objetivo: null, tipo: null, detalle: '', tactica: '', campana: '', notas: '' });
  const [tocados, setTocados] = useState(new Set());
  const [conDias, setConDias] = useState(false);
  const [dias, setDias] = useState(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const tipo = f.tipo || data.objetivos.find((o) => o.id === f.objetivo)?.tipo || 'atraer';
  const e = data.estructuras[tipo];
  const poner = (k, v) => { setF((x) => ({ ...x, [k]: v })); setTocados((t) => new Set([...t, k])); };
  const ordenadas = [...lunes].sort();
  const guardar = async () => {
    setGuardando(true); setError('');
    const cambios = {};
    for (const k of tocados) cambios[k] = f[k];
    if ('objetivo' in cambios && !('tipo' in cambios) && f.objetivo) cambios.tipo = tipo;
    if (conDias) { cambios.celdas = dias || e.filas; cambios.tipo = tipo; } else if ('tipo' in cambios) cambios.celdas = null;
    if (!Object.keys(cambios).length) { setGuardando(false); return setError('No has cambiado nada.'); }
    try {
      await api('/api/estrategia/semanas', { method: 'PUT', body: { semanas: ordenadas.map((l) => ({ lunes: l, ...cambios })) } });
      onHecho(`${ordenadas.length} ${ordenadas.length === 1 ? 'semana cambiada' : 'semanas cambiadas'}.`);
    } catch (err) { setError(err.message); setGuardando(false); }
  };
  const campo = (k, ph, max = 120) => <input className="campo" value={f[k]} onChange={(ev) => poner(k, ev.target.value)} placeholder={tocados.has(k) ? '' : `Sin cambiar · p. ej. ${ph}`} maxLength={max} />;
  return (
    <Modal titulo={<><Icon name="calendar" size={15} />Cambiar {ordenadas.length} semanas a la vez · {corta(ordenadas[0])} – {corta(masDias(ordenadas.at(-1), 6))}</>} onClose={onClose} ancho={1180} cerrarFuera={false} clase="est-semana">
      <p className="ayuda">Solo se cambia lo que toques; lo demás se queda como está en cada semana.</p>
      <div className="est-semana-datos">
        <div className="est-campo est-ancho">
          <span className="label">Qué semana es</span>
          <div className="est-chips">
            {data.objetivos.map((o) => <button type="button" key={o.id} className={`chip${f.objetivo === o.id ? ' chip-acento' : ''}`} onClick={() => poner('objetivo', f.objetivo === o.id ? null : o.id)}>{o.nombre}</button>)}
          </div>
        </div>
        <div className="est-campo est-ancho">
          <span className="label">Estructura de contenido</span>
          <div className="est-chips">
            {Object.values(data.estructuras).map((x) => <ChipTipo key={x.id} e={x} apagado={!(tocados.has('tipo') || tocados.has('objetivo')) || tipo !== x.id} onClick={() => { poner('tipo', x.id); setDias(null); }} title={x.etiqueta} />)}
          </div>
        </div>
        <label className="est-campo"><span className="label">Detalle del objetivo</span>{campo('detalle', 'Propósito de Año Nuevo')}</label>
        <label className="est-campo"><span className="label">Táctica</span>
          <input className="campo" list="est-tacticas-v" value={f.tactica} onChange={(ev) => poner('tactica', ev.target.value)} placeholder={tocados.has('tactica') ? '' : 'Sin cambiar'} maxLength={160} />
          <datalist id="est-tacticas-v">{data.tacticas.map((t) => <option key={t} value={t} />)}</datalist>
        </label>
        <label className="est-campo"><span className="label">Campaña o game plan</span>{campo('campana', 'Estrategia de Año Nuevo')}</label>
      </div>
      <label className="est-check-dias"><input type="checkbox" checked={conDias} onChange={(ev) => setConDias(ev.target.checked)} /> Cambiar también los días (directo, post y stories) de todas estas semanas</label>
      {conDias && (
        <>
          <div className="ayuda">Parte de «{e.nombre}». Pulsa + para añadir un botón, o uno para cambiarlo.</div>
          <Tabla filas={dias || e.filas} nombresFilas={data.filas} dias={data.dias} editable onCambio={setDias} color={e.color} categorias={data.categorias} />
        </>
      )}
      {error && <div className="aviso error">{error}</div>}
      <div className="modal-pie">
        <button type="button" className="link-btn" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : `Guardar en las ${ordenadas.length} semanas`}</button>
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
        <Tabla filas={editando.filas} nombresFilas={data.filas} dias={data.dias} editable onCambio={(filas) => setEditando({ ...editando, filas })} color={e.color} categorias={data.categorias} />
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
  const [aviso, setAviso] = useState(null);
  const [pasando, setPasando] = useState(null);
  const [sel, setSel] = useState([]); // semanas elegidas (lunes)
  const [ultima, setUltima] = useState(null);
  const [juntas, setJuntas] = useState(false);
  // Elegir semanas: una a una, un tramo con Mayús, o el mes entero
  const alternar = (lunes, tramo) => {
    if (tramo && ultima && data) {
      const todas = data.semanas.map((x) => x.lunes);
      const [a, b] = [todas.indexOf(ultima), todas.indexOf(lunes)].sort((x, y) => x - y);
      setSel((sl) => [...new Set([...sl, ...todas.slice(a, b + 1)])]);
    } else setSel((sl) => (sl.includes(lunes) ? sl.filter((x) => x !== lunes) : [...sl, lunes]));
    setUltima(lunes);
  };
  const enLote = async (que) => {
    if (que === 'vaciar' && !window.confirm(`¿Vaciar ${sel.length} semanas? Vuelven a ser «semana tipo» (lo que ya pasaste al calendario se queda).`)) return;
    setPasando('lote'); setAviso(null);
    try {
      if (que === 'pasar') {
        const r = await api('/api/estrategia/semanas/piezas', { method: 'POST', body: { lunes: sel } });
        setAviso({ tipo: 'ok', texto: r.creadas ? `${r.creadas} ${r.creadas === 1 ? 'hueco pasado' : 'huecos pasados'} al calendario de Contenido.` : 'Ya estaba todo en el calendario (los días que ya han pasado no se pasan).' });
      } else {
        await api('/api/estrategia/semanas/vaciar', { method: 'POST', body: { lunes: sel } });
        setSel([]); recargar();
      }
    } catch (e) { setAviso({ tipo: 'error', texto: e.message }); }
    setPasando(null);
  };
  // «Pasar al calendario» todo un mes: cada botón de cada día pasa a Contenido como un hueco
  const pasarMes = async (m) => {
    if (!window.confirm(`¿Pasar ${MESES[m].toLowerCase()} al calendario de Contenido? Cada botón de cada día (desde hoy) será un hueco en su día para ir metiendo el contenido. Lo que ya esté pasado no se repite.`)) return;
    setPasando(m); setAviso(null);
    try {
      const r = await api('/api/estrategia/mes', { method: 'POST', body: { anio, mes: m + 1 } });
      setAviso({ tipo: 'ok', texto: r.creadas ? `${MESES[m]}: ${r.creadas} ${r.creadas === 1 ? 'hueco pasado' : 'huecos pasados'} al calendario de Contenido.` : `${MESES[m]} ya estaba en el calendario (los días que ya han pasado no se pasan).` });
    } catch (e) { setAviso({ tipo: 'error', texto: e.message }); }
    setPasando(null);
  };
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
          <div className="ayuda est-ayuda-sel">Marca las casillas para cambiar varias semanas a la vez (Mayús para un tramo).</div>
          <div className="est-leyenda">{Object.values(est).map((e) => <span key={e.id}><i style={{ background: e.color }} />{e.nombre}</span>)}</div>
        </div>
        {aviso && <div className={`aviso ${aviso.tipo}`} style={{ marginBottom: 10 }}>{aviso.texto}<button className="link-btn" onClick={() => setAviso(null)}>Cerrar</button></div>}
        <div className="est-meses">
          {porMes.map((semanas, m) => (
            <div key={MESES[m]} className="est-mes">
              <div className="est-mes-nombre">
                <span>{MESES[m]}</span>
                {semanas.length > 0 && (
                  <span className="est-mes-acciones">
                    <button type="button" className="link-btn" onClick={() => { const ls = semanas.map((x) => x.lunes); const todas = ls.every((l) => sel.includes(l)); setSel((sl) => (todas ? sl.filter((l) => !ls.includes(l)) : [...new Set([...sl, ...ls])])); }}>
                      {semanas.every((x) => sel.includes(x.lunes)) ? 'Quitar el mes' : 'Elegir el mes'}
                    </button>
                    <button type="button" className="link-btn" onClick={() => pasarMes(m)} disabled={pasando != null}><Icon name="calendar" size={11} /> {pasando === m ? 'Pasando…' : 'Pasar al calendario'}</button>
                  </span>
                )}
              </div>
              {semanas.map((s, i) => {
                const e = est[s.tipo];
                return (
                  <div key={s.lunes} className={`est-fila-caja${sel.includes(s.lunes) ? ' elegida' : ''}`}>
                  <label className="est-check" title="Elegir para cambiar varias semanas a la vez (Mayús: un tramo)" onClick={(ev) => { ev.preventDefault(); alternar(s.lunes, ev.shiftKey); }}>
                    <input type="checkbox" checked={sel.includes(s.lunes)} readOnly tabIndex={-1} />
                  </label>
                  <button type="button" className={`est-fila${s.porDefecto ? ' por-defecto' : ''}${s.lunes === data.estaSemana ? ' hoy' : ''}`} style={{ '--c': e.color }} onClick={() => setAbierta(s.lunes)}>
                    <span className="est-fila-s">S{i + 1}</span>
                    <span className="est-fila-fechas">{corta(s.lunes)} – {corta(s.domingo)}</span>
                    <span className="est-fila-tipo"><i />{e.nombre}</span>
                    <span className="est-fila-obj">{objetivo(s) || (s.porDefecto ? <span className="t-dim" title="Sin marcar: es la semana tipo (atraer audiencia)">Sin marcar</span> : '')}{s.detalle ? ` · ${s.detalle}` : ''}</span>
                    <span className="est-fila-tac">{s.tactica || ''}</span>
                    <span className="est-fila-camp">{s.campana || ''}{s.propia ? ' ✎' : ''}</span>
                  </button>
                  </div>
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
        <div className="est-botones-titulo"><span className="label">Botones que puedes poner</span><span className="ayuda">Los tipos de contenido de cada fila. Añade los tuyos o quita los que no uses.</span></div>
        <Categorias data={data} recargar={recargar} />
        <Estructura key={verEstructura + (est[verEstructura].cambiada ? '-c' : '')} e={est[verEstructura]} data={data} recargar={recargar} />
      </section>

      {sel.length > 0 && (
        <div className="est-lote">
          <b>{sel.length} {sel.length === 1 ? 'semana elegida' : 'semanas elegidas'}</b>
          <button type="button" className="btn" onClick={() => setJuntas(true)}><Icon name="pen" size={14} />Cambiarlas juntas</button>
          <button type="button" className="btn btn-sec" onClick={() => enLote('pasar')} disabled={pasando != null}><Icon name="calendar" size={14} />{pasando === 'lote' ? 'Pasando…' : 'Pasar al calendario'}</button>
          <button type="button" className="link-btn" onClick={() => enLote('vaciar')} disabled={pasando != null}>Vaciar</button>
          <button type="button" className="link-btn" onClick={() => setSel([])}>Quitar la selección</button>
        </div>
      )}
      {juntas && <SemanasJuntas lunes={sel} data={data} onClose={() => setJuntas(false)} onHecho={(t) => { setJuntas(false); setSel([]); setAviso({ tipo: 'ok', texto: t }); recargar(); }} />}
      {abierta && <Semana key={abierta} lunes={abierta} data={data} onClose={() => setAbierta(null)} recargarAnio={recargar} />}
    </div>
  );
}
