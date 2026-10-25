import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api, useRecurso } from '../../lib/api.js';

// Fotos con IA (Kie AI, nano-banana-pro): tus fotos de referencia, tus correcciones de identidad y una prueba rápida.
// Claude las usa solo al diseñar (generar_foto) cuando no hay una foto real que sirva.
const FORMATOS = [['4:5', 'Carrusel 4:5'], ['9:16', 'Story 9:16'], ['1:1', 'Cuadrada 1:1'], ['16:9', 'Horizontal 16:9']];

export default function FotosIa() {
  const [abierto, setAbierto] = useState(false);
  const [e, recargar] = useRecurso(abierto ? '/api/fotos-ia' : null, null);
  const [aviso, setAviso] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [identidad, setIdentidad] = useState(null);
  const [prueba, setPrueba] = useState({ descripcion: '', conmigo: true, formato: '4:5' });
  const [trabajo, setTrabajo] = useState(null);
  const input = useRef(null);
  const [clave, setClave] = useState('');
  const [guardandoClave, setGuardandoClave] = useState(false);
  const [cambiandoClave, setCambiandoClave] = useState(false);
  const [creditos, setCreditos] = useState(null);
  const conectar = async () => {
    setGuardandoClave(true); setAviso('');
    try {
      const r = await api('/api/fotos-ia/clave', { method: 'PUT', body: { clave: clave.trim() } });
      setClave(''); setCambiandoClave(false); setCreditos(r.creditos ?? null);
      setAviso('Clave guardada en el servidor.'); recargar();
    } catch (err) { setAviso(`No se pudo guardar la clave: ${err.message}`); }
    setGuardandoClave(false);
  };

  useEffect(() => { if (e && identidad === null) setIdentidad(e.identidadTexto || ''); }, [e]); // eslint-disable-line react-hooks/exhaustive-deps
  // Mientras se genera la prueba, se pregunta cada pocos segundos
  useEffect(() => {
    if (!trabajo || trabajo.estado !== 'generando') return undefined;
    const t = setTimeout(async () => {
      try { setTrabajo(await api(`/api/fotos-ia/${trabajo.id}`)); } catch (err) { setTrabajo({ estado: 'error', error: err.message }); }
    }, 4000);
    return () => clearTimeout(t);
  }, [trabajo]);
  useEffect(() => { if (trabajo?.estado === 'listo') recargar(); }, [trabajo?.estado]); // eslint-disable-line react-hooks/exhaustive-deps

  const subir = async (lista) => {
    const fotos = [...(lista || [])];
    if (!fotos.length) return;
    setSubiendo(true); setAviso('');
    try {
      for (const f of fotos) {
        const r = await fetch(`/api/laboratorio/subir?tipo=cara&nombre=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`);
      }
      recargar();
    } catch (err) { setAviso(`No se pudo subir: ${err.message}`); }
    setSubiendo(false);
    if (input.current) input.current.value = '';
  };
  const borrar = async (ruta) => {
    try { await api(`/api/laboratorio/archivo?ruta=${encodeURIComponent(ruta)}`, { method: 'DELETE' }); recargar(); } catch (err) { setAviso(err.message); }
  };
  const guardarIdentidad = async () => {
    try { await api('/api/fotos-ia/identidad', { method: 'PUT', body: { texto: identidad } }); setAviso('Guardado.'); recargar(); } catch (err) { setAviso(err.message); }
  };
  const generar = async () => {
    setAviso('');
    try { const r = await api('/api/fotos-ia', { method: 'POST', body: prueba }); setTrabajo({ ...r, estado: 'generando' }); } catch (err) { setAviso(err.message); }
  };

  return (
    <div className="panel panel-pad fotos-ia">
      <button className="fotos-ia-cab" onClick={() => setAbierto(!abierto)} aria-expanded={abierto}>
        <Icon name="palette" size={15} />
        <b>Fotos con IA</b>
        <small>Kie AI · nano-banana-pro. Claude las crea al diseñar cuando no hay una foto real que sirva, también contigo.</small>
        <span className={`fotos-ia-flecha${abierto ? ' on' : ''}`}><Icon name="chevron" size={14} /></span>
      </button>
      {abierto && !e && <p className="ayuda">Cargando…</p>}
      {abierto && e && (
        <div className="fotos-ia-cuerpo">
          <div className="label">Clave de Kie AI</div>
          {e.configurado && !cambiandoClave
            ? <p className="ayuda">Conectado ({e.final}).{creditos != null && ` Te quedan ${creditos} créditos.`} <button type="button" className="link-btn" onClick={() => setCambiandoClave(true)}>Cambiar la clave</button></p>
            : (
              <div className="fotos-ia-fila">
                <input className="campo" type="password" autoComplete="off" value={clave} onChange={(ev) => setClave(ev.target.value)} placeholder="Pega aquí tu API key de kie.ai (kie.ai → API Key)" style={{ flex: 1, minWidth: 220 }} />
                <button className="btn" onClick={conectar} disabled={guardandoClave || clave.trim().length < 16}>{guardandoClave ? 'Comprobando…' : 'Guardar clave'}</button>
              </div>
            )}
          <div className="label">Tus fotos de referencia ({e.referencias}/{e.maxReferencias})</div>
          <p className="ayuda">Las usa para que salgas tú. Lo ideal son 8: cuerpo entero, medio cuerpo, cara de frente, de tres cuartos y de perfil, con buena luz.</p>
          <div className="fotos-ia-caras">
            {e.fotosCara.map((f) => (
              <div key={f.ruta} className="fotos-ia-cara" style={{ backgroundImage: `url("/api/laboratorio/archivo?ruta=${encodeURIComponent(f.ruta)}")` }} title={f.nombre}>
                <button onClick={() => borrar(f.ruta)} aria-label={`Quitar ${f.nombre}`}><Icon name="x" size={12} /></button>
              </div>
            ))}
            {e.referencias < e.maxReferencias && (
              <button className="fotos-ia-cara mas" onClick={() => input.current?.click()} disabled={subiendo}><Icon name="plus" size={16} />{subiendo ? 'Subiendo…' : 'Subir'}</button>
            )}
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(ev) => subir(ev.target.files)} />
          </div>

          <div className="label">Correcciones de tu cara (opcional, en inglés)</div>
          <p className="ayuda">Lo que la IA suele fallar contigo: color de ojos, pelo, barba, tatuajes… Una corrección por línea, en positivo y concreta.</p>
          <textarea className="campo" rows={5} value={identidad ?? ''} onChange={(ev) => setIdentidad(ev.target.value)} placeholder={'1. His irises are DARK BROWN. Never blue or green.\n2. Hair: short faded sides, top styled UP into a messy quiff.'} />
          <div><button className="btn btn-sec" onClick={guardarIdentidad} disabled={identidad === (e.identidadTexto || '')}>Guardar correcciones</button></div>

          <div className="label">Probar</div>
          <textarea className="campo" rows={3} value={prueba.descripcion} onChange={(ev) => setPrueba({ ...prueba, descripcion: ev.target.value })} placeholder="En inglés: dónde está, qué hace, qué lleva, objetos, luz y tipo de foto. Ej.: speaking on stage at a fitness event, black t-shirt, headset mic, warm stage lights, sharp, shallow depth of field" />
          <div className="fotos-ia-fila">
            <label className="fotos-ia-check"><input type="checkbox" checked={prueba.conmigo} onChange={(ev) => setPrueba({ ...prueba, conmigo: ev.target.checked })} />Salgo yo</label>
            <select className="campo" value={prueba.formato} onChange={(ev) => setPrueba({ ...prueba, formato: ev.target.value })}>
              {FORMATOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
            <button className="btn" onClick={generar} disabled={!e.configurado || trabajo?.estado === 'generando' || prueba.descripcion.trim().length < 8 || (prueba.conmigo && !e.referencias)}>
              <Icon name="sparkle" size={14} />{trabajo?.estado === 'generando' ? 'Generando… (1-3 min)' : `Generar (~${e.costeAprox.toFixed(2).replace('.', ',')} €)`}
            </button>
          </div>
          <small className="ayuda">Hoy: {e.hoy} de {e.maxDia} fotos. Se guardan en la biblioteca, carpeta «Fotos con IA».</small>
          {trabajo?.estado === 'error' && <div className="aviso error">{trabajo.error}</div>}
          {trabajo?.estado === 'listo' && (
            <div className="fotos-ia-resultado">
              {trabajo.fotos.map((f) => <a key={f.url} href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt="Foto generada" /></a>)}
            </div>
          )}
          {aviso && <div className={`aviso${/No se pudo|Error|Falta/i.test(aviso) ? ' error' : ' ok'}`}>{aviso}</div>}
        </div>
      )}
    </div>
  );
}
