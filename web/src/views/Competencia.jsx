import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import { api, useRecurso } from '../lib/api.js';
import { num } from '../lib/formato.js';
import MejoresCompetencia from './CompetenciaMejores.jsx';

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
  if (!data) return <section className="panel soon"><div className="t-dim">Cargando competencia…</div></section>;

  const sincronizar = async () => {
    try { await api('/api/competencia/sincronizar', { method: 'POST' }); setAviso({ tipo: 'ok', texto: 'Sincronizando competidores… los datos se actualizarán solos.' }); } catch (e) { setAviso({ tipo: 'error', texto: e.message }); }
  };

  return (
    <section className="comp-vista solo-mejores">
      <div className="col">
        <Perfiles data={data} recargar={recargar} setAviso={setAviso} />
        {data.conectado && <button className="btn btn-sec" onClick={sincronizar} disabled={data.sincronizando}><Icon name="refresh" size={14} />{data.sincronizando ? 'Sincronizando…' : 'Sincronizar ahora'}</button>}
        {aviso && <div className={`aviso ${aviso.tipo}`}>{aviso.texto}<button className="link-btn" onClick={() => setAviso(null)}>Cerrar</button></div>}
      </div>
      <MejoresCompetencia data={data} />
    </section>
  );
}
