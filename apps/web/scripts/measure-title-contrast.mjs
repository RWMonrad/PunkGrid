// Objective legibility measurement for the gradient hero title: capture the
// settled hero twice (title visible / hidden) and compute per-strip WCAG
// contrast between glyph pixels and their local background.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodePng } from '../../mobile/scripts/lib/png.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;

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

const luminance = (r, g, b) => {
  const lin = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

async function runViewport(width, height) {
  await call(ws, 'Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  await call(ws, 'Page.navigate', { url: 'http://localhost:4310/' });
  await sleep(4500);
  // Freeze motion so the two captures differ only by the title itself.
  await call(ws, 'Runtime.evaluate', { expression: `const s = document.createElement('style');
    s.textContent = '* { animation-play-state: paused !important; transition: none !important }';
    document.head.appendChild(s);` });
  const band = (await call(ws, 'Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => { const r = document.getElementById('heroTitle').getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })()`,
  })).result.value;

  const s1 = Buffer.from((await call(ws, 'Page.captureScreenshot', { format: 'png' })).data, 'base64');
  await call(ws, 'Runtime.evaluate', { expression: `document.getElementById('heroTitle').style.visibility = 'hidden'` });
  const s2 = Buffer.from((await call(ws, 'Page.captureScreenshot', { format: 'png' })).data, 'base64');
  await call(ws, 'Runtime.evaluate', { expression: `document.getElementById('heroTitle').style.visibility = 'visible'` });

  const a = decodePng(s1);
  const b = decodePng(s2);
  const ch = a.channels;

  // Ink-run analysis: in the pixel row with the most glyph ink inside each
  // line, count separated glyph groups. Fused or overlapping letters would
  // collapse into few long runs; clean tracking yields one run per glyph.
  const linesInfo = (await call(ws, 'Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => [...document.getElementById('heroTitle').querySelectorAll('.line > span')].map((s) => {
      const r = s.getBoundingClientRect();
      return { text: s.textContent, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }))()`,
  })).result.value;
  const runs = linesInfo.map((ln) => {
    const diff = (x, y) => {
      const p = (y * a.width + x) * ch;
      return Math.max(
        Math.abs(a.data[p] - b.data[p]),
        Math.abs(a.data[p + 1] - b.data[p + 1]),
        Math.abs(a.data[p + 2] - b.data[p + 2]),
      ) > 16;
    };
    let best = { y: 0, count: 0, looseRuns: 0, strictRuns: 0 };
    for (let y = ln.y + 2; y < ln.y + ln.h - 2; y++) {
      let count = 0;
      let loose = 0, strict = 0;
      let inRun = false, gap = 99;
      for (let x = ln.x; x < ln.x + ln.w; x++) {
        if (diff(x, y)) {
          count++;
          if (!inRun) {
            if (gap >= 2) loose++;
            if (gap >= 4) strict++;
          }
          inRun = true; gap = 0;
        } else { inRun = false; gap++; }
      }
      if (count > best.count) best = { y, count, looseRuns: loose, strictRuns: strict };
    }
    return { text: ln.text, inkPixels: best.count, runsAt2px: best.looseRuns, runsAt4px: best.strictRuns, glyphs: ln.text.replace(/[ .]/g, '').length };
  });
  // Row-by-row ink profile across the band, to see where glyph ink actually sits.
  const rowProfile = [];
  for (let y = band.y; y < band.y + band.h; y += 5) {
    let ink = 0;
    for (let x = band.x; x < band.x + band.w; x++) {
      const p = (y * a.width + x) * ch;
      if (Math.max(Math.abs(a.data[p] - b.data[p]), Math.abs(a.data[p + 1] - b.data[p + 1]), Math.abs(a.data[p + 2] - b.data[p + 2])) > 16) ink++;
    }
    rowProfile.push({ y, ink });
  }
  console.log(`${width}px row profile:`, rowProfile.map((r) => `${r.y}:${r.ink}`).join(' '));
  console.log(`${width}px ink runs:`, JSON.stringify(runs));

  const STRIPS = 12;
  const rows = [];
  for (let i = 0; i < STRIPS; i++) {
    const x0 = band.x + Math.floor((band.w * i) / STRIPS);
    const x1 = band.x + Math.floor((band.w * (i + 1)) / STRIPS);
    let glyphN = 0, glyphSum = 0, bgN = 0, bgSum = 0;
    for (let y = band.y; y < band.y + band.h; y++) {
      for (let x = x0; x < x1; x++) {
        const p = (y * a.width + x) * ch;
        const dr = Math.abs(a.data[p] - b.data[p]);
        const dg = Math.abs(a.data[p + 1] - b.data[p + 1]);
        const db = Math.abs(a.data[p + 2] - b.data[p + 2]);
        if (Math.max(dr, dg, db) > 16) {
          glyphN++;
          glyphSum += luminance(a.data[p], a.data[p + 1], a.data[p + 2]);
        } else {
          bgN++;
          bgSum += luminance(b.data[p], b.data[p + 1], b.data[p + 2]);
        }
      }
    }
    const gl = glyphSum / Math.max(1, glyphN);
    const bl = bgSum / Math.max(1, bgN);
    const ratio = (Math.max(gl, bl) + 0.05) / (Math.min(gl, bl) + 0.05);
    rows.push({ strip: i, glyphCoverage: +(glyphN / Math.max(1, glyphN + bgN)).toFixed(2), contrast: +ratio.toFixed(2) });
  }
  console.log(`${width}x${height} band ${JSON.stringify(band)}`);
  console.table(rows);
  const worst = Math.min(...rows.map((r) => r.contrast));
  console.log(`${width}px worst strip contrast: ${worst.toFixed(2)} (WCAG large-text minimum 3.0)`);
}

const WIDTHS = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [1440, 390];
for (const w of WIDTHS) await runViewport(w, w < 500 ? 844 : 900);

ws.close();
proc.kill();
