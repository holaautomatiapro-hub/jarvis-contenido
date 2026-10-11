import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import { api, useRecurso } from '../lib/api.js';
import { fechaCorta, hace, num } from '../lib/formato.js';

const COLOR_FORMATO = { Reels: '#3987e5', Carruseles: '#d95926', 'Imágenes': '#199e70' };

function Perfiles({ data, recargar, setAviso }) {
  const [usuario, setUsuario] = useState('');
  const anadir = async (e) => {
    e.preventDefault();
    try { await api('/api/competencia/perfiles', { method: 'POST', body: { usuario } }); setUsuario(''); recargar(); } catch (err) { setAviso({ tipo: 'error', texto: err.message }); }
  };
  const quitar = async (u) => { if (confirm(`¿Quitar @${u} de la competencia?`)) { await api(`/api/competencia/perfiles/${u}`, { method: 'DELETE' }); recargar(); } };
  const activar = async (p) => { await api(`/api/competencia/perfiles/${p.username}`, { method: 'PATCH', body: { activo: !p.activo } }); recargar(); };
  const estadoPerfil = (p) => (p.error ? <span className="t-err">{p.error}</span> : p.ultima_sync ? `${num(p.seguidores)} seguidores` : data.conectado ? 'Pendiente de sincronizar' : 'Conecta Instagram para analizarlo');

  return (
    <aside className="panel panel-pad comp-perfiles">
      <div className="panel-head"><span className="label">Perfiles a analizar</span></div>
      <p className="ayuda" style={{ margin: '-4px 0 12px' }}>JARVIS mira sus publicaciones públicas cada día.</p>
      <form className="fila" onSubmit={anadir}>
        <input className="campo" value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="@usuario o enlace" aria-label="Añadir perfil" />
        <button className="btn btn-ico" aria-label="Añadir perfil" disabled={!usuario.trim()}><Icon name="plus" size={15} /></button>
      </form>
      {data.perfiles.map((p) => (
        <div key={p.username} className={`perfil${p.activo ? '' : ' apagado'}`}>
          <button className={`check${p.activo ? ' on' : ''}`} onClick={() => activar(p)} aria-label={p.activo ? 'Excluir del análisis' : 'Incluir en el análisis'}>{p.activo && <Icon name="check" size={11} stroke={3} />}</button>
          {p.foto ? <img src={p.foto} alt="" className="perfil-foto" /> : <span className="perfil-foto vacia">{p.username[0].toUpperCase()}</span>}
          <div className="perfil-txt">
            <b>@{p.username}</b>
            <small>{estadoPerfil(p)}</small>
          </div>
          <button className="borrar" onClick={() => quitar(p.username)} aria-label={`Quitar @${p.username}`}>✕</button>
        </div>
      ))}
      {!data.perfiles.length && <div className="vacio">Añade los perfiles que quieres investigar.</div>}
      {data.demo && data.perfilesDemo && (
        <div className="comp-demo-perfiles">
          <div className="label" style={{ marginBottom: 6 }}>En el ejemplo</div>
          {data.perfilesDemo.map((p) => <div key={p.username} className="ayuda">@{p.username} · ficticio · {num(p.seguidores)} seguidores</div>)}
        </div>
      )}
    </aside>
  );
}

export default function Competencia() {
  const [data, recargar] = useRecurso('/api/competencia', null);
  const [aviso, setAviso] = useState(null);
  const [guardadas, setGuardadas] = useState({});
  if (!data) return <section className="panel soon"><div className="t-dim">Cargando competencia…</div></section>;

  const a = data.analisis;
  const porId = Object.fromEntries(data.publicaciones.map((m) => [m.id, m]));
  const maxEng = Math.max(1, ...data.mejoresGanchos.map((g) => g.engagement || 0));
  const maxFmt = Math.max(1, ...data.formatos.map((f) => f.engagementMedio));
  const reales = data.perfiles.map((p) => `@${p.username}`).join(' y ');

  const sincronizar = async () => {
    try { await api('/api/competencia/sincronizar', { method: 'POST' }); setAviso({ tipo: 'ok', texto: 'Sincronizando competidores… los datos se actualizarán solos.' }); } catch (e) { setAviso({ tipo: 'error', texto: e.message }); }
  };
  const analizar = async () => {
    try { await api('/api/competencia/analizar', { method: 'POST' }); setAviso({ tipo: 'ok', texto: 'JARVIS está analizando a tu competencia. Tarda un par de minutos; el resultado aparecerá aquí y en 04-Competencia.' }); recargar(); } catch (e) { setAviso({ tipo: 'error', texto: e.message }); }
  };
  const guardarIdea = async (idea, i) => {
    const texto = `${idea.titulo}\n\nFormato: ${idea.formato}\nGancho: ${idea.gancho}\n\n${idea.porque}${idea.inspiradoEn && porId[idea.inspiradoEn] ? `\n\nInspirada en @${porId[idea.inspiradoEn].username}: ${porId[idea.inspiradoEn].permalink || porId[idea.inspiradoEn].gancho}` : ''}`;
    try { await api('/api/ideas', { method: 'POST', body: { texto, formato: idea.formato?.toLowerCase() } }); setGuardadas((g) => ({ ...g, [i]: true })); } catch (e) { setAviso({ tipo: 'error', texto: e.message }); }
  };

  return (
    <section className="comp-vista">
      <Perfiles data={data} recargar={recargar} setAviso={setAviso} />

      <div className="col">
        <div className="panel panel-pad">
          <div className="panel-head">
            <div>
              <span className="label">Análisis de competencia</span>
              <div className="ayuda" style={{ marginTop: 3 }}>
                {data.demo
                  ? `Ejemplo con perfiles ficticios. ${reales ? `${reales} se analizarán` : 'Tus competidores se analizarán'} cuando conectes Instagram y sincronices.`
                  : `JARVIS detecta sus mejores ganchos, temas, formatos y patrones.${a?.fecha ? ` Último análisis: ${hace(a.fecha.replace(' ', 'T'))}.` : ''}`}
              </div>
            </div>
            <div className="ig-controles">
              {data.conectado && <button className="btn btn-sec" onClick={sincronizar} disabled={data.sincronizando}><Icon name="refresh" size={14} />{data.sincronizando ? 'Sincronizando…' : 'Sincronizar'}</button>}
              <button className="btn" onClick={analizar} disabled={data.demo || data.analizando}><Icon name="sparkle" size={14} />{data.analizando ? 'Analizando…' : 'Analizar con JARVIS'}</button>
            </div>
          </div>
          {aviso && <div className={`aviso ${aviso.tipo}`} style={{ marginBottom: 12 }}>{aviso.texto}<button className="link-btn" onClick={() => setAviso(null)}>Cerrar</button></div>}
          {a?.resumen && <p className="comp-resumen">{a.resumen}</p>}

          <div className="comp-grid">
            <div className="comp-bloque">
              <div className="comp-titulo"><Icon name="bolt" size={14} color="var(--pink)" />Mejores ganchos</div>
              {data.mejoresGanchos.map((g, i) => (
                <div key={g.id} className="gancho-comp" title={`${num(g.interacciones)} interacciones · ${g.formato}`}>
                  <span className="insight-n">{i + 1}</span>
                  <div>
                    <span>“{g.gancho}”</span>
                    <small>@{g.username} · {g.formato}</small>
                  </div>
                  <div className="bar mini"><span style={{ width: `${((g.engagement || 0) / maxEng) * 100}%`, background: 'var(--accent-2)' }} /></div>
                  <span className="bar-pct">{g.engagement ?? '—'}%</span>
                </div>
              ))}
              {!data.mejoresGanchos.length && <div className="vacio">Sin publicaciones todavía.</div>}
              <div className="ayuda" style={{ marginTop: 6 }}>% = interacciones / seguidores.</div>
            </div>

            <div className="comp-bloque">
              <div className="comp-titulo"><Icon name="sparkle" size={14} color="var(--orange)" />Temas que más funcionan</div>
              {a?.temas?.length ? a.temas.map((t) => (
                <div key={t.tema} className="insight-fila" title={t.detalle}>
                  <span className="leyenda-marca" style={{ background: 'var(--accent-2)' }} />
                  <span className="insight-nombre">{t.tema}</span>
                  <div className="bar"><span style={{ width: `${t.pct}%`, background: 'var(--accent-2)' }} /></div>
                  <span className="bar-pct">{t.pct}%</span>
                </div>
              )) : <div className="vacio">Pulsa “Analizar con JARVIS” para detectar los temas.</div>}
            </div>

            <div className="comp-bloque">
              <div className="comp-titulo"><Icon name="layers" size={14} color="var(--purple)" />Formatos ganadores</div>
              {data.formatos.map((f) => (
                <div key={f.formato} className="insight-fila" title={`${f.piezas} publicaciones (${f.pct}% del total)`}>
                  <span className="leyenda-marca" style={{ background: COLOR_FORMATO[f.formato] }} />
                  <span className="insight-nombre">{f.formato} <small className="t-dim">· {f.piezas}</small></span>
                  <div className="bar"><span style={{ width: `${(f.engagementMedio / maxFmt) * 100}%`, background: COLOR_FORMATO[f.formato] }} /></div>
                  <span className="bar-pct">{f.engagementMedio}%</span>
                </div>
              ))}
              {data.frecuencia.length > 0 && (
                <div className="frecuencia">
                  {data.frecuencia.map((f) => <span key={f.username}>@{f.username}: <b>{f.porSemana}</b> publicaciones/semana</span>)}
                </div>
              )}
            </div>

            <div className="comp-bloque">
              <div className="comp-titulo"><Icon name="target" size={14} color="var(--green)" />Patrones detectados</div>
              {a?.patrones?.length ? a.patrones.map((p) => (
                <div key={p.titulo} className="patron"><b>{p.titulo}</b><span>{p.detalle}</span></div>
              )) : <div className="vacio">Aquí aparecerán las estructuras que se repiten en sus mejores publicaciones.</div>}
            </div>
          </div>
        </div>
      </div>

      <aside className="panel panel-pad comp-ideas">
        <div className="panel-head">
          <div>
            <span className="label">Ideas adaptadas a tu negocio</span>
            <div className="ayuda" style={{ marginTop: 3 }}>No copies: entiende qué funciona y crea tu versión.</div>
          </div>
        </div>
        {a?.ideas?.length ? a.ideas.map((idea, i) => {
          const ins = idea.inspiradoEn ? porId[idea.inspiradoEn] : null;
          return (
            <div key={i} className="idea-card">
              <span className="miniatura" style={ins?.miniatura ? { backgroundImage: `url("${ins.miniatura}")` } : { background: `color-mix(in srgb, ${COLOR_FORMATO[ins?.formato] || '#3987e5'} 30%, var(--panel-2))` }}>
                {!ins?.miniatura && <Icon name="bulb" size={13} />}
              </span>
              <div className="idea-txt">
                <div className="idea-tags"><span className="tag" style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent-texto)' }}>{idea.formato}</span>{ins && <small>inspirada en @{ins.username} · {ins.engagement}%</small>}</div>
                <b>{idea.titulo}</b>
                {idea.gancho && <span className="idea-gancho">“{idea.gancho}”</span>}
                <span className="idea-porque">{idea.porque}</span>
                <button className="link-btn" disabled={data.demo || guardadas[i]} onClick={() => guardarIdea(idea, i)}>
                  {guardadas[i] ? '✓ Guardada en Ideas' : data.demo ? 'Ejemplo' : '+ Guardar como idea'}
                </button>
              </div>
            </div>
          );
        }) : <div className="vacio">JARVIS propondrá ideas adaptadas tras analizar a tu competencia.</div>}
        {a?.nota && <div className="ayuda" style={{ marginTop: 10 }}>Análisis completo en tu vault: {a.nota}{a.fecha ? ` (${fechaCorta(a.fecha.replace(' ', 'T'))})` : ''}</div>}
      </aside>
    </section>
  );
}
