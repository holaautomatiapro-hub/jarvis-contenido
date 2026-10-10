import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import Icon from './Icon.jsx';
import { api, useMensajes } from '../lib/api.js';

// Chat con JARVIS en una conversación propia (p. ej. "guiones"), con respuesta en directo.

const md = (t) => DOMPurify.sanitize(marked.parse(t || '', { breaks: true }));

function turnos(eventos) {
  const m = new Map();
  for (const e of eventos) {
    if (!e.id) continue;
    if (!m.has(e.id)) m.set(e.id, { id: e.id, texto: '', herramientas: [], estado: 'pensando' });
    const t = m.get(e.id);
    if (e.tipo === 'pregunta') Object.assign(t, { pregunta: e.texto, etiqueta: e.etiqueta });
    else if (e.tipo === 'texto') t.texto += e.texto;
    else if (e.tipo === 'herramienta') t.herramientas.push(e.nombre);
    else if (e.tipo === 'fin') Object.assign(t, { estado: 'ok', final: e.texto });
    else if (e.tipo === 'error') Object.assign(t, { estado: 'error', error: e.mensaje });
  }
  return [...m.values()];
}

export default function ChatJarvis({ conversacion, titulo, subtitulo, placeholder, intro, sugerencias = [], borrador, onBorradorUsado }) {
  const [eventos, setEventos] = useState([]);
  const [ocupado, setOcupado] = useState(false);
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState('');
  const caja = useRef(null);
  const input = useRef(null);

  const sincronizar = () => api(`/api/jarvis/estado?conversacion=${conversacion}`).then((e) => {
    setEventos((ev) => {
      const ultimo = e.eventos.at(-1)?.seq ?? 0;
      return [...e.eventos, ...ev.filter((x) => x.seq > ultimo)];
    });
    setOcupado(e.ocupadoAqui);
  }).catch(() => {});
  useEffect(() => { sincronizar(); }, [conversacion]); // eslint-disable-line react-hooks/exhaustive-deps

  useMensajes('jarvis', (e) => {
    if (e.conversacion !== conversacion) return;
    if (e.tipo === 'sesion_nueva') { setEventos([]); return; }
    setEventos((ev) => (ev.some((x) => x.seq === e.seq) ? ev : [...ev, e]));
    if (e.tipo === 'pregunta') setOcupado(true);
    if (e.tipo === 'fin' || e.tipo === 'error') setOcupado(false);
  });

  // Texto que llega desde fuera (botón "Usar" de una skill)
  useEffect(() => {
    if (!borrador) return;
    setTexto(borrador);
    onBorradorUsado?.();
    setTimeout(() => { input.current?.focus(); input.current?.setSelectionRange(borrador.length, borrador.length); }, 0);
  }, [borrador]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { caja.current?.scrollTo({ top: caja.current.scrollHeight, behavior: 'smooth' }); }, [eventos]);

  const enviar = async (t) => {
    const limpio = t.trim();
    if (!limpio || ocupado) return;
    setAviso('');
    try {
      await api('/api/jarvis/preguntar', { method: 'POST', body: { texto: limpio, conversacion } });
      setTexto('');
      sincronizar();
    } catch (err) { setAviso(err.message); }
  };

  const lista = useMemo(() => turnos(eventos), [eventos]);

  return (
    <div className="panel chat">
      <div className="panel-head chat-head">
        <div>
          <div className="label">{titulo}</div>
          {subtitulo && <div className="ayuda" style={{ marginTop: 3 }}>{subtitulo}</div>}
        </div>
        <button className="link-btn" onClick={() => api('/api/jarvis/nueva-sesion', { method: 'POST', body: { conversacion } })}>Nueva</button>
      </div>
      <div className="chat-mensajes" ref={caja}>
        {!lista.length && (
          <div className="chat-vacio">
            {intro && <p>{intro}</p>}
            {sugerencias.map((s) => <button key={s} className="chip" onClick={() => setTexto(s)}>{s}</button>)}
          </div>
        )}
        {lista.map((t) => (
          <div key={t.id} className="chat-turno">
            <div className="burbuja tu">{t.pregunta}</div>
            <div className="burbuja jarvis">
              {t.herramientas.length > 0 && (
                <div className="chat-tools">{[...new Set(t.herramientas)].map((h) => <span key={h} className="tag">{h}</span>)}</div>
              )}
              {t.texto ? <div className="md chat-md" dangerouslySetInnerHTML={{ __html: md(t.texto) }} /> : t.estado === 'pensando' && <span className="t-dim cursor">Pensando con {t.etiqueta}…</span>}
              {t.estado === 'error' && <div className="t-err">✕ {t.error}</div>}
              {t.estado === 'ok' && t.final && (
                <div className="chat-acciones">
                  <button className="link-btn" onClick={() => navigator.clipboard?.writeText(t.final)}>Copiar</button>
                  <button className="link-btn" onClick={() => enviar('Perfecto, guárdalo en 02-Guiones y pon la pieza en el estado guion.')}>Guardar en el vault</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {aviso && <div className="aviso-error" style={{ padding: '0 14px' }}>{aviso}</div>}
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); enviar(texto); }}>
        <textarea
          ref={input}
          className="campo"
          rows={2}
          value={texto}
          placeholder={placeholder}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(texto); } }}
          disabled={ocupado}
          aria-label={placeholder}
        />
        {ocupado
          ? <button type="button" className="ask-send parar" onClick={() => api('/api/jarvis/cancelar', { method: 'POST' })} aria-label="Cancelar">■</button>
          : <button className="ask-send" aria-label="Enviar"><Icon name="send" size={15} /></button>}
      </form>
    </div>
  );
}
