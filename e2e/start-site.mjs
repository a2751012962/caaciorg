// Starts the local site for the e2e runner: `npm run dev` in the repo root
// (build, then `wrangler pages dev dist` on :8788).
//
// The runner spawns its app command without a shell, and on Windows npm is a
// .cmd shim that cannot be spawned that way, so it starts this file with node
// and this file starts npm through the shell.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const child = spawn('npm run dev -- --ip 127.0.0.1 --port 8788', {
  cwd: root,
  shell: true,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
