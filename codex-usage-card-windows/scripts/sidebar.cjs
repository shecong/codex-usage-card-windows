const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { join } = require('node:path');
const readQuota = promisify(execFile);

// Runs in the client's renderer. Only mounts beside a recognized navigation rail.
function render(windows) {
  const id = 'windows-codex-usage-card';
  const nav = [...document.querySelectorAll('nav[data-app-navigation-rail]')].find((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width >= 30 && rect.width <= 110 && rect.height > 100;
  });
  const footer = nav && [...nav.children].find((child) =>
    child.querySelector('[aria-label*="profile" i], [aria-label*="account" i], [aria-label*="avatar" i], [aria-label*="账户"], [aria-label*="头像"], [aria-label*="个人"], [data-testid*="profile" i], [data-testid*="account" i], img[alt*="avatar" i]'));
  let card = document.getElementById(id);
  if (!footer || !windows.length) {
    card?.remove();
    return false;
  }
  if (!card) {
    card = document.createElement('div');
    card.id = id;
    card.setAttribute('aria-label', 'Codex 剩余额度');
    card.style.cssText = 'position:fixed;z-index:10;display:grid;gap:4px;padding:3px;box-sizing:border-box;border-radius:10px;background:var(--color-bg-primary,Canvas);color:var(--color-text-primary,CanvasText);';
    document.body.append(card);
  }
  const key = JSON.stringify(windows);
  if (card.dataset.quota !== key) {
    card.dataset.quota = key;
    card.replaceChildren();
    for (const window of windows) {
      const label = window.minutes === 300 ? '5 小时' : window.minutes === 10080 ? '每周' : '额度';
      const reset = window.resetsAt ? ' · 重置 ' + new Date(window.resetsAt * 1000).toLocaleString() : '';
      const item = document.createElement('div');
      item.tabIndex = 0;
      item.title = label + '剩余 ' + window.remaining + '%' + reset + (window.stale ? ' · 刷新失败，显示上次结果' : '');
      item.setAttribute('aria-label', item.title);
      item.style.cssText = 'display:grid;justify-items:center;gap:1px;font:9px system-ui;line-height:11px;';
      const ring = document.createElement('div');
      const color = window.remaining <= 15 ? '#d76248' : '#6a7cf2';
      ring.style.cssText = 'display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:conic-gradient(' + color + ' ' + window.remaining + '%, color-mix(in srgb, currentColor 15%, transparent) 0);';
      const value = document.createElement('span');
      value.style.cssText = 'display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--color-bg-primary,Canvas);font-weight:600;';
      value.textContent = window.remaining + '%';
      const caption = document.createElement('span');
      caption.textContent = label;
      ring.append(value);
      item.append(ring, caption);
      card.append(item);
    }
  }
  card.style.visibility = 'hidden';
  const rail = nav.getBoundingClientRect();
  const foot = footer.getBoundingClientRect();
  const left = Math.round(rail.left + (rail.width - card.offsetWidth) / 2);
  const top = Math.round(foot.top - card.offsetHeight - 4);
  const right = left + card.offsetWidth;
  const bottom = top + card.offsetHeight;
  const collision = [...nav.querySelectorAll('a,button,[role="button"],[tabindex]')].some((control) => {
    const r = control.getBoundingClientRect();
    return r.width && r.height && r.left < right && r.right > left && r.top < bottom && r.bottom > top;
  });
  if (collision || foot.height <= 0 || foot.bottom > rail.bottom + 2 ||
      top < rail.top || left < 0 || right > innerWidth || bottom > innerHeight) return false;
  card.style.left = left + 'px';
  card.style.top = top + 'px';
  card.style.visibility = 'visible';
  return true;
}

async function launch(executable, codex, profile) {
  const args = ['--remote-debugging-pipe'];
  if (profile) args.push('--user-data-dir=' + profile);
  const app = spawn(executable, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const pending = new Map();
  let counter = 0;
  let buffer = '';
  let running = true;
  let connected = false;
  function disconnected() {
    running = false;
    for (const request of pending.values()) request.reject(new Error('Codex disconnected'));
  }
  app.on('error', disconnected);
  app.on('exit', disconnected);
  app.stdio[3].on('error', disconnected);
  app.stdio[4].on('error', disconnected);
  app.stdio[4].on('end', disconnected);
  app.stdio[4].setEncoding('utf8');
  app.stdio[4].on('data', (chunk) => {
    buffer += chunk;
    for (let end; (end = buffer.indexOf('\0')) !== -1;) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const request = pending.get(message.id);
      if (message.error) request?.reject(new Error(message.error.message));
      else request?.resolve(message.result);
    }
  });
  function request(method, params, sessionId) {
    const id = ++counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP timeout')), 5000);
      pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      app.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    }).finally(() => pending.delete(id));
  }
  const sessions = new Map();
  let windows = [];
  let refreshAt = 0;
  while (running) {
    if (Date.now() >= refreshAt) {
      refreshAt = Date.now() + 120000;
      try {
        const { stdout } = await readQuota(process.execPath, [join(__dirname, 'quota.cjs'), codex],
          { windowsHide: true, timeout: 18000 });
        windows = JSON.parse(stdout);
      } catch {
        if (!windows.length) refreshAt = Date.now() + 15000;
        windows = windows.map((window) => ({ ...window, stale: true }));
      }
    }
    if (!running) break;
    try {
      const { targetInfos } = await request('Target.getTargets');
      connected = true;
      const pages = targetInfos.filter((target) => target.type === 'page' && /^app:\/\/-\/index\.html(?:[?#]|$)/.test(target.url));
      for (const id of sessions.keys()) {
        if (!pages.some((page) => page.targetId === id)) sessions.delete(id);
      }
      for (const { targetId } of pages) {
        try {
          if (!sessions.has(targetId)) {
            const { sessionId } = await request('Target.attachToTarget', { targetId, flatten: true });
            sessions.set(targetId, sessionId);
          }
          await request('Runtime.evaluate', {
            expression: '(' + render.toString() + ')(' + JSON.stringify(windows) + ')',
            returnByValue: true,
          }, sessions.get(targetId));
        } catch {
          sessions.delete(targetId);
        }
      }
    } catch {
      // The app may be starting or closing.
    }
    if (running) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (!connected) throw new Error('Codex closed before the sidebar connection was ready.');
}

if (require.main === module) {
  launch(...process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
module.exports = { render };
