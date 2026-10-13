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
 * Moneda: la operativa (primas, acciones, dividendos) va en USD; el capital del cliente
 * en EUR. La pestaña Divisa registra cada reseteo (USD consolidados a EUR).
 * Las cabeceras pueden terminar en € o $: la API las normaliza quitando el símbolo.
 *
 * Tras pegar una versión nueva de este archivo ejecuta una vez actualizarHoja()
 * (adapta cabeceras, crea la pestaña Divisa y regenera el Resumen sin tocar tus datos).
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
      'Comisiones apertura', 'Estado', 'Fecha cierre', 'Prima cierre (por acción)', 'Comisiones cierre',
      'Capital en riesgo manual', 'ID lote acciones', 'Notas'],
    defaults: { 'Multiplicador': 100 },
    autoId: 'ID'
  },
  acciones: {
    name: 'Acciones',
    key: 'Activo',
    inputs: ['ID lote', 'Activo', 'Origen', 'ID operación origen', 'Fecha entrada', 'Nº acciones',
      'Precio entrada (por acción)', 'Comisiones entrada', 'Estado', 'Fecha salida',
      'Precio salida (por acción)', 'Comisiones salida', 'Precio actual', 'Notas'],
    defaults: {},
    autoId: null
  },
  dividendos: {
    name: 'Dividendos',
    key: 'Activo',
    inputs: ['Fecha cobro', 'Activo', 'ID lote', 'Nº acciones', 'Dividendo por acción', 'Retención', 'Notas'],
    defaults: {},
    autoId: null
  },
  divisa: {
    name: 'Divisa',
    key: 'Fecha',
    inputs: ['Fecha', 'USD consolidados', 'Tipo de cambio EURUSD', 'Comisión', 'Notas'],
    defaults: {},
    autoId: null,
    optional: true   // las hojas antiguas no la tienen hasta ejecutar actualizarHoja()
  }
};
var DATE_HEADERS = ['Fecha', 'Fecha apertura', 'Vencimiento', 'Fecha cierre', 'Fecha entrada', 'Fecha salida', 'Fecha cobro'];
var TEXT_HEADERS = ['Activo', 'Notas', 'Estrategia', 'Estado', 'ID lote acciones', 'Notas', 'ID lote', 'Origen'];

/** Quita el símbolo de moneda final de una cabecera: "Prima neta €" → "Prima neta". */
function norm_(h) {
  return String(h).trim().replace(/\s*[€$]$/, '').trim();
}

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
  if (!sh) {
    if (def.optional) return [];
    throw new Error('No existe la pestaña ' + def.name);
  }
  var values = sh.getDataRange().getValues();
  var headers = values[0].map(norm_);
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
  var out = { cliente: '', capitalInicial: 15000, fxInicial: null, fxActual: null, divisaConfigurada: false };
  if (!sh) return out;
  var vals = sh.getRange(1, 1, 80, 2).getValues();
  for (var i = 0; i < vals.length; i++) {
    var label = norm_(vals[i][0]);
    var v = vals[i][1];
    if (label === 'Cliente') out.cliente = String(v || '');
    if (label === 'Capital inicial' && v !== '') out.capitalInicial = Number(v);
    if (label === 'Tipo de cambio EURUSD inicial' && v !== '' && isFinite(Number(v))) out.fxInicial = Number(v);
    if (label === 'Tipo de cambio EURUSD actual' && v !== '' && isFinite(Number(v))) out.fxActual = Number(v);
  }
  out.divisaConfigurada = !!(out.fxInicial && out.fxActual && ss.getSheetByName('Divisa'));
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
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(norm_);
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

/* ================================================================== Estructura de la hoja (v3) */

var FMT = {
  EUR: '#,##0.00 €;[Red]-#,##0.00 €;"-"',
  USD: '$#,##0.00;[Red]-$#,##0.00;"-"',
  PCT: '0.0%;[Red]-0.0%;"-"',
  DATE: 'dd/mm/yyyy',
  INT: '0',
  FX: '0.0000',
  NUM1: '0.0',
  MON: 'mmm-yy'
};
var LAST_ROW = { Operaciones: 1001, Acciones: 201, Dividendos: 301, Divisa: 201 };

/**
 * Especificación del Resumen: lista de celdas { a1, v, f (formato), s (estilo), gas (fórmula solo-Sheets) }.
 * La usa actualizarHoja() y también el generador de la plantilla .xlsx, para que ambas coincidan.
 */
function resumenSpec_() {
  var rng = function (sheet, col) { return sheet + '!$' + col + '$2:$' + col + '$' + LAST_ROW[sheet]; };
  var O = function (c) { return rng('Operaciones', c); };
  var A = function (c) { return rng('Acciones', c); };
  var D = function (c) { return rng('Dividendos', c); };
  var X = function (c) { return rng('Divisa', c); };
  var cells = [];
  var put = function (a1, v, f, s, gas) { cells.push({ a1: a1, v: v, f: f || null, s: s || 'calc', gas: gas || null }); };

  put('A1', 'Resumen de la cartera de opciones', null, 'title');
  put('A2', 'Operativa en dólares (cuenta USD) y capital del cliente en euros (cuenta EUR). Celdas azules con fondo amarillo: datos a rellenar.', null, 'muted');

  var rows = [
    ['Datos de la cuenta'],
    ['cliente', 'Cliente', '', null, 'input'],
    ['cap0', 'Capital inicial €', 15000, FMT.EUR, 'input'],
    ['fxIni', 'Tipo de cambio EURUSD inicial', 1.17, FMT.FX, 'input'],
    ['fxNow', 'Tipo de cambio EURUSD actual', 1.17, FMT.FX, 'auto', '=GOOGLEFINANCE("CURRENCY:EURUSD")'],
    ['ini', 'Fecha inicio', '=IF(COUNT(' + O('B') + ')=0,TODAY(),MIN(' + O('B') + '))', FMT.DATE],
    ['Cuentas'],
    ['eurAcc', 'Cuenta EUR €', '={cap0}+SUM(' + X('F') + ')', FMT.EUR],
    ['usdPend', 'Cuenta USD pendiente de consolidar $', '={r_tot}-SUM(' + X('B') + ')', FMT.USD],
    ['usdPendE', 'Cuenta USD en € (al cambio actual)', '=IF({fxNow}>0,{usdPend}/{fxNow},0)', FMT.EUR],
    ['capTot', 'Capital total €', '={eurAcc}+{usdPendE}', FMT.EUR],
    ['rentTot', 'Rentabilidad total % (en €)', '=IF({cap0}=0,"",{capTot}/{cap0}-1)', FMT.PCT],
    ['rentA', 'Rentabilidad anualizada % (en €)', '=IF(OR({cap0}=0,TODAY()-{ini}<30),"",(1+{rentTot})^(365/(TODAY()-{ini}))-1)', FMT.PCT],
    ['lastReset', 'Último reseteo de divisa', '=IF(COUNT(' + X('A') + ')=0,"",MAX(' + X('A') + '))', FMT.DATE],
    ['Resultados en dólares (operativa)'],
    ['r_op', 'Resultado opciones (primas) $', '=SUM(' + O('AE') + ')', FMT.USD],
    ['r_ac', 'Resultado acciones (vendidas / llamadas) $', '=SUM(' + A('Q') + ')', FMT.USD],
    ['r_dv', 'Dividendos netos $', '=SUM(' + D('I') + ')', FMT.USD],
    ['r_tot', 'Resultado realizado total $', '={r_op}+{r_ac}+{r_dv}', FMT.USD],
    ['rentOp', 'Rentabilidad operativa % (en $)', '=IF({cap0}*{fxIni}=0,"",{r_tot}/({cap0}*{fxIni}))', FMT.PCT],
    ['fxEff', 'Efecto divisa % (aprox.)', '=IF(OR({rentTot}="",{rentOp}=""),"",{rentTot}-{rentOp})', FMT.PCT],
    ['arorc', 'ARORC medio ponderado opciones %', '=IF(SUM(' + O('AM') + ')=0,"",SUMIFS(' + O('AE') + ',' + O('AM') + ',">0")/SUM(' + O('AM') + ')*365)', FMT.PCT],
    ['primas', 'Primas netas cobradas $ (créditos)', '=SUMIFS(' + O('Z') + ',' + O('U') + ',"Crédito")', FMT.USD],
    ['comis', 'Comisiones totales $', '=SUMIFS(' + O('L') + ',' + O('C') + ',"<>")+SUMIFS(' + O('P') + ',' + O('C') + ',"<>")+SUMIFS(' + A('H') + ',' + A('B') + ',"<>")+SUMIFS(' + A('L') + ',' + A('B') + ',"<>")', FMT.USD],
    ['Acciones en cartera (no realizado)'],
    ['lotes', 'Lotes en cartera', '=COUNTIF(' + A('I') + ',"En cartera")', FMT.INT],
    ['c_ac', 'Coste acciones en cartera $', '=SUMIFS(' + A('O') + ',' + A('I') + ',"En cartera")', FMT.USD],
    ['lat', 'Plusvalía latente $', '=SUM(' + A('R') + ')', FMT.USD],
    ['patr', 'Patrimonio estimado € (capital + latente)', '={capTot}+IF({fxNow}>0,{lat}/{fxNow},0)', FMT.EUR],
    ['Operaciones de opciones'],
    ['n', 'Operaciones totales', '=COUNTIF(' + O('C') + ',"?*")', FMT.INT],
    ['ab', 'Abiertas', '=COUNTIF(' + O('M') + ',"Abierta")', FMT.INT],
    ['asig', 'Asignadas', '=COUNTIF(' + O('M') + ',"Asignada")', FMT.INT],
    ['fin', 'Finalizadas', '=COUNTIF(' + O('AL') + ',1)', FMT.INT],
    ['gan', 'Ganadoras', '=COUNTIF(' + O('AE') + ',">0")', FMT.INT],
    ['wr', 'Win rate %', '=IF({fin}=0,"",{gan}/{fin})', FMT.PCT],
    ['med', 'Resultado medio por operación $', '=IF({fin}=0,"",{r_op}/{fin})', FMT.USD],
    ['best', 'Mejor operación $', '=IF({fin}=0,"",MAX(' + O('AE') + '))', FMT.USD],
    ['worst', 'Peor operación $', '=IF({fin}=0,"",MIN(' + O('AE') + '))', FMT.USD],
    ['dias', 'Días medios en operación', '=IF({fin}=0,"",SUMIFS(' + O('X') + ',' + O('AL') + ',1)/{fin})', FMT.NUM1],
    ['capt', '% prima capturada medio', '=IFERROR(AVERAGE(' + O('AJ') + '),"")', FMT.PCT],
    ['Riesgo actual'],
    ['c_op', 'Capital comprometido en opciones abiertas $', '=SUMIFS(' + O('AD') + ',' + O('M') + ',"Abierta")-SUMIFS(' + O('AD') + ',' + O('M') + ',"Abierta",' + O('D') + ',"Call cubierta (CC)",' + O('R') + ',"<>")', FMT.USD],
    ['c_ac2', 'Coste acciones en cartera $', '={c_ac}', FMT.USD],
    ['uso', 'Capital en uso $', '={c_op}+{c_ac2}', FMT.USD],
    ['uso_p', '% del capital en uso', '=IF({capTot}*{fxNow}<=0,"",{uso}/({capTot}*{fxNow}))', FMT.PCT],
    ['p_ab', 'Prima neta en opciones abiertas $', '=SUMIFS(' + O('Z') + ',' + O('M') + ',"Abierta")', FMT.USD],
    ['avisos', 'Avisos pendientes (columnas Control)', '=COUNTIF(' + O('C') + ',"?*")-COUNTIF(' + O('AN') + ',"OK")+COUNTIF(' + A('B') + ',"?*")-COUNTIF(' + A('Y') + ',"OK*")+COUNTIF(' + D('B') + ',"?*")-COUNTIF(' + D('J') + ',"OK")+COUNT(' + X('A') + ')-COUNTIF(' + X('G') + ',"OK")', FMT.INT]
  ];
  var pos = {};
  rows.forEach(function (row, i) { if (row.length > 1) pos[row[0]] = '$B$' + (4 + i); });
  var fill = function (v) { return typeof v === 'string' ? v.replace(/\{(\w+)\}/g, function (_, k) { if (!pos[k]) throw new Error('Clave ' + k); return pos[k]; }) : v; };
  rows.forEach(function (row, i) {
    var r = 4 + i;
    if (row.length === 1) { put('A' + r, row[0], null, 'section'); put('B' + r, '', null, 'section'); return; }
    put('A' + r, row[1], null, 'label');
    put('B' + r, fill(row[2]), row[3], row[4] || 'calc', row[5] ? fill(row[5]) : null);
  });

  // Tabla mensual (operativa en $)
  var mh = ['Mes', 'Primas $', 'Acciones $', 'Dividendos $', 'Total $', 'Nº cierres', 'Capital operativo fin de mes $', 'Rentab. mes %', 'Rentab. acumulada % ($)', 'Win rate opciones %'];
  var mc = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
  mh.forEach(function (h, i) { put(mc[i] + '4', h, null, 'hdr'); });
  var cap0usd = '(' + pos.cap0 + '*' + pos.fxIni + ')';
  var between = function (r, m) { return r + ',">="&' + m + ',' + r + ',"<"&EDATE(' + m + ',1)'; };
  for (var k = 0; k < 24; k++) {
    var r = 5 + k, m = '$D' + r, fut = m + '>TODAY()';
    var prev = k === 0 ? cap0usd : 'J' + (r - 1);
    put('D' + r, k === 0 ? '=DATE(YEAR(' + pos.ini + '),MONTH(' + pos.ini + '),1)' : '=EDATE(D' + (r - 1) + ',1)', FMT.MON, 'cell');
    put('E' + r, '=IF(' + fut + ',"",SUMIFS(' + O('AE') + ',' + between(O('N'), m) + '))', FMT.USD, 'cell');
    put('F' + r, '=IF(' + fut + ',"",SUMIFS(' + A('Q') + ',' + between(A('J'), m) + '))', FMT.USD, 'cell');
    put('G' + r, '=IF(' + fut + ',"",SUMIFS(' + D('I') + ',' + between(D('A'), m) + '))', FMT.USD, 'cell');
    put('H' + r, '=IF(' + fut + ',"",E' + r + '+F' + r + '+G' + r + ')', FMT.USD, 'cell');
    put('I' + r, '=IF(' + fut + ',"",COUNTIFS(' + between(O('N'), m) + ',' + O('AL') + ',1))', FMT.INT, 'cell');
    put('J' + r, '=IF(' + fut + ',"",' + prev + '+H' + r + ')', FMT.USD, 'cell');
    put('K' + r, '=IF(OR(' + fut + ',' + prev + '=0),"",H' + r + '/' + prev + ')', FMT.PCT, 'cell');
    put('L' + r, '=IF(OR(' + fut + ',' + cap0usd + '=0),"",J' + r + '/' + cap0usd + '-1)', FMT.PCT, 'cell');
    put('M' + r, '=IF(OR(' + fut + ',I' + r + '=0),"",COUNTIFS(' + between(O('N'), m) + ',' + O('AE') + ',">0")/I' + r + ')', FMT.PCT, 'cell');
  }
  put('D29', 'Meses futuros vacíos. Primas: por fecha de cierre · Acciones: por fecha de salida · Dividendos: por fecha de cobro. Todo en $.', null, 'muted');

  // Tabla por estrategia
  var sh = ['Estrategia', 'Nº ops', 'Finalizadas', 'Asignadas', 'Resultado prima $', 'Win rate %', 'ARORC pond. %'];
  sh.forEach(function (h, i) { put(mc[i] + '32', h, null, 'hdr'); });
  for (var j = 0; j < 12; j++) {
    var rr = 33 + j, s = '$D' + rr;
    put('D' + rr, '=Listas!A' + (2 + j), null, 'cell');
    put('E' + rr, '=COUNTIF(' + O('D') + ',' + s + ')', FMT.INT, 'cell');
    put('F' + rr, '=COUNTIFS(' + O('D') + ',' + s + ',' + O('AL') + ',1)', FMT.INT, 'cell');
    put('G' + rr, '=COUNTIFS(' + O('D') + ',' + s + ',' + O('M') + ',"Asignada")', FMT.INT, 'cell');
    put('H' + rr, '=SUMIFS(' + O('AE') + ',' + O('D') + ',' + s + ')', FMT.USD, 'cell');
    put('I' + rr, '=IF(F' + rr + '=0,"",COUNTIFS(' + O('D') + ',' + s + ',' + O('AE') + ',">0")/F' + rr + ')', FMT.PCT, 'cell');
    put('J' + rr, '=IF(SUMIFS(' + O('AM') + ',' + O('D') + ',' + s + ')=0,"",SUMIFS(' + O('AE') + ',' + O('D') + ',' + s + ',' + O('AM') + ',">0")/SUMIFS(' + O('AM') + ',' + O('D') + ',' + s + ')*365)', FMT.PCT, 'cell');
  }
  return { cells: cells, pos: pos };
}

/** Especificación de la pestaña Divisa. */
function divisaSpec_() {
  var last = LAST_ROW.Divisa;
  return {
    headers: [
      ['A', 'Fecha', 12, FMT.DATE, true, 'Fecha del reseteo (conversión real o contable)'],
      ['B', 'USD consolidados', 14, FMT.USD, true, 'Dólares que pasan de la cuenta USD a la EUR. Normalmente, el saldo de "Cuenta USD pendiente" del Resumen.'],
      ['C', 'Tipo de cambio EURUSD', 12, FMT.FX, true, 'Dólares por 1 euro ese día (p. ej. 1,1650)'],
      ['D', 'Comisión €', 11, FMT.EUR, true, 'Coste de la conversión, si lo hay'],
      ['E', 'Notas', 28, null, true, null],
      ['F', 'EUR recibidos (neto) €', 14, FMT.EUR, false, null],
      ['G', 'Control', 18, null, false, null]
    ],
    formulas: function (r) {
      return {
        F: '=IF(OR($A' + r + '="",$B' + r + '="",N($C' + r + ')=0),"",$B' + r + '/$C' + r + '-N($D' + r + '))',
        G: '=IF($A' + r + '="","",IF(OR($B' + r + '="",$C' + r + '=""),"Faltan datos","OK"))'
      };
    },
    last: last
  };
}

var GUIA_MONEDA = 'La operativa va en USD (primas, strikes, acciones, dividendos y comisiones del bróker). El capital del cliente está en EUR. '
  + 'Cada mes (recomendado, a fin de mes) registra en la pestaña Divisa un reseteo: los USD acumulados que pasan a EUR y el tipo de cambio. '
  + 'El Resumen muestra la cuenta EUR, la cuenta USD pendiente y el capital total en € al cambio actual.';

/**
 * Ejecútala UNA VEZ desde el editor tras pegar esta versión del script (es seguro repetirla):
 *  - cambia € por $ en las cabeceras y formatos de Operaciones, Acciones y Dividendos
 *  - crea la pestaña Divisa si no existe
 *  - regenera el Resumen conservando Cliente, Capital inicial y Tipo de cambio inicial
 */
function actualizarHoja() {
  var ss = spreadsheet_();
  var cuenta = readCuenta_(ss);

  // 1. Cabeceras y formatos a USD
  ['Operaciones', 'Acciones', 'Dividendos'].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) throw new Error('No existe la pestaña ' + name);
    var lastCol = sh.getLastColumn();
    var heads = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    var rows = Math.max(sh.getLastRow() - 1, 1);
    heads.forEach(function (h, i) {
      var t = String(h).trim();
      if (/€$/.test(t) || /\$$/.test(t)) {
        sh.getRange(1, i + 1).setValue(t.replace(/\s*€$/, ' $'));
        sh.getRange(2, i + 1, rows, 1).setNumberFormat(FMT.USD);
      }
    });
  });

  // 2. Pestaña Divisa
  var dv = ss.getSheetByName('Divisa');
  if (!dv) {
    var idx = ss.getSheetByName('Dividendos') ? ss.getSheetByName('Dividendos').getIndex() : ss.getNumSheets();
    dv = ss.insertSheet('Divisa', idx);
    var spec = divisaSpec_();
    var hs = spec.headers;
    dv.getRange(1, 1, 1, hs.length).setValues([hs.map(function (h) { return h[1]; })])
      .setFontWeight('bold').setFontColor('#FFFFFF').setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('center');
    hs.forEach(function (h, i) {
      dv.getRange(1, i + 1).setBackground(h[4] ? '#1F4E79' : '#404040');
      dv.setColumnWidth(i + 1, h[2] * 8);
      if (h[3]) dv.getRange(2, i + 1, spec.last - 1, 1).setNumberFormat(h[3]);
      dv.getRange(2, i + 1, spec.last - 1, 1).setFontColor(h[4] ? '#0000FF' : '#000000');
      if (h[5]) dv.getRange(1, i + 1).setNote(h[5]);
    });
    var f = [];
    for (var r = 2; r <= spec.last; r++) { var fr = spec.formulas(r); f.push([fr.F, fr.G]); }
    dv.getRange(2, 6, spec.last - 1, 2).setFormulas(f);
    dv.setFrozenRows(1);
    dv.setRowHeight(1, 40);
  }

  // 3. Resumen
  var rs = ss.getSheetByName('Resumen') || ss.insertSheet('Resumen');
  rs.clear();
  if (rs.clearConditionalFormatRules) rs.clearConditionalFormatRules();
  applyResumen_(rs, resumenSpec_(), cuenta);

  // 4. Texto de la Guía sobre la moneda
  var g = ss.getSheetByName('Guía');
  if (g) {
    var col = g.getRange(1, 1, Math.max(g.getLastRow(), 1), 2).getValues();
    for (var i = 0; i < col.length; i++) if (String(col[i][0]).trim() === 'Moneda') g.getRange(i + 1, 2).setValue(GUIA_MONEDA);
  }
  SpreadsheetApp.flush();
  Logger.log('Hoja actualizada. Revisa en Resumen el "Tipo de cambio EURUSD inicial" (cambio del día en que empezó la cuenta).');
}

function applyResumen_(rs, spec, cuenta) {
  var ROWS = 60, COLS = 13;
  var grid = [], fmts = [], bgs = [], colors = [], weights = [];
  for (var r = 0; r < ROWS; r++) {
    grid.push(new Array(COLS).fill(''));
    fmts.push(new Array(COLS).fill('General'));
    bgs.push(new Array(COLS).fill(null));
    colors.push(new Array(COLS).fill('#000000'));
    weights.push(new Array(COLS).fill('normal'));
  }
  var keep = { cliente: cuenta.cliente, cap0: cuenta.capitalInicial, fxIni: cuenta.fxInicial };
  var keyAt = {};
  Object.keys(spec.pos).forEach(function (k) { keyAt[spec.pos[k].replace(/\$/g, '')] = k; });
  spec.cells.forEach(function (c) {
    var m = /^([A-Z]+)(\d+)$/.exec(c.a1);
    var col = m[1].charCodeAt(0) - 65, row = Number(m[2]) - 1;
    var key = keyAt[c.a1];
    var v = c.gas || c.v;
    if (key && keep[key] !== undefined && keep[key] !== null && keep[key] !== '') v = keep[key];
    grid[row][col] = v;
    if (c.f) fmts[row][col] = c.f;
    if (c.s === 'title') weights[row][col] = 'bold';
    if (c.s === 'muted') colors[row][col] = '#666666';
    if (c.s === 'section') { weights[row][col] = 'bold'; bgs[row][col] = '#D9E1F2'; }
    if (c.s === 'input') { colors[row][col] = '#0000FF'; bgs[row][col] = '#FFFF00'; }
    if (c.s === 'auto') { colors[row][col] = '#0000FF'; bgs[row][col] = '#FFF2CC'; }
    if (c.s === 'hdr') { weights[row][col] = 'bold'; colors[row][col] = '#FFFFFF'; bgs[row][col] = '#404040'; }
  });
  var range = rs.getRange(1, 1, ROWS, COLS);
  range.setValues(grid);
  range.setNumberFormats(fmts);
  range.setBackgrounds(bgs);
  range.setFontColors(colors);
  range.setFontWeights(weights);
  rs.getRange('A1').setFontSize(14);
  rs.setColumnWidth(1, 300);
  rs.setColumnWidth(2, 130);
  rs.setColumnWidth(3, 20);
  rs.getRange('D4:M4').setWrap(true);
  rs.getRange('D32:J32').setWrap(true);
  rs.setFrozenRows(3);
}
