import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Cell, LabelList,
} from 'recharts';
import { fmtEur, fmtEur0, fmtPct, fmtMonth, fmtTs, fmtUsd0, fmtSignedUsd, fmtFx } from '../lib/format.js';

const axisTick = { fill: 'var(--muted)', fontSize: 11 };
const kTick = (v) => `${(v / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })}k`;
export const SERIES = [
  { key: 'primas', label: 'Primas', color: 'var(--s1)' },
  { key: 'acciones', label: 'Acciones', color: 'var(--s2)' },
  { key: 'dividendos', label: 'Dividendos', color: 'var(--s3)' },
];

export function Legend({ items }) {
  return (
    <div className="legend">
      {items.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
    </div>
  );
}

/* ---------------- Evolución del capital + drawdown (dos gráficos, mismo eje X) */
export function EquityChart({ a }) {
  const data = a.curve;
  if (data.length < 2) return <div className="empty">Aún no hay operaciones finalizadas.</div>;
  const vals = data.map((d) => d.capital);
  const min = Math.min(a.cap0, ...vals); const max = Math.max(a.cap0, ...vals);
  const pad = Math.max((max - min) * 0.12, a.cap0 * 0.004);
  const domainX = [data[0].t, data[data.length - 1].t];
  const xProps = { dataKey: 't', type: 'number', scale: 'time', domain: domainX, tickFormatter: fmtTs, tick: axisTick, axisLine: { stroke: 'var(--axis)' }, tickLine: false, minTickGap: 40 };
  const minDD = Math.min(...data.map((d) => d.dd), -0.001);
  return (
    <>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} syncId="eq">
          <defs>
            <linearGradient id="gEq" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: 'var(--s1)', stopOpacity: 0.22 }} />
              <stop offset="100%" style={{ stopColor: 'var(--s1)', stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis {...xProps} hide />
          <YAxis domain={[Math.floor(min - pad), Math.ceil(max + pad)]} tickFormatter={kTick} tick={axisTick} axisLine={false} tickLine={false} width={44} />
          <ReferenceLine y={a.cap0} stroke="var(--axis)" strokeDasharray="4 4" label={{ value: 'Capital inicial', position: 'insideBottomLeft', fill: 'var(--muted)', fontSize: 11 }} />
          <Tooltip content={<EqTip />} cursor={{ stroke: 'var(--axis)' }} />
          <Area type="stepAfter" dataKey="capital" stroke="var(--s1)" strokeWidth={2} fill="url(#gEq)" isAnimationActive={false}
            dot={false} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
      <div className="small muted" style={{ margin: '6px 0 2px 44px' }}>Drawdown (caída desde el máximo)</div>
      <ResponsiveContainer width="100%" height={90}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} syncId="eq">
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis {...xProps} />
          <YAxis domain={[minDD * 1.15, 0]} tickFormatter={(v) => `${(v * 100).toFixed(1)}%`} tick={axisTick} axisLine={false} tickLine={false} width={44} tickCount={3} />
          <Tooltip content={<EqTip />} cursor={{ stroke: 'var(--axis)' }} />
          <Area type="stepAfter" dataKey="dd" stroke="var(--bad)" strokeWidth={1.5} fill="var(--bad)" fillOpacity={0.12} isAnimationActive={false} dot={false} activeDot={{ r: 3 }} />
        </AreaChart>
      </ResponsiveContainer>
    </>
  );
}

function EqTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="tip">
      <div className="tip-title">{fmtTs(p.t)}</div>
      <div className="tip-row"><span>Capital total</span><b>{fmtEur(p.capital)}</b></div>
      <div className="tip-row"><span>Rentabilidad</span><span>{fmtPct(p.ret, true)}</span></div>
      <div className="tip-row"><span>Drawdown</span><span>{fmtPct(p.dd)}</span></div>
      {p.reset && <div className="tip-row muted"><span>Reseteo de divisa</span><span>✓</span></div>}
    </div>
  );
}

/* ---------------- Resultado mensual apilado por origen */
export function MonthlyChart({ a }) {
  const data = a.months;
  if (!data.length) return <div className="empty">Sin datos.</div>;
  const kinds = SERIES.filter((s) => data.some((m) => m[s.key] !== 0));
  const shown = kinds.length ? kinds : SERIES.slice(0, 1);
  return (
    <>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} stackOffset="sign" barCategoryGap="30%">
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="key" tick={<MonthTick data={data} />} axisLine={{ stroke: 'var(--axis)' }} tickLine={false} height={38} interval={0} />
          <YAxis tickFormatter={(v) => fmtUsd0(v)} tick={axisTick} axisLine={false} tickLine={false} width={62} />
          <ReferenceLine y={0} stroke="var(--axis)" />
          <Tooltip content={<MonthTip />} cursor={{ fill: 'var(--surface-2)' }} />
          {shown.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} stackId="m" fill={s.color} maxBarSize={28} isAnimationActive={false}
              stroke="var(--surface)" strokeWidth={1}
              radius={i === shown.length - 1 ? [4, 4, 0, 0] : 0} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <Legend items={shown} />
    </>
  );
}

function MonthTick({ x, y, payload, data }) {
  const m = data.find((d) => d.key === payload.value);
  const r = m && m.total !== 0 ? fmtPct(m.ret, true) : '';
  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={12} textAnchor="middle" fill="var(--muted)" fontSize={11}>{fmtMonth(payload.value)}</text>
      {r && <text dy={26} textAnchor="middle" fontSize={11} fontWeight={600} fill={m.ret < 0 ? 'var(--bad)' : 'var(--ink-2)'}>{r}</text>}
    </g>
  );
}

function MonthTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload;
  return (
    <div className="tip">
      <div className="tip-title">{fmtMonth(m.key)} · {m.cierres} cierres</div>
      {SERIES.map((s) => (
        <div className="tip-row" key={s.key}><span><i style={{ background: s.color }} />{s.label}</span><span>{fmtSignedUsd(m[s.key])}</span></div>
      ))}
      <div className="tip-row tip-total"><span>Total</span><span>{fmtSignedUsd(m.total)} ({fmtPct(m.ret, true)})</span></div>
      {m.resets.map((r) => (
        <div className="tip-row" key={r.date}><span className="muted">Reseteo</span><span>{fmtUsd0(r.usd)} a {fmtFx(r.rate)} → {fmtEur0(r.eur)}</span></div>
      ))}
    </div>
  );
}

/* ---------------- Exposición por activo */
export function ExposureChart({ a }) {
  const data = a.exposure;
  if (!data.length) return <div className="empty">No hay capital comprometido ahora mismo.</div>;
  const series = [
    { key: 'opciones', label: 'Opciones abiertas', color: 'var(--s1)' },
    { key: 'acciones', label: 'Acciones en cartera', color: 'var(--s2)' },
  ].filter((s) => data.some((d) => d[s.key] > 0));
  const h = Math.max(120, data.length * 34 + 30);
  return (
    <>
      <ResponsiveContainer width="100%" height={h}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid stroke="var(--grid)" horizontal={false} />
          <XAxis type="number" tickFormatter={kTick} tick={axisTick} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="activo" tick={{ fill: 'var(--ink)', fontSize: 12, fontWeight: 600 }} axisLine={{ stroke: 'var(--axis)' }} tickLine={false} width={52} />
          <Tooltip content={<ExpoTip />} cursor={{ fill: 'var(--surface-2)' }} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} stackId="e" fill={s.color} maxBarSize={20} isAnimationActive={false} stroke="var(--surface)" strokeWidth={1}
              radius={i === series.length - 1 ? [0, 4, 4, 0] : 0}>
              {i === series.length - 1 && <LabelList dataKey="pct" position="right" formatter={(v) => fmtPct(v)} style={{ fill: 'var(--ink-2)', fontSize: 11 }} />}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
      {series.length > 1 && <Legend items={series} />}
    </>
  );
}

function ExpoTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="tip">
      <div className="tip-title">{d.activo}</div>
      {d.opciones > 0 && <div className="tip-row"><span><i style={{ background: 'var(--s1)' }} />Opciones</span><span>{fmtUsd0(d.opciones)}</span></div>}
      {d.acciones > 0 && <div className="tip-row"><span><i style={{ background: 'var(--s2)' }} />Acciones</span><span>{fmtUsd0(d.acciones)}</span></div>}
      <div className="tip-row tip-total"><span>Total</span><span>{fmtUsd0(d.total)} · {fmtPct(d.pct)}</span></div>
    </div>
  );
}

export { Cell };
