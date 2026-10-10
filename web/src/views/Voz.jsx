import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import Sphere from '../components/Sphere.jsx';
import { api, useMensajes, useRecurso } from '../lib/api.js';
import { callar, escuchar, hablar, reconocimientoDisponible } from '../lib/voz.js';

const MODELOS = [
  { id: 'auto', label: 'Auto (JEV)' },
  { id: 'haiku', label: 'Haiku' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'opus', label: 'Opus' },
];
const SUGERENCIAS = ['Resume mi día', 'Apunta esta idea: ', 'Escríbeme un guion para un reel sobre ', '¿Qué tengo pendiente en el pipeline?'];

const leer = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };
const segundos = (ms) => (ms == null ? '' : `${(ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`);
const euros = (usd) => (usd == null ? '' : `${usd.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} $`);

// Negritas y cursivas de Markdown en el terminal (sin interpretar HTML)
function enLinea(texto) {
  return texto.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g).map((p, i) => {
    if (/^\*\*.+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (/^\*.+\*$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
    if (/^`.+`$/.test(p)) return <code key={i}>{p.slice(1, -1)}</code>;
    return p;
  });
}

// Agrupa los eventos en turnos de conversación
function turnos(eventos) {
  const m = new Map();
  for (const e of eventos) {
    if (!e.id) continue;
    if (!m.has(e.id)) m.set(e.id, { id: e.id, texto: '', herramientas: [], estado: 'pensando' });
    const t = m.get(e.id);
    if (e.tipo === 'pregunta') Object.assign(t, { pregunta: e.texto, canal: e.canal, etiqueta: e.etiqueta, modelo: e.modelo, motivo: e.motivo });
    else if (e.tipo === 'texto') t.texto += e.texto;
    else if (e.tipo === 'herramienta') t.herramientas.push({ nombre: e.nombre, detalle: e.detalle, ok: null });
    else if (e.tipo === 'resultado_herramienta') { const h = t.herramientas.findLast((x) => x.ok === null); if (h) h.ok = e.ok; }
    else if (e.tipo === 'fin') Object.assign(t, { estado: 'ok', final: e.texto, coste: e.coste, duracion: e.duracion });
    else if (e.tipo === 'error') Object.assign(t, { estado: 'error', error: e.mensaje });
  }
  return [...m.values()];
}

export default function Voz({ sistema = [], pendiente, onConsumido }) {
  const [eventos, setEventos] = useState([]);
  const [ocupado, setOcupado] = useState(false);
  const [texto, setTexto] = useState('');
  const [parcial, setParcial] = useState('');
  const [escuchando, setEscuchando] = useState(false);
  const [hablando, setHablando] = useState(false);
  const [modelo, setModelo] = useState(() => leer('jarvis.modelo', 'auto'));
  const [responderVoz, setResponderVoz] = useState(() => leer('jarvis.voz', true));
  const [aviso, setAviso] = useState('');
  const [motorVoz, setMotorVoz] = useState('');
  const [enrut, recargarEnrut] = useRecurso('/api/jarvis/enrutamiento', { barras: [], total: 0, coste: 0 });
  const [vozCfg] = useRecurso('/api/voz/estado', { elevenlabs: false });
  const escucha = useRef(null);
  const ultimoCanal = useRef('texto');
  const terminal = useRef(null);

  // El historial del servidor manda: se resincroniza al entrar y tras cada petición, sin duplicar eventos
  const sincronizar = () => api('/api/jarvis/estado').then((e) => {
    setEventos((ev) => {
      const ultimoSeq = e.eventos.at(-1)?.seq ?? 0;
      return [...e.eventos, ...ev.filter((x) => x.seq > ultimoSeq)];
    });
    setOcupado(e.ocupadoAqui);
  }).catch(() => {});
  useEffect(() => {
    sincronizar();
    return () => { escucha.current?.parar(); callar(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useMensajes('jarvis', (e) => {
    if ((e.conversacion || 'principal') !== 'principal') return; // el chat de guiones va aparte
    if (e.tipo === 'sesion_nueva') { setEventos([]); return; }
    setEventos((ev) => (ev.some((x) => x.seq === e.seq) ? ev : [...ev, e]));
    if (e.tipo === 'pregunta') setOcupado(true);
    if (e.tipo === 'fin' || e.tipo === 'error') {
      setOcupado(false);
      recargarEnrut();
      if (e.tipo === 'fin' && (responderVoz || ultimoCanal.current === 'voz') && e.texto) {
        hablar(e.texto, { elevenlabs: vozCfg.elevenlabs, onInicio: () => setHablando(true), onFin: () => setHablando(false) }).then((m) => m && setMotorVoz(m));
      }
    }
  });

  useEffect(() => { terminal.current?.scrollTo({ top: terminal.current.scrollHeight, behavior: 'smooth' }); }, [eventos]);
  useEffect(() => guardar('jarvis.modelo', modelo), [modelo]);
  useEffect(() => guardar('jarvis.voz', responderVoz), [responderVoz]);

  const enviar = async (t, canal = 'texto') => {
    const limpio = t.trim();
    if (!limpio) return;
    setAviso('');
    callar();
    ultimoCanal.current = canal;
    try {
      await api('/api/jarvis/preguntar', { method: 'POST', body: { texto: limpio, canal, modelo: modelo === 'auto' ? undefined : modelo } });
      setTexto('');
      sincronizar();
    } catch (err) { setAviso(err.message); }
  };

  // Pregunta que llega desde Inicio ("Pregúntale a JARVIS…")
  useEffect(() => {
    if (pendiente) { enviar(pendiente); onConsumido?.(); }
  }, [pendiente]); // eslint-disable-line react-hooks/exhaustive-deps

  const micro = () => {
    if (escuchando) { escucha.current?.parar(); return; }
    callar();
    setAviso('');
    setParcial('');
    setEscuchando(true);
    escucha.current = escuchar({
      onParcial: setParcial,
      onFinal: (f) => { setParcial(''); enviar(f, 'voz'); },
      onError: (m) => setAviso(m),
      onFin: () => setEscuchando(false),
    });
  };

  const lista = useMemo(() => turnos(eventos), [eventos]);
  const ultimo = lista.at(-1);
  const estadoTxt = escuchando ? 'Te escucho…' : ocupado ? `Pensando con ${ultimo?.etiqueta || 'Claude'}…` : hablando ? 'Hablando…' : 'Listo. Pulsa el micro o escribe.';
  const activo = escuchando || ocupado || hablando;
  const etiquetaCentro = (ultimo?.modelo || (modelo === 'auto' ? 'claude' : modelo)).toUpperCase();

  const filasSistema = [
    ...sistema.filter((s) => ['Claude Code', 'Obsidian'].includes(s.label)).map((s) => ({ ...s, label: s.label === 'Obsidian' ? 'Memoria · Obsidian' : s.label })),
    { label: 'Clasificador JEV', icon: 'core', estado: 'on' },
    { label: `Oídos · ${reconocimientoDisponible ? 'navegador' : 'no disponible'}`, icon: 'mic', estado: reconocimientoDisponible ? 'on' : 'warn' },
    { label: `Voz · ${vozCfg.elevenlabs ? 'ElevenLabs' : 'navegador'}`, icon: 'voice', estado: vozCfg.elevenlabs ? 'on' : 'warn' },
  ];

  return (
    <section className="voz-vista">
      <div className="col">
        <div className="panel hero voz-hero">
          <div className="sphere-wrap"><Sphere active={activo} /></div>
          <div className="voz-modelo">{etiquetaCentro}</div>
          <button className={`mic${escuchando ? ' on' : ''}`} onClick={micro} aria-label={escuchando ? 'Dejar de escuchar' : 'Hablar con JARVIS'} disabled={ocupado}>
            <Icon name="mic" size={26} />
          </button>
          <div className="voz-estado">{parcial ? `“${parcial}”` : estadoTxt}</div>
          <form className="ask" onSubmit={(e) => { e.preventDefault(); enviar(texto); }}>
            <Icon name="sparkle" />
            <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escribe a JARVIS…" aria-label="Escribe a JARVIS" disabled={ocupado} />
            {ocupado
              ? <button type="button" className="ask-send parar" onClick={() => api('/api/jarvis/cancelar', { method: 'POST' })} aria-label="Cancelar">■</button>
              : <button className="ask-send" type="submit" aria-label="Enviar"><Icon name="send" size={15} /></button>}
          </form>
          <div className="chips">
            {SUGERENCIAS.map((s) => <button key={s} className="chip" onClick={() => (s.endsWith(' ') ? setTexto(s) : enviar(s))}>{s.trim()}</button>)}
          </div>
          {aviso && <div className="aviso-error" style={{ position: 'relative', marginTop: 10 }}>{aviso}</div>}
        </div>

        <div className="panel terminal">
          <div className="terminal-head">
            <span className="dots"><i /><i /><i /></span>
            <span className="label">JARVIS OUTPUT</span>
            <span className="terminal-acciones">
              {ultimo?.final && <button className="link-btn" onClick={() => navigator.clipboard?.writeText(ultimo.final)}>Copiar respuesta</button>}
              <button className="link-btn" onClick={() => { callar(); api('/api/jarvis/nueva-sesion', { method: 'POST', body: { conversacion: 'principal' } }); }}>Nueva sesión</button>
            </span>
          </div>
          <div className="terminal-body" ref={terminal}>
            {!lista.length && <div className="t-dim">{'> '}Esperando instrucciones. JARVIS recuerda la conversación hasta que pulses “Nueva sesión”.</div>}
            {lista.map((t) => (
              <div key={t.id} className="turno">
                <div className="t-user">
                  <span className="t-prompt">{t.canal === 'voz' ? '🎙' : '>'}</span> {t.pregunta}
                  <span className="t-ruta">JEV → {t.etiqueta} · {t.motivo}</span>
                </div>
                {t.herramientas.map((h, i) => (
                  <div key={i} className="t-tool">
                    <span className={h.ok === false ? 't-err' : 't-ok'}>{h.ok === null ? '◌' : h.ok ? '✓' : '✕'}</span> {h.nombre}{h.detalle ? <span className="t-dim"> · {h.detalle}</span> : null}
                  </div>
                ))}
                {t.texto && <div className="t-text">{enLinea(t.texto.trim())}</div>}
                {t.estado === 'pensando' && <div className="t-dim cursor">▍</div>}
                {t.estado === 'ok' && <div className="t-fin">✓ Proceso completado{t.duracion ? ` · ${segundos(t.duracion)}` : ''}{t.coste != null ? ` · ${euros(t.coste)}` : ''}</div>}
                {t.estado === 'error' && <div className="t-err">✕ {t.error}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="col">
        <div className="panel panel-pad">
          <div className="panel-head">
            <span className="label">Enrutamiento · JEV</span>
            <span className="select-mini">30 días</span>
          </div>
          {enrut.barras.map((b) => (
            <div className="bar-row" key={b.label}>
              <span className="dot" style={{ background: b.color, boxShadow: `0 0 6px ${b.color}` }} />
              <span>{b.label}</span>
              <div className="bar"><span style={{ width: `${b.pct}%`, background: b.color, boxShadow: `0 0 8px ${b.color}` }} /></div>
              <span className="bar-pct">{b.pct}%</span>
            </div>
          ))}
          <div className="enrut-pie">
            <span>{enrut.total} peticiones</span>
            <span>{euros(enrut.coste)} en API equivalente</span>
          </div>
        </div>

        <div className="panel panel-pad">
          <div className="panel-head"><span className="label">Modelo</span></div>
          <div className="seg seg-ancho">
            {MODELOS.map((m) => <button key={m.id} type="button" className={modelo === m.id ? 'on' : ''} onClick={() => setModelo(m.id)}>{m.label}</button>)}
          </div>
          <label className="interruptor">
            <input type="checkbox" checked={responderVoz} onChange={(e) => setResponderVoz(e.target.checked)} />
            <span className="track"><span /></span>
            Responder siempre en voz alta
          </label>
          {hablando && <button className="chip" style={{ marginTop: 10 }} onClick={() => { callar(); setHablando(false); }}>■ Callar</button>}
          {motorVoz && <div className="ayuda" style={{ marginTop: 8 }}>Última respuesta leída con: {motorVoz}</div>}
          <p className="ayuda" style={{ marginTop: 10, lineHeight: 1.5 }}>
            En Auto, JEV usa Haiku para lo rápido y la memoria, Sonnet para escribir y buscar, y Opus para analizar y planificar.
          </p>
        </div>

        <div className="panel panel-pad" style={{ flex: 1 }}>
          <div className="panel-head"><span className="label">Sistema</span></div>
          {filasSistema.map((s) => (
            <div className="status-row" key={s.label}>
              <Icon name={s.icon} />
              <span>{s.label}</span>
              <span className="status"><span className={`dot ${s.estado}`} />{s.estado === 'on' ? 'En línea' : 'Revisar'}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
