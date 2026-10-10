import { useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import Sparkline from '../components/Sparkline.jsx';
import LineChart from '../components/charts/LineChart.jsx';
import Donut from '../components/charts/Donut.jsx';
import { api, normaliza, useRecurso } from '../lib/api.js';
import { fechaCorta, hace, num, numLargo, segundos } from '../lib/formato.js';

// Colores de formato validados para el fondo oscuro (separación para daltonismo y contraste)
const COLOR_FORMATO = { Reels: '#3987e5', Carruseles: '#d95926', 'Imágenes': '#199e70' };
const SERIES = [
  { id: 'alcance', label: 'Alcance' },
  { id: 'views', label: 'Visualizaciones' },
  { id: 'nuevos', label: 'Nuevos seguidores' },
];
const resolver = (c) => (c.startsWith('var(') ? getComputedStyle(document.documentElement).getPropertyValue(c.slice(4, -1)).trim() : c);

function Kpi({ k }) {
  const up = (k.delta ?? 0) >= 0;
  return (
    <div className="panel ig-kpi">
      <div className="ig-kpi-top">
        <span className="kpi-icon peque" style={{ background: `color-mix(in srgb, ${k.color} 16%, transparent)`, color: k.color }}><Icon name={k.icon} size={14} /></span>
        <span className="label">{k.label}</span>
      </div>
      <div className="ig-kpi-valor">
        {num(k.value)}
        {k.delta != null && <span className={`delta ${up ? 'up' : 'down'}`}>{up ? '▲' : '▼'} {Math.abs(k.delta)}%</span>}
        {k.extra != null && <span className="delta up">+{num(k.extra)}</span>}
      </div>
      <Sparkline data={k.series.length > 1 ? k.series : [0, 0]} color={resolver(k.color)} height={26} />
    </div>
  );
}

function Conectar({ estado, onHecho }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const pegar = async (e) => {
    e.preventDefault();
    setEnviando(true); setError('');
    try { await api('/api/instagram/token', { method: 'POST', body: { token } }); setToken(''); onHecho(); } catch (err) { setError(err.message); } finally { setEnviando(false); }
  };
  return (
    <div className="panel panel-pad ig-conectar">
      <div className="ig-conectar-txt">
        <span className="ig-logo"><Icon name="instagram" size={22} /></span>
        <div>
          <b>Conecta tu Instagram para ver tus datos reales</b>
          <p>Mientras tanto ves datos de ejemplo. Al conectar, JARVIS sincroniza tus publicaciones cada 6 horas{estado.transcripcion.activa ? ' y transcribe tus reels para aprender cómo hablas.' : '. Con ElevenLabs configurado, además transcribe tus reels.'}</p>
        </div>
      </div>
      <div className="ig-conectar-acciones">
        {estado.appConfigurada
          ? <a className="btn" href="/api/instagram/conectar"><Icon name="link" size={14} />Conectar con Facebook</a>
          : <span className="ayuda">Para el botón de conexión, añade META_APP_ID y META_APP_SECRET en .env (guía en docs/INSTAGRAM.md).</span>}
        <form className="fila" onSubmit={pegar} style={{ margin: 0 }}>
          <input className="campo" value={token} onChange={(e) => setToken(e.target.value)} placeholder="…o pega un token de acceso de Meta" aria-label="Token de acceso de Meta" />
          <button className="btn btn-sec" disabled={!token.trim() || enviando}>{enviando ? 'Conectando…' : 'Conectar'}</button>
        </form>
        {error && <div className="aviso-error">{error}</div>}
      </div>
    </div>
  );
}

function TablaContenido({ piezas, medias }) {
  const [q, setQ] = useState('');
  const [orden, setOrden] = useState({ campo: 'fecha', desc: true });
  const filas = useMemo(() => {
    const n = normaliza(q.trim());
    const l = piezas.filter((p) => !n || normaliza(`${p.caption || ''} ${p.tema || ''} ${p.gancho || ''} ${p.formato}`).includes(n));
    return [...l].sort((a, b) => {
      const va = a[orden.campo] ?? -1, vb = b[orden.campo] ?? -1;
      const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return orden.desc ? -c : c;
    });
  }, [piezas, q, orden]);
  const th = (campo, label, num = true) => (
    <th className={num ? 'n' : ''}>
      <button onClick={() => setOrden((o) => ({ campo, desc: o.campo === campo ? !o.desc : true }))}>
        {label}{orden.campo === campo ? (orden.desc ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  );
  const delta = (v) => (v == null ? null : <span className={`delta ${v >= 0 ? 'up' : 'down'}`}>{v >= 0 ? '▲' : '▼'} {Math.abs(v)}%</span>);

  return (
    <div className="panel panel-pad">
      <div className="panel-head">
        <div>
          <span className="label">Análisis de contenido</span>
          <div className="ayuda" style={{ marginTop: 3 }}>Rendimiento de cada pieza. Media del periodo: {num(medias.alcance)} de alcance y {medias.tasa}% de interacción.</div>
        </div>
        <label className="ask buscar-skills">
          <Icon name="search" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contenido…" aria-label="Buscar contenido" />
        </label>
      </div>
      <div className="tabla-scroll">
        <table className="tabla">
          <thead>
            <tr>
              <th>Contenido</th>
              {th('fecha', 'Fecha', false)}
              {th('formato', 'Tipo', false)}
              {th('tema', 'Tema', false)}
              {th('alcance', 'Alcance')}
              {th('views', 'Visualiz.')}
              {th('interacciones', 'Interacc.')}
              {th('guardados', 'Guardados')}
              {th('compartidos', 'Compart.')}
              {th('ver_medio_ms', 'T. medio')}
              {th('tasa', '% Interacción')}
            </tr>
          </thead>
          <tbody>
            {filas.map((p) => (
              <tr key={p.id}>
                <td><div className="celda-contenido">
                  <span className="miniatura" style={p.miniatura ? { backgroundImage: `url("${p.miniatura}")` } : { background: `color-mix(in srgb, ${COLOR_FORMATO[p.formato]} 30%, var(--panel-2))` }}>
                    {!p.miniatura && <Icon name={p.formato === 'Reels' ? 'play' : p.formato === 'Carruseles' ? 'layers' : 'eye'} size={12} />}
                  </span>
                  <span className="celda-txt">
                    <b>{(p.gancho || p.caption || 'Sin texto').slice(0, 70)}</b>
                    <small>
                      {p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer">Ver en Instagram</a>}
                      {p.transcrita && <span title={p.nota || 'Transcrito'}>· transcrito</span>}
                    </small>
                  </span>
                </div></td>
                <td>{fechaCorta(p.fecha)}</td>
                <td><span className="tag" style={{ background: `color-mix(in srgb, ${COLOR_FORMATO[p.formato]} 18%, transparent)`, color: 'var(--text)' }}>{p.formato}</span></td>
                <td className="t-tema">{p.tema || <span className="t-dim">—</span>}</td>
                <td className="n">{numLargo(p.alcance)} {delta(p.vsMedia)}</td>
                <td className="n">{numLargo(p.views)}</td>
                <td className="n">{numLargo(p.interacciones)}</td>
                <td className="n">{numLargo(p.guardados)}</td>
                <td className="n">{numLargo(p.compartidos)}</td>
                <td className="n">{segundos(p.ver_medio_ms)}</td>
                <td className="n">{p.tasa}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filas.length && <div className="vacio">No hay publicaciones en este periodo{q ? ` con "${q}"` : ''}.</div>}
      </div>
    </div>
  );
}

export default function Instagram() {
  const [dias, setDias] = useState(30);
  const [vista, setVista] = useState('cuenta');
  const [serie, setSerie] = useState('alcance');
  const [insight, setInsight] = useState('temas');
  const [aviso, setAviso] = useState(() => {
    const p = new URLSearchParams(window.location.hash.split('?')[1] || '');
    return p.get('error') ? { tipo: 'error', texto: p.get('error') } : p.get('conectado') ? { tipo: 'ok', texto: 'Instagram conectado. JARVIS está sincronizando tus publicaciones…' } : null;
  });
  const [data, recargar] = useRecurso(`/api/instagram/resumen?dias=${dias}`, null);
  useEffect(() => { if (aviso) history.replaceState(null, '', '#instagram'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <section className="panel soon"><div className="t-dim">Cargando Instagram…</div></section>;
  const { estado } = data;

  const sincronizar = async () => {
    try { await api('/api/instagram/sincronizar', { method: 'POST' }); setAviso({ tipo: 'ok', texto: 'Sincronizando… los datos se actualizarán solos.' }); recargar(); } catch (e) { setAviso({ tipo: 'error', texto: e.message }); }
  };
  const desconectar = async () => {
    if (!confirm('¿Desconectar Instagram? Tus datos sincronizados se conservan.')) return;
    await api('/api/instagram/desconectar', { method: 'POST' });
    recargar();
  };

  const serieSel = SERIES.find((s) => s.id === serie);
  const formatos = data.formatos.map((f) => ({ etiqueta: f.formato, valor: f.valor, pct: f.pct, detalle: `${f.piezas} piezas` }));
  const maxTasa = Math.max(1, ...data.temas.map((t) => t.tasa));

  return (
    <section className="ig-vista">
      <header className="panel ig-cabecera">
        <div className="ig-cuenta">
          {estado.foto ? <img src={estado.foto} alt="" className="ig-foto" /> : <span className="ig-logo"><Icon name="instagram" size={18} /></span>}
          <div>
            <div className="label">Cuenta de Instagram</div>
            <div className="ig-user">
              {estado.conectado ? `@${estado.username}` : 'Sin conectar'}
              <span className={`chip-estado ${estado.conectado ? 'on' : 'demo'}`}><span className={`dot ${estado.conectado ? 'on' : 'warn'}`} />{estado.conectado ? 'Conectada' : 'Datos de ejemplo'}</span>
            </div>
          </div>
        </div>
        <div className="seg">
          <button className={vista === 'cuenta' ? 'on' : ''} onClick={() => setVista('cuenta')}><Icon name="chart" />Rendimiento de la cuenta</button>
          <button className={vista === 'contenido' ? 'on' : ''} onClick={() => setVista('contenido')}><Icon name="layers" />Análisis de contenido</button>
        </div>
        <div className="ig-controles">
          <div className="seg">
            {[7, 30, 90].map((d) => <button key={d} className={dias === d ? 'on' : ''} onClick={() => setDias(d)}>{d} días</button>)}
          </div>
          {estado.conectado && (
            <>
              <button className="btn btn-sec" onClick={sincronizar} disabled={estado.sincronizando}>
                <Icon name="refresh" size={14} />{estado.sincronizando ? 'Sincronizando…' : 'Sincronizar'}
              </button>
              <button className="link-btn" onClick={desconectar}>Desconectar</button>
            </>
          )}
        </div>
      </header>

      {aviso && <div className={`aviso ${aviso.tipo}`} role="status">{aviso.texto}<button className="link-btn" onClick={() => setAviso(null)}>Cerrar</button></div>}
      {estado.error && <div className="aviso error">Última sincronización con error: {estado.error}</div>}
      {!estado.conectado && <Conectar estado={estado} onHecho={() => { setAviso({ tipo: 'ok', texto: 'Instagram conectado. Sincronizando…' }); recargar(); }} />}
      {estado.conectado && (
        <div className="ig-meta">
          Última sincronización: {hace(estado.ultimaSync)} · {estado.publicaciones} publicaciones
          {estado.transcripcion.activa
            ? ` · ${estado.transcripcion.hechas} reels transcritos${estado.transcripcion.pendientes ? ` (${estado.transcripcion.pendientes} pendientes)` : ''}`
            : ' · Transcripción desactivada (falta ELEVENLABS_API_KEY)'}
        </div>
      )}

      {vista === 'cuenta' ? (
        <>
          <div className="ig-kpis">{data.kpis.map((k) => <Kpi key={k.id} k={k} />)}</div>
          <div className="ig-graficos">
            <div className="panel panel-pad">
              <div className="panel-head">
                <span className="label">Rendimiento de la cuenta</span>
                <div className="seg seg-mini">
                  {SERIES.map((s) => <button key={s.id} className={serie === s.id ? 'on' : ''} onClick={() => setSerie(s.id)}>{s.label}</button>)}
                </div>
              </div>
              <LineChart datos={data.diaria} campo={serie} etiqueta={serieSel.label} />
            </div>

            <div className="panel panel-pad">
              <div className="panel-head"><span className="label">Distribución por formato</span></div>
              {formatos.length
                ? <Donut datos={formatos} colores={formatos.map((f) => COLOR_FORMATO[f.etiqueta])} etiquetaTotal="visualizaciones" />
                : <div className="vacio">Sin publicaciones en este periodo.</div>}
            </div>

            <div className="panel panel-pad">
              <div className="panel-head">
                <span className="label">Insights con mejor rendimiento</span>
                <div className="seg seg-mini">
                  {[['temas', 'Temas'], ['ganchos', 'Ganchos'], ['formatos', 'Formatos']].map(([id, l]) => <button key={id} className={insight === id ? 'on' : ''} onClick={() => setInsight(id)}>{l}</button>)}
                </div>
              </div>
              {insight === 'temas' && (data.temas.length ? data.temas.slice(0, 6).map((t, i) => (
                <div className="insight-fila" key={t.tema} title={`${t.piezas} piezas · alcance medio ${numLargo(t.alcanceMedio)}`}>
                  <span className="insight-n">{i + 1}</span>
                  <span className="insight-nombre">{t.tema}</span>
                  <div className="bar"><span style={{ width: `${(t.tasa / maxTasa) * 100}%`, background: '#3987e5' }} /></div>
                  <span className="bar-pct">{t.tasa}%</span>
                </div>
              )) : <div className="vacio">JARVIS clasificará los temas tras la primera sincronización.</div>)}
              {insight === 'temas' && data.temas.length > 0 && <div className="ayuda" style={{ marginTop: 8 }}>% = interacciones / alcance, media por pieza.</div>}
              {insight === 'ganchos' && (data.ganchos.length ? data.ganchos.map((g, i) => (
                <div className="gancho-fila" key={g.id}>
                  <span className="insight-n">{i + 1}</span>
                  <span>“{g.gancho}”</span>
                  <b>{num(g.views ?? g.alcance)}</b>
                </div>
              )) : <div className="vacio">Sin ganchos todavía.</div>)}
              {insight === 'formatos' && data.formatos.map((f) => (
                <div className="insight-fila" key={f.formato}>
                  <span className="leyenda-marca" style={{ background: COLOR_FORMATO[f.formato] }} />
                  <span className="insight-nombre">{f.formato}</span>
                  <div className="bar"><span style={{ width: `${(f.alcanceMedio / Math.max(1, ...data.formatos.map((x) => x.alcanceMedio))) * 100}%`, background: COLOR_FORMATO[f.formato] }} /></div>
                  <span className="bar-pct">{num(f.alcanceMedio)}</span>
                </div>
              ))}
              {insight === 'formatos' && <div className="ayuda" style={{ marginTop: 8 }}>Alcance medio por pieza.</div>}
            </div>
          </div>
          <TablaContenido piezas={data.piezas.slice(0, 6)} medias={data.medias} />
        </>
      ) : (
        <TablaContenido piezas={data.piezas} medias={data.medias} />
      )}
    </section>
  );
}
