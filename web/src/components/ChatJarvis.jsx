import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import Icon from './Icon.jsx';
import { api, useMensajes, useRecurso } from '../lib/api.js';
import { callar, escuchar, hablar, reconocimientoDisponible } from '../lib/voz.js';

// Chat con JARVIS en una conversación propia (p. ej. "guiones"), con respuesta en directo.

const MODELOS = [
  { id: '', label: 'Normal', ayuda: 'Sonnet: escribe bien y va rápido' },
  { id: 'haiku', label: 'Rápido', ayuda: 'Haiku: para preguntas cortas' },
  { id: 'opus', label: 'A fondo', ayuda: 'Opus: para analizar y planificar' },
];
const leer = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };

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

// prefijo: se antepone a cada mensaje (p. ej. "[Diseño #4]") para que JARVIS sepa de qué se habla.
// mostrarPregunta: cómo se enseña cada pregunta (p. ej. resumir las que lanza el propio dashboard).
// conGuardarGuion: el botón «Guardar en el vault» del chat de guiones.
// conModelo: elegir Normal / Rápido / A fondo. conVoz: dictar con el micro y oír las respuestas.
// pendiente: un mensaje que llega de otra pestaña (p. ej. «Pregúntale a JARVIS» de Inicio) y se envía solo.
export default function ChatJarvis({ conversacion, titulo, subtitulo, placeholder, intro, sugerencias = [], borrador, onBorradorUsado, prefijo = '', mostrarPregunta = (t) => t, conGuardarGuion = true, deshabilitado = '', conModelo = false, conVoz = false, pendiente, onPendienteUsado, clase = '' }) {
  const [eventos, setEventos] = useState([]);
  const [ocupado, setOcupado] = useState(false);
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState('');
  const [modelo, setModelo] = useState(() => { const m = leer(`chat.modelo.${conversacion}`, ''); return MODELOS.some((x) => x.id === m) ? m : ''; });
  const [enVozAlta, setEnVozAlta] = useState(() => leer('chat.vozAlta', false));
  const [escuchando, setEscuchando] = useState(false);
  const [hablando, setHablando] = useState(false);
  const [vozCfg] = useRecurso(conVoz ? '/api/voz/estado' : null, { elevenlabs: false });
  const escucha = useRef(null);
  const ultimoCanal = useRef('texto');
  const caja = useRef(null);
  const input = useRef(null);
  useEffect(() => guardar(`chat.modelo.${conversacion}`, modelo), [conversacion, modelo]);
  useEffect(() => guardar('chat.vozAlta', enVozAlta), [enVozAlta]);
  useEffect(() => () => { escucha.current?.parar(); callar(); }, []);

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
    if (conVoz && e.tipo === 'fin' && e.texto && (enVozAlta || ultimoCanal.current === 'voz')) {
      hablar(e.texto, { elevenlabs: vozCfg.elevenlabs, onInicio: () => setHablando(true), onFin: () => setHablando(false) });
    }
  });

  // Texto que llega desde fuera (botón "Usar" de una skill)
  useEffect(() => {
    if (!borrador) return;
    setTexto(borrador);
    onBorradorUsado?.();
    setTimeout(() => { input.current?.focus(); input.current?.setSelectionRange(borrador.length, borrador.length); }, 0);
  }, [borrador]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { caja.current?.scrollTo({ top: caja.current.scrollHeight, behavior: 'smooth' }); }, [eventos]);

  const enviar = async (t, canal = 'texto') => {
    const limpio = t.trim();
    if (!limpio || ocupado || deshabilitado) return;
    setAviso('');
    callar();
    ultimoCanal.current = canal;
    try {
      await api('/api/jarvis/preguntar', { method: 'POST', body: { texto: prefijo ? `${prefijo} ${limpio}` : limpio, conversacion, canal, modelo: modelo || undefined } });
      setTexto('');
      sincronizar();
    } catch (err) { setAviso(err.message); }
  };

  useEffect(() => {
    if (pendiente) { enviar(pendiente); onPendienteUsado?.(); }
  }, [pendiente]); // eslint-disable-line react-hooks/exhaustive-deps

  const micro = () => {
    if (escuchando) { escucha.current?.parar(); return; }
    callar();
    setAviso('');
    setEscuchando(true);
    escucha.current = escuchar({
      onParcial: setTexto,
      onFinal: (f) => enviar(f, 'voz'),
      onError: setAviso,
      onFin: () => setEscuchando(false),
    });
  };

  const lista = useMemo(() => turnos(eventos), [eventos]);

  return (
    <div className={`panel chat ${clase}`}>
      <div className="panel-head chat-head">
        <div>
          <div className="label">{titulo}</div>
          {subtitulo && <div className="ayuda" style={{ marginTop: 3 }}>{subtitulo}</div>}
        </div>
        <div className="chat-head-der">
          {conModelo && (
            <div className="seg seg-mini" role="group" aria-label="Modelo">
              {MODELOS.map((m) => <button key={m.id} type="button" className={modelo === m.id ? 'on' : ''} title={m.ayuda} onClick={() => setModelo(m.id)}>{m.label}</button>)}
            </div>
          )}
          {conVoz && (
            <button type="button" className={`link-btn${enVozAlta ? ' on' : ''}`} onClick={() => { if (hablando) { callar(); setHablando(false); } else setEnVozAlta(!enVozAlta); }} title="Leer las respuestas en voz alta">
              {hablando ? '■ Callar' : enVozAlta ? '🔊 En voz alta' : '🔈 Sin voz'}
            </button>
          )}
          <button className="link-btn" onClick={() => { callar(); api('/api/jarvis/nueva-sesion', { method: 'POST', body: { conversacion } }); }}>Nueva</button>
        </div>
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
            <div className="burbuja tu">{mostrarPregunta(t.pregunta || '')}</div>
            <div className="burbuja jarvis">
              {t.herramientas.length > 0 && (
                <div className="chat-tools">{[...new Set(t.herramientas)].map((h) => <span key={h} className="tag">{h}</span>)}</div>
              )}
              {t.texto ? <div className="md chat-md" dangerouslySetInnerHTML={{ __html: md(t.texto) }} /> : t.estado === 'pensando' && <span className="t-dim cursor">Pensando con {t.etiqueta}…</span>}
              {t.estado === 'error' && <div className="t-err">✕ {t.error}</div>}
              {t.estado === 'ok' && t.final && conGuardarGuion && (
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
          placeholder={deshabilitado || placeholder}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(texto); } }}
          disabled={ocupado || Boolean(deshabilitado)}
          aria-label={placeholder}
        />
        {conVoz && reconocimientoDisponible && !ocupado && (
          <button type="button" className={`ask-send micro${escuchando ? ' on' : ''}`} onClick={micro} aria-label={escuchando ? 'Dejar de escuchar' : 'Dictar'} title="Dictar"><Icon name="mic" size={15} /></button>
        )}
        {ocupado
          ? <button type="button" className="ask-send parar" onClick={() => api('/api/jarvis/cancelar', { method: 'POST', body: { conversacion } })} aria-label="Cancelar">■</button>
          : <button className="ask-send" aria-label="Enviar"><Icon name="send" size={15} /></button>}
      </form>
    </div>
  );
}
