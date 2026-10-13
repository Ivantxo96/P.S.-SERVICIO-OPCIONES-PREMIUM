// Simulador mínimo de Google Apps Script para ejecutar Code.gs en Node
// sobre un volcado JSON de la hoja (solo para desarrollo y pruebas).
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const toCell = (v) => (v && typeof v === 'object' && v.__date)
  ? (([y, m, d]) => new Date(y, m - 1, d))(v.__date.split('-').map(Number))
  : v;

export function loadGas({ codePath, sheetsPath, props }) {
  const raw = JSON.parse(fs.readFileSync(sheetsPath, 'utf8'));
  const grids = Object.fromEntries(Object.entries(raw).map(([k, rows]) => [k, rows.map((r) => r.map(toCell))]));

  const a1ToRC = (a1) => {
    const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(a1);
    const col = (s) => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
    const r1 = Number(m[2]); const c1 = col(m[1]);
    const r2 = m[4] ? Number(m[4]) : r1; const c2 = m[3] ? col(m[3]) : c1;
    return [r1, c1, r2 - r1 + 1, c2 - c1 + 1];
  };
  const makeRange = (grid, r, c, nr = 1, nc = 1) => {
    const ensure = (rr) => { while (grid.length < rr) grid.push([]); };
    let proxy;
    const range = {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => grid[r - 1 + i]?.[c - 1 + j] ?? '')),
      getValue: () => grid[r - 1]?.[c - 1] ?? '',
      setValue: (v) => { ensure(r); grid[r - 1][c - 1] = v; return proxy; },
      setValues: (vals) => { vals.forEach((row, i) => { ensure(r + i); row.forEach((v, j) => { grid[r - 1 + i][c - 1 + j] = v; }); }); return proxy; },
      setFormulas: (vals) => range.setValues(vals),
    };
    // Métodos de formato: no-op encadenables
    proxy = new Proxy(range, { get: (t, k) => (k in t ? t[k] : () => proxy) });
    return proxy;
  };
  const order = Object.keys(grids);
  const makeSheet = (name) => {
    const grid = grids[name];
    if (!grid) return null;
    const width = () => Math.max(1, ...grid.map((r) => r.length));
    let sproxy;
    const sheet = {
      getName: () => name,
      getIndex: () => order.indexOf(name) + 1,
      getLastRow: () => grid.length,
      getLastColumn: width,
      getDataRange: () => makeRange(grid, 1, 1, grid.length, width()),
      getRange: (r, c, nr, nc) => (typeof r === 'string' ? makeRange(grid, ...a1ToRC(r)) : makeRange(grid, r, c, nr, nc)),
      clear: () => { grid.length = 0; return sproxy; },
    };
    sproxy = new Proxy(sheet, { get: (t, k) => (k in t ? t[k] : () => sproxy) });
    return sproxy;
  };
  const ss = {
    getSheetByName: makeSheet,
    getSpreadsheetTimeZone: () => 'Europe/Madrid',
    getNumSheets: () => order.length,
    insertSheet: (name, idx) => { grids[name] = []; order.splice(idx ?? order.length, 0, name); return makeSheet(name); },
  };
  const cache = new Map();
  const properties = { ...props };

  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, flush: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => properties[k] ?? null }) },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => cache.get(k) ?? null,
        put: (k, v) => cache.set(k, String(v)),
        remove: (k) => cache.delete(k),
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      sleep: () => {},
      formatDate: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; } }),
    },
    Logger: { log: (...a) => console.log('[Logger]', ...a) },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(codePath, 'utf8'), ctx, { filename: 'Code.gs' });

  const call = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).content);
  return { call, grids, ctx, clearCache: () => cache.clear() };
}
