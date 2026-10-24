import { useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api, useRecurso } from '../../lib/api.js';
import { Modal } from './comun.jsx';

// Tu estilo de stories: tu CLAUDE.md (Stories/CLAUDE.md en el vault) y tus stories de ejemplo (Stories/ejemplos).
// JARVIS los sigue al escribir el guion de una story (su ficha → «Escribir el guion de stories con IA»).

const PLANTILLA_ESTILO = `# Mi estilo de stories

## Voz y tono
- Cómo hablo en stories (cercano, directo, con humor…), cómo me dirijo a quien me ve.

## Estructura de una secuencia
- Cuántas stories suelo hacer y qué hace cada una (gancho, desarrollo, prueba, CTA).

## Textos en pantalla
- Cuántas palabras como mucho, mayúsculas o no, emojis sí o no, palabras que resalto.

## Diseño visual
- Fondo (foto mía, color liso, captura…), colores, tipografías, dónde va el texto y a qué tamaño.
- Si salgo yo: cómo (cara a cámara, recortado, foto pequeña en una esquina…).

## Stickers e interacción
- Qué stickers uso (encuestas, cajas de preguntas, quiz…) y cómo los formulo.

## CTA y palabras clave
- Cómo cierro (responde con una palabra, enlace, ir al post) y mis palabras clave.

## Lo que nunca hago
- …
`;

// Tu guía de estilo de stories (Stories/CLAUDE.md en tu vault): JARVIS la sigue al escribir los guiones y Claude al
// diseñarlas. Se escribe aquí, se sube un .md o se edita en Obsidian.
// Tus stories de ejemplo: se suben al momento (no hace falta Guardar) y Claude las mira antes de diseñar
function EjemplosStories({ ejemplos, onCambio }) {
  const [lista, setLista] = useState(ejemplos);
  const [subiendo, setSubiendo] = useState(0);
  const [error, setError] = useState('');
  const input = useRef(null);
  const subir = async (files) => {
    const imgs = [...files].filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name));
    if (!imgs.length) return setError('Sube imágenes (JPG, PNG o WebP). Si tu story es un vídeo, haz una captura.');
    setError('');
    for (const f of imgs) {
      setSubiendo((n) => n + 1);
      try {
        const r = await fetch(`/api/stories/ejemplos?nombre=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: f });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `No se pudo subir «${f.name}»`);
        setLista(j); onCambio();
      } catch (e) { setError((x) => (x ? `${x}\n` : '') + e.message); }
      setSubiendo((n) => n - 1);
    }
  };
  const borrar = async (e) => {
    try { setLista(await api(`/api/stories/ejemplos/${encodeURIComponent(e.fichero)}`, { method: 'DELETE' })); onCambio(); } catch (err) { setError(err.message); }
  };
  return (
    <div className="estilo-ejemplos">
      <div className="estilo-ejemplos-cab">
        <div><b>Stories de ejemplo</b><span className="ayuda"> · capturas de tus stories (hasta 12). JARVIS las mira al escribir los guiones para que suenen y se estructuren como las tuyas.</span></div>
        <button type="button" className="btn btn-sec" onClick={() => input.current?.click()} disabled={subiendo > 0 || lista.length >= 12}><Icon name="plus" size={14} />{subiendo ? `Subiendo ${subiendo}…` : 'Añadir'}</button>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { subir(e.target.files); e.target.value = ''; }} />
      </div>
      <div className="estilo-ejemplos-grid" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); subir(e.dataTransfer.files); }}>
        {lista.map((e) => (
          <div key={e.fichero} className="estilo-ejemplo">
            <img src={e.url} alt="" loading="lazy" />
            <button type="button" onClick={() => borrar(e)} aria-label="Quitar este ejemplo" title="Quitar este ejemplo">✕</button>
          </div>
        ))}
        {!lista.length && <button type="button" className="estilo-ejemplo-vacio" onClick={() => input.current?.click()}>Arrastra aquí capturas de tus stories o pulsa para elegirlas</button>}
      </div>
      {error && <div className="caja-error">{error}</div>}
    </div>
  );
}

function EditorEstilo({ estilo, ejemplos, onClose, onGuardado, onEjemplos }) {
  const [texto, setTexto] = useState(estilo.texto);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const input = useRef(null);
  const subir = async (f) => {
    if (!f) return;
    if (f.size > 200_000) return setError('Ese archivo es demasiado grande para una guía de estilo.');
    setTexto(await f.text()); setError('');
  };
  const guardar = async () => {
    setGuardando(true); setError('');
    try { onGuardado(await api('/api/stories/estilo', { method: 'PUT', body: { texto, modificado: estilo.modificado } })); }
    catch (e) { setError(e.message); setGuardando(false); }
  };
  return (
    <Modal titulo={<><Icon name="doc" size={14} />Tu estilo de stories</>} onClose={onClose} ancho={760} cerrarFuera={false}>
      <EjemplosStories ejemplos={ejemplos} onCambio={onEjemplos} />
      <div className="estilo-ejemplos-cab" style={{ marginTop: 14 }}><b>CLAUDE.md</b></div>
      <p className="ayuda">Cuéntale a JARVIS cómo son tus stories: tono, estructura, textos, diseño, stickers y CTA. Lo sigue al escribir el guion de cada story (en su ficha, «Escribir el guion de stories con IA»). Se guarda en tu vault, en <b>{estilo.ruta}</b> (también puedes editarlo en Obsidian); los ejemplos, en Stories/ejemplos.</p>
      <div className="estilo-barra">
        <button type="button" className="btn btn-sec" onClick={() => input.current?.click()}><Icon name="share" size={14} />Subir un .md</button>
        {!texto.trim() && <button type="button" className="btn btn-sec" onClick={() => setTexto(PLANTILLA_ESTILO)}><Icon name="doc" size={14} />Empezar con una plantilla</button>}
        <input ref={input} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden onChange={(e) => { subir(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      <textarea className="campo stories-guion" rows={14} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="# Mi estilo de stories&#10;- Máximo 12 palabras por story&#10;- Fondo con foto mía y texto en blanco arriba&#10;- Siempre cierro con «responde YO»…" />
      {error && <div className="caja-error">{error}</div>}
      <div className="modal-pie">
        <span className="ayuda">{texto.length.toLocaleString('es-ES')} caracteres</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-sec" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn" onClick={texto === estilo.texto ? onClose : guardar} disabled={guardando}>{guardando ? 'Guardando…' : texto === estilo.texto ? 'Listo' : 'Guardar'}</button>
        </div>
      </div>
    </Modal>
  );
}

// Se abre desde la ficha de una story: carga tu guía y tus ejemplos y los deja cambiar
export default function EstiloStories({ onClose }) {
  const [data, recargar] = useRecurso('/api/stories', null);
  if (!data) return <Modal titulo="Tu estilo de stories" onClose={onClose}><div className="t-dim">Cargando…</div></Modal>;
  return <EditorEstilo estilo={data.estilo || { texto: '', ruta: 'Stories/CLAUDE.md', modificado: null }} ejemplos={data.ejemplos || []} onEjemplos={recargar} onClose={onClose} onGuardado={onClose} />;
}
