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

  const makeRange = (grid, r, c, nr = 1, nc = 1) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => grid[r - 1 + i]?.[c - 1 + j] ?? '')),
    getValue: () => grid[r - 1]?.[c - 1] ?? '',
    setValue: (v) => {
      while (grid.length < r) grid.push([]);
      grid[r - 1][c - 1] = v;
    },
  });
  const makeSheet = (name) => {
    const grid = grids[name];
    if (!grid) return null;
    const width = () => Math.max(...grid.map((r) => r.length));
    return {
      getName: () => name,
      getLastRow: () => grid.length,
      getLastColumn: width,
      getDataRange: () => makeRange(grid, 1, 1, grid.length, width()),
      getRange: (r, c, nr, nc) => makeRange(grid, r, c, nr, nc),
    };
  };
  const ss = { getSheetByName: makeSheet, getSpreadsheetTimeZone: () => 'Europe/Madrid' };
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
