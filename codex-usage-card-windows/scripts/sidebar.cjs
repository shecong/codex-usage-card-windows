const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { join } = require('node:path');
const readQuota = promisify(execFile);

// Runs in the client's renderer. Only mounts beside a recognized navigation rail.
function render(windows, updatedAt) {
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

  function positionDetails(trigger, details) {
    const anchor = trigger.getBoundingClientRect();
    const maxLeft = innerWidth - details.offsetWidth - 8;
    const maxTop = innerHeight - details.offsetHeight - 8;
    details.style.left = Math.max(8, Math.min(anchor.right + 10, maxLeft)) + 'px';
    details.style.top = Math.max(8, Math.min(anchor.bottom - details.offsetHeight, maxTop)) + 'px';
  }

  if (!card) {
    card = document.createElement('div');
    card.id = id;
    const shadow = card.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host {
          position: fixed; z-index: 10;
          --surface: var(--color-bg-primary, Canvas);
          --ink: var(--color-text-primary, CanvasText);
          --muted: color-mix(in srgb, var(--ink) 68%, var(--surface));
          --line: color-mix(in srgb, var(--ink) 14%, var(--surface));
          --hover: color-mix(in srgb, var(--ink) 7%, var(--surface));
          --accent: #6978e6;
          --low: light-dark(#b54a24, #f2946b);
          color: var(--ink);
          font: 12px/1.4 system-ui, sans-serif;
        }
        button {
          appearance: none; position: relative; display: grid; justify-items: center;
          gap: 5px; padding: 3px 1px; border: 0; border-radius: 10px;
          background: var(--surface); color: inherit; font: inherit; cursor: pointer;
        }
        button:hover, button[aria-expanded="true"] { background: var(--hover); }
        button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
        .meters { display: grid; gap: 5px; }
        .meter { display: grid; justify-items: center; gap: 1px; }
        .caption { color: var(--muted); font-size: 9px; white-space: nowrap; }
        .ring {
          display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%;
          background: conic-gradient(var(--fill) var(--amount), var(--line) 0);
        }
        .value {
          display: grid; place-items: center; width: calc(100% - 6px);
          height: calc(100% - 6px); border-radius: 50%; background: var(--surface);
          font-size: 11px; font-weight: 650; font-variant-numeric: tabular-nums;
        }
        .compact, :host([data-compact]) .meters { display: none; }
        :host([data-compact]) .compact { display: grid; }
        .compact .ring { width: 27px; height: 27px; }
        .compact .value { font-size: 9px; }
        .stale {
          position: absolute; top: 3px; right: 1px; width: 6px; height: 6px;
          border-radius: 50%; background: var(--low); box-shadow: 0 0 0 2px var(--surface);
        }
        .stale[hidden] { display: none; }
        [popover] {
          position: fixed; inset: auto; margin: 0; box-sizing: border-box;
          width: min(236px, calc(100vw - 16px)); max-height: calc(100vh - 16px);
          overflow: auto; padding: 12px 14px; border: 1px solid var(--line);
          border-radius: 12px; background: var(--surface); color: var(--ink);
          box-shadow: 0 8px 24px #0003; font: inherit;
        }
        h2 { margin: 0 0 7px; font-size: 13px; font-weight: 650; }
        .row { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; padding: 7px 0; }
        .row + .row, .updated { border-top: 1px solid var(--line); }
        .row strong { color: var(--value-color); font-variant-numeric: tabular-nums; }
        .reset { grid-column: 1 / -1; }
        .reset, .updated { color: var(--muted); font-size: 11px; }
        .updated { margin: 3px 0 0; padding-top: 8px; }
      </style>
      <button type="button" popovertarget="quota-details" aria-controls="quota-details" aria-expanded="false">
        <span class="meters" aria-hidden="true"></span>
        <span class="compact" aria-hidden="true"></span>
        <span class="stale" hidden aria-hidden="true"></span>
      </button>
      <section id="quota-details" popover="auto" aria-labelledby="quota-heading">
        <h2 id="quota-heading">Codex 剩余额度</h2>
        <div class="rows"></div>
        <p class="updated"></p>
      </section>`;
    const trigger = shadow.querySelector('button');
    const details = shadow.querySelector('[popover]');
    details.addEventListener('beforetoggle', (event) => {
      trigger.setAttribute('aria-expanded', String(event.newState === 'open'));
      if (event.newState === 'open') requestAnimationFrame(() => positionDetails(trigger, details));
    });
    document.body.append(card);
  }

  const shadow = card.shadowRoot;
  const trigger = shadow.querySelector('button');
  const details = shadow.querySelector('[popover]');
  const key = JSON.stringify([windows, updatedAt]);
  if (card.dataset.quota !== key) {
    card.dataset.quota = key;
    const label = (window) => window.minutes === 300 ? '5 小时' : window.minutes === 10080 ? '每周' : '额度';
    const element = (tag, className, value) => {
      const node = document.createElement(tag);
      node.className = className;
      if (value !== undefined) node.textContent = value;
      return node;
    };
    const ring = (window) => {
      const node = element('span', 'ring');
      node.style.setProperty('--amount', window.remaining + '%');
      node.style.setProperty('--fill', window.remaining <= 15 ? 'var(--low)' : 'var(--accent)');
      node.append(element('span', 'value', window.remaining + '%'));
      return node;
    };
    const stale = windows.some((window) => window.stale);
    trigger.setAttribute('aria-label', '查看 Codex 剩余额度，' +
      windows.map((window) => label(window) + ' ' + window.remaining + '%').join('，') +
      (stale ? '，显示上次结果' : ''));
    shadow.querySelector('.stale').hidden = !stale;
    shadow.querySelector('.meters').replaceChildren(...windows.map((window) => {
      const meter = element('span', 'meter');
      meter.append(ring(window), element('span', 'caption', label(window)));
      return meter;
    }));
    const lowest = windows.reduce((a, b) => a.remaining <= b.remaining ? a : b);
    shadow.querySelector('.compact').replaceChildren(ring(lowest));
    shadow.querySelector('.rows').replaceChildren(...windows.map((window) => {
      const row = element('div', 'row');
      const reset = window.resetsAt
        ? '重置于 ' + new Date(window.resetsAt * 1000).toLocaleString(undefined, {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        })
        : '重置时间待定';
      row.style.setProperty('--value-color', window.remaining <= 15 ? 'var(--low)' : 'var(--ink)');
      row.append(element('span', '', label(window)), element('strong', '', window.remaining + '%'),
        element('span', 'reset', reset));
      return row;
    }));
    const stamp = updatedAt ? new Date(updatedAt).toLocaleTimeString() : '';
    shadow.querySelector('.updated').textContent =
      (stale ? '显示上次结果' : '额度已更新') + (stamp ? ' · ' + stamp : '');
  }

  const rail = nav.getBoundingClientRect();
  const foot = footer.getBoundingClientRect();
  const controls = [...nav.querySelectorAll('a,button,[role="button"],[tabindex]')]
    .map((control) => control.getBoundingClientRect());
  function position(compact) {
    card.toggleAttribute('data-compact', compact);
    const left = Math.round(rail.left + (rail.width - card.offsetWidth) / 2);
    const top = Math.floor(foot.top - card.offsetHeight - 4);
    const right = left + card.offsetWidth;
    const bottom = top + card.offsetHeight;
    const collision = controls.some((r) =>
      r.width && r.height && r.left < right && r.right > left && r.top < bottom && r.bottom > top);
    if (collision || foot.height <= 0 || foot.bottom > rail.bottom + 2 ||
        top < rail.top || left < Math.ceil(rail.left) - 1 || right > Math.floor(rail.right) + 1 ||
        left < 0 || right > innerWidth || bottom > innerHeight) return false;
    card.style.left = left + 'px';
    card.style.top = top + 'px';
    return true;
  }
  const placed = position(false) || position(true);
  card.style.visibility = placed ? 'visible' : 'hidden';
  if (details.matches(':popover-open')) {
    if (placed) positionDetails(trigger, details);
    else details.hidePopover();
  }
  return placed;
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
  let updatedAt = 0;
  let refreshAt = 0;
  while (running) {
    if (Date.now() >= refreshAt) {
      refreshAt = Date.now() + 120000;
      try {
        const { stdout } = await readQuota(process.execPath, [join(__dirname, 'quota.cjs'), codex],
          { windowsHide: true, timeout: 18000 });
        windows = JSON.parse(stdout);
        updatedAt = Date.now();
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
            expression: '(' + render.toString() + ')(' + JSON.stringify(windows) + ', ' + updatedAt + ')',
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

