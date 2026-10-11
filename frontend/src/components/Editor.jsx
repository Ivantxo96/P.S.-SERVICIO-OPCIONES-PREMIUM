import { useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { C, todayStr } from '../lib/calc.js';
import { fmtNum } from '../lib/format.js';

/* Campos editables por hoja. type: date | num | int | text | select. req = obligatorio */
function fieldsFor(sheet, listas, lots) {
  const lotIds = lots.map((l) => l[C.idLote]).filter(Boolean);
  if (sheet === 'operaciones') return [
    { h: C.fApertura, type: 'date', req: true }, { h: C.activo, type: 'text', req: true },
    { h: C.estrategia, type: 'select', opts: listas.estrategias, req: true },
    { h: C.sv, type: 'num' }, { h: C.sc, type: 'num' }, { h: C.vto, type: 'date', req: true },
    { h: C.contratos, type: 'int', req: true }, { h: C.mult, type: 'int' },
    { h: C.subyacente, type: 'num' }, { h: C.primaAp, type: 'num', req: true },
    { h: 'Comisiones apertura €', type: 'num' },
    { h: C.estado, type: 'select', opts: listas.estados, req: true },
    { h: C.fCierre, type: 'date' }, { h: C.primaCie, type: 'num' }, { h: 'Comisiones cierre €', type: 'num' },
    { h: 'Capital en riesgo manual €', type: 'num', hint: 'Solo strangle, straddle u “Otra”' },
    { h: C.lote, type: 'select', opts: ['', ...lotIds] },
    { h: C.id, type: 'int', hint: 'Vacío = automático' },
    { h: C.notas, type: 'text', wide: true },
  ];
  if (sheet === 'acciones') return [
    { h: C.idLote, type: 'text', req: true }, { h: C.activo, type: 'text', req: true },
    { h: C.origen, type: 'select', opts: listas.origenes },
    { h: 'ID operación origen', type: 'int' }, { h: C.fEntrada, type: 'date', req: true },
    { h: C.nAcc, type: 'int', req: true }, { h: C.pEntrada, type: 'num', req: true, hint: 'Si viene de asignación: strike de la put' },
    { h: 'Comisiones entrada €', type: 'num' },
    { h: C.estado, type: 'select', opts: listas.estadosLote, req: true },
    { h: C.fSalida, type: 'date' }, { h: C.pSalida, type: 'num' }, { h: 'Comisiones salida €', type: 'num' },
    { h: C.pActual, type: 'num', hint: 'Para la plusvalía latente' },
    { h: C.notas, type: 'text', wide: true },
  ];
  return [
    { h: C.fCobro, type: 'date', req: true }, { h: C.idLote, type: 'select', opts: ['', ...lotIds] },
    { h: C.activo, type: 'text', req: true }, { h: C.nAcc, type: 'int', req: true },
    { h: C.dpa, type: 'num', req: true }, { h: C.retencion, type: 'num', hint: 'Importe en €, no %' },
    { h: C.notas, type: 'text', wide: true },
  ];
}

const TITLES = { operaciones: 'operación', acciones: 'lote de acciones', dividendos: 'dividendo' };
const toInput = (v) => (v === null || v === undefined ? '' : String(v));
const nextLotId = (lots) => `L${lots.reduce((m, l) => Math.max(m, Number(String(l[C.idLote] || '').replace(/\D/g, '')) || 0), 0) + 1}`;

function validate(fields, values) {
  for (const f of fields) {
    const v = values[f.h];
    if (f.req && (v === '' || v === undefined)) return `Falta: ${f.h}`;
    if (v === '' || v === undefined) continue;
    if ((f.type === 'num' || f.type === 'int') && !Number.isFinite(Number(String(v).replace(',', '.')))) return `${f.h} debe ser un número`;
    if (f.type === 'int' && !Number.isInteger(Number(v))) return `${f.h} debe ser un número entero`;
  }
  return null;
}

function Field({ f, value, onChange }) {
  const common = { value, onChange: (e) => onChange(e.target.value) };
  let input;
  if (f.type === 'select') input = <select {...common}>{(f.opts || []).map((o) => <option key={o} value={o}>{o || '—'}</option>)}{value && !(f.opts || []).includes(value) && <option value={value}>{value}</option>}</select>;
  else if (f.type === 'date') input = <input type="date" {...common} />;
  else if (f.type === 'num' || f.type === 'int') input = <input inputMode="decimal" {...common} />;
  else input = <input type="text" {...common} />;
  return (
    <label className={`f ${f.wide ? 'wide' : ''}`}>
      <span>{f.h}{f.req && <span className="req"> *</span>}</span>
      {input}
      {f.hint && <span className="muted" style={{ fontSize: 11 }}>{f.hint}</span>}
    </label>
  );
}

/* ---------------- Alta / edición genérica */
export function EditDialog({ sheet, row, data, onDone }) {
  const fields = useMemo(() => fieldsFor(sheet, data.listas, data.acciones), [sheet, data]);
  const [values, setValues] = useState(() => {
    const v = {};
    for (const f of fields) v[f.h] = toInput(row ? row[f.h] : '');
    if (!row) {
      if (sheet === 'operaciones') Object.assign(v, { [C.fApertura]: todayStr(), [C.mult]: '100', [C.estado]: 'Abierta', [C.estrategia]: data.listas.estrategias[0] || '' });
      if (sheet === 'acciones') Object.assign(v, { [C.idLote]: nextLotId(data.acciones), [C.estado]: 'En cartera', [C.origen]: data.listas.origenes[0] || '', [C.fEntrada]: todayStr() });
      if (sheet === 'dividendos') v[C.fCobro] = todayStr();
    }
    return v;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (h, val) => {
    const next = { ...values, [h]: val };
    // Dividendos: al elegir lote, rellena activo y nº de acciones
    if (sheet === 'dividendos' && h === C.idLote && val) {
      const lot = data.acciones.find((l) => l[C.idLote] === val);
      if (lot) { next[C.activo] = lot[C.activo]; next[C.nAcc] = toInput(lot[C.nAcc]); }
    }
    setValues(next);
  };

  const submit = async (e) => {
    e.preventDefault();
    const err = validate(fields, values);
    if (err) return setError(err);
    const payload = {};
    for (const f of fields) {
      const before = row ? toInput(row[f.h]) : '';
      if (!row || values[f.h] !== before) payload[f.h] = values[f.h];
    }
    if (row && !Object.keys(payload).length) return onDone(false);
    setBusy(true); setError('');
    try { await api.save(sheet, row?._row ?? null, payload); onDone(true, row ? 'Cambios guardados' : 'Registro añadido'); }
    catch (ex) { setError(ex.message); setBusy(false); }
  };

  const remove = async () => {
    if (!confirm('¿Borrar este registro de la hoja? Se vacían sus datos de entrada.')) return;
    setBusy(true);
    try { await api.remove(sheet, row._row); onDone(true, 'Registro borrado'); }
    catch (ex) { setError(ex.message); setBusy(false); }
  };

  return (
    <Modal onCancel={() => onDone(false)}>
      <form className="card modal" onSubmit={submit}>
        <h2>{row ? 'Editar' : 'Nuevo'} {TITLES[sheet]}{row?.[C.activo] ? ` · ${row[C.activo]}` : ''}</h2>
        <div className="form-grid">
          {fields.map((f) => <Field key={f.h} f={f} value={values[f.h]} onChange={(v) => set(f.h, v)} />)}
        </div>
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          {row && <button type="button" className="btn danger" onClick={remove} disabled={busy}>Borrar</button>}
          <span className="spacer" />
          <button type="button" className="btn" onClick={() => onDone(false)} disabled={busy}>Cancelar</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- Cierre rápido de una operación abierta */
export function CloseDialog({ op, data, onDone }) {
  const today = todayStr();
  const isCC = op[C.estrategia] === 'Call cubierta (CC)';
  const isShortPut = op[C.familia] === 'Put' && op[C.tipo] === 'Crédito';
  const lot = data.acciones.find((l) => l[C.idLote] === op[C.lote]);
  const [estado, setEstado] = useState('Cerrada');
  const [fecha, setFecha] = useState(today < op[C.vto] ? today : op[C.vto]);
  const [prima, setPrima] = useState('');
  const [comis, setComis] = useState(toInput(op['Comisiones apertura €']));
  const [makeLot, setMakeLot] = useState(true);
  const [lotId, setLotId] = useState(nextLotId(data.acciones));
  const [callAway, setCallAway] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const changeEstado = (e) => { setEstado(e); if (e === 'Vencida' || e === 'Asignada') setFecha(op[C.vto]); };
  const shares = Number(op[C.contratos]) * Number(op[C.mult] || 100);
  const strike = op[C.sv];
  const needsPrima = estado === 'Cerrada' || estado === 'Rolada';
  const willCreateLot = estado === 'Asignada' && isShortPut && !op[C.lote] && makeLot;
  const willCallAway = estado === 'Asignada' && isCC && lot && lot[C.estado] === 'En cartera' && callAway;

  const submit = async (e) => {
    e.preventDefault();
    if (!fecha) return setError('Indica la fecha');
    if (needsPrima && (prima === '' || !Number.isFinite(Number(prima.replace(',', '.'))))) return setError('Indica la prima de cierre por acción');
    setBusy(true); setError('');
    try {
      const values = { [C.estado]: estado, [C.fCierre]: fecha, [C.primaCie]: needsPrima ? prima : '', 'Comisiones cierre €': comis };
      if (willCreateLot) {
        if (data.acciones.some((l) => l[C.idLote] === lotId)) throw new Error(`Ya existe el lote ${lotId}`);
        await api.save('acciones', null, {
          [C.idLote]: lotId, [C.activo]: op[C.activo], [C.origen]: 'Asignación put', 'ID operación origen': op[C.id],
          [C.fEntrada]: fecha, [C.nAcc]: shares, [C.pEntrada]: strike, [C.estado]: 'En cartera',
        });
        values[C.lote] = lotId;
      }
      if (willCallAway) {
        await api.save('acciones', lot._row, { [C.estado]: 'Llamada por call', [C.fSalida]: fecha, [C.pSalida]: strike });
      }
      await api.save('operaciones', op._row, values);
      onDone(true, 'Operación cerrada');
    } catch (ex) { setError(ex.message); setBusy(false); }
  };

  return (
    <Modal onCancel={() => onDone(false)}>
      <form className="card modal" style={{ maxWidth: 520 }} onSubmit={submit}>
        <h2>Cerrar {op[C.activo]} · {op[C.estrategia]} {fmtNum(strike)}</h2>
        <div className="tabs" role="radiogroup">
          {['Cerrada', 'Rolada', 'Vencida', 'Asignada'].map((s) => (
            <button type="button" key={s} className={estado === s ? 'on' : ''} onClick={() => changeEstado(s)}>{s}</button>
          ))}
        </div>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
          <label className="f">Fecha {estado === 'Asignada' ? 'de asignación' : estado === 'Vencida' ? 'de vencimiento' : 'de cierre'}
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
          {needsPrima && <label className="f">Prima de cierre (por acción)
            <input inputMode="decimal" value={prima} onChange={(e) => setPrima(e.target.value)} autoFocus /></label>}
          <label className="f">Comisiones de cierre €
            <input inputMode="decimal" value={comis} onChange={(e) => setComis(e.target.value)} /></label>
        </div>
        {estado === 'Rolada' && <div className="warn-bar">Después registra la operación nueva con “+ Operación”.</div>}
        {estado === 'Asignada' && isShortPut && !op[C.lote] && (
          <label className="check">
            <input type="checkbox" checked={makeLot} onChange={(e) => setMakeLot(e.target.checked)} />
            <span>Crear el lote de acciones
              <input value={lotId} onChange={(e) => setLotId(e.target.value)} style={{ width: 70, margin: '0 6px', padding: '2px 6px' }} />
              con {shares} acciones de {op[C.activo]} a {fmtNum(strike)} y enlazarlo a esta operación.</span>
          </label>
        )}
        {estado === 'Asignada' && isCC && lot && lot[C.estado] === 'En cartera' && (
          <label className="check">
            <input type="checkbox" checked={callAway} onChange={(e) => setCallAway(e.target.checked)} />
            <span>Marcar el lote {lot[C.idLote]} como <b>llamado por call</b> a {fmtNum(strike)} en esta fecha.</span>
          </label>
        )}
        {estado === 'Asignada' && !isShortPut && !isCC && (
          <div className="warn-bar">Recuerda registrar las acciones resultantes en la pestaña Acciones si aplica.</div>
        )}
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => onDone(false)} disabled={busy}>Cancelar</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Confirmar'}</button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({ children, onCancel }) {
  return <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>{children}</div>;
}
