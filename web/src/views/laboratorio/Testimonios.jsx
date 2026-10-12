import { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import ChatJarvis from '../../components/ChatJarvis.jsx';
import { api } from '../../lib/api.js';
import { fechaCorta } from '../../lib/formato.js';
import { CampoArchivo, Grupo, Medio, VerMedio, VerTexto, enviarGrupo, textoEnviadas, urlArchivo } from './comun.jsx';

// Testimonios: de la entrevista de un cliente a stories, carrusel en vídeo, clips (reel, 4:5, YouTube),
// portada y 3 captions, con tu plugin y tu marca. Claude lo prepara, te enseña el guion y, con tu sí, lo monta.
const VACIO = { cliente: '', entrevista: null, foto: null, frase: '', queHicimos: '', indicaciones: '', piezas: null };
// Tipo de pieza en Contenido: cada story es una publicación; el carrusel en vídeo, una sola con todos sus vídeos
const formatoDe = (g) => (/stories/.test(g.id) ? 'Story' : g.id === 'carrusel-video' ? 'Carrusel' : /youtube/.test(g.id) ? 'YouTube' : 'Reel');

export default function Testimonios({ data, recargar }) {
  const [f, setF] = useState(VACIO);
  const [aviso, setAviso] = useState(null);
  const [viendo, setViendo] = useState(null);
  const [texto, setTexto] = useState(null);
  const piezas = f.piezas || Object.keys(data.piezasTestimonio);
  const listo = data.plugin.instalado && data.python;

  const empezar = async (tipo, datos) => {
    setAviso(null);
    try {
      await api('/api/laboratorio/empezar', { method: 'POST', body: { tipo, datos } });
      setAviso({ tipo: 'ok', texto: tipo === 'marca' ? 'JARVIS te va a hacer unas preguntas sobre tu diseño en el chat de la derecha.' : 'JARVIS está preparando el testimonio: primero transcribe y te enseña el guion en el chat. No monta nada hasta que le des el visto bueno.' });
      if (tipo === 'testimonio') setF(VACIO);
    } catch (e) { setAviso({ tipo: 'error', texto: e.message }); }
  };
  // Todo lo de un cliente a la biblioteca de una vez (stories, carrusel, clips y portadas), sin duplicar lo que ya estaba
  const [enviando, setEnviando] = useState(null);
  const todoABiblioteca = async (t) => {
    setEnviando(t.cliente); setAviso(null);
    try {
      let n = 0;
      if (t.portadas.length) n += await enviarGrupo({ id: 'portadas', nombre: 'Portadas', archivos: t.portadas }, t.cliente, () => 'Post');
      // Lo de Instagram: los clips en 4:5 y los de YouTube son otra versión de los mismos clips y se pasan a mano si se quieren
      for (const g of t.grupos.filter((x) => !/youtube|4x5/.test(x.id))) n += await enviarGrupo(g, t.cliente, formatoDe);
      setAviso({ tipo: 'ok', texto: textoEnviadas(n) });
    } catch (e) { setAviso({ tipo: 'error', texto: e.message }); }
    setEnviando(null);
  };
  const alternarPieza = (p) => setF((x) => ({ ...x, piezas: piezas.includes(p) ? piezas.filter((y) => y !== p) : [...piezas, p] }));

  return (
    <div className="lab-dos">
      <div className="lab-col">
        <div className="panel panel-pad lab-marca">
          {data.marca.muestra ? <button className="lab-marca-img" onClick={() => setViendo({ ruta: data.marca.muestra, nombre: 'Tu marca' })}><img src={`${urlArchivo(data.marca.muestra)}&v=${data.marca.fecha || ''}`} alt="Muestra de tu marca" /></button>
            : <span className="lab-marca-img vacia"><Icon name="palette" size={20} /></span>}
          <div>
            <span className="label">Tu marca</span>
            <b>{data.marca.verificado ? `${data.marca.nombre || 'Marca'} ${data.marca.usuario || ''}` : 'Sin fijar'}</b>
            <small>{data.marca.verificado ? 'Colores, letra, logo y tono de los captions de tus testimonios.' : 'La primera vez, JARVIS te pregunta tus colores, tu letra, tu logo y cómo escribes los captions.'}</small>
          </div>
          <button className="btn btn-sec" onClick={() => empezar('marca', {})} disabled={!data.plugin.instalado || data.trabajando}><Icon name="palette" size={14} />{data.marca.verificado ? 'Cambiar mi marca' : 'Configurar mi marca'}</button>
        </div>

        <div className="panel panel-pad">
          <div className="panel-head"><span className="label">Nuevo testimonio</span></div>
          <div className="lab-form">
            <label className="lab-campo"><span className="label">Cliente</span>
              <input className="campo" value={f.cliente} onChange={(e) => setF({ ...f, cliente: e.target.value })} placeholder="María López" maxLength={60} />
            </label>
            <CampoArchivo etiqueta="Entrevista (vídeo)" ayuda="La grabación de Zoom o del móvil" tipo="entrevista" aceptar="video/*,.mp4,.mov,.m4v,.mkv" valor={f.entrevista} onSubido={(r) => setF((x) => ({ ...x, entrevista: r }))} />
            <CampoArchivo etiqueta="Foto del cliente (para la portada)" ayuda="Opcional" tipo="foto" cliente={f.cliente} aceptar="image/*" valor={f.foto} onSubido={(r) => setF((x) => ({ ...x, foto: r }))} deshabilitado={!f.cliente.trim()} />
            <label className="lab-campo"><span className="label">Frase de la portada</span>
              <input className="campo" value={f.frase} onChange={(e) => setF({ ...f, frase: e.target.value })} placeholder="He duplicado mis agendas en 3 meses (opcional)" maxLength={140} />
            </label>
            <label className="lab-campo lab-ancho"><span className="label">Qué hicimos con el cliente</span>
              <textarea className="campo" rows={2} value={f.queHicimos} onChange={(e) => setF({ ...f, queHicimos: e.target.value })} placeholder="Cómo le ayudaste (si lo dejas vacío, JARVIS te lo pregunta: no lo inventa)" />
            </label>
            <div className="lab-campo lab-ancho"><span className="label">Qué sacar</span>
              <div className="lab-piezas">
                {Object.entries(data.piezasTestimonio).map(([id, nombre]) => (
                  <button type="button" key={id} className={`chip filtro-chip${piezas.includes(id) ? ' on' : ''}`} onClick={() => alternarPieza(id)}>{piezas.includes(id) ? '✓ ' : ''}{nombre}</button>
                ))}
              </div>
            </div>
            <label className="lab-campo lab-ancho"><span className="label">Indicaciones</span>
              <input className="campo" value={f.indicaciones} onChange={(e) => setF({ ...f, indicaciones: e.target.value })} placeholder="Opcional: «palabra de cierre MÉTODO», «no saques lo de su socio»…" />
            </label>
          </div>
          {aviso && <div className={`aviso ${aviso.tipo}`}>{aviso.texto}</div>}
          <div className="modal-pie">
            <span className="ayuda">{listo ? 'Una entrevista de 1 hora tarda unos 20-40 min en transcribirse; el montaje, otro rato.' : 'Primero completa la preparación de arriba.'}</span>
            <button className="btn" disabled={!listo || !f.cliente.trim() || !f.entrevista || !piezas.length || data.trabajando}
              onClick={() => empezar('testimonio', { cliente: f.cliente, entrevista: f.entrevista.ruta, foto: f.foto?.ruta, frase: f.frase, queHicimos: f.queHicimos, indicaciones: f.indicaciones, piezas })}>
              <Icon name="sparkle" size={14} />{piezas.length === Object.keys(data.piezasTestimonio).length ? 'Hacer todo el testimonio' : 'Hacer lo elegido'}
            </button>
          </div>
        </div>

        {data.testimonios.map((t) => (
          <div key={t.cliente} className="panel panel-pad lab-resultado">
            <div className="panel-head">
              <div><span className="label">Testimonio</span><h3>{t.cliente}</h3>{t.mod && <small className="t-dim">Actualizado {fechaCorta(t.mod)}</small>}</div>
              <div className="lab-acciones">
                {t.caption && <button className="chip" onClick={() => setTexto({ ruta: t.caption, titulo: `Captions · ${t.cliente}` })}><Icon name="doc" />Captions</button>}
                {t.indice && <button className="chip" onClick={() => setTexto({ ruta: t.indice, titulo: `Clips · ${t.cliente}` })}><Icon name="tasks" />Índice de clips</button>}
                <button className="chip" onClick={() => todoABiblioteca(t)} disabled={Boolean(enviando)} title={`Stories, carrusel, clips en reel y portadas, cada uno con su caption, en la carpeta Testimonios/${t.cliente}. Los clips en 4:5 y YouTube, desde su grupo.`}><Icon name="book" />{enviando === t.cliente ? 'Pasando…' : 'Todo a la biblioteca'}</button>
              </div>
            </div>
            {t.portadas.length > 0 && <Grupo g={{ id: 'portadas', nombre: 'Portadas', archivos: t.portadas }} titulo={t.cliente} formatoPorDefecto={() => 'Post'} setAviso={setAviso} />}
            {t.grupos.map((g) => <Grupo key={g.id} g={g} titulo={t.cliente} formatoPorDefecto={formatoDe} setAviso={setAviso} />)}
          </div>
        ))}
        {!data.testimonios.length && <div className="panel panel-pad vacio">Aquí aparecerán los testimonios que montes: stories, carrusel, clips, portadas y captions.</div>}
        {data.entrevistas.length > 0 && (
          <div className="panel panel-pad">
            <div className="panel-head"><span className="label">Entrevistas y vídeos subidos</span></div>
            <div className="lab-medios">{data.entrevistas.map((a) => <Medio key={a.ruta} a={a} onVer={setViendo} />)}</div>
          </div>
        )}
      </div>
      <ChatJarvis
        conversacion="laboratorio"
        titulo="JARVIS · Laboratorio"
        subtitulo="Te enseña el guion y los clips antes de montar"
        placeholder="Responde a JARVIS o pídele cambios: «el clip 3 empieza antes», «otro título»…"
        intro="Aquí JARVIS te va contando cada paso: transcribe, prepara el guion y los clips y te los enseña. Cuando le des el visto bueno, monta todo."
        conGuardarGuion={false}
      />
      {viendo && <VerMedio a={viendo} onClose={() => setViendo(null)} />}
      {texto && <VerTexto {...texto} onClose={() => setTexto(null)} />}
    </div>
  );
}
