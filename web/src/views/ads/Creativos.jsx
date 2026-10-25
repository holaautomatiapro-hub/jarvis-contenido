import { useEffect, useMemo, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import ChatJarvis from '../../components/ChatJarvis.jsx';
import { api, useMensajes, useRecurso } from '../../lib/api.js';
import { Modal } from '../contenido/comun.jsx';
import { DetalleDiseno } from '../contenido/Diseno.jsx';
import { Visor } from '../contenido/Editor.jsx';
import ElegirBiblioteca from '../contenido/ElegirBiblioteca.jsx';

// Meta Ads → Creativos: anuncios en imagen (4:5, varias variantes) o en vídeo (9:16) con la plantilla de anuncios de tu
// sistema de diseño. Por dentro son diseños (uso «anuncio"): Claude los diseña, se revisan y se exportan a la biblioteca.
const TIPOS = [['imagen', 'Imagen 4:5', 'Para el feed. Varias variantes para probarlas a la vez.'], ['video', 'Vídeo 9:16', 'Para reels y stories. Mejor con un testimonio o un vídeo tuyo hablando.']];

export default function Creativos() {
  const [data, recargar] = useRecurso('/api/disenos', null);
  const [contenido] = useRecurso('/api/contenido', null);
  const [sel, setSel] = useState(null);
  const [nuevo, setNuevo] = useState(false);
  const [aviso, setAviso] = useState('');
  const [progreso, setProgreso] = useState({});
  const [visor, setVisor] = useState(null);
  useMensajes('diseno', (m) => {
    if (m.progreso != null) setProgreso((p) => ({ ...p, [m.id]: m.progreso }));
    else recargar();
  });

  const kit = data?.kit;
  const deAnuncio = (kit?.plantillas || []).filter((p) => p.anuncio);
  const creativos = (data?.disenos || []).filter((d) => d.uso === 'anuncio');
  const actual = creativos.find((d) => d.id === sel) || creativos[0] || null;
  const piezas = contenido?.piezas || [];
  const irAContenido = () => { window.location.hash = 'contenido'; };

  return (
    <section className="panel panel-pad creativos">
      <div className="panel-head">
        <div>
          <span className="label">Creativos para anuncios</span>
          <p className="ayuda">Imágenes y vídeos con tu sistema de diseño, más los textos para Meta. Claude los diseña y revisa; tú los exportas a la biblioteca (carpeta Anuncios) y los subes al Administrador de anuncios.</p>
        </div>
        <button className="btn" onClick={() => setNuevo(true)} disabled={!deAnuncio.length}><Icon name="plus" size={14} />Nuevo creativo</button>
      </div>
      {data && !deAnuncio.length && <div className="aviso">Tu sistema de diseño aún no tiene plantilla de anuncios. Importa uno que la tenga en Laboratorio → Diseño → Cambiar sistema (.zip).</div>}
      {aviso && <div className={`aviso${/No se|Error/i.test(aviso) ? ' error' : ' ok'}`}>{aviso}</div>}

      {creativos.length > 0 && (
        <div className="diseno-grid creativos-grid">
          <div className="diseno-lista">
            {creativos.map((d) => (
              <button key={d.id} className={`diseno-item${actual?.id === d.id ? ' on' : ''}`} onClick={() => setSel(d.id)}>
                <span className={`diseno-mini ${d.formato}`} style={d.previas[0] ? { backgroundImage: `url("${d.previas[0]}")` } : undefined} />
                <span className="diseno-item-txt">
                  <b>{d.titulo}</b>
                  <small>{d.formato === 'story' ? 'Vídeo 9:16' : `Imagen 4:5 · ${d.diapositivas || '—'} variante${d.diapositivas === 1 ? '' : 's'}`}</small>
                  <small>{d.estado === 'generando' ? 'Claude lo está diseñando…' : d.estado === 'exportando' ? `Exportando… ${progreso[d.id] ?? 0}%` : d.exportado ? 'En la biblioteca' : d.estado === 'error' ? 'Con error' : 'Listo para revisar'}</small>
                </span>
              </button>
            ))}
          </div>
          {actual && <DetalleDiseno d={actual} kit={kit} piezas={piezas} ig={null} progreso={progreso[actual.id]} onVisor={setVisor} onAbrir={irAContenido} onProgramar={irAContenido} onAviso={setAviso} onBorrado={() => { setSel(null); recargar(); }} recargar={recargar} />}
          <ChatJarvis
            conversacion="diseno"
            titulo="Ajustar con Claude"
            subtitulo={actual ? `Sobre «${actual.titulo}»` : 'Elige un creativo'}
            placeholder="Ej.: en la variante 2 cambia el gancho por la escena de la sombrilla y haz la oferta más grande"
            intro="Pídele cambios: otro gancho, otra foto, más variantes, otro cierre… Claude lo vuelve a dibujar y revisa que todo se lea."
            prefijo={actual ? `[Diseño #${actual.id}]` : ''}
            mostrarPregunta={(t) => (/^Diseña el creativo de anuncio #\d+/.test(t) ? 'Diseñar el creativo' : t.replace(/^\[Diseño #\d+\]\s*/, ''))}
            conGuardarGuion={false}
            deshabilitado={actual ? '' : 'Crea o elige un creativo para hablar de él'}
          />
        </div>
      )}
      {data && deAnuncio.length > 0 && !creativos.length && <p className="ayuda">Aún no hay creativos. Pulsa <b>Nuevo creativo</b>: cuéntale a Claude a quién va, qué ofreces y el ángulo, y elige el material.</p>}

      {nuevo && <NuevoCreativo plantillas={deAnuncio} piezas={piezas} carpetas={contenido?.carpetas || []} onClose={() => setNuevo(false)} onCreado={(d) => { setSel(d.id); setNuevo(false); recargar(); }} />}
      {visor && <Visor archivos={visor.archivos} inicio={visor.inicio} onClose={() => setVisor(null)} />}
    </section>
  );
}

function NuevoCreativo({ plantillas, piezas, carpetas, onClose, onCreado }) {
  const [tipo, setTipo] = useState('imagen');
  const [f, setF] = useState({ titulo: '', brief: '', oferta: '', palabra: '', variantes: 3 });
  const [material, setMaterial] = useState([]);
  const [eligiendo, setEligiendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const formato = tipo === 'video' ? 'story' : 'carrusel';
  const validas = useMemo(() => plantillas.filter((p) => p.formatos.includes(formato)), [plantillas, formato]);
  const [plantilla, setPlantilla] = useState('');
  useEffect(() => { if (!validas.some((p) => p.id === plantilla)) setPlantilla(validas[0]?.id || ''); }, [formato]); // eslint-disable-line react-hooks/exhaustive-deps

  const crear = async () => {
    setEnviando(true); setError('');
    try {
      const d = await api('/api/anuncios/creativos', { method: 'POST', body: { tipo, plantilla, ...f, material: material.map((m) => m.url) } });
      onCreado(d);
    } catch (e) { setError(e.message); setEnviando(false); }
  };
  const elegir = (lista) => {
    const nuevos = lista.flatMap(({ pieza }) => (pieza.archivos || []).map((a) => ({ url: a.url, nombre: `${pieza.titulo} · ${a.nombre || ''}`.trim(), mime: a.mime })));
    setMaterial((m) => [...m, ...nuevos.filter((n) => !m.some((x) => x.url === n.url))].slice(0, 12));
    setEligiendo(false);
  };

  return (
    <Modal titulo={<><Icon name="ads" size={14} /> Nuevo creativo</>} onClose={onClose} ancho={640}>
      <label className="campo-et">Qué vas a hacer</label>
      <div className="seg seg-ancho">
        {TIPOS.map(([id, nombre]) => <button key={id} type="button" className={tipo === id ? 'on' : ''} onClick={() => setTipo(id)}>{nombre}</button>)}
      </div>
      <p className="ayuda" style={{ marginTop: 6 }}>{TIPOS.find((t) => t[0] === tipo)[2]}</p>
      {validas.length > 1 && <>
        <label className="campo-et">Plantilla</label>
        <div className="diseno-plantillas">
          {validas.map((p) => (
            <button key={p.id} type="button" className={`modo${plantilla === p.id ? ' on' : ''}`} onClick={() => setPlantilla(p.id)}>
              <b>{p.nombre}</b>{p.descripcion && <small>{p.descripcion}</small>}
            </button>
          ))}
        </div>
      </>}
      {!validas.length && <div className="caja-error">Tu plantilla de anuncios no tiene formato {tipo === 'video' ? 'vertical 9:16' : '4:5'}.</div>}
      <label className="campo-et">De qué va</label>
      <textarea className="campo" rows={4} value={f.brief} onChange={(e) => setF({ ...f, brief: e.target.value })} placeholder="A quién va, qué le duele o qué quiere, qué le ofreces y el ángulo. Ej.: entrenadores online que pasan el día contestando mensajes; ángulo «cerrar el portátil a las 3»; con el testimonio de Andrea." />
      <div className="creativo-fila">
        <div><label className="campo-et">Oferta</label><input className="campo" value={f.oferta} onChange={(e) => setF({ ...f, oferta: e.target.value })} placeholder="Ej.: prueba 14 días gratis" /></div>
        <div><label className="campo-et">Palabra clave o CTA</label><input className="campo" value={f.palabra} onChange={(e) => setF({ ...f, palabra: e.target.value })} placeholder="Ej.: SETTER" /></div>
        {tipo === 'imagen' && <div><label className="campo-et">Variantes</label><select className="campo" value={f.variantes} onChange={(e) => setF({ ...f, variantes: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>}
      </div>
      <label className="campo-et">Material <small className="t-dim">(opcional)</small></label>
      <div className="creativo-material">
        {material.map((m) => (
          <span key={m.url} className="chip"><Icon name={m.mime?.startsWith('video/') ? 'play' : 'palette'} size={12} />{m.nombre.slice(0, 40)}<button type="button" className="link-btn" onClick={() => setMaterial((l) => l.filter((x) => x.url !== m.url))} aria-label="Quitar">✕</button></span>
        ))}
        <button type="button" className="btn btn-sec" onClick={() => setEligiendo(true)}><Icon name="book" size={14} />Elegir de la biblioteca</button>
      </div>
      <p className="ayuda" style={{ marginTop: 6 }}>Fotos tuyas, capturas o el vídeo del testimonio. Si no eliges nada, Claude busca en tu biblioteca y, si hace falta, genera una foto con IA.</p>
      <label className="campo-et">Nombre <small className="t-dim">(opcional)</small></label>
      <input className="campo" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Ej.: Prueba gratis · entrenadores" />
      <p className="ayuda" style={{ marginTop: 10 }}>Claude (Opus) lo diseña con tu plantilla de anuncios, lo revisa y escribe los textos para Meta. Suele tardar 5-10 minutos.</p>
      {error && <div className="caja-error">{error}</div>}
      <div className="modal-pie">
        <span />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sec" onClick={onClose}>Cancelar</button>
          <button className="btn" onClick={crear} disabled={enviando || !plantilla || f.brief.trim().length < 10}><Icon name="sparkle" size={14} />{enviando ? 'Enviando…' : 'Diseñar con Claude'}</button>
        </div>
      </div>
      {eligiendo && <ElegirBiblioteca piezas={piezas} carpetas={carpetas} onElegir={elegir} onClose={() => setEligiendo(false)} />}
    </Modal>
  );
}
