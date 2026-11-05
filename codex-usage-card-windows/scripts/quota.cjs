const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

const child = spawn(process.argv[2] || 'codex.exe', ['app-server', '--listen', 'stdio://'], {
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'ignore'],
});
const lines = createInterface({ input: child.stdout });
let finished = false;
const timeout = setTimeout(() => finish(), 15000);

function finish(windows) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  lines.close();
  child.kill();
  if (windows) console.log(JSON.stringify(windows));
  else process.exitCode = 1;
}

function send(message) {
  child.stdin.write(JSON.stringify(message) + '\n');
}

child.on('error', () => finish());
child.on('exit', () => finish());
child.stdin.on('error', () => finish());
lines.on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === 1 && message.result) {
    send({ method: 'initialized' });
    send({ id: 2, method: 'account/rateLimits/read' });
  } else if (message.id === 2 && message.result) {
    const limits = message.result.rateLimitsByLimitId?.codex ?? message.result.rateLimits;
    const windows = [limits?.primary, limits?.secondary]
      .filter((window) => Number.isFinite(window?.usedPercent))
      .map((window) => ({
        remaining: Math.round(Math.max(0, Math.min(100, 100 - window.usedPercent))),
        minutes: window.windowDurationMins,
        resetsAt: window.resetsAt,
      }));
    finish(windows);
  } else if (message.id === 1 || message.id === 2) {
    finish();
  }
});
send({
  id: 1,
  method: 'initialize',
  params: { clientInfo: { name: 'usage_card_windows', title: 'Codex Usage Card', version: '1.0.0' } },
});
