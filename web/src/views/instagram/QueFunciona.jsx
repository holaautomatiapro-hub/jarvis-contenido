import { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api, obsidianUrl, useRecurso } from '../../lib/api.js';
import { num } from '../../lib/formato.js';

// Qué te funciona: tus piezas unidas a su publicación, agrupadas por pilar, objetivo, formato y CTA.
// Todo son datos (sin IA). Las conclusiones solo salen con grupos de 3 piezas o más.

function Delta({ v }) {
  if (v == null) return <span className="t-dim">—</span>;
  return <span className={`qf-delta ${v > 10 ? 'bien' : v < -10 ? 'mal' : ''}`}>{v > 0 ? '+' : ''}{v} %</span>;
}

function Tabla({ titulo, ayuda, grupos }) {
  return (
    <div className="panel panel-pad">
      <div className="panel-head"><span className="label">{titulo}</span></div>
      {!grupos.length ? <div className="vacio mini-vacio">{ayuda}</div> : (
        <div className="qf-tabla">
          <div className="qf-fila qf-cab"><span /><span>Piezas</span><span>Alcance medio</span><span>vs. tu media</span><span title="Interacciones / alcance">Interacción</span><span title="Guardados + compartidos por cada 1.000 personas">Guarda y comparte</span></div>
          {grupos.map((g) => (
            <div key={g.clave} className={`qf-fila${g.pocas ? ' pocas' : ''}`} title={g.pocas ? 'Menos de 3 piezas: aún no es una tendencia' : ''}>
              <b>{g.clave}</b>
              <span>{g.piezas}{g.pocas ? ' ·' : ''}</span>
              <span>{num(g.alcanceMedio)}</span>
              <Delta v={g.vsMedia} />
              <span>{g.tasa ?? '—'} %</span>
              <span>{g.valor ?? '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Ganchos({ titulo, lista }) {
  if (!lista.length) return null;
  return (
    <div className="qf-ganchos">
      <span className="label">{titulo}</span>
      {lista.map((g) => (
        <div key={g.piezaId} className="gancho-fila">
          <span>“{g.gancho}”<small className="t-dim"> · {g.titulo}</small></span>
          <span><Delta v={g.vsMedia} /> {g.permalink && <a className="link-btn" href={g.permalink} target="_blank" rel="noreferrer">↗</a>}</span>
        </div>
      ))}
    </div>
  );
}

export default function QueFunciona({ dias }) {
  const periodo = Math.max(30, dias);
  const [data, recargar, error] = useRecurso(`/api/resultados?dias=${periodo}`, null);
  const [cfg] = useRecurso('/api/config', { vault: 'JARVIS-Vault' });
  const [escribiendo, setEscribiendo] = useState(false);
  const [aviso, setAviso] = useState(null);
  if (error) return <div className="panel panel-pad aviso error">No se ha podido cargar: {error}</div>;
  if (!data) return <div className="panel panel-pad vacio">Cargando…</div>;
  const c = data.cobertura;
  const informe = async () => {
    setEscribiendo(true); setAviso(null);
    try { const r = await api('/api/resultados/informe', { method: 'POST', body: {} }); setAviso({ tipo: 'ok', texto: `Informe guardado en ${r.nota}` }); recargar(); } catch (e) { setAviso({ tipo: 'error', texto: e.message }); }
    setEscribiendo(false);
  };
  return (
    <div className="qf">
      <div className="panel panel-pad qf-resumen">
        <div className="panel-head">
          <span className="label">Qué te funciona · últimos {periodo} días</span>
          <span className="panel-head-der">
            {data.informe?.nota && <a className="link-btn" href={obsidianUrl(cfg.vault, data.informe.nota)}>Último informe semanal</a>}
            <button type="button" className="btn btn-sec btn-mini" onClick={informe} disabled={escribiendo}><Icon name="doc" size={13} />{escribiendo ? 'Escribiendo…' : 'Informe de la semana pasada'}</button>
          </span>
        </div>
        {aviso && <div className={`aviso ${aviso.tipo}`}>{aviso.texto}</div>}
        {data.conclusiones.length
          ? <ul className="qf-conclusiones">{data.conclusiones.map((t) => <li key={t}>{t}</li>)}</ul>
          : <p className="ayuda">Aún no hay conclusiones: hacen falta al menos 3 piezas publicadas por grupo, unidas a su publicación y con su pilar u objetivo.</p>}
        <p className="ayuda">
          {c.conPieza} de {c.publicaciones} publicaciones están unidas a su pieza ({c.conPilar} con pilar, {c.conObjetivo} con objetivo). JARVIS las une solas (por el enlace, el caption o el día); las que no, únelas desde la ficha de la pieza.
          {' '}Tu media: alcance {num(data.medias.alcance)}, interacción {data.medias.tasa ?? '—'} %, {data.medias.valor ?? '—'} guardados y compartidos por cada 1.000 personas.
        </p>
      </div>
      <div className="qf-grid">
        <Tabla titulo="Por pilar" ayuda="Ponle pilar a tus piezas (en su ficha) para ver cuál funciona." grupos={data.porPilar} />
        <Tabla titulo="Por objetivo" ayuda="Marca si cada pieza es para atraer, nutrir o convertir." grupos={data.porObjetivo} />
        <Tabla titulo="Por formato" ayuda="Sin publicaciones en este periodo." grupos={data.porFormato} />
        <Tabla titulo="Por CTA" ayuda="Escribe el CTA de cada pieza en su ficha." grupos={data.porCta} />
      </div>
      {(data.mejoresGanchos.length > 0) && (
        <div className="panel panel-pad">
          <Ganchos titulo="Ganchos que más alcance tuvieron" lista={data.mejoresGanchos} />
          <Ganchos titulo="Los que menos" lista={data.peoresGanchos} />
        </div>
      )}
    </div>
  );
}
