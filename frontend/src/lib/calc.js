// Agregados del dashboard a partir de las filas de la hoja.
// Los cálculos por fila (resultado, capital en riesgo, ARORC…) ya vienen hechos
// por las fórmulas de Google Sheets; aquí solo se suman y se ordenan en el tiempo.
import { isNum } from './format.js';

// Nombres de columna de la hoja (deben coincidir con las cabeceras)
export const C = {
  // Operaciones
  id: 'ID', fApertura: 'Fecha apertura', activo: 'Activo', estrategia: 'Estrategia', sv: 'Strike venta',
  sc: 'Strike compra', vto: 'Vencimiento', contratos: 'Contratos', mult: 'Multiplicador',
  subyacente: 'Precio subyacente apertura', primaAp: 'Prima apertura (por acción)', estado: 'Estado',
  fCierre: 'Fecha cierre', primaCie: 'Prima cierre (por acción)', lote: 'ID lote acciones', notas: 'Notas',
  familia: 'Familia', tipo: 'Crédito / Débito', diasOp: 'Días en operación', primaNeta: 'Prima neta €',
  be: 'Break-even', colchon: 'Colchón OTM % (apertura)', capital: 'Capital en riesgo €',
  resultado: 'Resultado prima €', rent: 'Rentabilidad s/ capital %', arorc: 'ARORC realizado %',
  rocMax: 'ROC máximo %', arorcEsp: 'ARORC esperado %', capturada: '% prima capturada',
  capDias: 'Capital × días', control: 'Control',
  // Acciones
  idLote: 'ID lote', origen: 'Origen', fEntrada: 'Fecha entrada', nAcc: 'Nº acciones',
  pEntrada: 'Precio entrada (por acción)', fSalida: 'Fecha salida', pSalida: 'Precio salida (por acción)',
  pActual: 'Precio actual', coste: 'Coste entrada €', resAcc: 'Resultado acciones realizado €',
  latente: 'Plusvalía latente €', divLote: 'Dividendos netos €', primasLote: 'Primas asociadas €',
  totalCiclo: 'Resultado total ciclo €', costeAjust: 'Coste base ajustado (por acción)',
  // Dividendos
  fCobro: 'Fecha cobro', dpa: 'Dividendo por acción', retencion: 'Retención €', bruto: 'Bruto €', neto: 'Neto €',
};

const n = (v) => (isNum(v) ? v : 0);
const sum = (arr, f) => arr.reduce((s, x) => s + n(f(x)), 0);
const r2 = (v) => Math.round(v * 100) / 100;
export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const ts = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
export const daysBetween = (a, b) => Math.round((ts(b) - ts(a)) / 86400000);

export function analyze(data, today = todayStr()) {
  const cap0 = Number(data.cuenta?.capitalInicial) || 15000;
  const ops = data.operaciones || [];
  const lots = data.acciones || [];
  const divs = data.dividendos || [];

  // --- Eventos realizados (lo que mueve el capital)
  const events = [];
  for (const o of ops) if (isNum(o[C.resultado]) && o[C.fCierre]) events.push({ date: o[C.fCierre], kind: 'primas', amount: o[C.resultado] });
  for (const l of lots) if (isNum(l[C.resAcc]) && l[C.fSalida]) events.push({ date: l[C.fSalida], kind: 'acciones', amount: l[C.resAcc] });
  for (const d of divs) if (isNum(d[C.neto]) && d[C.fCobro]) events.push({ date: d[C.fCobro], kind: 'dividendos', amount: d[C.neto] });
  events.sort((a, b) => a.date.localeCompare(b.date));

  const startCandidates = [...ops.map((o) => o[C.fApertura]), ...lots.map((l) => l[C.fEntrada]), ...events.map((e) => e.date)].filter(Boolean).sort();
  const start = startCandidates[0] || today;

  const byKind = { primas: 0, acciones: 0, dividendos: 0 };
  for (const e of events) byKind[e.kind] += e.amount;
  const realized = byKind.primas + byKind.acciones + byKind.dividendos;
  const capital = cap0 + realized;

  // --- Curva de capital y drawdown (sobre resultado realizado)
  const curve = [{ date: start, t: ts(start), capital: cap0 }];
  let running = cap0;
  for (const e of events) {
    running += e.amount;
    const last = curve[curve.length - 1];
    if (last.date === e.date) last.capital = running;
    else curve.push({ date: e.date, t: ts(e.date), capital: running });
  }
  if (curve[curve.length - 1].date < today) curve.push({ date: today, t: ts(today), capital: running });
  let peak = -Infinity; let maxDD = 0;
  for (const p of curve) {
    p.capital = r2(p.capital);
    peak = Math.max(peak, p.capital);
    p.dd = peak > 0 ? p.capital / peak - 1 : 0;
    p.ret = p.capital / cap0 - 1;
    maxDD = Math.min(maxDD, p.dd);
  }

  // --- Mes a mes
  const months = [];
  const [sy, sm] = start.split('-').map(Number);
  const [ty, tm] = today.split('-').map(Number);
  let capStart = cap0;
  for (let y = sy, m = sm; y < ty || (y === ty && m <= tm); m === 12 ? (y++, (m = 1)) : m++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const ev = events.filter((e) => e.date.startsWith(key));
    const row = { key, primas: 0, acciones: 0, dividendos: 0 };
    for (const e of ev) row[e.kind] += e.amount;
    row.total = row.primas + row.acciones + row.dividendos;
    row.capStart = capStart;
    row.capEnd = capStart + row.total;
    row.ret = capStart ? row.total / capStart : 0;
    row.cierres = ops.filter((o) => (o[C.fCierre] || '').startsWith(key) && isNum(o[C.resultado])).length;
    for (const k of ['primas', 'acciones', 'dividendos', 'total', 'capEnd']) row[k] = r2(row[k]);
    capStart = row.capEnd;
    months.push(row);
  }
  const withActivity = months.filter((m) => m.total !== 0 || m.cierres > 0);
  const bestMonth = withActivity.length ? withActivity.reduce((a, b) => (b.ret > a.ret ? b : a)) : null;
  const worstMonth = withActivity.length ? withActivity.reduce((a, b) => (b.ret < a.ret ? b : a)) : null;

  // --- Operaciones
  const open = ops.filter((o) => o[C.estado] === 'Abierta')
    .map((o) => ({ ...o, _dte: o[C.vto] ? daysBetween(today, o[C.vto]) : null }))
    .sort((a, b) => (a[C.vto] || '').localeCompare(b[C.vto] || ''));
  const closed = ops.filter((o) => o[C.estado] && o[C.estado] !== 'Abierta')
    .sort((a, b) => (b[C.fCierre] || '').localeCompare(a[C.fCierre] || '') || n(b[C.id]) - n(a[C.id]));
  const finished = closed.filter((o) => isNum(o[C.resultado]));
  const winners = finished.filter((o) => o[C.resultado] > 0).length;
  const capDias = sum(finished, (o) => o[C.capDias]);
  const arorc = capDias > 0 ? sum(finished.filter((o) => n(o[C.capDias]) > 0), (o) => o[C.resultado]) / capDias * 365 : null;

  // --- Capital comprometido y exposición
  const linkedCC = (o) => o[C.estrategia] === 'Call cubierta (CC)' && o[C.lote];
  const openLots = lots.filter((l) => l[C.estado] === 'En cartera');
  const committedOpts = sum(open.filter((o) => !linkedCC(o)), (o) => o[C.capital]);
  const stockCost = sum(openLots, (l) => l[C.coste]);
  const committed = committedOpts + stockCost;

  const expoMap = new Map();
  const add = (t, k, v) => {
    if (!expoMap.has(t)) expoMap.set(t, { activo: t, opciones: 0, acciones: 0 });
    expoMap.get(t)[k] += n(v);
  };
  open.filter((o) => !linkedCC(o)).forEach((o) => add(o[C.activo], 'opciones', o[C.capital]));
  openLots.forEach((l) => add(l[C.activo], 'acciones', l[C.coste]));
  const exposure = [...expoMap.values()]
    .map((e) => ({ ...e, total: e.opciones + e.acciones, pct: capital > 0 ? (e.opciones + e.acciones) / capital : 0 }))
    .filter((e) => e.total > 0)
    .sort((a, b) => b.total - a.total);

  const daysRunning = Math.max(daysBetween(start, today), 0);
  const ret = cap0 ? realized / cap0 : 0;
  const latent = sum(lots, (l) => l[C.latente]);

  return {
    cap0, start, today, capital, realized, byKind, ret,
    retAnnual: daysRunning >= 30 ? Math.pow(1 + ret, 365 / daysRunning) - 1 : null,
    daysRunning,
    premiumsCollected: sum(ops.filter((o) => o[C.tipo] === 'Crédito'), (o) => o[C.primaNeta]),
    openPremium: sum(open, (o) => o[C.primaNeta]),
    committed, committedOpts, stockCost, usePct: capital > 0 ? committed / capital : 0,
    dividends: { neto: byKind.dividendos, bruto: sum(divs, (d) => d[C.bruto]), retencion: sum(divs, (d) => d[C.retencion]), count: divs.length },
    latent, equity: capital + latent,
    winRate: finished.length ? winners / finished.length : null,
    finishedCount: finished.length, arorc, maxDD, bestMonth, worstMonth,
    curve, months, open, closed, lots, divs, exposure,
    warnings: ops.filter((o) => o[C.control] && o[C.control] !== 'OK').length
      + lots.filter((l) => l[C.control] && !String(l[C.control]).startsWith('OK')).length
      + divs.filter((d) => d[C.control] && d[C.control] !== 'OK').length,
  };
}
