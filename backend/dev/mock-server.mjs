// Servidor local que ejecuta el Code.gs real sobre la hoja de demo.
//   node backend/dev/mock-server.mjs            → http://localhost:8787
// Contraseñas de prueba: cliente "cliente-demo" · gestor "gestor-demo"
// Ojo: aquí las columnas calculadas NO se recalculan al editar (en Google Sheets sí).
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGas } from './gas-shim.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const gas = loadGas({
  codePath: path.join(dir, '..', 'Code.gs'),
  sheetsPath: process.env.SHEETS_JSON || path.join(dir, 'hoja-demo.json'),
  props: { CLIENT_PASSWORD: 'cliente-demo', ADMIN_PASSWORD: 'gestor-demo' },
});

const port = Number(process.env.PORT || 8787);
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.end();
  if (req.method !== 'POST') { res.setHeader('Content-Type', 'application/json'); return res.end('{"ok":true}'); }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let out;
    try { out = gas.call(JSON.parse(body || '{}')); } catch (e) { out = { ok: false, error: e.message }; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(out));
  });
}).listen(port, () => console.log(`API simulada en http://localhost:${port}`));
