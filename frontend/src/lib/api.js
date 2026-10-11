// Cliente de la API (Google Apps Script). Todas las llamadas son POST con
// Content-Type text/plain para evitar el preflight CORS de Apps Script.
let apiUrl = null;
const store = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
};

export async function loadConfig() {
  const res = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-store' });
  const cfg = res.ok ? await res.json() : {};
  apiUrl = import.meta.env.VITE_API_URL || cfg.apiUrl;
  const configured = !!apiUrl && /^https?:\/\//.test(apiUrl);
  return { ...cfg, configured };
}

export const session = {
  get token() { return store.get('cartera_token'); },
  get role() { return store.get('cartera_role'); },
  set(token, role) { store.set('cartera_token', token); store.set('cartera_role', role); },
  clear() { store.set('cartera_token', null); store.set('cartera_role', null); },
};

export class SessionError extends Error {}

async function call(body) {
  let res;
  try {
    res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
    });
  } catch {
    throw new Error('No se puede conectar con la hoja. Revisa la URL del Apps Script o tu conexión.');
  }
  let data;
  try { data = await res.json(); } catch { throw new Error('Respuesta no válida del Apps Script (¿está desplegado como aplicación web con acceso "Cualquiera"?)'); }
  if (!data.ok) {
    const msg = data.error || 'Error desconocido';
    if (msg.startsWith('SESION')) { session.clear(); throw new SessionError(msg.replace(/^SESION:\s*/, '')); }
    throw new Error(msg);
  }
  return data;
}

export const api = {
  async login(password) {
    const r = await call({ action: 'login', password });
    session.set(r.token, r.role);
    return r;
  },
  data: () => call({ action: 'data', token: session.token }),
  save: (sheet, row, values) => call({ action: 'save', token: session.token, sheet, row, values }),
  remove: (sheet, row) => call({ action: 'delete', token: session.token, sheet, row }),
  logout() { const token = session.token; session.clear(); if (token) call({ action: 'logout', token }).catch(() => {}); },
};
