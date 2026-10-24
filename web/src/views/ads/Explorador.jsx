import { useMemo, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import LineChart from '../../components/charts/LineChart.jsx';
import { Modal } from '../contenido/comun.jsx';
import { api, useRecurso } from '../../lib/api.js';
import { numLargo } from '../../lib/formato.js';

// El Administrador de anuncios dentro de JARVIS: cualquier cuenta de tus Business Manager, sus campañas, conjuntos y
// anuncios con las métricas que elijas, y el detalle de cada uno. Solo lee: los cambios se hacen en Meta.

const NIVELES = [['campanas', 'Campañas'], ['conjuntos', 'Conjuntos de anuncios'], ['anuncios', 'Anuncios']];
const SINGULAR = { campanas: 'campaña', conjuntos: 'conjunto', anuncios: 'anuncio' };
const PRESETS = {
  Rendimiento: ['estado', 'resultados', 'coste_resultado', 'gasto', 'impresiones', 'alcance', 'frecuencia', 'ctr_enlace', 'cpc_enlace', 'cpm', 'presupuesto'],
  Interacción: ['estado', 'gasto', 'interacciones', 'coste_interaccion', 'reacciones', 'comentarios', 'compartidos', 'guardados', 'ctr', 'cpm'],
  Vídeo: ['estado', 'gasto', 'impresiones', 'reproducciones', 'hook_rate', 'thruplay', 'hold_rate', 'coste_thruplay', 'p25', 'p50', 'p75', 'p100', 'tiempo_medio'],
  'Leads y mensajes': ['estado', 'gasto', 'leads', 'coste_lead', 'conversaciones', 'coste_conversacion', 'registros', 'clics_enlace', 'ctr_enlace', 'cpc_enlace'],
  Ventas: ['estado', 'gasto', 'compras', 'coste_compra', 'valor_compras', 'roas', 'anadir_carrito', 'pagos_iniciados', 'ctr_enlace', 'cpm'],
};
const COLOR_ESTADO = { ACTIVE: 'on', PAUSED: 'warn', CAMPAIGN_PAUSED: 'warn', ADSET_PAUSED: 'warn', WITH_ISSUES: 'warn', DISAPPROVED: 'warn', PENDING_REVIEW: 'warn', IN_PROCESS: 'warn' };

const dinero = (v, moneda) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: moneda || 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
export function formatear(v, formato, moneda) {
  if (v == null || v === '') return '—';
  switch (formato) {
    case 'moneda': return dinero(v, moneda);
    case 'n': return numLargo(v);
    case 'pct': return `${Number(v).toLocaleString('es-ES', { maximumFractionDigits: 2 })} %`;
    case 'dec': return Number(v).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'seg': return `${Number(v).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`;
    case 'fecha': return new Date(v).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' });
    case 'presupuesto': return v.tipo === 'campaña' ? 'De la campaña' : `${dinero(v.valor, moneda)}${v.tipo === 'diario' ? ' / día' : ' total'}`;
    default: return String(v);
  }
}
const valorDe = (f, col) => (col.startsWith('accion:') ? f.acciones?.[col.slice(7)] ?? 0 : f.m?.[col]);
const ordenable = (v) => (v && typeof v === 'object' ? v.valor ?? -1 : v);

function Estado({ f }) {
  return <span className="status"><span className={`dot ${COLOR_ESTADO[f.efectivo] || 'off'}`} />{f.m.estado}</span>;
}

// ---------- Elegir columnas ----------
function ElegirColumnas({ catalogo, elegidas, onGuardar, onClose }) {
  const [sel, setSel] = useState(elegidas);
  const [buscar, setBuscar] = useState('');
  const [guardando, setGuardando] = useState(false);
  const porId = new Map(catalogo.map((c) => [c.id, c]));
  const grupos = useMemo(() => {
    const g = new Map();
    const b = buscar.trim().toLowerCase();
    for (const c of catalogo) {
      if (b && !`${c.nombre} ${c.tecnico || ''}`.toLowerCase().includes(b)) continue;
      if (!g.has(c.grupo)) g.set(c.grupo, []);
      g.get(c.grupo).push(c);
    }
    return [...g];
  }, [catalogo, buscar]);
  const cambiar = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const mover = (i, d) => setSel((s) => { const o = [...s]; const j = i + d; if (j < 0 || j >= o.length) return s; [o[i], o[j]] = [o[j], o[i]]; return o; });
  const guardar = async () => { setGuardando(true); try { await onGuardar(sel); onClose(); } finally { setGuardando(false); } };
  return (
    <Modal titulo={<><Icon name="layers" size={14} />Columnas</>} onClose={onClose} ancho={860}>
      <div className="exp-presets">
        <span className="ayuda">Rápidas:</span>
        {Object.entries(PRESETS).map(([k, v]) => <button key={k} className="btn btn-sec" onClick={() => setSel(v)}>{k}</button>)}
      </div>
      <div className="exp-columnas">
        <div className="exp-col-catalogo">
          <input className="campo" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar una métrica…" aria-label="Buscar una métrica" />
          {grupos.map(([g, cols]) => (
            <fieldset key={g}>
              <legend>{g}</legend>
              {cols.map((c) => (
                <label key={c.id} title={c.tecnico || ''}>
                  <input type="checkbox" checked={sel.includes(c.id)} onChange={() => cambiar(c.id)} />{c.nombre}
                </label>
              ))}
            </fieldset>
          ))}
          {!grupos.length && <div className="vacio">Ninguna métrica con ese nombre.</div>}
        </div>
        <div className="exp-col-elegidas">
          <div className="label">En la tabla ({sel.length}), en este orden</div>
          {sel.map((id, i) => (
            <div key={id} className="exp-col-item">
              <span>{porId.get(id)?.nombre || id.replace(/^accion:/, '')}</span>
              <button className="icon-btn" onClick={() => mover(i, -1)} disabled={!i} aria-label="Subir">↑</button>
              <button className="icon-btn" onClick={() => mover(i, 1)} disabled={i === sel.length - 1} aria-label="Bajar">↓</button>
              <button className="icon-btn" onClick={() => cambiar(id)} aria-label="Quitar">✕</button>
            </div>
          ))}
          {!sel.length && <div className="vacio">Elige al menos una.</div>}
        </div>
      </div>
      <div className="modal-pie">
        <span className="ayuda">Se guardan para todas tus pantallas (ordenador y móvil).</span>
        <button className="btn" onClick={guardar} disabled={!sel.length || guardando}>{guardando ? 'Guardando…' : 'Aplicar'}</button>
      </div>
    </Modal>
  );
}

// ---------- Detalle de una campaña, conjunto o anuncio ----------
const SERIES = [['gasto', 'Gasto', 'moneda'], ['resultados', 'Resultados', 'n'], ['coste_resultado', 'Coste por resultado', 'moneda'], ['impresiones', 'Impresiones', 'n'],
  ['clics_enlace', 'Clics en el enlace', 'n'], ['ctr_enlace', 'CTR del enlace', 'pct'], ['cpc_enlace', 'CPC del enlace', 'moneda'], ['cpm', 'CPM', 'moneda']];
const DESGLOSES = [['edad', 'Edad'], ['sexo', 'Sexo'], ['ubicacion', 'Ubicación'], ['dispositivo', 'Dispositivo']];
const COLS_DESGLOSE = [['gasto', 'Gasto', 'moneda'], ['impresiones', 'Impresiones', 'n'], ['alcance', 'Alcance', 'n'], ['ctr_enlace', 'CTR enlace', 'pct'], ['cpc_enlace', 'CPC enlace', 'moneda'], ['cpm', 'CPM', 'moneda'], ['resultados', 'Resultados', 'n'], ['coste_resultado', '€/result.', 'moneda']];
const CTA = { LEARN_MORE: 'Más información', SIGN_UP: 'Registrarte', DOWNLOAD: 'Descargar', SEND_MESSAGE: 'Enviar mensaje', MESSAGE_PAGE: 'Enviar mensaje', SHOP_NOW: 'Comprar', BOOK_TRAVEL: 'Reservar', CONTACT_US: 'Contactar', APPLY_NOW: 'Solicitar', GET_OFFER: 'Ver oferta', SUBSCRIBE: 'Suscribirte', WATCH_MORE: 'Ver más', INSTAGRAM_MESSAGE: 'Enviar mensaje', WHATSAPP_MESSAGE: 'WhatsApp', NO_BUTTON: 'Sin botón' };

function Detalle({ nivel, id, filtro, catalogo, onClose, onBajar }) {
  const [d, , error] = useRecurso(`/api/ads/explorar/${nivel}/${id}?${filtro}`, null);
  const [serie, setSerie] = useState('gasto');
  const [desglose, setDesglose] = useState('edad');
  const moneda = d?.moneda;
  const f = d?.fila;
  const titulo = <><Icon name={nivel === 'anuncios' ? 'eye' : 'layers'} size={14} />{f?.nombre || `Detalle del ${SINGULAR[nivel]}`}</>;
  if (!d) return <Modal titulo={titulo} onClose={onClose} ancho={1000}>{error ? <div className="aviso error">{error}</div> : <div className="t-dim">Cargando lo que dice Meta…</div>}</Modal>;
  const [, nombreSerie, formatoSerie] = SERIES.find((s) => s[0] === serie);
  const grupos = new Map();
  for (const c of catalogo) {
    const v = valorDe(f, c.id);
    if (v == null || v === 0 || v === '' || c.grupo === 'Configuración') continue;
    if (!grupos.has(c.grupo)) grupos.set(c.grupo, []);
    grupos.get(c.grupo).push([c, v]);
  }
  const conf = catalogo.filter((c) => c.grupo === 'Configuración' && f.m[c.id] != null);
  const filasDesglose = d.desgloses[desglose];
  const maxGasto = Math.max(1, ...(filasDesglose || []).map((x) => x.m.gasto));
  const cr = d.creativo;
  const kpis = [['resultados', f.m.tipoResultado ? `Resultados · ${f.m.tipoResultado}` : 'Resultados', 'n'], ['coste_resultado', 'Coste por resultado', 'moneda'], ['gasto', 'Importe gastado', 'moneda'],
    ['impresiones', 'Impresiones', 'n'], ['alcance', 'Alcance', 'n'], ['ctr_enlace', 'CTR del enlace', 'pct']];

  return (
    <Modal titulo={titulo} onClose={onClose} ancho={1000}>
      {d.demo && <div className="aviso">Es un ejemplo: conecta tu cuenta para ver tus datos.</div>}
      <div className="exp-det-cabecera">
        <Estado f={f} />
        {f.campana?.nombre && <span className="ayuda">Campaña: <b>{f.campana.nombre}</b></span>}
        {f.conjunto?.nombre && <span className="ayuda">Conjunto: <b>{f.conjunto.nombre}</b></span>}
        <span className="exp-det-enlaces">
          {nivel !== 'anuncios' && <button className="link-btn" onClick={() => onBajar(f)}>Ver sus {nivel === 'campanas' ? 'conjuntos' : 'anuncios'} →</button>}
          {d.vistaPrevia && <a className="link-btn" href={d.vistaPrevia} target="_blank" rel="noreferrer">Vista previa del anuncio</a>}
          {cr?.instagram && <a className="link-btn" href={cr.instagram} target="_blank" rel="noreferrer">Ver en Instagram</a>}
          {!d.demo && <a className="link-btn" href={f.enlace} target="_blank" rel="noreferrer">Abrir en el Administrador de anuncios</a>}
        </span>
      </div>

      <div className={`exp-det-arriba${cr ? ' con-creativo' : ''}`}>
        {cr && (
          <div className="exp-creativo">
            {cr.imagen ? <img src={cr.imagen} alt="" loading="lazy" /> : <div className="exp-creativo-vacio"><Icon name={cr.video ? 'play' : 'eye'} size={22} /></div>}
            {cr.texto && <p className="exp-creativo-texto">{cr.texto}</p>}
            {(cr.titulo || cr.cta) && <div className="exp-creativo-pie"><b>{cr.titulo}</b>{cr.cta && <span className="tag">{CTA[cr.cta] || cr.cta}</span>}</div>}
            {cr.descripcion && <span className="ayuda">{cr.descripcion}</span>}
            {cr.enlace && <a className="link-btn" href={cr.enlace} target="_blank" rel="noreferrer">{cr.enlace.replace(/^https?:\/\//, '').slice(0, 60)}</a>}
            {cr.carrusel?.length > 0 && <span className="ayuda">Carrusel de {cr.carrusel.length} tarjetas</span>}
          </div>
        )}
        <div className="exp-det-datos">
          <div className="exp-kpis">
            {kpis.map(([k, l, fo]) => <div key={k} className="exp-kpi"><span className="label">{l}</span><b>{formatear(f.m[k], fo, moneda)}</b></div>)}
          </div>
          <div className="panel-head" style={{ marginTop: 12 }}>
            <span className="label">Día a día</span>
            <select className="campo exp-select" value={serie} onChange={(e) => setSerie(e.target.value)} aria-label="Métrica del gráfico">
              {SERIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          {d.diario.length > 1
            ? <LineChart datos={d.diario.map((x) => ({ fecha: x.fecha, v: x.m[serie] || 0 }))} campo="v" etiqueta={formatoSerie === 'moneda' ? `${nombreSerie} (${moneda})` : nombreSerie} alto={170} />
            : <div className="vacio">Sin datos por día en este periodo.</div>}
        </div>
      </div>

      {d.segmentacion && (
        <div className="exp-bloque">
          <div className="label">A quién se dirige</div>
          <div className="exp-segmentacion">
            <span><b>Edad</b> {d.segmentacion.edad}</span><span><b>Sexo</b> {d.segmentacion.genero}</span>
            {d.segmentacion.lugares.length > 0 && <span><b>Lugares</b> {d.segmentacion.lugares.join(', ')}</span>}
            {d.segmentacion.advantage && <span><b>Público Advantage+</b> activado</span>}
            {d.segmentacion.intereses.length > 0 && <span><b>Intereses</b> {d.segmentacion.intereses.join(', ')}</span>}
            {d.segmentacion.publicos.length > 0 && <span><b>Públicos</b> {d.segmentacion.publicos.join(', ')}</span>}
            {d.segmentacion.excluidos.length > 0 && <span><b>Excluye</b> {d.segmentacion.excluidos.join(', ')}</span>}
            {d.segmentacion.posiciones.length > 0 && <span><b>Ubicaciones</b> {d.segmentacion.posiciones.join(', ')}</span>}
          </div>
        </div>
      )}

      <div className="exp-bloque">
        <div className="panel-head">
          <span className="label">Reparto</span>
          <div className="seg">{DESGLOSES.map(([k, l]) => <button key={k} className={desglose === k ? 'on' : ''} onClick={() => setDesglose(k)}>{l}</button>)}</div>
        </div>
        {filasDesglose == null ? <div className="vacio">Meta no ha dado este reparto.</div> : !filasDesglose.length ? <div className="vacio">Sin datos en este periodo.</div> : (
          <div className="tabla-scroll">
            <table className="tabla exp-desglose">
              <thead><tr><th>{DESGLOSES.find((x) => x[0] === desglose)[1]}</th>{COLS_DESGLOSE.map(([k, l]) => <th key={k} className="n">{l}</th>)}</tr></thead>
              <tbody>
                {filasDesglose.map((x) => (
                  <tr key={x.clave}>
                    <td><span className="exp-barra" style={{ '--p': `${(x.m.gasto / maxGasto) * 100}%` }}>{x.clave}</span></td>
                    {COLS_DESGLOSE.map(([k, , fo]) => <td key={k} className="n">{formatear(x.m[k], fo, moneda)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="exp-bloque">
        <div className="label">Todas sus métricas</div>
        <div className="exp-todas">
          {conf.length > 0 && (
            <div><div className="exp-grupo">Configuración</div>{conf.map((c) => <div key={c.id} className="exp-par"><span>{c.nombre}</span><b>{formatear(f.m[c.id], c.formato, moneda)}</b></div>)}</div>
          )}
          {[...grupos].map(([g, pares]) => (
            <div key={g}><div className="exp-grupo">{g}</div>{pares.map(([c, v]) => <div key={c.id} className="exp-par"><span>{c.nombre}</span><b>{formatear(v, c.formato, moneda)}</b></div>)}</div>
          ))}
          {Object.keys(f.acciones || {}).length > 0 && (
            <div><div className="exp-grupo">Todas las acciones de Meta</div>{Object.entries(f.acciones).sort((a, b) => b[1] - a[1]).map(([t, v]) => <div key={t} className="exp-par" title={t}><span>{catalogo.find((c) => c.id === `accion:${t}`)?.nombre || t}</span><b>{numLargo(v)}</b></div>)}</div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ---------- La tabla ----------
export default function Explorador() {
  const [cuenta, setCuenta] = useState('');
  const [nivel, setNivel] = useState('campanas');
  const [campana, setCampana] = useState(null);
  const [conjunto, setConjunto] = useState(null);
  const [periodo, setPeriodo] = useState('last_30d');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [archivadas, setArchivadas] = useState(false);
  const [soloActivas, setSoloActivas] = useState(false);
  const [conGasto, setConGasto] = useState(false);
  const [buscar, setBuscar] = useState('');
  const [orden, setOrden] = useState({ col: 'gasto', dir: -1 });
  const [viendo, setViendo] = useState(null);
  const [eligiendo, setEligiendo] = useState(false);
  const [limite, setLimite] = useState(100);
  const [actualizando, setActualizando] = useState(false);
  const [aviso, setAviso] = useState('');

  const [cols, , , setCols] = useRecurso('/api/ads/columnas', null);
  const [cuentas] = useRecurso('/api/ads/negocio/cuentas', null);
  const personalizado = periodo === 'personalizado';
  const filtro = new URLSearchParams({
    ...(cuenta ? { cuenta } : {}),
    ...(personalizado ? (desde && hasta ? { desde, hasta } : {}) : { periodo }),
  }).toString();
  const params = new URLSearchParams({ nivel, ...(campana && nivel !== 'campanas' ? { campana: campana.id } : {}), ...(conjunto && nivel === 'anuncios' ? { conjunto: conjunto.id } : {}), ...(archivadas ? { archivadas: '1' } : {}) });
  const url = personalizado && !(desde && hasta) ? null : `/api/ads/explorar?${params}&${filtro}`;
  const [data, recargar, error] = useRecurso(url, null);
  const listo = data && data.nivel === nivel;

  const catalogo = useMemo(() => [...(cols?.catalogo || []), ...(data?.columnasAcciones || [])], [cols, data]);
  const porId = useMemo(() => new Map(catalogo.map((c) => [c.id, c])), [catalogo]);
  const elegidas = (cols?.elegidas || []).filter((c) => porId.has(c) || c.startsWith('accion:'));
  const moneda = data?.cuenta?.moneda || 'EUR';

  const filas = useMemo(() => {
    if (!listo) return [];
    const b = buscar.trim().toLowerCase();
    let l = data.filas.filter((f) => (!b || `${f.nombre} ${f.id}`.toLowerCase().includes(b)) && (!soloActivas || f.activo) && (!conGasto || f.m.gasto > 0));
    const { col, dir } = orden;
    l = [...l].sort((a, z) => {
      const x = col === 'nombre' ? a.nombre : ordenable(valorDe(a, col)), y = col === 'nombre' ? z.nombre : ordenable(valorDe(z, col));
      if (typeof x === 'string' || typeof y === 'string') return String(x ?? '').localeCompare(String(y ?? '')) * dir;
      return ((x ?? -Infinity) - (y ?? -Infinity)) * dir || 0;
    });
    return l;
  }, [listo, data, buscar, soloActivas, conGasto, orden]);

  const ordenar = (col) => setOrden((o) => ({ col, dir: o.col === col ? -o.dir : col === 'nombre' ? 1 : -1 }));
  const irA = (n) => { setNivel(n); setLimite(100); };
  const bajar = (f) => {
    setViendo(null);
    if (f.nivel === 'campanas') { setCampana({ id: f.id, nombre: f.nombre }); setConjunto(null); irA('conjuntos'); }
    else if (f.nivel === 'conjuntos') { setConjunto({ id: f.id, nombre: f.nombre }); if (f.campana) setCampana({ id: f.campana.id, nombre: f.campana.nombre }); irA('anuncios'); }
    else setViendo(f);
  };
  const guardarColumnas = async (lista) => { try { setCols(await api('/api/ads/columnas', { method: 'PUT', body: { columnas: lista } })); } catch (e) { setAviso(e.message); throw e; } };
  const actualizar = async () => {
    if (!url) return;
    setActualizando(true);
    try { await api(`${url}&forzar=1`); recargar(); setAviso(''); } catch (e) { setAviso(e.message); } finally { setActualizando(false); }
  };
  const hacerPrincipal = async () => { try { await api('/api/ads/cuenta', { method: 'POST', body: { id: cuenta } }); setCuenta(''); } catch (e) { setAviso(e.message); } };

  const nombreNivel = NIVELES.find((x) => x[0] === nivel)[1];
  const visibles = filas.slice(0, limite);

  return (
    <div className="panel panel-pad explorador">
      <div className="panel-head">
        <div>
          <span className="label">Administrador de anuncios</span>
          <div className="ayuda">{data?.cuenta ? <>{data.cuenta.negocio ? `${data.cuenta.negocio} · ` : ''}{data.cuenta.nombre}{data.demo ? ' · datos de ejemplo' : ''}</> : 'Todas tus cuentas, campañas, conjuntos y anuncios'}</div>
        </div>
        <div className="panel-head-der">
          <button className="btn btn-sec" onClick={() => setEligiendo(true)} disabled={!cols}><Icon name="layers" size={14} />Columnas</button>
          {!data?.demo && <button className="btn btn-sec" onClick={actualizar} disabled={actualizando || !url}><Icon name="refresh" size={14} />{actualizando ? 'Actualizando…' : 'Actualizar'}</button>}
        </div>
      </div>

      <div className="exp-barra-filtros">
        {cuentas?.grupos?.length > 0 && (
          <select className="campo exp-select" value={cuenta} onChange={(e) => { setCuenta(e.target.value); setCampana(null); setConjunto(null); irA('campanas'); }} aria-label="Cuenta publicitaria">
            <option value="">{cuentas.porDefecto ? 'Tu cuenta principal' : 'Elige una cuenta…'}</option>
            {cuentas.grupos.map((g) => (
              <optgroup key={g.negocio?.id || 'propias'} label={g.negocio ? `Business: ${g.negocio.nombre}` : 'Tus cuentas'}>
                {g.cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({c.id.replace('act_', '')}){c.activa ? '' : ' · inactiva'}{c.id === cuentas.porDefecto ? ' · principal' : ''}</option>)}
              </optgroup>
            ))}
          </select>
        )}
        <select className="campo exp-select" value={periodo} onChange={(e) => setPeriodo(e.target.value)} aria-label="Periodo">
          {Object.entries(cols?.periodos || { last_30d: 'Últimos 30 días' }).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          <option value="personalizado">Personalizado…</option>
        </select>
        {personalizado && (
          <span className="exp-fechas">
            <input type="date" className="campo" value={desde} onChange={(e) => setDesde(e.target.value)} aria-label="Desde" />
            <input type="date" className="campo" value={hasta} onChange={(e) => setHasta(e.target.value)} aria-label="Hasta" />
          </span>
        )}
        <input className="campo exp-buscar" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder={`Buscar ${nombreNivel.toLowerCase()}…`} aria-label="Buscar por nombre" />
        <label className="exp-check"><input type="checkbox" checked={soloActivas} onChange={(e) => setSoloActivas(e.target.checked)} />Solo activas</label>
        <label className="exp-check"><input type="checkbox" checked={conGasto} onChange={(e) => setConGasto(e.target.checked)} />Con gasto</label>
        <label className="exp-check"><input type="checkbox" checked={archivadas} onChange={(e) => setArchivadas(e.target.checked)} />Archivadas</label>
      </div>
      {cuenta && cuentas?.porDefecto !== cuenta && !data?.demo && <div className="ayuda" style={{ marginBottom: 8 }}>Estás viendo otra cuenta. <button className="link-btn" onClick={hacerPrincipal}>Usarla como cuenta principal de JARVIS</button></div>}

      <div className="exp-niveles">
        {NIVELES.map(([k, l]) => (
          <button key={k} className={`exp-nivel${nivel === k ? ' on' : ''}`} onClick={() => irA(k)}>
            <Icon name={k === 'campanas' ? 'folder' : k === 'conjuntos' ? 'layers' : 'eye'} size={13} />{l}
            {listo && nivel === k && <span className="tag">{filas.length}</span>}
          </button>
        ))}
        {campana && (
          <span className="exp-filtro">Campaña: <b>{campana.nombre}</b><button className="icon-btn" onClick={() => { setCampana(null); setConjunto(null); }} aria-label="Quitar filtro de campaña">✕</button></span>
        )}
        {conjunto && (
          <span className="exp-filtro">Conjunto: <b>{conjunto.nombre}</b><button className="icon-btn" onClick={() => setConjunto(null)} aria-label="Quitar filtro de conjunto">✕</button></span>
        )}
      </div>

      {(aviso || error) && <div className="aviso error">{aviso || error}</div>}
      {personalizado && !(desde && hasta) && <div className="vacio">Elige las dos fechas.</div>}
      {url && !listo && !error && <div className="vacio">Pidiendo los datos a Meta…</div>}
      {listo && (
        <div className="tabla-scroll exp-scroll">
          <table className="tabla exp-tabla" style={{ minWidth: 320 + elegidas.length * 118 }}>
            <thead>
              <tr>
                <th className="exp-fijo"><button onClick={() => ordenar('nombre')}>{nombreNivel}{orden.col === 'nombre' ? (orden.dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>
                {elegidas.map((c) => {
                  const col = porId.get(c) || { nombre: c.replace(/^accion:/, ''), formato: 'n' };
                  return <th key={c} className={col.formato === 'texto' ? '' : 'n'}><button onClick={() => ordenar(c)} title={col.tecnico || col.nombre}>{col.nombre}{orden.col === c ? (orden.dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>;
                })}
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => (
                <tr key={f.id}>
                  <td className="exp-fijo">
                    <div className="exp-nombre">
                      {f.nivel === 'anuncios' && (f.miniatura ? <img src={f.miniatura} alt="" loading="lazy" /> : <span className="exp-mini-vacia"><Icon name="eye" size={12} /></span>)}
                      <div>
                        <button className="exp-nombre-btn" onClick={() => bajar(f)} title={f.nivel === 'anuncios' ? 'Ver el anuncio y sus métricas' : `Ver sus ${f.nivel === 'campanas' ? 'conjuntos' : 'anuncios'}`}>{f.nombre}</button>
                        {f.nivel !== 'campanas' && <div className="ayuda exp-padre">{[!campana && f.campana?.nombre, f.nivel === 'anuncios' && !conjunto && f.conjunto?.nombre].filter(Boolean).join(' › ')}</div>}
                      </div>
                      <span className="exp-acciones">
                        {f.nivel !== 'anuncios' && <button className="icon-btn" onClick={() => setViendo(f)} title="Detalle y métricas" aria-label="Detalle y métricas"><Icon name="chart" size={13} /></button>}
                        {!data.demo && <a className="icon-btn" href={f.enlace} target="_blank" rel="noreferrer" title="Abrir en el Administrador de anuncios" aria-label="Abrir en Meta"><Icon name="link" size={13} /></a>}
                      </span>
                    </div>
                  </td>
                  {elegidas.map((c) => {
                    const col = porId.get(c) || { formato: 'n' };
                    if (c === 'estado') return <td key={c}><Estado f={f} /></td>;
                    const v = valorDe(f, c);
                    return <td key={c} className={col.formato === 'texto' ? '' : 'n'} title={c === 'resultados' && f.m.tipoResultado ? f.m.tipoResultado : undefined}>
                      {formatear(v, col.formato, moneda)}
                      {c === 'resultados' && f.m.tipoResultado && v > 0 && <div className="ayuda">{f.m.tipoResultado}</div>}
                    </td>;
                  })}
                </tr>
              ))}
            </tbody>
            {data.total && filas.length > 0 && (
              <tfoot>
                <tr>
                  <td className="exp-fijo"><b>Total</b> <span className="ayuda">{campana && nivel !== 'campanas' ? (conjunto && nivel === 'anuncios' ? 'del conjunto' : 'de la campaña') : 'de la cuenta'}</span></td>
                  {elegidas.map((c) => {
                    const col = porId.get(c) || { formato: 'n' };
                    const v = c.startsWith('accion:') ? data.total.acciones?.[c.slice(7)] : data.total.m[c];
                    return <td key={c} className={col.formato === 'texto' ? '' : 'n'}>{col.formato === 'texto' || col.formato === 'fecha' || col.formato === 'presupuesto' ? '' : formatear(v, col.formato, moneda)}</td>;
                  })}
                </tr>
              </tfoot>
            )}
          </table>
          {!filas.length && <div className="vacio">{data.filas.length ? 'Nada con estos filtros.' : `No hay ${nombreNivel.toLowerCase()} aquí.`}</div>}
          {filas.length > limite && <div className="vacio"><button className="btn btn-sec" onClick={() => setLimite((x) => x + 200)}>Ver más ({filas.length - limite})</button></div>}
        </div>
      )}
      {listo && <div className="ayuda exp-pie">Los datos vienen de Meta y se guardan 10 minutos. Pulsa en un nombre para bajar de nivel; en un anuncio, para ver el creativo y todas sus métricas.</div>}

      {eligiendo && cols && <ElegirColumnas catalogo={catalogo} elegidas={elegidas} onGuardar={guardarColumnas} onClose={() => setEligiendo(false)} />}
      {viendo && <Detalle nivel={viendo.nivel} id={viendo.id} filtro={filtro} catalogo={catalogo} onClose={() => setViendo(null)} onBajar={bajar} />}
    </div>
  );
}
