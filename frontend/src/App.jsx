import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, loadConfig, session, SessionError } from './lib/api.js';
import { analyze } from './lib/calc.js';
import { Kpis, Stats } from './components/Kpis.jsx';
import { EquityChart, MonthlyChart, ExposureChart } from './components/Charts.jsx';
import Expiries from './components/Expiries.jsx';
import { OpenTable, ClosedTable, LotsTable, DividendsTable } from './components/Tables.jsx';
import { EditDialog, CloseDialog } from './components/Editor.jsx';

export default function App() {
  const [cfg, setCfg] = useState(null);
  const [data, setData] = useState(null);
  const [role, setRole] = useState(session.role);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await api.data()); }
    catch (e) {
      if (e instanceof SessionError) { setRole(null); setData(null); setError(e.message); }
      else setError(e.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    loadConfig().then((c) => {
      setCfg(c);
      if (c.titulo) document.title = c.titulo;
      if (c.configured && session.token) load();
    }).catch(() => setCfg({ configured: false }));
  }, [load]);

  if (!cfg) return <div className="center muted">Cargando…</div>;
  if (!cfg.configured) return <SetupHint />;
  if (!role || !session.token) {
    return <Login title={cfg.titulo} error={error} onLogin={async (pw) => { const r = await api.login(pw); setRole(r.role); await load(); }} />;
  }
  if (!data) return <div className="center">{error ? <div className="card login"><div className="error">{error}</div><button className="btn" onClick={load}>Reintentar</button></div> : <span className="muted">Cargando datos de la hoja…</span>}</div>;

  return <Dashboard data={data} role={role} title={cfg.titulo} loading={loading} error={error} reload={load}
    logout={() => { api.logout(); setRole(null); setData(null); }} />;
}

function Dashboard({ data, role, title, loading, error, reload, logout }) {
  const a = useMemo(() => analyze(data), [data]);
  const isAdmin = role === 'admin';
  const [tab, setTab] = useState('abiertas');
  const [edit, setEdit] = useState(null);     // { sheet, row }
  const [closing, setClosing] = useState(null);
  const [flash, setFlash] = useState('');

  const done = (changed, msg) => {
    setEdit(null); setClosing(null);
    if (changed) { setFlash(msg || 'Guardado'); reload(); setTimeout(() => setFlash(''), 3500); }
  };
  const updated = new Date(data.generatedAt).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
  const tabs = [
    ['abiertas', 'Abiertas', a.open.length], ['cerradas', 'Cerradas', a.closed.length],
    ['acciones', 'Acciones', a.lots.length], ['dividendos', 'Dividendos', a.divs.length],
  ];

  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <div className="brand">
            <b>{title || 'Cartera de opciones'}{data.cuenta?.cliente ? ` · ${data.cuenta.cliente}` : ''}</b>
            <span className="small muted">Datos de la hoja a las {updated}{loading ? ' · actualizando…' : ''}</span>
          </div>
          <div className="spacer" />
          <div className="toolbar">
            {isAdmin && <span className="badge-admin">Modo gestor</span>}
            {isAdmin && <>
              <button className="btn primary" onClick={() => setEdit({ sheet: 'operaciones', row: null })}>+ Operación</button>
              <button className="btn" onClick={() => setEdit({ sheet: 'acciones', row: null })}>+ Lote</button>
              <button className="btn" onClick={() => setEdit({ sheet: 'dividendos', row: null })}>+ Dividendo</button>
            </>}
            <button className="btn" onClick={reload} disabled={loading} title="Volver a leer la hoja">↻</button>
            <button className="btn" onClick={logout}>Salir</button>
          </div>
        </div>
      </header>

      <main className="wrap">
        {error && <div className="error">{error}</div>}
        {flash && <div className="ok-msg">{flash}</div>}
        {isAdmin && a.warnings > 0 && (
          <div className="warn-bar">⚠ Hay {a.warnings} fila(s) con avisos en la columna Control de la hoja (faltan datos o hay incoherencias). Solo tú ves este aviso.</div>
        )}

        <Kpis a={a} />
        <Stats a={a} />

        <div className="grid-2">
          <section className="card">
            <div className="card-head">
              <div><h2>Evolución del capital</h2><p className="small muted">Capital inicial + resultado realizado (primas, acciones y dividendos)</p></div>
            </div>
            <EquityChart a={a} />
          </section>
          <section className="card">
            <div className="card-head">
              <div><h2>Próximos vencimientos</h2><p className="small muted">{a.open.length} operaciones abiertas · {fmtCount(a.open.filter((o) => o._dte !== null && o._dte <= 7).length)} vencen esta semana</p></div>
            </div>
            <Expiries open={a.open} isAdmin={isAdmin} onClose={setClosing} />
          </section>
        </div>

        <div className="grid-2">
          <section className="card">
            <div className="card-head">
              <div><h2>Resultado por mes</h2><p className="small muted">Por fecha de cierre, venta de acciones o cobro del dividendo · % sobre el capital al inicio del mes</p></div>
            </div>
            <MonthlyChart a={a} />
          </section>
          <section className="card">
            <div className="card-head">
              <div><h2>Capital comprometido por activo</h2><p className="small muted">% sobre el capital actual · las calls cubiertas usan el capital del lote</p></div>
            </div>
            <ExposureChart a={a} />
          </section>
        </div>

        <section className="card">
          <div className="card-head">
            <div className="tabs">
              {tabs.map(([k, l, n]) => (
                <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}<span className="count">{n}</span></button>
              ))}
            </div>
          </div>
          {tab === 'abiertas' && <OpenTable rows={a.open} isAdmin={isAdmin} onEdit={(r) => setEdit({ sheet: 'operaciones', row: r })} onClose={setClosing} />}
          {tab === 'cerradas' && <ClosedTable rows={a.closed} isAdmin={isAdmin} onEdit={(r) => setEdit({ sheet: 'operaciones', row: r })} />}
          {tab === 'acciones' && <LotsTable rows={a.lots} isAdmin={isAdmin} onEdit={(r) => setEdit({ sheet: 'acciones', row: r })} />}
          {tab === 'dividendos' && <DividendsTable rows={a.divs} isAdmin={isAdmin} onEdit={(r) => setEdit({ sheet: 'dividendos', row: r })} />}
          <p className="note">
            Vencida: expira sin valor y se queda toda la prima. Asignada: se ejecuta; la prima cuenta en opciones y las acciones van a la pestaña Acciones.
            Las operaciones abiertas y las acciones en cartera no suman al capital hasta que se cierran.
          </p>
        </section>
      </main>

      {edit && <EditDialog sheet={edit.sheet} row={edit.row} data={data} onDone={done} />}
      {closing && <CloseDialog op={closing} data={data} onDone={done} />}
    </>
  );
}

const fmtCount = (n) => (n === 0 ? 'ninguna' : n);

function Login({ title, onLogin, error: initialError }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState(initialError || '');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await onLogin(pw); } catch (ex) { setError(ex.message); setBusy(false); }
  };
  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <div><h1 style={{ fontSize: 20 }}>{title || 'Cartera de opciones'}</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>Introduce tu contraseña para ver la evolución de la cartera.</p></div>
        <input type="text" name="username" autoComplete="username" value="cartera" readOnly hidden />
        <label className="f">Contraseña
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" autoFocus required /></label>
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  );
}

function SetupHint() {
  return (
    <div className="center">
      <div className="card login">
        <h1 style={{ fontSize: 20 }}>Falta conectar la hoja</h1>
        <p className="ink2" style={{ margin: 0 }}>
          Edita <code>frontend/public/config.json</code> en GitHub y pega en <code>apiUrl</code> la URL de la
          aplicación web de tu Apps Script (termina en <code>/exec</code>). Los pasos están en el README.
        </p>
      </div>
    </div>
  );
}
