import { C } from '../lib/calc.js';
import { fmtDayMonth, fmtUsd0, fmtNum } from '../lib/format.js';

const strikes = (o) => [o[C.sv], o[C.sc]].filter((v) => v !== null && v !== undefined).map(fmtNum).join(' / ');

export default function Expiries({ open, isAdmin, onClose }) {
  if (!open.length) return <div className="empty">No hay operaciones abiertas.</div>;
  const groups = [
    ['Vencidas sin actualizar', (d) => d < 0],
    ['Esta semana', (d) => d >= 0 && d <= 7],
    ['Próximas 2 semanas', (d) => d > 7 && d <= 21],
    ['Más adelante', (d) => d > 21],
  ];
  return (
    <div className="exp-list">
      {groups.map(([title, test]) => {
        const rows = open.filter((o) => o._dte !== null && test(o._dte));
        if (!rows.length) return null;
        return [
          <div className="exp-group" key={title}>{title}</div>,
          ...rows.map((o) => (
            <div key={o._row} className={`exp-row ${o._dte < 0 ? 'late' : o._dte <= 7 ? 'soon' : ''}`}>
              <div className="dte">{o._dte < 0 ? '!' : o._dte}<small>{o._dte < 0 ? 'vencida' : o._dte === 1 ? 'día' : 'días'}</small></div>
              <div style={{ minWidth: 0 }}>
                <div><b>{o[C.activo]}</b> <span className="ink2">{o[C.estrategia]}</span></div>
                <div className="small muted">
                  {strikes(o)} · vence {fmtDayMonth(o[C.vto])} · {o[C.contratos]} contr.
                  {o[C.lote] ? ` · lote ${o[C.lote]}` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="tab">{fmtUsd0(o[C.primaNeta])}</div>
                {isAdmin
                  ? <button className="btn sm" onClick={() => onClose(o)}>Cerrar</button>
                  : <div className="small muted">prima</div>}
              </div>
            </div>
          )),
        ];
      })}
    </div>
  );
}
