// Simulador de "claude -p --output-format stream-json" para los tests (no gasta nada ni necesita cuenta).
// Palabras clave en el prompt: FALLA → error de Claude; LENTO → tarda 5 s (para probar cancelar);
// SINLOGIN → sale con error de autenticación por stderr.
let prompt = '';
process.stdin.on('data', (d) => (prompt += d));
process.stdin.on('end', async () => {
  const args = process.argv.slice(2);
  const modelo = args[args.indexOf('--model') + 1] || 'sonnet';
  const resume = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : null;
  const sesion = resume || 'sesion-falsa-1';
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

  if (prompt.includes('SINLOGIN')) { process.stderr.write('Error: Invalid API key · Please run /login\n'); process.exit(1); }
  out({ type: 'system', subtype: 'init', session_id: sesion, model: `claude-${modelo}`, cwd: process.cwd() });
  if (prompt.includes('LENTO')) await new Promise((r) => setTimeout(r, 5000));
  if (prompt.includes('FALLA')) { out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Algo salió mal', session_id: sesion }); return; }

  out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't0', name: 'ToolSearch', input: { query: 'select:mcp__jarvis__capturar_idea' } }] }, session_id: sesion });
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't0', content: 'ok', is_error: false }] }, session_id: sesion });
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__jarvis__capturar_idea', input: { texto: 'Idea de prueba' } }] }, session_id: sesion });
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: false }] }, session_id: sesion });
  for (const trozo of ['Hecho. ', 'He guardado ', `la idea (modelo ${modelo}${resume ? ', sesión retomada' : ''}).`]) {
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: trozo } } });
  }
  out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hecho. He guardado la idea.' }] }, session_id: sesion });
  out({ type: 'result', subtype: 'success', is_error: false, result: `Hecho. He guardado la idea (modelo ${modelo}).`, total_cost_usd: 0.0123, duration_ms: 850, session_id: sesion });
});
