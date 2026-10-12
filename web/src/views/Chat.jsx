import ChatJarvis from '../components/ChatJarvis.jsx';

// Chat principal con JARVIS: la misma memoria, skills y MCP que Claude Code en tu vault.
const SUGERENCIAS = ['¿Qué tengo que publicar esta semana?', 'Apunta esta idea: ', 'Escríbeme un guion para un reel sobre ', '¿Qué me ha funcionado mejor este mes?'];

export default function Chat({ pendiente, onConsumido }) {
  return (
    <section className="chat-vista">
      <ChatJarvis
        conversacion="principal"
        titulo="JARVIS"
        subtitulo="Pregunta, apunta ideas, pide guiones o un resumen. Recuerda la conversación hasta que pulses «Nueva»."
        placeholder="Escribe a JARVIS… (Enter para enviar)"
        intro="Lee tu vault, tus tareas, tu pipeline y tus métricas. Para dictar, pulsa el micro."
        sugerencias={SUGERENCIAS}
        conGuardarGuion={false}
        conModelo
        conVoz
        pendiente={pendiente}
        onPendienteUsado={onConsumido}
        clase="chat-principal"
      />
    </section>
  );
}
