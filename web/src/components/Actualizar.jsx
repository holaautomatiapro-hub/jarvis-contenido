import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { api, useRecurso } from '../lib/api.js';

const fechaCorta = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace('.', '') : '—');

// Actualizar JARVIS: mira si hay cambios en GitHub, los enseña y (en el VPS) se actualiza y se reinicia solo
export default function Actualizar() {
  const [e, recargar, error, setE] = useRecurso('/api/actualizar', null);
  const [haciendo, setHaciendo] = useState('');
  const [aviso, setAviso] = useState('');
  const actualizando = e?.actualizando || haciendo === 'actualizar';
  // Mientras se actualiza, JARVIS se reinicia: se pregunta cada 5 s hasta que vuelve y ha terminado
  useEffect(() => {
    if (!actualizando) return undefined;
    const id = setInterval(() => recargar(), 5000);
    return () => clearInterval(id);
  }, [actualizando, recargar]);
  useEffect(() => { if (e && !e.actualizando && haciendo === 'actualizar' && e.ultima?.estado && e.ultima.estado !== 'actualizando') setHaciendo(''); }, [e, haciendo]);
  if (!e) return error ? null : <div className="panel panel-pad actualizar"><span className="t-dim">Cargando…</span></div>;
  if (!e.disponible) return <div className="panel panel-pad actualizar"><div className="label">JARVIS</div><p className="ayuda">{e.motivo}</p></div>;

  const comprobar = async () => {
    setHaciendo('comprobar'); setAviso('');
    try { setE(await api('/api/actualizar/comprobar', { method: 'POST' })); } catch (x) { setAviso(x.message); }
    setHaciendo('');
  };
  const actualizar = async (aunqueOcupado = false) => {
    setHaciendo('actualizar'); setAviso('');
    try { await api('/api/actualizar', { method: 'POST', body: { aunqueOcupado } }); recargar(); } catch (x) {
      setHaciendo('');
      if (/está trabajando/.test(x.message) && window.confirm(`${x.message}\n\n¿Actualizar igualmente? Lo que esté haciendo se cortará.`)) return actualizar(true);
      setAviso(x.message);
    }
    return undefined;
  };
  const pendientes = e.comprobado?.pendientes || [];
  const u = e.ultima;
  return (
    <div className="panel panel-pad actualizar">
      <div className="panel-head">
        <div>
          <span className="label">JARVIS</span>
          <div className="ayuda" style={{ marginTop: 3 }}>Versión del {fechaCorta(e.actual?.fecha)}{e.actual?.titulo ? ` · «${e.actual.titulo}»` : ''}</div>
        </div>
        <button className="btn btn-sec" onClick={comprobar} disabled={Boolean(haciendo) || actualizando}><Icon name="refresh" size={14} />{haciendo === 'comprobar' ? 'Mirando…' : 'Buscar actualizaciones'}</button>
      </div>
      {actualizando ? (
        <div className="actualizar-curso">
          <div className="aviso ig-aviso"><span className="cursor" />Actualizando… Tarda unos minutos y JARVIS se reinicia en medio: si la página deja de responder un momento, es normal. Cuando termine, recarga con Ctrl+F5.</div>
          {e.log && <pre className="actualizar-log">{e.log}</pre>}
        </div>
      ) : (
        <>
          {u?.estado === 'ok' && u.fin && <div className="aviso ok">Última actualización: {fechaCorta(u.fin)}{u.desde && u.hasta && u.desde !== u.hasta ? ` (de ${u.desde} a ${u.hasta})` : ''}. Si no ves los cambios, recarga con Ctrl+F5.</div>}
          {u?.estado === 'error' && <div className="aviso error">{u.cortada ? 'La última actualización se cortó.' : 'La última actualización falló.'} Vuelve a probar o ejecuta  bash ~/instalar-vps.sh  en el servidor.{e.log && <pre className="actualizar-log">{e.log}</pre>}</div>}
          {e.comprobado && (pendientes.length ? (
            <div className="actualizar-lista">
              <b>{pendientes.length === 1 ? 'Hay 1 cambio nuevo' : `Hay ${pendientes.length} cambios nuevos`}</b>
              <ul>{pendientes.map((c) => <li key={c.commit}><span>{c.titulo}</span><small className="t-dim">{fechaCorta(c.fecha)}</small></li>)}</ul>
              {e.puedeSola
                ? <button className="btn" onClick={() => actualizar()} disabled={Boolean(haciendo)}><Icon name="bolt" size={14} />Actualizar ahora</button>
                : <p className="ayuda">{e.secundario ? <>Este JARVIS se actualiza a la vez que el principal del servidor: cuando se actualiza el otro, este también.</> : e.plataforma === 'win32' ? <>En el PC: en PowerShell, dentro de la carpeta de JARVIS, <code>git pull</code> y luego <code>powershell -ExecutionPolicy Bypass -File instalar.ps1</code>.</> : <>Ejecuta <code>bash ~/instalar-vps.sh</code> en el servidor.</>}</p>}
            </div>
          ) : <div className="aviso ok">Está al día (mirado {fechaCorta(e.comprobado.en)}).</div>)}
        </>
      )}
      {aviso && <div className="aviso error">{aviso}</div>}
    </div>
  );
}
