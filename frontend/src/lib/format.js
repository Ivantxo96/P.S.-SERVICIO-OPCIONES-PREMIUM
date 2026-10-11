const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
const eur0 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, useGrouping: 'always' });
const n2 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
const n1 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const fmtEur = (v) => (isNum(v) ? eur.format(v) : '—');
export const fmtEur0 = (v) => (isNum(v) ? eur0.format(v) : '—');
export const fmtSigned = (v) => (isNum(v) ? (v > 0 ? '+' : '') + eur.format(v) : '—');
export const fmtNum = (v) => (isNum(v) ? n2.format(v) : '—');
export const fmtPct = (v, signed = false) => (isNum(v) ? (signed && v > 0 ? '+' : '') + n1.format(v * 100) + ' %' : '—');
export const tone = (v) => (isNum(v) ? (v > 0 ? 'pos' : v < 0 ? 'neg' : '') : '');

const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const fmtDate = (s) => {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y.slice(2)}`;
};
export const fmtDayMonth = (s) => {
  if (!s) return '—';
  const [, m, d] = s.split('-');
  return `${Number(d)} ${MES[Number(m) - 1]}`;
};
export const fmtMonth = (key) => {
  const [y, m] = key.split('-');
  return `${MES[Number(m) - 1]} ${y.slice(2)}`;
};
export const fmtTs = (ts) => {
  const d = new Date(ts);
  return `${d.getDate()} ${MES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
};
