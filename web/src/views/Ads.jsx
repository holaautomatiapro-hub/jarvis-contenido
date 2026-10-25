import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import ChatJarvis from '../components/ChatJarvis.jsx';
import Creativos from './ads/Creativos.jsx';
import LineChart from '../components/charts/LineChart.jsx';
import AnunciosCompetencia from './ads/AnunciosCompetencia.jsx';
import Explorador from './ads/Explorador.jsx';
import { api, useRecurso } from '../lib/api.js';
import { fechaCorta, hace, num } from '../lib/formato.js';

const euro = (v, moneda = 'EUR') => (v == null ? '—' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: moneda || 'EUR', maximumFractionDigits: v < 10 ? 2 : 0 }).format(v));

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

  const actualizar = async () => { try { await api('/api/ads/actualizar', { method: 'POST', body: { dias } }); recargar(); } catch (e) { setAviso({ tipo: 'error', texto: e.message }); } };

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

      <div className={`ads-grid${pendientes.length ? '' : ' sin-propuestas'}`}>
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
        </div>

        {pendientes.length > 0 && (
          <div className="col">
            <div className="panel panel-pad">
              <div className="panel-head"><span className="label">Campañas propuestas</span><span className="ayuda">Se crean en pausa al confirmar</span></div>
              {pendientes.map((b) => <Borrador key={b.id} b={b} moneda={moneda} recargar={recargar} setAviso={setAviso} />)}
            </div>
          </div>
        )}
      </div>
      <Creativos />
      <Explorador />
      <AnunciosCompetencia conectado={estado.conectado} />
    </section>
  );
}
