import { useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import ChatJarvis from '../components/ChatJarvis.jsx';
import Mascota from '../components/Mascota.jsx';
import { normaliza, useRecurso } from '../lib/api.js';

const VACIO = { total: 0, categorias: [], skills: [], transcripciones: 0, vozLista: false };

export default function Skills() {
  const [data] = useRecurso('/api/skills', VACIO);
  const [categoria, setCategoria] = useState(null);
  const [q, setQ] = useState('');
  const [borrador, setBorrador] = useState(null);

  const cat = data.categorias.find((c) => c.id === categoria);
  const filtradas = useMemo(() => {
    const n = normaliza(q.trim());
    return data.skills.filter((s) => (!categoria || s.categoria === categoria) && (!n || normaliza(`${s.titulo} ${s.descripcion} ${s.nombre}`).includes(n)));
  }, [data.skills, categoria, q]);
  const verLista = Boolean(categoria || q.trim());
  const colorDe = (id) => data.categorias.find((c) => c.id === id)?.color || 'var(--accent-2)';

  const usar = (s) => setBorrador(`Usa la skill «${s.titulo}» (${s.nombre}): `);

  return (
    <section className="skills-vista">
      {/* Columna izquierda: el vault */}
      <aside className="col">
        <div className="panel panel-pad vault-card">
          <div className="label">Vault de contenido</div>
          <div className="ayuda" style={{ margin: '4px 0 12px' }}>Skills de Claude para crear, analizar y optimizar tu contenido.</div>
          <div className="vault-total">
            <div>
              <div className="vault-num">{data.total}</div>
              <div className="status"><span className="dot on" />{data.total} skills activas</div>
            </div>
            <Mascota pose="sentada" size={92} float={false} />
          </div>
          <div className={`vault-voz${data.vozLista ? ' ok' : ''}`}>
            <Icon name="mic" size={14} />
            <div>
              <b>{data.vozLista ? 'Escribe con tu voz' : 'Perfil de voz pendiente'}</b>
              <span>
                {data.transcripciones
                  ? `${data.transcripciones} transcripciones en tu vault.${data.vozLista ? '' : ' Pídele a JARVIS "actualiza mi perfil de voz".'}`
                  : 'JARVIS aprenderá cómo hablas cuando conectes Instagram y transcriba tus reels.'}
              </span>
            </div>
          </div>
        </div>

        <div className="panel panel-pad">
          <div className="panel-head"><span className="label">Categorías principales</span></div>
          <button className={`cat-fila${!categoria ? ' on' : ''}`} onClick={() => setCategoria(null)}>
            <span className="dot" style={{ background: 'var(--text)' }} /> Todas <span className="cuenta">{data.total}</span>
          </button>
          {data.categorias.map((c) => (
            <button key={c.id} className={`cat-fila${categoria === c.id ? ' on' : ''}`} onClick={() => setCategoria(c.id)}>
              <span className="dot" style={{ background: c.color, boxShadow: `0 0 6px ${c.color}` }} /> {c.titulo} <span className="cuenta">{c.total} skills</span>
            </button>
          ))}
        </div>
      </aside>

      {/* Centro: categorías o lista de skills */}
      <div className="panel panel-pad skills-centro">
        <div className="panel-head">
          <div>
            <div className="label">{cat ? cat.titulo : 'Skills de contenido'}</div>
            <div className="ayuda" style={{ marginTop: 3 }}>{cat ? cat.descripcion : 'Herramientas especializadas para cada parte del proceso creativo.'}</div>
          </div>
          <label className="ask buscar-skills">
            <Icon name="search" />
            <input value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value) setCategoria(null); }} placeholder="Buscar skills…" aria-label="Buscar skills" />
          </label>
        </div>

        {!verLista ? (
          <div className="cat-grid">
            {data.categorias.map((c) => (
              <button key={c.id} className="cat-card" onClick={() => setCategoria(c.id)}>
                <div className="cat-card-top">
                  <span className="cat-icono" style={{ background: `color-mix(in srgb, ${c.color} 18%, transparent)`, color: c.color }}><Icon name={c.icono} size={16} /></span>
                  <b>{c.titulo}</b>
                  <span className="cuenta">{c.total} skills</span>
                </div>
                <p>{c.descripcion}</p>
                <span className="cat-accion" style={{ color: c.color }}>{c.accion} →</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="skill-lista">
            {cat && <button className="link-btn" style={{ marginBottom: 10 }} onClick={() => { setCategoria(null); setQ(''); }}>← Todas las categorías</button>}
            {filtradas.map((s) => (
              <div key={s.nombre} className="skill-item">
                <span className="dot" style={{ background: colorDe(s.categoria), boxShadow: `0 0 6px ${colorDe(s.categoria)}` }} />
                <div className="skill-txt">
                  <b>{s.titulo}{s.propia && <span className="tag" style={{ marginLeft: 8, background: 'rgba(34,197,94,.14)', color: 'var(--verde-texto)' }}>tuya</span>}</b>
                  <span>{s.descripcion}</span>
                </div>
                <button className="btn btn-sec" onClick={() => usar(s)}>Usar</button>
              </div>
            ))}
            {!filtradas.length && <div className="vacio">No hay skills que coincidan con "{q}".</div>}
          </div>
        )}
      </div>

      {/* Derecha: chat de guiones */}
      <ChatJarvis
        conversacion="guiones"
        titulo="Chat para guiones"
        subtitulo="Guiones basados en tu contenido, no desde cero."
        intro="Pídele un guion y JARVIS buscará en tus transcripciones antes de escribir."
        placeholder="Escríbeme un guion para un reel sobre…"
        sugerencias={['Escríbeme un guion para un reel sobre ', 'Dame 10 ganchos para un reel sobre ', 'Convierte mi último guion en un carrusel']}
        borrador={borrador}
        onBorradorUsado={() => setBorrador(null)}
      />
    </section>
  );
}
