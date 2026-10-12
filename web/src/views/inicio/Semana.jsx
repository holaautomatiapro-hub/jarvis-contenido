import { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api, useRecurso } from '../../lib/api.js';
import { diaCorto, fechaDe, hoyIso, sumarDias } from '../../lib/fechas.js';
import { Modal, TIPOS, tipoDe } from '../contenido/comun.jsx';

// Inicio · tu semana: qué sale cada día (y los huecos), cómo vas con tu ritmo y cuántos días tienes cubiertos.

const DIAS = [{ n: 1, l: 'L' }, { n: 2, l: 'M' }, { n: 3, l: 'X' }, { n: 4, l: 'J' }, { n: 5, l: 'V' }, { n: 6, l: 'S' }, { n: 0, l: 'D' }];
const nombreDia = (f) => fechaDe(f).toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '');
// «hoy», «mañana» o «jue 15 oct»
export const cuando = (f, hoy = hoyIso()) => (f === hoy ? 'hoy' : f === sumarDias(hoy, 1) ? 'mañana' : diaCorto(f));
const cuandoCorto = (f, hoy = hoyIso()) => (f === hoy ? 'hoy' : f === sumarDias(hoy, 1) ? 'mañana' : `${nombreDia(f)} ${Number(f.slice(8))}`);

// ---------- Ritmo: cuántas piezas de cada tipo a la semana y qué días publicas ----------
function EditarRitmo({ ritmo, onClose, onGuardado }) {
  const [objetivos, setObjetivos] = useState(() => Object.fromEntries(TIPOS.map((t) => [t.id, ritmo.objetivos[t.id] || 0])));
  const [dias, setDias] = useState(ritmo.dias);
  const [error, setError] = useState('');
  const guardar = async () => {
    try { await api('/api/ritmo', { method: 'PUT', body: { objetivos, dias } }); onGuardado(); onClose(); } catch (e) { setError(e.message); }
  };
  return (
    <Modal titulo="Tu ritmo semanal" onClose={onClose} ancho={520}>
      <p className="ayuda">Cuántas piezas de cada tipo quieres publicar a la semana. Lo que dejes a 0 no se sigue.</p>
      <div className="ritmo-grid">
        {TIPOS.map((t) => (
          <label key={t.id} className="ritmo-campo">
            <span>{t.id}</span>
            <input type="number" min={0} max={50} className="campo" value={objetivos[t.id]} onChange={(e) => setObjetivos({ ...objetivos, [t.id]: Math.max(0, Math.min(50, Number(e.target.value) || 0)) })} />
          </label>
        ))}
      </div>
      <label className="campo-et">Días en que publicas</label>
      <div className="dias-chips" role="group" aria-label="Días en que publicas">
        {DIAS.map((d) => (
          <button type="button" key={d.n} className={dias.includes(d.n) ? 'on' : ''} aria-pressed={dias.includes(d.n)} onClick={() => setDias(dias.includes(d.n) ? dias.filter((x) => x !== d.n) : [...dias, d.n])}>{d.l}</button>
        ))}
      </div>
      <p className="ayuda">Un día de publicación sin nada programado cuenta como hueco.</p>
      {error && <div className="aviso-error">{error}</div>}
      <div className="modal-pie">
        <span />
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-sec" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn" onClick={guardar}>Guardar</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Tapar un hueco con algo que ya tienes listo ----------
function TaparHueco({ fecha, onClose, onHecho, ir }) {
  const [data] = useRecurso('/api/contenido', null);
  const [error, setError] = useState('');
  const pendiente = (p) => p.estado !== 'publicado' && p.ig_estado !== 'publicado';
  const listas = (data?.piezas || []).filter((p) => pendiente(p) && !p.fecha && p.estado !== 'idea')
    .sort((a, b) => (b.estado === 'listo') - (a.estado === 'listo') || b.id - a.id);
  const poner = async (p) => {
    try { await api(`/api/piezas/${p.id}`, { method: 'PATCH', body: { fecha } }); onHecho(); onClose(); } catch (e) { setError(e.message); }
  };
  return (
    <Modal titulo={`Tapar el hueco del ${diaCorto(fecha)}`} onClose={onClose} ancho={560}>
      {!data && <div className="vacio">Cargando…</div>}
      {data && !listas.length && <div className="vacio">No tienes nada sin fecha en la biblioteca. Mira tus ideas o crea algo nuevo.</div>}
      <div className="tapar-lista">
        {listas.map((p) => (
          <button type="button" key={p.id} className="tapar-fila" onClick={() => poner(p)}>
            <span className="tipo-pildora">{tipoDe(p.formato)?.corto || p.formato || 'Pieza'}</span>
            <b>{p.titulo}</b>
            <small>{p.estado === 'listo' ? 'Lista' : 'En marcha'}{p.pilar ? ` · ${p.pilar}` : ''}</small>
          </button>
        ))}
      </div>
      {error && <div className="aviso-error">{error}</div>}
      <div className="modal-pie">
        <button type="button" className="link-btn" onClick={() => { try { localStorage.setItem('contenido_vista', 'ideas'); } catch { /* sin localStorage */ } ir?.('contenido'); }}>Ver mis ideas</button>
        <button type="button" className="btn btn-sec" onClick={onClose}>Cerrar</button>
      </div>
    </Modal>
  );
}

function Ritmo({ progreso, onEditar }) {
  if (!progreso.length) {
    return (
      <div className="ritmo-vacio">
        <span>¿Cuánto quieres publicar a la semana? Define tu ritmo y JARVIS te dirá cómo vas.</span>
        <button type="button" className="btn btn-sec btn-mini" onClick={onEditar}>Definir mi ritmo</button>
      </div>
    );
  }
  return (
    <div className="ritmo">
      {progreso.map((x) => {
        const total = Math.max(x.objetivo, x.publicadas + x.programadas);
        const pct = (n) => `${(n / total) * 100}%`;
        return (
          <div key={x.tipo} className="ritmo-fila" title={`${x.publicadas} publicadas, ${x.programadas} programadas, objetivo ${x.objetivo}`}>
            <span className="ritmo-tipo">{x.tipo}</span>
            <div className="ritmo-barra">
              <i className="pub" style={{ width: pct(x.publicadas) }} />
              <i className="prog" style={{ width: pct(x.programadas) }} />
            </div>
            <span className={`ritmo-n${x.faltan ? ' falta' : ''}`}>{x.publicadas + x.programadas}/{x.objetivo}</span>
          </div>
        );
      })}
    </div>
  );
}

export function TuSemana({ semana, recargar, ir }) {
  const [editando, setEditando] = useState(false);
  const [tapando, setTapando] = useState(null);
  if (!semana) return null;
  const hoy = hoyIso();
  const { colchon, huecos, reserva } = semana;
  const aviso = !colchon.dias
    ? { clase: 'mal', texto: 'Hoy no tienes nada programado' }
    : { clase: colchon.dias >= 5 ? 'bien' : 'medio', texto: `Cubierto hasta el ${diaCorto(colchon.hasta)} · ${colchon.dias} ${colchon.dias === 1 ? 'día' : 'días'} de publicación` };
  const proximoHueco = huecos[0];
  return (
    <div className="panel panel-pad semana-panel">
      <div className="panel-head">
        <span className="label">Tu semana</span>
        <span className="panel-head-der">
          <span className={`colchon ${aviso.clase}`}>{aviso.texto}</span>
          <button type="button" className="link-btn" onClick={() => setEditando(true)}>Ritmo</button>
        </span>
      </div>
      <div className="semana-dias">
        {semana.dias.map((d) => (
          <div key={d.fecha} className={`semana-dia${d.fecha === hoy ? ' hoy' : ''}${d.pasado ? ' pasado' : ''}${d.publicas ? '' : ' libre'}`}>
            <div className="semana-dia-cab">{nombreDia(d.fecha)} <b>{Number(d.fecha.slice(8))}</b></div>
            {d.piezas.map((p) => (
              <button type="button" key={p.id} className={`semana-pieza${p.publicada ? ' hecha' : ''}`} onClick={() => ir?.('contenido')} title={p.titulo}>
                <span className="semana-pieza-txt"><span className="cal-chip-tipo">{tipoDe(p.formato)?.corto || ''}</span>{p.publicada ? '✓ ' : ''}{p.titulo}</span>
              </button>
            ))}
            {d.hueco && <button type="button" className="semana-hueco" onClick={() => setTapando(d.fecha)}>Hueco · tapar</button>}
            {!d.piezas.length && !d.hueco && <span className="semana-nada">{d.publicas ? '' : 'No publicas'}</span>}
          </div>
        ))}
      </div>
      <Ritmo progreso={semana.progreso} onEditar={() => setEditando(true)} />
      <div className="semana-pie ayuda">
        {proximoHueco ? <>Próximo hueco: <b>{cuando(proximoHueco, hoy)}</b>. </> : <>Sin huecos en los próximos 14 días. </>}
        {reserva ? <>Tienes {reserva} {reserva === 1 ? 'pieza lista' : 'piezas listas'} sin fecha para taparlos.</> : <>No tienes piezas listas sin fecha de reserva.</>}
      </div>
      {editando && <EditarRitmo ritmo={semana.ritmo} onClose={() => setEditando(false)} onGuardado={recargar} />}
      {tapando && <TaparHueco fecha={tapando} onClose={() => setTapando(null)} onHecho={recargar} ir={ir} />}
    </div>
  );
}

// ---------- Lo que tiene día y aún no está listo ----------
export function ParaProducir({ lista = [], ir }) {
  return (
    <div className="panel panel-pad">
      <div className="panel-head">
        <span className="label">Por producir</span>
        {lista.length ? <span className="ayuda">{lista.length} con día y sin terminar</span> : null}
      </div>
      {!lista.length && <div className="vacio mini-vacio">Todo lo que tiene día en las próximas dos semanas está listo.</div>}
      <div className="hoy-lista">
        {lista.slice(0, 6).map((p) => (
          <button type="button" key={p.id} className="hoy-fila" onClick={() => ir?.('contenido')}>
            <span className={`time${p.urgente ? ' urgente' : ''}`}>{cuandoCorto(p.fecha)}</span>
            <span className="hoy-txt"><b>{p.titulo}</b><small className="sin-mayus">{p.formato || 'Pieza'} · está en {p.etiqueta}</small></span>
          </button>
        ))}
      </div>
    </div>
  );
}
