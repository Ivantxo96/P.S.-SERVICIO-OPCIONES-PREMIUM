import { fmtDayMonth, fmtEur, fmtEur0, fmtFx, fmtMonth, fmtPct, fmtSigned, fmtSignedUsd, fmtUsd, fmtUsd0, tone } from '../lib/format.js';

export function Kpis({ a }) {
  const usePct = Math.min(a.usePct, 1);
  const optShare = a.committed > 0 ? a.committedOpts / a.committed : 0;
  return (
    <section className="kpis">
      <Kpi label="Capital total" value={fmtEur(a.capital)} sub={`Inicial ${fmtEur0(a.cap0)} · ${fmtPct(a.ret, true)}`} />
      <Kpi label="Resultado realizado" value={fmtSignedUsd(a.realized)} cls={tone(a.realized)}
        sub={`Primas ${fmtUsd0(a.byKind.primas)} · Acc. ${fmtUsd0(a.byKind.acciones)} · Div. ${fmtUsd0(a.byKind.dividendos)}`} />
      <Kpi label="Rentabilidad anualizada" value={a.retAnnual == null ? '—' : fmtPct(a.retAnnual, true)} cls={tone(a.retAnnual)}
        sub={a.retAnnual == null ? 'Disponible a partir de 30 días' : `En euros · ${a.daysRunning} días`} />
      <Kpi label="Primas netas cobradas" value={fmtUsd(a.premiumsCollected)} sub={`${fmtUsd0(a.openPremium)} en operaciones abiertas`} />
      <Kpi label="Capital comprometido" value={fmtUsd0(a.committed)} sub={`${fmtPct(a.usePct)} del capital`}>
        <div className="meter" role="img" aria-label={`Opciones ${fmtUsd0(a.committedOpts)}, acciones ${fmtUsd0(a.stockCost)}`}>
          <span style={{ width: `${usePct * optShare * 100}%`, background: 'var(--s1)' }} />
          <span style={{ width: `${usePct * (1 - optShare) * 100}%`, background: 'var(--s2)' }} />
        </div>
      </Kpi>
      <Kpi label="Dividendos cobrados" value={fmtUsd(a.dividends.neto)}
        sub={a.dividends.count ? `Bruto ${fmtUsd(a.dividends.bruto)} · Ret. ${fmtUsd(a.dividends.retencion)}` : 'Aún no hay cobros'} />
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

function StatRow({ title, items }) {
  return (
    <section className="card stats-wrap">
      {title && <div className="stats-title">{title}</div>}
      <div className="stats">
        {items.map(([l, v, s, cls]) => (
          <div className="stat" key={l}>
            <div className="small ink2">{l}</div>
            <div className={`v ${cls || ''}`}>{v}</div>
            <div className="small muted">{s}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Accounts({ a }) {
  const last = a.lastReset;
  return (
    <StatRow title="Cuentas EUR / USD" items={[
      ['Cuenta EUR', fmtEur(a.eurAccount), `${fmtEur0(a.cap0)} + ${a.convs.length} reseteo${a.convs.length === 1 ? '' : 's'}`],
      ['Cuenta USD por consolidar', fmtSignedUsd(a.usdPending), `≈ ${fmtEur(a.usdPendingEur)} al cambio actual`, tone(a.usdPending)],
      ['EUR/USD actual', fmtFx(a.fxNow), a.fxIni ? `Inicial ${fmtFx(a.fxIni)}` : 'Falta el cambio inicial'],
      ['Último reseteo', last ? fmtDayMonth(last.date) : '—', last ? `${fmtUsd(last.usd)} a ${fmtFx(last.rate)}` : 'Aún no hay reseteos'],
      ['Rentabilidad operativa', fmtPct(a.retOp, true), 'Gestión en $, sin divisa', tone(a.retOp)],
      ['Efecto divisa', fmtPct(a.fxEffect, true), 'Por el movimiento del EUR/USD', tone(a.fxEffect)],
    ]} />
  );
}

export function Stats({ a }) {
  return (
    <StatRow items={[
      ['Win rate', a.winRate == null ? '—' : fmtPct(a.winRate), `${a.finishedCount} finalizadas`],
      ['ARORC medio', a.arorc == null ? '—' : fmtPct(a.arorc), 'ponderado por capital y días'],
      ['Máx. drawdown', fmtPct(a.maxDD), 'sobre el capital en €', a.maxDD < 0 ? 'neg' : ''],
      ['Mejor mes', a.bestMonth ? fmtPct(a.bestMonth.ret, true) : '—', a.bestMonth ? `${fmtMonth(a.bestMonth.key)} · operativa` : '', tone(a.bestMonth?.ret)],
      ['Peor mes', a.worstMonth ? fmtPct(a.worstMonth.ret, true) : '—', a.worstMonth ? `${fmtMonth(a.worstMonth.key)} · operativa` : '', tone(a.worstMonth?.ret)],
      ['Plusvalía latente', fmtSignedUsd(a.latent), `Patrimonio ${fmtEur0(a.equity)}`, tone(a.latent)],
    ]} />
  );
}

export { fmtSigned };
