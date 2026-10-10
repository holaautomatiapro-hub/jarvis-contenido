import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import ChatJarvis from '../components/ChatJarvis.jsx';
import LineChart from '../components/charts/LineChart.jsx';
import { api, useRecurso } from '../lib/api.js';
import { fechaCorta, hace, num, numLargo } from '../lib/formato.js';

const euro = (v, moneda = 'EUR') => (v == null ? '—' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: moneda || 'EUR', maximumFractionDigits: v < 10 ? 2 : 0 }).format(v));
const ESTADO = { ACTIVE: ['Activa', 'on'], PAUSED: ['En pausa', 'warn'], CAMPAIGN_PAUSED: ['En pausa', 'warn'], ADSET_PAUSED: ['En pausa', 'warn'], ARCHIVED: ['Archivada', 'off'], WITH_ISSUES: ['Con problemas', 'warn'] };

function CuentaPublicitaria({ estado, recargar, setAviso }) {
  const [cuentas, setCuentas] = useState(null);
  const [manual, setManual] = useState('');
  if (!estado.conectado) return null;
  const cargar = async () => { try { setCuentas(await api('/api/ads/cuentas')); } catch (e) { setAviso({ tipo: 'error', texto: e.message }); } };
  const elegir = async (id) => { try { await api('/api/ads/cuenta', { method: 'POST', body: { id } }); setCuentas(null); recargar(); } catch (e) { setAviso({ tipo: 'error', texto: e.message }); } };
  if (estado.cuenta && !cuentas) return <button className="link-btn" onClick={cargar}>Cambiar cuenta</button>;
  return (
    <div className="cuenta-ads">
      {cuentas ? (
        <select className="campo" defaultValue="" onChange={(e) => e.target.value && elegir(e.target.value)} aria-label="Cuenta publicitaria">
          <option value="" disabled>Elige tu cuenta publicitaria…</option>
          {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({c.id.replace('act_', '')}){c.activa ? '' : ' · inactiva'}</option>)}
        </select>
      ) : (
        <>
          <button className="btn btn-sec" onClick={cargar}>Elegir cuenta publicitaria</button>
          <form className="fila" style={{ margin: 0 }} onSubmit={(e) => { e.preventDefault(); elegir(manual); }}>
            <input className="campo" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="o pega el ID (act_…)" aria-label="ID de la cuenta publicitaria" />
          </form>
        </>
      )}
    </div>
  );
}

function Proponer({ pub, objetivos, max, onCerrar, onHecho }) {
  const [f, setF] = useState({ objetivo: 'interaccion', presupuestoDia: 10, dias: 7, edadMin: 25, edadMax: 55 });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'number' ? Number(e.target.value) : e.target.value }));
  const enviar = async (e) => {
    e.preventDefault();
    try { await api('/api/ads/borradores', { method: 'POST', body: { ...f, publicacionId: pub.id } }); onHecho(); onCerrar(); } catch (err) { setError(err.message); }
  };
  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <form className="panel modal" onSubmit={enviar} role="dialog" aria-modal="true" aria-label="Proponer campaña">
        <div className="panel-head"><span className="label">Proponer campaña</span><button type="button" className="icon-btn" onClick={onCerrar} aria-label="Cerrar">✕</button></div>
        <p className="ayuda" style={{ marginTop: 0 }}>Impulsar: “{pub.gancho}”</p>
        <div className="form-grid">
          <label>Objetivo<select className="campo" value={f.objetivo} onChange={set('objetivo')}>{objetivos.map((o) => <option key={o.id} value={o.id}>{o.etiqueta}</option>)}</select></label>
          <label>€ al día<input className="campo" type="number" min="1" max={max} step="1" value={f.presupuestoDia} onChange={set('presupuestoDia')} /></label>
          <label>Días<input className="campo" type="number" min="1" max="30" value={f.dias} onChange={set('dias')} /></label>
          <label>Edad<span className="fila" style={{ margin: 0 }}><input className="campo" type="number" min="18" max="65" value={f.edadMin} onChange={set('edadMin')} aria-label="Edad mínima" /><input className="campo" type="number" min="18" max="65" value={f.edadMax} onChange={set('edadMax')} aria-label="Edad máxima" /></span></label>
        </div>
        <div className="aviso" style={{ marginTop: 12 }}>Gasto máximo: <b>{euro(f.presupuestoDia * f.dias)}</b>. Se guarda como borrador; nada se crea en Meta hasta que confirmes, y se creará en pausa.</div>
        {error && <div className="aviso-error">{error}</div>}
        <div className="modal-pie"><span /><button className="btn">Guardar borrador</button></div>
      </form>
    </div>
  );
}

function Borrador({ b, moneda, recargar, setAviso }) {
  const [creando, setCreando] = useState(false);
  const d = b.datos;
  const confirmar = async () => {
    if (!confirm(`¿Crear la campaña "${d.nombre}" EN PAUSA?\n\nGasto máximo si luego la activas: ${euro(d.gastoMaximo, moneda)}.\nNo se gasta nada hasta que la actives tú en el Administrador de anuncios.`)) return;
    setCreando(true);
    try { await api(`/api/ads/borradores/${b.id}/confirmar`, { method: 'POST' }); setAviso({ tipo: 'ok', texto: 'Campaña creada en pausa. Revísala y actívala tú en el Administrador de anuncios cuando quieras.' }); } catch (e) { setAviso({ tipo: 'error', texto: e.message }); } finally { setCreando(false); recargar(); }
  };
  const descartar = async () => { await api(`/api/ads/borradores/${b.id}/descartar`, { method: 'POST' }); recargar(); };
  return (
    <div className={`borrador ${b.estado}`}>
      <div className="borrador-top">
        <span className="tag">{b.estado === 'creada' ? 'Creada en pausa' : b.estado === 'error' ? 'Error' : b.estado === 'creando' ? 'Creando…' : `Borrador${b.origen !== 'dashboard' ? ` · vía ${b.origen === 'hermes' ? 'Telegram' : 'JARVIS'}` : ''}`}</span>
        <small>{fechaCorta(b.ts.replace(' ', 'T'))}</small>
      </div>
      <b>{d.nombre}</b>
      {d.publicacion?.gancho && <span className="ayuda">Impulsa: “{d.publicacion.gancho}”</span>}
      <div className="borrador-datos">
        <span>{euro(d.presupuestoDia, moneda)}/día × {d.dias} días</span>
        <span>Máx. <b>{euro(d.gastoMaximo, moneda)}</b></span>
        <span>{d.paises.join(', ')} · {d.edadMin}-{d.edadMax} años</span>
      </div>
      {d.motivo && <span className="idea-porque">{d.motivo}</span>}
      {b.estado === 'borrador' && (
        <div className="borrador-acciones">
          <button className="btn" onClick={confirmar} disabled={creando}>{creando ? 'Creando…' : 'Crear en pausa'}</button>
          <button className="link-btn" onClick={descartar}>Descartar</button>
        </div>
      )}
      {b.estado === 'creada' && b.resultado?.enlace && <a className="link-btn" href={b.resultado.enlace} target="_blank" rel="noreferrer">Revisar y activar en el Administrador de anuncios →</a>}
      {b.estado === 'error' && <span className="t-err" style={{ fontSize: 11 }}>{b.resultado?.error} <button className="link-btn" onClick={descartar}>Descartar</button></span>}
    </div>
  );
}

export default function Ads() {
  const [dias, setDias] = useState(30);
  const [data, recargar] = useRecurso(`/api/ads?dias=${dias}`, null);
  const [aviso, setAviso] = useState(null);
  const [proponer, setProponer] = useState(null);
  const [verPaginas, setVerPaginas] = useState(false);
  if (!data) return <section className="panel soon"><div className="t-dim">Cargando Meta Ads…</div></section>;

  const { estado, rendimiento: r } = data;
  const moneda = r.cuenta?.moneda || 'EUR';
  const t = r.totales;
  const kpis = [
    ['Gasto', euro(t.gasto, moneda), 'chart', 'var(--accent-2)'],
    ['Impresiones', num(t.impresiones), 'eye', 'var(--purple)'],
    ['Clics', num(t.clics), 'target', 'var(--pink)'],
    ['CTR', `${t.ctr.toLocaleString('es-ES')} %`, 'bolt', 'var(--green)'],
    ['CPC', euro(t.cpc, moneda), 'ads', 'var(--orange)'],
    ['CPM', euro(t.cpm, moneda), 'layers', 'var(--cyan)'],
  ];
  const pendientes = data.borradores.filter((b) => b.estado !== 'descartada');

  const sincronizarLib = async () => { try { await api('/api/ads/biblioteca/sincronizar', { method: 'POST' }); setAviso({ tipo: 'ok', texto: 'Buscando anuncios de tu competencia en la Ad Library…' }); } catch (e) { setAviso({ tipo: 'error', texto: e.message }); } };
  const actualizar = async () => { try { await api('/api/ads/actualizar', { method: 'POST', body: { dias } }); recargar(); } catch (e) { setAviso({ tipo: 'error', texto: e.message }); } };
  const guardarPagina = async (u, pagina) => { await api(`/api/ads/competidores/${u}/pagina`, { method: 'POST', body: { pagina } }); recargar(); };

  return (
    <section className="ig-vista">
      <header className="panel ig-cabecera">
        <div className="ig-cuenta">
          <span className="ig-logo meta"><Icon name="ads" size={20} /></span>
          <div>
            <div className="label">Asistente de Meta Ads</div>
            <div className="ig-user">
              {data.demoRendimiento ? 'Sin cuenta publicitaria' : r.cuenta.nombre}
              <span className={`chip-estado ${data.demoRendimiento ? 'demo' : 'on'}`}><span className={`dot ${data.demoRendimiento ? 'warn' : 'on'}`} />{data.demoRendimiento ? 'Datos de ejemplo' : 'Cuenta conectada'}</span>
            </div>
          </div>
        </div>
        <CuentaPublicitaria estado={estado} recargar={recargar} setAviso={setAviso} />
        <div className="ig-controles">
          <div className="seg">{[7, 30, 90].map((d) => <button key={d} className={dias === d ? 'on' : ''} onClick={() => setDias(d)}>{d} días</button>)}</div>
          {!data.demoRendimiento && <button className="btn btn-sec" onClick={actualizar}><Icon name="refresh" size={14} />Actualizar</button>}
        </div>
      </header>

      {aviso && <div className={`aviso ${aviso.tipo}`}>{aviso.texto}<button className="link-btn" onClick={() => setAviso(null)}>Cerrar</button></div>}
      {data.errorRendimiento && <div className="aviso error">{data.errorRendimiento}</div>}
      {!estado.conectado && <div className="aviso">Para ver tus campañas y crear nuevas, conecta primero Instagram con Facebook (pestaña Instagram) y elige aquí tu cuenta publicitaria. Guía: docs/META-ADS.md</div>}
      {estado.conectado && !estado.cuenta && <div className="aviso">Elige tu cuenta publicitaria arriba para ver gasto, CTR y CPC reales.</div>}

      <div className="ads-grid">
        <ChatJarvis
          conversacion="ads"
          titulo="Asistente de Meta Ads"
          subtitulo="Planifica, analiza y crea campañas con IA (siempre en pausa)."
          placeholder="Pregunta por tus anuncios o pide una campaña…"
          intro="Consulta gasto, CTR y CPC, analiza la Ad Library de tu competencia o pide una campaña: JARVIS la deja como borrador para que la confirmes, y se crea en pausa."
          sugerencias={['¿Cuánto gasté este mes y con qué CTR y CPC?', '¿Qué reel debería impulsar y con cuánto presupuesto?', '¿Qué ángulos usa mi competencia en sus anuncios?']}
        />

        <div className="col">
          <div className="ads-kpis">
            {kpis.map(([l, v, ic, c]) => (
              <div key={l} className="panel ig-kpi">
                <div className="ig-kpi-top"><span className="kpi-icon peque" style={{ background: `color-mix(in srgb, ${c} 16%, transparent)`, color: c }}><Icon name={ic} size={14} /></span><span className="label">{l}</span></div>
                <div className="ig-kpi-valor">{v}</div>
              </div>
            ))}
          </div>
          <div className="panel panel-pad">
            <div className="panel-head"><span className="label">Gasto diario</span>{!data.demoRendimiento && <span className="ayuda">Actualizado {hace(r.actualizado)}</span>}</div>
            <LineChart datos={r.diario.map((d) => ({ ...d, fecha: d.fecha }))} campo="gasto" etiqueta={`Gasto (${moneda})`} alto={170} />
          </div>
          <div className="panel panel-pad">
            <div className="panel-head"><span className="label">Campañas</span></div>
            <div className="tabla-scroll">
              <table className="tabla" style={{ minWidth: 620 }}>
                <thead><tr><th>Campaña</th><th>Estado</th><th className="n">Gasto</th><th className="n">CTR</th><th className="n">CPC</th><th className="n">Resultados</th><th className="n">€/result.</th></tr></thead>
                <tbody>
                  {r.campanas.map((c) => {
                    const [et, cl] = ESTADO[c.estado] || [c.estado, 'off'];
                    return (
                      <tr key={c.id}>
                        <td style={{ whiteSpace: 'normal' }}><b style={{ fontWeight: 500 }}>{c.nombre}</b></td>
                        <td><span className="status"><span className={`dot ${cl}`} />{et}</span></td>
                        <td className="n">{euro(c.gasto, moneda)}</td>
                        <td className="n">{c.ctr.toLocaleString('es-ES', { maximumFractionDigits: 2 })} %</td>
                        <td className="n">{euro(c.cpc, moneda)}</td>
                        <td className="n" title={c.tipoResultado}>{numLargo(c.resultados)}</td>
                        <td className="n">{euro(c.costeResultado, moneda)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!r.campanas.length && <div className="vacio">Sin campañas en este periodo.</div>}
            </div>
          </div>
        </div>

        <div className="col">
          {pendientes.length > 0 && (
            <div className="panel panel-pad">
              <div className="panel-head"><span className="label">Campañas propuestas</span><span className="ayuda">Se crean en pausa al confirmar</span></div>
              {pendientes.map((b) => <Borrador key={b.id} b={b} moneda={moneda} recargar={recargar} setAviso={setAviso} />)}
            </div>
          )}

          <div className="panel panel-pad">
            <div className="panel-head">
              <div><span className="label">Contenido orgánico para impulsar</span>{data.demoRecomendados && <div className="ayuda">Ejemplo: conecta Instagram para ver los tuyos</div>}</div>
            </div>
            {data.recomendados.map((p) => (
              <div key={p.id} className="idea-card">
                <span className="miniatura" style={p.miniatura ? { backgroundImage: `url("${p.miniatura}")` } : { background: 'color-mix(in srgb, #3987e5 30%, var(--panel-2))' }}>{!p.miniatura && <Icon name="play" size={12} />}</span>
                <div className="idea-txt">
                  <div className="idea-tags"><span className="tag" style={{ background: 'rgba(47,107,255,.15)', color: '#9cc0ff' }}>{p.formato}</span><small>{num(p.alcance)} alcance · {num(p.guardados)} guardados</small></div>
                  <b>{p.gancho}</b>
                  <span className="idea-porque">{p.motivo}</span>
                  <button className="link-btn" disabled={data.demoRecomendados || !estado.cuenta} onClick={() => setProponer(p)}>{data.demoRecomendados ? 'Ejemplo' : !estado.cuenta ? 'Elige antes la cuenta publicitaria' : '+ Proponer campaña'}</button>
                </div>
              </div>
            ))}
            {!data.recomendados.length && <div className="vacio">Sin publicaciones con datos suficientes todavía.</div>}
          </div>

          <div className="panel panel-pad">
            <div className="panel-head">
              <div>
                <span className="label">Creativos de la competencia</span>
                <div className="ayuda">{data.demoBiblioteca ? 'Ejemplo con páginas ficticias' : `Ad Library · ${hace(data.bibliotecaSync)}`}</div>
              </div>
              {estado.conectado && <button className="link-btn" onClick={sincronizarLib}>Buscar ahora</button>}
            </div>
            {data.errorBiblioteca && <div className="aviso error" style={{ marginBottom: 8 }}>{data.errorBiblioteca}</div>}
            {data.biblioteca.slice(0, 6).map((a) => (
              <div key={a.id} className="creativo">
                <div className="creativo-top"><b>{a.pagina}</b><span className={`chip-estado ${a.activo ? 'on' : ''}`}><span className={`dot ${a.activo ? 'on' : 'off'}`} />{a.activo ? `Activo · ${a.diasActivo} días` : `Terminado · ${a.diasActivo} días`}</span></div>
                <p>{a.cuerpo}</p>
                <small>{a.titulo ? `${a.titulo} · ` : ''}{a.plataformas}{a.alcance_ue ? ` · ${num(a.alcance_ue)} de alcance en la UE` : ''}{a.snapshot ? <> · <a href={a.snapshot} target="_blank" rel="noreferrer">ver anuncio</a></> : null}</small>
              </div>
            ))}
            <div className="ayuda" style={{ marginTop: 8 }}>Cuantos más días lleva activo un anuncio, más probable es que le funcione.</div>
            <button className="link-btn" style={{ marginTop: 8 }} onClick={() => setVerPaginas((v) => !v)}>{verPaginas ? 'Ocultar' : 'Configurar'} páginas de Facebook de la competencia</button>
            {verPaginas && data.competidores.map((c) => (
              <label key={c.username} className="pagina-fb">
                <span>@{c.username}</span>
                <input className="campo" defaultValue={c.fb_pagina || ''} placeholder={`Nombre o ID de su página (por defecto “${c.nombre || c.username}”)`} onBlur={(e) => e.target.value !== (c.fb_pagina || '') && guardarPagina(c.username, e.target.value)} />
              </label>
            ))}
          </div>
        </div>
      </div>
      {proponer && <Proponer pub={proponer} objetivos={data.objetivos} max={estado.maxPresupuestoDia} onCerrar={() => setProponer(null)} onHecho={recargar} />}
    </section>
  );
}
