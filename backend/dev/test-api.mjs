// Pruebas del Code.gs sobre la hoja de demo:  node backend/dev/test-api.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGas } from './gas-shim.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const fresh = () => loadGas({
  codePath: path.join(dir, '..', 'Code.gs'),
  sheetsPath: path.join(dir, 'hoja-demo.json'),
  props: { CLIENT_PASSWORD: 'cliente-demo', ADMIN_PASSWORD: 'gestor-demo' },
});
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('✔', name); };

test('login correcto e incorrecto', () => {
  const g = fresh();
  assert.equal(g.call({ action: 'login', password: 'nope' }).ok, false);
  const c = g.call({ action: 'login', password: 'cliente-demo' });
  assert.equal(c.role, 'client');
  assert.equal(g.call({ action: 'login', password: 'gestor-demo' }).role, 'admin');
});

test('bloqueo tras 10 intentos fallidos', () => {
  const g = fresh();
  for (let i = 0; i < 10; i++) g.call({ action: 'login', password: 'x' + i });
  const r = g.call({ action: 'login', password: 'gestor-demo' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Demasiados intentos/);
});

test('sin contraseñas configuradas', () => {
  const g = loadGas({ codePath: path.join(dir, '..', 'Code.gs'), sheetsPath: path.join(dir, 'hoja-demo.json'), props: {} });
  assert.match(g.call({ action: 'login', password: 'a' }).error, /no ha configurado/);
});

test('lectura de datos', () => {
  const g = fresh();
  const { token } = g.call({ action: 'login', password: 'cliente-demo' });
  const d = g.call({ action: 'data', token });
  assert.equal(d.ok, true);
  assert.equal(d.operaciones.length, 26);
  assert.equal(d.acciones.length, 2);
  assert.equal(d.dividendos.length, 1);
  assert.equal(d.cuenta.capitalInicial, 15000);
  assert.equal(d.cuenta.cliente, 'Cliente demo');
  assert.ok(d.listas.estrategias.includes('Put vendida (CSP)'));
  assert.deepEqual(d.listas.estados, ['Abierta', 'Cerrada', 'Rolada', 'Vencida', 'Asignada']);
  const op1 = d.operaciones[0];
  assert.equal(op1._row, 2);
  assert.equal(op1['Fecha apertura'], '2026-05-04');
  assert.equal(op1['Resultado prima €'], 73.9);
  assert.equal(op1['Control'], 'OK');
  const sum = d.operaciones.reduce((s, o) => s + (typeof o['Resultado prima €'] === 'number' ? o['Resultado prima €'] : 0), 0);
  assert.equal(Math.round(sum * 100) / 100, 850.7);
});

test('token inválido y cliente sin permisos de edición', () => {
  const g = fresh();
  assert.match(g.call({ action: 'data', token: 'xxx' }).error, /^SESION/);
  const { token } = g.call({ action: 'login', password: 'cliente-demo' });
  assert.match(g.call({ action: 'save', token, sheet: 'operaciones', values: { Activo: 'X' } }).error, /Solo el gestor/);
});

test('alta de operación: primera fila libre, ID automático y multiplicador por defecto', () => {
  const g = fresh();
  const { token } = g.call({ action: 'login', password: 'gestor-demo' });
  const r = g.call({ action: 'save', token, sheet: 'operaciones', values: {
    'Fecha apertura': '2026-10-12', Activo: 'ko', Estrategia: 'Put vendida (CSP)', 'Strike venta': '62,5',
    Vencimiento: '2026-11-13', Contratos: 1, 'Prima apertura (por acción)': 0.7, Estado: 'Abierta',
    'Resultado prima €': 999999, // columna calculada: debe ignorarse
  } });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.row, 28);
  const grid = g.grids.Operaciones;
  const h = grid[0];
  const cell = (name) => grid[27][h.indexOf(name)];
  assert.equal(cell('ID'), 27);
  assert.equal(cell('Activo'), 'KO');
  assert.equal(cell('Strike venta'), 62.5);
  assert.equal(cell('Multiplicador'), 100);
  assert.equal(Object.prototype.toString.call(cell('Fecha apertura')), '[object Date]');
  assert.notEqual(cell('Resultado prima €'), 999999);
});

test('editar solo los campos enviados y validar tipos', () => {
  const g = fresh();
  const { token } = g.call({ action: 'login', password: 'gestor-demo' });
  const r = g.call({ action: 'save', token, sheet: 'operaciones', row: 22, values: { Estado: 'Cerrada', 'Fecha cierre': '2026-10-12', 'Prima cierre (por acción)': 0.1 } });
  assert.equal(r.ok, true, r.error);
  const grid = g.grids.Operaciones; const h = grid[0];
  assert.equal(grid[21][h.indexOf('Estado')], 'Cerrada');
  assert.equal(grid[21][h.indexOf('Activo')], 'SOFI');
  assert.match(g.call({ action: 'save', token, sheet: 'operaciones', row: 22, values: { Contratos: 'dos' } }).error, /número/);
  assert.match(g.call({ action: 'save', token, sheet: 'operaciones', row: 22, values: { Vencimiento: '12/10/2026' } }).error, /fecha/);
  assert.match(g.call({ action: 'save', token, sheet: 'operaciones', row: 500, values: { Estado: 'Cerrada' } }).error, /vacía/);
  assert.match(g.call({ action: 'save', token, sheet: 'hackeo', values: {} }).error, /Hoja no válida/);
});

test('alta de lote y dividendo, y borrado', () => {
  const g = fresh();
  const { token } = g.call({ action: 'login', password: 'gestor-demo' });
  assert.equal(g.call({ action: 'save', token, sheet: 'acciones', values: { 'ID lote': 'L3', Activo: 'INTC', 'Nº acciones': 200 } }).row, 4);
  assert.equal(g.call({ action: 'save', token, sheet: 'dividendos', values: { 'Fecha cobro': '2026-10-10', Activo: 'PFE', 'ID lote': 'L2' } }).row, 3);
  assert.equal(g.call({ action: 'delete', token, sheet: 'dividendos', row: 3 }).ok, true);
  const d = g.call({ action: 'data', token });
  assert.equal(d.dividendos.length, 1);
  assert.equal(d.acciones.length, 3);
  // borrar una operación mantiene el multiplicador por defecto
  g.call({ action: 'delete', token, sheet: 'operaciones', row: 27 });
  const h = g.grids.Operaciones[0];
  assert.equal(g.grids.Operaciones[26][h.indexOf('Activo')], '');
  assert.equal(g.grids.Operaciones[26][h.indexOf('Multiplicador')], 100);
});

console.log(`\n${passed} pruebas superadas`);
