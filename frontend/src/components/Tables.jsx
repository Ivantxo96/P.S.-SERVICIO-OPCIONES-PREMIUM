import { useState } from 'react';
import { C } from '../lib/calc.js';
import { fmtDate, fmtEur, fmtFx, fmtNum, fmtPct, fmtUsd, fmtSignedUsd, isNum, tone } from '../lib/format.js';

const strikes = (o) => [o[C.sv], o[C.sc]].filter((v) => v !== null && v !== undefined).map(fmtNum).join(' / ') || '—';
const PILL = { 'En cartera': 'cartera', 'Llamada por call': 'llamada' };
const pillCls = (s) => PILL[s] || String(s || '').toLowerCase();
const Pill = ({ v }) => <span className={`pill ${pillCls(v)}`}>{v}</span>;

function Table({ cols, rows, empty, actions }) {
  if (!rows.length) return <div className="empty">{empty}</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {cols.map((c) => <th key={c.h} className={c.num ? 'num' : ''} title={c.title}>{c.h}</th>)}
            {actions && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r._row}>
              {cols.map((c) => <td key={c.h} className={`${c.num ? 'num' : ''} ${c.strong ? 'strong' : ''} ${c.tone ? tone(c.tone(r)) : ''}`}>{c.v(r)}</td>)}
              {actions && <td><div className="row-actions">{actions(r)}</div></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OpenTable({ rows, isAdmin, onEdit, onClose }) {
  const cols = [
    { h: 'Activo', v: (o) => o[C.activo], strong: true },
    { h: 'Estrategia', v: (o) => o[C.estrategia] },
    { h: 'Strikes', v: strikes, num: true },
    { h: 'Vencimiento', v: (o) => fmtDate(o[C.vto]) },
    { h: 'DTE', v: (o) => (o._dte ?? '—'), num: true },
    { h: 'Contr.', v: (o) => o[C.contratos], num: true },
    { h: 'Prima neta', v: (o) => fmtUsd(o[C.primaNeta]), num: true },
    { h: 'Capital en riesgo', v: (o) => (o[C.lote] && o[C.estrategia] === 'Call cubierta (CC)' ? `lote ${o[C.lote]}` : fmtUsd(o[C.capital])), num: true },
    { h: 'ROC máx.', v: (o) => fmtPct(o[C.rocMax]), num: true, title: 'Rentabilidad si vence sin valor' },
    { h: 'ARORC esp.', v: (o) => fmtPct(o[C.arorcEsp]), num: true, title: 'ROC máximo anualizado con el DTE de apertura' },
    { h: 'Colchón OTM', v: (o) => fmtPct(o[C.colchon]), num: true, title: 'Distancia del strike al precio de apertura' },
    { h: 'Break-even', v: (o) => fmtNum(o[C.be]), num: true },
  ];
  return <Table cols={cols} rows={rows} empty="No hay operaciones abiertas."
    actions={isAdmin ? (o) => (<>
      <button className="btn sm primary" onClick={() => onClose(o)}>Cerrar</button>
      <button className="btn sm" onClick={() => onEdit(o)}>Editar</button>
    </>) : null} />;
}

export function ClosedTable({ rows, isAdmin, onEdit }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 15);
  const cols = [
    { h: 'Cierre', v: (o) => fmtDate(o[C.fCierre]) },
    { h: 'Activo', v: (o) => o[C.activo], strong: true },
    { h: 'Estrategia', v: (o) => o[C.estrategia] },
    { h: 'Strikes', v: strikes, num: true },
    { h: 'Estado', v: (o) => <Pill v={o[C.estado]} /> },
    { h: 'Días', v: (o) => o[C.diasOp] ?? '—', num: true },
    { h: 'Prima neta', v: (o) => fmtUsd(o[C.primaNeta]), num: true },
    { h: 'Resultado', v: (o) => fmtSignedUsd(o[C.resultado]), num: true, tone: (o) => o[C.resultado] },
    { h: 'Rent.', v: (o) => fmtPct(o[C.rent], true), num: true, tone: (o) => o[C.rent], title: 'Resultado / capital en riesgo' },
    { h: 'ARORC', v: (o) => fmtPct(o[C.arorc], true), num: true, tone: (o) => o[C.arorc] },
    { h: '% prima', v: (o) => fmtPct(o[C.capturada]), num: true, title: 'Prima capturada' },
  ];
  return (
    <>
      <Table cols={cols} rows={shown} empty="Aún no hay operaciones cerradas."
        actions={isAdmin ? (o) => <button className="btn sm" onClick={() => onEdit(o)}>Editar</button> : null} />
      {rows.length > 15 && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button className="btn sm" onClick={() => setAll(!all)}>{all ? 'Ver menos' : `Ver las ${rows.length} operaciones`}</button>
        </div>
      )}
    </>
  );
}

export function LotsTable({ rows, isAdmin, onEdit }) {
  const cols = [
    { h: 'Lote', v: (l) => l[C.idLote], strong: true },
    { h: 'Activo', v: (l) => l[C.activo], strong: true },
    { h: 'Entrada', v: (l) => fmtDate(l[C.fEntrada]) },
    { h: 'Acciones', v: (l) => l[C.nAcc], num: true },
    { h: 'Precio entrada', v: (l) => fmtNum(l[C.pEntrada]), num: true },
    { h: 'Coste base ajust.', v: (l) => fmtNum(l[C.costeAjust]), num: true, title: '(Coste − primas − dividendos) / acciones' },
    { h: 'Estado', v: (l) => <Pill v={l[C.estado]} /> },
    { h: 'Salida', v: (l) => (l[C.fSalida] ? `${fmtDate(l[C.fSalida])} @ ${fmtNum(l[C.pSalida])}` : '—') },
    { h: 'Acciones (P&L)', v: (l) => (isNum(l[C.resAcc]) ? fmtSignedUsd(l[C.resAcc]) : isNum(l[C.latente]) ? `${fmtSignedUsd(l[C.latente])} lat.` : '—'), num: true, tone: (l) => l[C.resAcc] ?? l[C.latente] },
    { h: 'Primas', v: (l) => fmtSignedUsd(l[C.primasLote]), num: true, tone: (l) => l[C.primasLote] },
    { h: 'Dividendos', v: (l) => fmtSignedUsd(l[C.divLote]), num: true, tone: (l) => l[C.divLote] },
    { h: 'Total ciclo', v: (l) => fmtSignedUsd(l[C.totalCiclo]), num: true, tone: (l) => l[C.totalCiclo], title: 'Realizado: acciones vendidas + primas + dividendos' },
  ];
  return <Table cols={cols} rows={rows} empty="No hay lotes de acciones (aparecen cuando se asigna una put)."
    actions={isAdmin ? (l) => <button className="btn sm" onClick={() => onEdit(l)}>Editar</button> : null} />;
}

export function DividendsTable({ rows, isAdmin, onEdit }) {
  const sorted = [...rows].sort((a, b) => (b[C.fCobro] || '').localeCompare(a[C.fCobro] || ''));
  const cols = [
    { h: 'Cobro', v: (d) => fmtDate(d[C.fCobro]) },
    { h: 'Activo', v: (d) => d[C.activo], strong: true },
    { h: 'Lote', v: (d) => d[C.idLote] || '—' },
    { h: 'Acciones', v: (d) => d[C.nAcc], num: true },
    { h: 'Div./acción', v: (d) => (isNum(d[C.dpa]) ? d[C.dpa].toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '—'), num: true },
    { h: 'Bruto', v: (d) => fmtUsd(d[C.bruto]), num: true },
    { h: 'Retención', v: (d) => fmtUsd(d[C.retencion]), num: true },
    { h: 'Neto', v: (d) => fmtUsd(d[C.neto]), num: true, strong: true },
  ];
  return <Table cols={cols} rows={sorted} empty="Aún no se han cobrado dividendos."
    actions={isAdmin ? (d) => <button className="btn sm" onClick={() => onEdit(d)}>Editar</button> : null} />;
}

export function DivisaTable({ rows, isAdmin, onEdit }) {
  const sorted = [...rows].sort((a, b) => (b[C.fecha] || '').localeCompare(a[C.fecha] || ''));
  const cols = [
    { h: 'Fecha', v: (c) => fmtDate(c[C.fecha]) },
    { h: 'USD consolidados', v: (c) => fmtUsd(c[C.usdConv]), num: true },
    { h: 'EUR/USD', v: (c) => fmtFx(c[C.tc]), num: true, title: 'Dólares por 1 euro' },
    { h: 'Comisión', v: (c) => fmtEur(c[C.comision]), num: true },
    { h: 'EUR recibidos', v: (c) => fmtEur(c[C.eurRec]), num: true, strong: true },
    { h: 'Notas', v: (c) => c[C.notas] || '' },
  ];
  return <Table cols={cols} rows={sorted} empty="Aún no hay reseteos de divisa. Recomendado: uno a fin de cada mes."
    actions={isAdmin ? (c) => <button className="btn sm" onClick={() => onEdit(c)}>Editar</button> : null} />;
}
