// Modo desarrollo: servidor (3333) + Vite con recarga en caliente (5173).
import { spawn } from 'node:child_process';

const opts = { stdio: 'inherit', shell: process.platform === 'win32' };
const procs = [
  spawn('node', ['--watch', '--disable-warning=ExperimentalWarning', 'server/index.js'], opts),
  spawn('npx', ['vite'], opts),
];
const stop = () => { procs.forEach((p) => p.kill()); process.exit(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
