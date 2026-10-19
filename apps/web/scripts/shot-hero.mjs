// Drive headless Chrome over CDP: real-time wait (no virtual-time quirks),
// capture the settled hero plus a 3x zoom crop of the title band at desktop
// and mobile widths, and report geometry.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const OUT = 'C:/Users/Rune W. Monrad/CascadeProjects/PunkGrid/docs/qa/evidence/landing';

const ud = mkdtempSync(join(tmpdir(), 'pgchrome-'));
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${ud}`,
  '--window-size=1440,900', 'about:blank',
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

async function measure() {
  return (await call(ws, 'Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const t = document.getElementById('heroTitle');
      const pre = document.querySelector('.preloader');
      const pcs = getComputedStyle(pre);
      const band = t.getBoundingClientRect();
      return {
        font: document.fonts.check('800 64px Orbitron'),
        loaded: document.body.classList.contains('loaded'),
        preloader: { opacity: pcs.opacity, visibility: pcs.visibility },
        band: { x: Math.round(band.x), y: Math.round(band.y), w: Math.round(band.width), h: Math.round(band.height) },
        lines: [...t.querySelectorAll('.line > span')].map((s) => {
          const r = s.getBoundingClientRect();
          return { text: s.textContent, y1: Math.round(r.top), y2: Math.round(r.bottom), rows: s.getClientRects().length };
        }),
      };
    })()`,
  })).result.value;
}

async function captureViewport(width, height, settledName, zoomName) {
  await call(ws, 'Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  await call(ws, 'Page.navigate', { url: 'http://localhost:4310/' });
  await sleep(4500);
  const report = await measure();
  console.log(`${width}x${height} geometry:`, JSON.stringify(report));
  const settled = (await call(ws, 'Page.captureScreenshot', { format: 'png' })).data;
  writeFileSync(join(OUT, settledName), Buffer.from(settled, 'base64'));
  const b = report.band;
  const pad = 30;
  const zoom = (await call(ws, 'Page.captureScreenshot', {
    format: 'png',
    clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.w + 2 * pad, height: b.h + 2 * pad, scale: 3 },
  })).data;
  writeFileSync(join(OUT, zoomName), Buffer.from(zoom, 'base64'));
  console.log('wrote', settledName, 'and', zoomName);
}

await captureViewport(1440, 900, 'cdp-settled.png', 'cdp-title-zoom.png');
await captureViewport(1280, 900, 'cdp-settled-1280.png', 'cdp-title-zoom-1280.png');
await captureViewport(390, 844, 'cdp-settled-mobile.png', 'cdp-title-zoom-mobile.png');

ws.close();
proc.kill();
