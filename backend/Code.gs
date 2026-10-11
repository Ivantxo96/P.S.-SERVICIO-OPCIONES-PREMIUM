/**
 * API del dashboard de la cartera de opciones.
 *
 * Se pega en Extensiones → Apps Script de la Google Sheet creada a partir de
 * Cartera_Opciones_Cliente.xlsx y se despliega como aplicación web.
 *
 * Propiedades del script (Configuración del proyecto → Propiedades del script):
 *   CLIENT_PASSWORD   contraseña del cliente (solo lectura)
 *   ADMIN_PASSWORD    contraseña del gestor (lectura + edición)
 *   SPREADSHEET_ID    opcional; solo si el script NO está creado desde la propia hoja
 *
 * Todas las peticiones son POST con un JSON en el cuerpo: { action, ... }.
 * Respuesta siempre JSON: { ok: true, ... } o { ok: false, error: "..." }.
 */

var TOKEN_TTL_SECONDS = 6 * 60 * 60;   // la sesión dura 6 horas
var MAX_FAILED_LOGINS = 10;            // intentos fallidos permitidos...
var FAILED_WINDOW_SECONDS = 15 * 60;   // ...en esta ventana

// Hojas que expone la API. key = columna que indica si la fila está en uso.
var SHEETS = {
  operaciones: {
    name: 'Operaciones',
    key: 'Activo',
    inputs: ['ID', 'Fecha apertura', 'Activo', 'Estrategia', 'Strike venta', 'Strike compra', 'Vencimiento',
      'Contratos', 'Multiplicador', 'Precio subyacente apertura', 'Prima apertura (por acción)',
      'Comisiones apertura €', 'Estado', 'Fecha cierre', 'Prima cierre (por acción)', 'Comisiones cierre €',
      'Capital en riesgo manual €', 'ID lote acciones', 'Notas'],
    defaults: { 'Multiplicador': 100 },
    autoId: 'ID'
  },
  acciones: {
    name: 'Acciones',
    key: 'Activo',
    inputs: ['ID lote', 'Activo', 'Origen', 'ID operación origen', 'Fecha entrada', 'Nº acciones',
      'Precio entrada (por acción)', 'Comisiones entrada €', 'Estado', 'Fecha salida',
      'Precio salida (por acción)', 'Comisiones salida €', 'Precio actual', 'Notas'],
    defaults: {},
    autoId: null
  },
  dividendos: {
    name: 'Dividendos',
    key: 'Activo',
    inputs: ['Fecha cobro', 'Activo', 'ID lote', 'Nº acciones', 'Dividendo por acción', 'Retención €', 'Notas'],
    defaults: {},
    autoId: null
  }
};
var DATE_HEADERS = ['Fecha apertura', 'Vencimiento', 'Fecha cierre', 'Fecha entrada', 'Fecha salida', 'Fecha cobro'];
var TEXT_HEADERS = ['Activo', 'Estrategia', 'Estado', 'ID lote acciones', 'Notas', 'ID lote', 'Origen'];

/* ------------------------------------------------------------------ HTTP */

function doPost(e) {
  var out;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = route_(body);
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'cartera-opciones', hint: 'Usa POST' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function route_(body) {
  switch (body.action) {
    case 'login': return login_(body.password);
    case 'data': return getData_(requireRole_(body.token, 'client'));
    case 'save': requireRole_(body.token, 'admin'); return withLock_(function () { return saveRow_(body.sheet, body.row, body.values); });
    case 'delete': requireRole_(body.token, 'admin'); return withLock_(function () { return clearRow_(body.sheet, body.row); });
    case 'logout': CacheService.getScriptCache().remove('tok_' + body.token); return { ok: true };
    default: throw new Error('Acción no válida');
  }
}

/* ------------------------------------------------------------------ Auth */

function login_(password) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('failed_logins') || 0);
  if (fails >= MAX_FAILED_LOGINS) throw new Error('Demasiados intentos fallidos. Espera 15 minutos.');

  var props = PropertiesService.getScriptProperties();
  var adminPw = props.getProperty('ADMIN_PASSWORD');
  var clientPw = props.getProperty('CLIENT_PASSWORD');
  if (!adminPw || !clientPw) throw new Error('El gestor aún no ha configurado las contraseñas del script.');

  var role = null;
  if (password && safeEquals_(String(password), adminPw)) role = 'admin';
  else if (password && safeEquals_(String(password), clientPw)) role = 'client';

  if (!role) {
    cache.put('failed_logins', String(fails + 1), FAILED_WINDOW_SECONDS);
    Utilities.sleep(800);
    throw new Error('Contraseña incorrecta');
  }
  var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  cache.put('tok_' + token, role, TOKEN_TTL_SECONDS);
  return { ok: true, token: token, role: role, expiresIn: TOKEN_TTL_SECONDS };
}

function requireRole_(token, needed) {
  if (!token) throw new Error('SESION: no autenticado');
  var role = CacheService.getScriptCache().get('tok_' + token);
  if (!role) throw new Error('SESION: la sesión ha caducado, vuelve a entrar');
  if (needed === 'admin' && role !== 'admin') throw new Error('Solo el gestor puede editar');
  return role;
}

function safeEquals_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ------------------------------------------------------------------ Lectura */

function spreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function getData_(role) {
  var ss = spreadsheet_();
  var tz = ss.getSpreadsheetTimeZone();
  var data = { ok: true, role: role, generatedAt: new Date().toISOString(), cuenta: readCuenta_(ss), listas: readListas_(ss) };
  Object.keys(SHEETS).forEach(function (k) { data[k] = readSheet_(ss, SHEETS[k], tz); });
  data.schema = {};
  Object.keys(SHEETS).forEach(function (k) { data.schema[k] = SHEETS[k].inputs; });
  return data;
}

function readSheet_(ss, def, tz) {
  var sh = ss.getSheetByName(def.name);
  if (!sh) throw new Error('No existe la pestaña ' + def.name);
  var values = sh.getDataRange().getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var keyIdx = headers.indexOf(def.key);
  if (keyIdx < 0) throw new Error('En ' + def.name + ' falta la columna ' + def.key);
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    if (values[r][keyIdx] === '' || values[r][keyIdx] === null) continue;
    var obj = { _row: r + 1 };
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      obj[headers[c]] = serialize_(values[r][c], tz);
    }
    rows.push(obj);
  }
  return rows;
}

function serialize_(v, tz) {
  if (v === '' || v === null || v === undefined) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? null : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  }
  return v;
}

function readCuenta_(ss) {
  var sh = ss.getSheetByName('Resumen');
  var out = { cliente: '', capitalInicial: 15000 };
  if (!sh) return out;
  var vals = sh.getRange(1, 1, 60, 2).getValues();
  for (var i = 0; i < vals.length; i++) {
    var label = String(vals[i][0]).trim();
    if (label === 'Cliente') out.cliente = String(vals[i][1] || '');
    if (label === 'Capital inicial €' && vals[i][1] !== '') out.capitalInicial = Number(vals[i][1]);
  }
  return out;
}

function readListas_(ss) {
  var sh = ss.getSheetByName('Listas');
  var empty = { estrategias: [], estados: [], estadosLote: [], origenes: [] };
  if (!sh) return empty;
  var v = sh.getRange(2, 1, 19, 10).getValues();
  var col = function (i) { return v.map(function (r) { return r[i]; }).filter(function (x) { return x !== '' && x !== null; }).map(String); };
  var familias = {};
  v.forEach(function (r) { if (r[0]) familias[r[0]] = { familia: r[1], tipo: r[2], metodo: r[3] }; });
  return { estrategias: col(0), estrategiaInfo: familias, estados: col(5), estadosLote: col(7), origenes: col(9) };
}

/* ------------------------------------------------------------------ Escritura */

function sheetDef_(key) {
  var def = SHEETS[key];
  if (!def) throw new Error('Hoja no válida');
  return def;
}

function headerMap_(sh) {
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  var map = {};
  headers.forEach(function (h, i) { if (h) map[h] = i + 1; });
  return map;
}

function parseValue_(header, v) {
  if (v === null || v === undefined || v === '') return '';
  if (DATE_HEADERS.indexOf(header) >= 0) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
    if (!m) throw new Error(header + ': fecha no válida (usa AAAA-MM-DD)');
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  if (header === 'Activo') return String(v).trim().toUpperCase();
  if (TEXT_HEADERS.indexOf(header) >= 0) return String(v).trim();
  var n = Number(String(v).replace(',', '.'));
  if (!isFinite(n)) throw new Error(header + ': debe ser un número');
  return n;
}

function saveRow_(sheetKey, row, values) {
  var def = sheetDef_(sheetKey);
  var sh = spreadsheet_().getSheetByName(def.name);
  var map = headerMap_(sh);
  values = values || {};
  if (!values[def.key] && !row) throw new Error('Falta ' + def.key);

  var target = Number(row) || null;
  if (target) {
    if (target < 2 || target > sh.getLastRow()) throw new Error('Fila no válida');
    var current = sh.getRange(target, map[def.key]).getValue();
    if (current === '' || current === null) throw new Error('Esa fila está vacía; recarga los datos');
  } else {
    target = firstEmptyRow_(sh, map[def.key]);
    if (!target) throw new Error('No quedan filas preparadas en ' + def.name + '. Copia la última fila hacia abajo en la hoja.');
    Object.keys(def.defaults).forEach(function (h) {
      if (values[h] === undefined || values[h] === '' || values[h] === null) values[h] = def.defaults[h];
    });
    if (def.autoId && (values[def.autoId] === undefined || values[def.autoId] === '' || values[def.autoId] === null)) {
      values[def.autoId] = nextId_(sh, map[def.autoId]);
    }
  }

  def.inputs.forEach(function (h) {
    if (!(h in values)) return;          // solo se tocan los campos enviados
    if (!map[h]) throw new Error('No existe la columna "' + h + '" en ' + def.name);
    sh.getRange(target, map[h]).setValue(parseValue_(h, values[h]));
  });
  SpreadsheetApp.flush();
  return { ok: true, row: target };
}

function clearRow_(sheetKey, row) {
  var def = sheetDef_(sheetKey);
  var sh = spreadsheet_().getSheetByName(def.name);
  var map = headerMap_(sh);
  var target = Number(row);
  if (!target || target < 2 || target > sh.getLastRow()) throw new Error('Fila no válida');
  def.inputs.forEach(function (h) {
    if (map[h]) sh.getRange(target, map[h]).setValue(h in def.defaults ? def.defaults[h] : '');
  });
  SpreadsheetApp.flush();
  return { ok: true, row: target };
}

function firstEmptyRow_(sh, keyCol) {
  var last = sh.getLastRow();
  if (last < 2) return 2;
  var vals = sh.getRange(2, keyCol, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) if (vals[i][0] === '' || vals[i][0] === null) return i + 2;
  return null;
}

function nextId_(sh, col) {
  var last = sh.getLastRow();
  if (last < 2) return 1;
  var vals = sh.getRange(2, col, last - 1, 1).getValues();
  var max = 0;
  vals.forEach(function (r) { var n = Number(r[0]); if (isFinite(n) && n > max) max = n; });
  return max + 1;
}

/* ------------------------------------------------------------------ Utilidades para el gestor */

/** Ejecútala desde el editor para comprobar que lee bien la hoja (mira el registro). */
function probar() {
  var d = getData_('admin');
  Logger.log('Cliente: %s · Capital: %s', d.cuenta.cliente, d.cuenta.capitalInicial);
  Logger.log('Operaciones: %s · Lotes: %s · Dividendos: %s', d.operaciones.length, d.acciones.length, d.dividendos.length);
  Logger.log('Estrategias: %s', d.listas.estrategias.join(', '));
}
