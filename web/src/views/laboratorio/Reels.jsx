import { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import ChatJarvis from '../../components/ChatJarvis.jsx';
import { api } from '../../lib/api.js';
import { fechaCorta } from '../../lib/formato.js';
import { CampoArchivo, Grupo, Medio, VerMedio, VerTexto } from './comun.jsx';

// Edición de reels: subes tu vídeo hablando a cámara y JARVIS corta los mejores momentos, quita silencios
// y muletillas y le pone tus subtítulos y tu título con la plantilla que elijas.
const VACIO = { nombre: '', video: null, modo: 'mejores', clips: 3, duracion: 45, plantillas: ['pantalla'], titulo: '', muletillas: true, indicaciones: '' };
const AYUDA_PLANTILLA = {
  pantalla: 'El vídeo ocupa todo el reel, con el título arriba y los subtítulos abajo.',
  ventana: 'Tu vídeo en una ventana con marco sobre el fondo de tu marca, como los clips de testimonios.',
  feed: 'Formato 4:5 para el feed, con la ventana y el título.',
};

export default function Reels({ data }) {
  const [f, setF] = useState(VACIO);
  const [aviso, setAviso] = useState(null);
  const [viendo, setViendo] = useState(null);
  const [texto, setTexto] = useState(null);
  const listo = data.plugin.instalado && data.python;
  const alternar = (p) => setF((x) => ({ ...x, plantillas: x.plantillas.includes(p) ? x.plantillas.filter((y) => y !== p) : [...x.plantillas, p] }));

  const empezar = async () => {
    setAviso(null);
    try {
      await api('/api/laboratorio/empezar', { method: 'POST', body: { tipo: 'reel', datos: { ...f, video: f.video.ruta } } });
      setAviso({ tipo: 'ok', texto: 'JARVIS está transcribiendo tu vídeo. Te enseñará los cortes y los títulos en el chat antes de montar.' });
      setF(VACIO);
    } catch (e) { setAviso({ tipo: 'error', texto: e.message }); }
  };

  return (
    <div className="lab-dos">
      <div className="lab-col">
        <div className="panel panel-pad">
          <div className="panel-head"><span className="label">Editar un reel</span></div>
          <div className="lab-form">
            <CampoArchivo etiqueta="Tu vídeo" ayuda="Tú hablando a cámara (vertical u horizontal)" tipo="video" aceptar="video/*,.mp4,.mov,.m4v" valor={f.video} onSubido={(r) => setF((x) => ({ ...x, video: r, nombre: x.nombre || r.nombre.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') }))} />
            <label className="lab-campo"><span className="label">Nombre</span>
              <input className="campo" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Lanzamiento octubre" maxLength={60} />
            </label>
            <div className="lab-campo lab-ancho"><span className="label">Qué quieres</span>
              <div className="seg seg-ancho">
                <button type="button" className={f.modo === 'mejores' ? 'on' : ''} onClick={() => setF({ ...f, modo: 'mejores' })}><Icon name="bolt" />Los mejores momentos</button>
                <button type="button" className={f.modo === 'entero' ? 'on' : ''} onClick={() => setF({ ...f, modo: 'entero' })}><Icon name="play" />El vídeo entero, limpio</button>
              </div>
              {f.modo === 'mejores' && (
                <div className="lab-numeros">
                  <label>Clips <input className="campo" type="number" min={1} max={10} value={f.clips} onChange={(e) => setF({ ...f, clips: e.target.value })} /></label>
                  <label>Duración de cada uno <select className="campo" value={f.duracion} onChange={(e) => setF({ ...f, duracion: Number(e.target.value) })}>{[15, 30, 45, 60, 90].map((d) => <option key={d} value={d}>~{d} s</option>)}</select></label>
                </div>
              )}
            </div>
            <div className="lab-campo lab-ancho"><span className="label">Plantillas</span>
              <div className="lab-plantillas">
                {Object.entries(data.plantillasReel).map(([id, nombre]) => (
                  <button type="button" key={id} className={`lab-plantilla${f.plantillas.includes(id) ? ' on' : ''}`} onClick={() => alternar(id)}>
                    <span className={`lab-mini ${id}`}><i /></span>
                    <b>{nombre}</b><small>{AYUDA_PLANTILLA[id]}</small>
                  </button>
                ))}
              </div>
            </div>
            <label className="lab-campo lab-ancho"><span className="label">Título</span>
              <input className="campo" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Opcional: si lo dejas vacío, JARVIS propone uno con gancho para cada clip" maxLength={80} />
            </label>
            <label className="lab-check"><input type="checkbox" checked={f.muletillas} onChange={(e) => setF({ ...f, muletillas: e.target.checked })} />Quitar muletillas («eh», «em», «mmm») y silencios</label>
            <label className="lab-campo lab-ancho"><span className="label">Indicaciones</span>
              <input className="campo" value={f.indicaciones} onChange={(e) => setF({ ...f, indicaciones: e.target.value })} placeholder="Opcional: «empieza por la parte del precio», «CTA: comenta GUÍA»…" />
            </label>
          </div>
          {aviso && <div className={`aviso ${aviso.tipo}`}>{aviso.texto}</div>}
          <div className="modal-pie">
            <span className="ayuda">{listo ? 'Subtítulos y títulos con tu marca del Laboratorio.' : 'Primero completa la preparación de arriba.'}</span>
            <button className="btn" onClick={empezar} disabled={!listo || !f.video || !f.plantillas.length || data.trabajando}><Icon name="sparkle" size={14} />Editar el reel</button>
          </div>
        </div>

        {data.reels.map((r) => (
          <div key={r.nombre} className="panel panel-pad lab-resultado">
            <div className="panel-head">
              <div><span className="label">Reel</span><h3>{r.nombre}</h3>{r.mod && <small className="t-dim">Actualizado {fechaCorta(r.mod)}</small>}</div>
              <div className="lab-acciones">{r.caption && <button className="chip" onClick={() => setTexto({ ruta: r.caption, titulo: `Captions · ${r.nombre}` })}><Icon name="doc" />Captions</button>}</div>
            </div>
            {r.grupos.map((g) => <Grupo key={g.id} g={g} titulo={r.nombre} formatoPorDefecto={() => 'Reel'} setAviso={setAviso} />)}
            {!r.grupos.length && r.previas.length > 0 && (
              <div className="lab-grupo"><div className="lab-grupo-head"><b>Pruebas</b></div><div className="lab-medios">{r.previas.map((a) => <Medio key={a.ruta} a={a} onVer={setViendo} />)}</div></div>
            )}
          </div>
        ))}
        {!data.reels.length && <div className="panel panel-pad vacio">Aquí aparecerán tus reels editados, listos para pasar a la biblioteca.</div>}
      </div>
      <ChatJarvis
        conversacion="laboratorio"
        titulo="JARVIS · Laboratorio"
        subtitulo="Te enseña los cortes antes de montar"
        placeholder="Responde a JARVIS o pídele cambios: «el 2 más corto», «otro título»…"
        intro="JARVIS transcribe tu vídeo, elige los mejores momentos y te enseña cada clip (título, texto y duración). Con tu visto bueno, lo monta."
        conGuardarGuion={false}
      />
      {viendo && <VerMedio a={viendo} onClose={() => setViendo(null)} />}
      {texto && <VerTexto {...texto} onClose={() => setTexto(null)} />}
    </div>
  );
}
