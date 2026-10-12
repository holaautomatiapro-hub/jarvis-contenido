import { useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import ChatJarvis from '../../components/ChatJarvis.jsx';
import { api, useRecurso } from '../../lib/api.js';
import { fechaCorta } from '../../lib/formato.js';
import { BotonCopiar, Modal } from '../contenido/comun.jsx';
import { urlArchivo } from './comun.jsx';

// Lead magnets: páginas web interactivas (guías, checklists, tests, generadores) que JARVIS hace con tu sistema
// de diseño y publica en Vercel. El enlace se copia o se pone directamente en la pieza que lo anuncia.
const VACIO = { titulo: '', tipo: 'guia', palabra: '', pieza: '', contenido: '', indicaciones: '' };

// En el chat, del encargo largo solo se enseñan las primeras líneas
const resumenPregunta = (t) => (/^(Crea|Rehaz) un LEAD MAGNET/.test(t) ? t.split('\n').slice(0, 3).join('\n') : t);

function Vercel({ v, recargar }) {
  const [abierto, setAbierto] = useState(!v.conectado);
  const [f, setF] = useState({ token: '', equipo: v.equipo || '', proyecto: v.proyecto || 'leadmagnets', dominio: v.dominio || '' });
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true); setAviso(null);
    try {
      const r = await api('/api/laboratorio/leadmagnets/vercel', { method: 'PUT', body: f });
      setAviso({ tipo: 'ok', texto: `Vercel conectado${r.usuario ? ` (${r.usuario})` : ''}. El token se guarda solo en tu servidor.` });
      setF((x) => ({ ...x, token: '' }));
      setAbierto(false);
      recargar();
    } catch (err) { setAviso({ tipo: 'error', texto: err.message }); }
    setGuardando(false);
  };
  return (
    <div className="panel panel-pad lm-vercel">
      <div className="lab-checks">
        <div className={v.conectado ? 'ok' : ''}>
          <Icon name={v.conectado ? 'checkCircle' : 'clock'} size={15} />
          <span>{v.conectado ? <>Vercel conectado <code>{v.final}</code> · se publican en <b>{v.dominio || `${v.proyecto}.vercel.app`}</b>/…</> : 'Conecta Vercel para publicar tus lead magnets con un enlace'}</span>
          <button className="chip" onClick={() => setAbierto((x) => !x)}>{v.conectado ? 'Cambiar' : 'Conectar'}</button>
        </div>
      </div>
      {abierto && (
        <form className="lab-form" onSubmit={guardar} autoComplete="off">
          <label className="lab-campo lab-ancho"><span className="label">Token de Vercel</span>
            <input className="campo" type="password" autoComplete="new-password" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} placeholder={v.conectado ? 'Déjalo vacío para mantener el actual' : 'Pégalo aquí (no lo pegues en el chat)'} />
            <small className="ayuda">Créalo en <a href="https://vercel.com/account/tokens" target="_blank" rel="noreferrer">vercel.com/account/tokens</a> (Create Token, alcance: tu cuenta, sin caducidad o la que prefieras).</small>
          </label>
          <label className="lab-campo"><span className="label">Nombre del proyecto</span>
            <input className="campo" value={f.proyecto} onChange={(e) => setF({ ...f, proyecto: e.target.value })} placeholder="leadmagnets" maxLength={60} />
            <small className="ayuda">Tu enlace será {(f.proyecto || 'leadmagnets').toLowerCase().replace(/[^a-z0-9-]+/g, '-')}.vercel.app/…</small>
          </label>
          <label className="lab-campo"><span className="label">ID del equipo (opcional)</span>
            <input className="campo" value={f.equipo} onChange={(e) => setF({ ...f, equipo: e.target.value })} placeholder="team_… (vacío = tu cuenta personal)" />
          </label>
          <label className="lab-campo lab-ancho"><span className="label">Dominio propio (opcional)</span>
            <input className="campo" value={f.dominio} onChange={(e) => setF({ ...f, dominio: e.target.value })} placeholder="recursos.tudominio.com (añádelo antes al proyecto en Vercel)" />
          </label>
          <div className="modal-pie lab-ancho">
            {aviso && <div className={`aviso ${aviso.tipo}`}>{aviso.texto}</div>}
            <button className="btn" disabled={guardando || (!v.conectado && !f.token.trim())}>{guardando ? 'Comprobando…' : 'Guardar'}</button>
          </div>
        </form>
      )}
      {!abierto && aviso && <div className={`aviso ${aviso.tipo}`}>{aviso.texto}</div>}
    </div>
  );
}

function Banner({ cual, nombre, ruta, recargar }) {
  const input = useRef(null);
  const [estado, setEstado] = useState('');
  const subir = async (f) => {
    if (!f) return;
    setEstado('Subiendo…');
    try {
      const r = await fetch(`/api/laboratorio/leadmagnets/banner?cual=${cual}&nombre=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: f });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'No se pudo subir');
      setEstado(''); recargar();
    } catch (e) { setEstado(e.message); }
  };
  return (
    <div className={`lab-archivo${ruta ? ' ok' : ''}`}>
      {ruta ? <img className="lm-banner" src={`${urlArchivo(ruta)}&v=${Date.now() % 1e6}`} alt="" /> : <Icon name="plus" size={14} />}
      <span className="lab-archivo-txt">{estado || (ruta ? nombre : `${nombre}: la imagen de tu comunidad para el cierre`)}</span>
      <button type="button" className="chip" onClick={() => input.current?.click()}>{ruta ? 'Cambiar' : 'Subir'}</button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { subir(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}

function Tarjeta({ lm, piezas, tipos, ocupado, onCambios, recargar, setAviso }) {
  const [viendo, setViendo] = useState(false);
  const [trabajando, setTrabajando] = useState('');
  const accion = async (que, fn) => {
    setTrabajando(que); setAviso(null);
    try { await fn(); recargar(); } catch (e) { setAviso({ tipo: 'error', texto: e.message }); }
    setTrabajando('');
  };
  const publicar = () => accion('publicar', async () => {
    const r = await api(`/api/laboratorio/leadmagnets/${lm.slug}/publicar`, { method: 'POST' });
    setAviso({ tipo: 'ok', texto: `Publicado: ${r.url}${lm.pieza ? ' (y puesto en su pieza)' : ''}` });
  });
  const quitar = () => window.confirm(`¿Quitar «${lm.titulo}» de internet? El enlace dejará de funcionar.`) && accion('quitar', () => api(`/api/laboratorio/leadmagnets/${lm.slug}/despublicar`, { method: 'POST' }));
  const borrar = () => window.confirm(`¿Borrar «${lm.titulo}»?${lm.url ? ' También se quita de internet.' : ''}`) && accion('borrar', () => api(`/api/laboratorio/leadmagnets/${lm.slug}`, { method: 'DELETE' }));
  const asignar = (pieza) => accion('pieza', async () => {
    await api(`/api/laboratorio/leadmagnets/${lm.slug}/pieza`, { method: 'PUT', body: { pieza: pieza || null } });
    if (pieza) setAviso({ tipo: 'ok', texto: lm.url ? 'Enlace puesto en la pieza (lleva lead magnet).' : 'Pieza marcada con lead magnet: el enlace se pone solo al publicarlo.' });
  });

  return (
    <div className="panel panel-pad lm-tarjeta">
      <button className="lm-captura" onClick={() => lm.html && setViendo(true)} disabled={!lm.html} title={lm.html ? 'Ver en móvil' : ''}>
        {lm.captura ? <img src={`${urlArchivo(lm.captura)}&v=${encodeURIComponent(lm.mod)}`} alt="" loading="lazy" /> : <span><Icon name={lm.html ? 'eye' : 'clock'} size={18} /></span>}
      </button>
      <div className="lm-datos">
        <div className="lm-titulo">
          <b>{lm.titulo}</b>
          <small className="t-dim">{[tipos[lm.tipo]?.split(' (')[0], lm.palabra && `Comenta ${lm.palabra}`, lm.mod && fechaCorta(lm.mod)].filter(Boolean).join(' · ')}</small>
        </div>
        <div className={`lm-estado${lm.url ? ' ok' : ''}`}>
          {!lm.listo ? <><Icon name="clock" size={12} />{ocupado ? 'JARVIS lo está haciendo…' : 'Aún sin página: pídesela a JARVIS'}</>
            : lm.url ? <><Icon name="checkCircle" size={12} /><a href={lm.url} target="_blank" rel="noreferrer">{lm.url.replace(/^https:\/\//, '')}</a>{lm.cambiado && <span className="lm-cambios">cambios sin publicar</span>}</>
              : <><Icon name="eye" size={12} />Lista para revisar y publicar</>}
        </div>
        <label className="lm-pieza">
          <span>Pieza que lo anuncia</span>
          <select className="campo" value={lm.pieza || ''} onChange={(e) => asignar(e.target.value)} disabled={Boolean(trabajando)}>
            <option value="">Ninguna</option>
            {piezas.map((p) => <option key={p.id} value={p.id}>{p.titulo}{p.fecha ? ` · ${p.fecha}` : ''}</option>)}
          </select>
        </label>
        <div className="lab-acciones">
          {lm.html && <button className="chip" onClick={() => setViendo(true)}><Icon name="eye" />Ver</button>}
          {lm.listo && <button className="chip chip-acento" onClick={publicar} disabled={Boolean(trabajando)}><Icon name="publish" />{trabajando === 'publicar' ? 'Publicando…' : lm.url ? (lm.cambiado ? 'Publicar cambios' : 'Volver a publicar') : 'Publicar'}</button>}
          {lm.url && <BotonCopiar texto={lm.url} etiqueta="Copiar enlace" className="chip" />}
          <button className="chip" onClick={() => onCambios(lm)} disabled={ocupado}><Icon name="pen" />{lm.listo ? 'Pedir cambios' : 'Pedírsela'}</button>
          {lm.url && <button className="chip" onClick={quitar} disabled={Boolean(trabajando)}>{trabajando === 'quitar' ? 'Quitando…' : 'Quitar de internet'}</button>}
          <button className="chip" onClick={borrar} disabled={Boolean(trabajando)} aria-label="Borrar"><Icon name="trash" /></button>
        </div>
      </div>
      {viendo && (
        <Modal titulo={lm.titulo} onClose={() => setViendo(false)} ancho={460}>
          <div className="lm-movil"><iframe title={lm.titulo} src={`${urlArchivo(lm.html)}&v=${encodeURIComponent(lm.mod)}`} sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals" /></div>
          <div className="modal-pie">
            <a className="btn btn-sec" href={urlArchivo(lm.html)} download={`${lm.slug}.html`}><Icon name="publish" size={14} />Descargar .html</a>
            <button className="btn" onClick={() => setViendo(false)}>Cerrar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function LeadMagnets({ trabajando }) {
  const [data, recargar, error] = useRecurso('/api/laboratorio/leadmagnets', null);
  const [piezasData] = useRecurso('/api/piezas', []);
  const [f, setF] = useState(VACIO);
  const [rehacer, setRehacer] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const form = useRef(null);
  const piezas = (Array.isArray(piezasData) ? piezasData : piezasData?.piezas || []).filter((p) => p.estado !== 'publicado').slice(0, 200);

  if (!data) return <div className="panel panel-pad vacio">{error ? `No se han podido cargar los lead magnets: ${error}` : 'Cargando…'}</div>;

  const pedirCambios = (lm) => {
    setRehacer(lm);
    setF({ ...VACIO, titulo: lm.titulo, tipo: lm.tipo || 'guia', palabra: lm.palabra || '', pieza: lm.pieza || '' });
    form.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const empezar = async (e) => {
    e.preventDefault();
    setEnviando(true); setAviso(null);
    try {
      await api('/api/laboratorio/empezar', { method: 'POST', body: { tipo: 'leadmagnet', datos: { ...f, slug: rehacer?.slug } } });
      setAviso({ tipo: 'ok', texto: rehacer ? 'JARVIS está cambiando tu lead magnet. Lo revisa en móvil antes de terminar.' : 'JARVIS está haciendo tu lead magnet con tu sistema de diseño. Lo revisa en móvil y te avisa en el chat.' });
      setF(VACIO); setRehacer(null); recargar();
    } catch (err) { setAviso({ tipo: 'error', texto: err.message }); }
    setEnviando(false);
  };

  return (
    <div className="lab-dos">
      <div className="lab-col">
        <Vercel v={data.vercel} recargar={recargar} />

        <form ref={form} className="panel panel-pad" onSubmit={empezar}>
          <div className="panel-head">
            <span className="label">{rehacer ? `Cambiar «${rehacer.titulo}»` : 'Crear un lead magnet'}</span>
            {rehacer && <button type="button" className="link-btn" onClick={() => { setRehacer(null); setF(VACIO); }}>Crear uno nuevo</button>}
          </div>
          <div className="lab-form">
            <label className="lab-campo lab-ancho"><span className="label">De qué va</span>
              <input className="campo" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Guía para contratar a tu primer setter" maxLength={120} required />
            </label>
            <div className="lab-campo lab-ancho"><span className="label">Tipo</span>
              <div className="lab-piezas">
                {Object.entries(data.tipos).map(([id, nombre]) => (
                  <button type="button" key={id} className={`chip${f.tipo === id ? ' chip-acento' : ''}`} onClick={() => setF({ ...f, tipo: id })}>{nombre}</button>
                ))}
              </div>
            </div>
            <label className="lab-campo"><span className="label">Palabra clave</span>
              <input className="campo" value={f.palabra} onChange={(e) => setF({ ...f, palabra: e.target.value.toUpperCase() })} placeholder="SETTER" maxLength={30} />
            </label>
            <label className="lab-campo"><span className="label">Pieza que lo anuncia</span>
              <select className="campo" value={f.pieza} onChange={(e) => setF({ ...f, pieza: e.target.value })}>
                <option value="">Ninguna (o elígela luego)</option>
                {piezas.map((p) => <option key={p.id} value={p.id}>{p.titulo}</option>)}
              </select>
            </label>
            {!rehacer && (
              <label className="lab-campo lab-ancho"><span className="label">Contenido de base (opcional)</span>
                <textarea className="campo" rows={4} value={f.contenido} onChange={(e) => setF({ ...f, contenido: e.target.value })} placeholder="Pega aquí tus pasos, tu checklist, tus notas o el guion del reel. Si lo dejas vacío, JARVIS tira de tus notas y de lo que sabe de tu negocio." />
              </label>
            )}
            <label className="lab-campo lab-ancho"><span className="label">{rehacer ? 'Qué quieres cambiar' : 'Indicaciones (opcional)'}</span>
              <input className="campo" value={f.indicaciones} onChange={(e) => setF({ ...f, indicaciones: e.target.value })} required={Boolean(rehacer)} placeholder={rehacer ? '«Añade un paso sobre el guion de llamada», «el test más corto»…' : '«Que tenga un generador del mensaje de bienvenida», «para entrenadores online»…'} />
            </label>
          </div>
          <div className="lm-banners">
            <span className="label">Banners del cierre (se suben una vez)</span>
            <Banner cual="skool" nombre="Banner de Skool" ruta={data.banners.skool} recargar={recargar} />
            <Banner cual="whatsapp" nombre="Banner de WhatsApp" ruta={data.banners.whatsapp} recargar={recargar} />
          </div>
          {aviso && <div className={`aviso ${aviso.tipo}`}>{aviso.texto}</div>}
          <div className="modal-pie">
            <span className="ayuda">{data.kit ? 'Con la guía y la plantilla de lead magnets de tu sistema de diseño.' : 'Sin sistema de diseño importado: JARVIS usará un diseño limpio.'}</span>
            <button className="btn" disabled={enviando || trabajando || !f.titulo.trim()}><Icon name="sparkle" size={14} />{rehacer ? 'Pedir cambios' : 'Crear con JARVIS'}</button>
          </div>
        </form>

        {data.leadmagnets.map((lm) => <Tarjeta key={lm.slug} lm={lm} piezas={piezas} tipos={data.tipos} ocupado={trabajando} onCambios={pedirCambios} recargar={recargar} setAviso={setAviso} />)}
        {!data.leadmagnets.length && <div className="panel panel-pad vacio">Aquí aparecerán tus lead magnets: los ves como en el móvil, los publicas y copias el enlace.</div>}
      </div>
      <ChatJarvis
        conversacion="laboratorio"
        titulo="JARVIS · Laboratorio"
        subtitulo="Hace la página y la revisa en móvil"
        placeholder="Pídele cambios: «más corto», «añade un test al final»…"
        intro="JARVIS escribe el lead magnet con tu voz, lo monta con tu sistema de diseño y lo revisa a 375 px antes de dártelo. Luego lo publicas tú."
        mostrarPregunta={resumenPregunta}
        conGuardarGuion={false}
      />
    </div>
  );
}
