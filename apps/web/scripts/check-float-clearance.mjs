// Verify the float cards never intersect the title band across viewport
// widths, and log the gaps.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;

const ud = mkdtempSync(join(tmpdir(), 'pgchrome-'));
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${ud}`,
  '--window-size=1920,900', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page' && t.url === 'about:blank') ?? list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('no CDP page target');
}

let seq = 0;
const pending = new Map();
function call(ws, method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const ws = new WebSocket(await pageWs());
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  }
};
await new Promise((r) => (ws.onopen = r));
await call(ws, 'Page.enable');
await call(ws, 'Runtime.enable');

for (const width of [1024, 1280, 1366, 1440, 1600, 1920]) {
  await call(ws, 'Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await call(ws, 'Page.navigate', { url: 'http://localhost:4310/' });
  await sleep(3500);
  const r = (await call(ws, 'Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const t = document.getElementById('heroTitle').getBoundingClientRect();
      const floats = [...document.querySelectorAll('.hero-float')].map((f) => {
        const cs = getComputedStyle(f);
        const b = f.getBoundingClientRect();
        return { shown: cs.display !== 'none', x: Math.round(b.x), x2: Math.round(b.right), y: Math.round(b.y), y2: Math.round(b.bottom) };
      });
      const hits = floats.filter((f) => f.shown && f.x < t.right && f.x2 > t.x && f.y < t.bottom && f.y2 > t.top);
      return { title: { x: Math.round(t.x), x2: Math.round(t.right), y: Math.round(t.y), y2: Math.round(t.bottom) }, floats, hits: hits.length };
    })()`,
  })).result.value;
  console.log(`${width}px`, JSON.stringify(r));
}

ws.close();
proc.kill();
