import { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api, useRecurso } from '../../lib/api.js';
import { fechaCorta, num } from '../../lib/formato.js';
import { hoyIso } from '../../lib/fechas.js';

// En la ficha de la pieza: sus resultados en Instagram (si está unida a su publicación) o, si ya salió,
// elegir cuál es su publicación. JARVIS las une solo cuando está claro.

const COMO = { jarvis: 'la publicó JARVIS', enlace: 'por su enlace', caption: 'por el caption', fecha: 'por el día y el formato', manual: 'a mano' };

function Elegir({ piezaId, onHecho, onCerrar }) {
  const [lista] = useRecurso(`/api/piezas/${piezaId}/instagram/candidatas`, null);
  const [error, setError] = useState('');
  const elegir = async (m) => {
    try { onHecho(await api(`/api/piezas/${piezaId}/instagram`, { method: 'PUT', body: { media: m } })); } catch (e) { setError(e.message); }
  };
  return (
    <div className="res-elegir">
      {!lista && <div className="ayuda">Buscando publicaciones de esos días…</div>}
      {lista && !lista.length && <div className="ayuda">No hay publicaciones de Instagram 10 días antes ni después. Sincroniza Instagram y vuelve a mirar.</div>}
      {lista?.map((m) => (
        <button type="button" key={m.id} className="res-cand" disabled={m.usada} onClick={() => elegir(m.id)} title={m.usada ? 'Ya está unida a otra pieza' : 'Es esta'}>
          {m.miniatura ? <img src={m.miniatura} alt="" loading="lazy" /> : <span className="res-sin"><Icon name="instagram" size={14} /></span>}
          <span className="res-cand-txt"><b>{fechaCorta(m.fecha)} · {m.formato}</b><small>{m.caption || 'Sin caption'}</small></span>
          <span className="t-dim">{m.usada ? 'ya unida' : `${num(m.alcance)} alcance`}</span>
        </button>
      ))}
      {error && <div className="aviso-error">{error}</div>}
      <div className="res-elegir-pie">
        <button type="button" className="link-btn" onClick={() => elegir(null)}>No está en Instagram</button>
        <button type="button" className="link-btn" onClick={onCerrar}>Cerrar</button>
      </div>
    </div>
  );
}

// onVinculada(pieza): al unirla pasa a Publicado (y toma el día de Instagram si no tenía): la ficha lo refleja
export function ResultadosPieza({ pieza, onVinculada }) {
  const [r, recargar] = useRecurso(`/api/piezas/${pieza.id}/resultados`, null);
  const [eligiendo, setEligiendo] = useState(false);
  if (!r) return null;
  const m = r.metricas;
  const yaSalio = pieza.estado === 'publicado' || (pieza.fecha && pieza.fecha <= hoyIso());
  if (!m && !yaSalio && !eligiendo) return null;
  const c = r.comparado;
  const cifras = m ? [
    ['Alcance', num(m.alcance), c?.alcance != null ? `${c.alcance > 0 ? '+' : ''}${c.alcance} % vs. tus ${c.formato.toLowerCase()}` : null],
    ['Visualizaciones', num(m.views)],
    ['Guardados', num(m.guardados)],
    ['Compartidos', num(m.compartidos)],
    ['Comentarios', num(m.comentarios)],
    ['Interacción', m.tasa != null ? `${m.tasa} %` : '—', c?.tasa != null ? `tu media ${c.tasa} %` : null],
  ] : [];
  return (
    <div className="resultados-pieza">
      <div className="vr-titulo">
        <Icon name="chart" size={14} />
        <b>Resultados en Instagram</b>
        <span className="ayuda">
          {m ? `${fechaCorta(m.fecha)} · unida ${COMO[r.vinculo] || ''}` : r.aviso || (r.vinculo === 'ninguna' ? 'Marcada como «no está en Instagram»' : 'Aún sin unir a su publicación')}
        </span>
        <span className="vr-acciones">
          {m?.permalink && <a className="link-btn" href={m.permalink} target="_blank" rel="noreferrer">Ver ↗</a>}
          <button type="button" className="link-btn" onClick={() => setEligiendo(!eligiendo)}>{m ? 'No es esta' : 'Elegir su publicación'}</button>
        </span>
      </div>
      {m && (
        <div className="res-cifras">
          {cifras.map(([k, v, extra]) => <div key={k}><small>{k}</small><b>{v}</b>{extra && <span className={`res-extra${/^\+/.test(extra) ? ' bien' : /^-/.test(extra) ? ' mal' : ''}`}>{extra}</span>}</div>)}
        </div>
      )}
      {eligiendo && <Elegir piezaId={pieza.id} onHecho={(p) => { setEligiendo(false); recargar(); onVinculada?.(p); }} onCerrar={() => setEligiendo(false)} />}
    </div>
  );
}
