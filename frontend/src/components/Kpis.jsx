import { fmtEur, fmtEur0, fmtPct, fmtSigned, fmtMonth, tone } from '../lib/format.js';

export function Kpis({ a }) {
  const usePct = Math.min(a.usePct, 1);
  const optShare = a.committed > 0 ? a.committedOpts / a.committed : 0;
  return (
    <section className="kpis">
      <Kpi label="Capital actual" value={fmtEur(a.capital)} sub={`Inicial ${fmtEur0(a.cap0)} · ${fmtPct(a.ret, true)}`} />
      <Kpi label="Resultado realizado" value={fmtSigned(a.realized)} cls={tone(a.realized)}
        sub={`Primas ${fmtEur0(a.byKind.primas)} · Acc. ${fmtEur0(a.byKind.acciones)} · Div. ${fmtEur0(a.byKind.dividendos)}`} />
      <Kpi label="Rentabilidad anualizada" value={a.retAnnual == null ? '—' : fmtPct(a.retAnnual, true)} cls={tone(a.retAnnual)}
        sub={a.retAnnual == null ? 'Disponible a partir de 30 días' : `${a.daysRunning} días desde el inicio`} />
      <Kpi label="Primas netas cobradas" value={fmtEur(a.premiumsCollected)} sub={`${fmtEur0(a.openPremium)} en operaciones abiertas`} />
      <Kpi label="Capital comprometido" value={fmtEur0(a.committed)} sub={`${fmtPct(a.usePct)} del capital`}>
        <div className="meter" role="img" aria-label={`Opciones ${fmtEur0(a.committedOpts)}, acciones ${fmtEur0(a.stockCost)}`}>
          <span style={{ width: `${usePct * optShare * 100}%`, background: 'var(--s1)' }} />
          <span style={{ width: `${usePct * (1 - optShare) * 100}%`, background: 'var(--s2)' }} />
        </div>
      </Kpi>
      <Kpi label="Dividendos cobrados" value={fmtEur(a.dividends.neto)}
        sub={a.dividends.count ? `Bruto ${fmtEur(a.dividends.bruto)} · Ret. ${fmtEur(a.dividends.retencion)}` : 'Aún no hay cobros'} />
    </section>
  );
}

function Kpi({ label, value, sub, cls = '', children }) {
  return (
    <div className="card kpi">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${cls}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
      {children}
    </div>
  );
}

export function Stats({ a }) {
  const items = [
    ['Win rate', a.winRate == null ? '—' : fmtPct(a.winRate), `${a.finishedCount} finalizadas`],
    ['ARORC medio', a.arorc == null ? '—' : fmtPct(a.arorc), 'ponderado por capital y días'],
    ['Máx. drawdown', fmtPct(a.maxDD), 'sobre capital realizado', a.maxDD < 0 ? 'neg' : ''],
    ['Mejor mes', a.bestMonth ? fmtPct(a.bestMonth.ret, true) : '—', a.bestMonth ? fmtMonth(a.bestMonth.key) : '', tone(a.bestMonth?.ret)],
    ['Peor mes', a.worstMonth ? fmtPct(a.worstMonth.ret, true) : '—', a.worstMonth ? fmtMonth(a.worstMonth.key) : '', tone(a.worstMonth?.ret)],
    ['Plusvalía latente', fmtSigned(a.latent), `Patrimonio ${fmtEur0(a.equity)}`, tone(a.latent)],
  ];
  return (
    <section className="card stats">
      {items.map(([l, v, s, cls]) => (
        <div className="stat" key={l}>
          <div className="small ink2">{l}</div>
          <div className={`v ${cls || ''}`}>{v}</div>
          <div className="small muted">{s}</div>
        </div>
      ))}
    </section>
  );
}
