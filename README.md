# Servicio de opciones premium · Dashboard del cliente

Dashboard web para que el cliente siga su cartera de opciones (capital inicial 15.000 €) y para que el gestor
registre y cierre operaciones desde la propia web. Los datos viven en una **Google Sheet privada**; la web se
publica en **GitHub Pages** y lee la hoja a través de un **Apps Script con contraseña**.

```
.
├── backend/                         Google Sheets + Apps Script
│   ├── Cartera_Opciones_Cliente.xlsx   plantilla de la hoja (súbela a Google Drive)
│   ├── Code.gs                      API: login, lectura y edición de la hoja
│   ├── appsscript.json              manifiesto del Apps Script
│   └── dev/                         simulador local de Apps Script, pruebas y hoja de demo (datos ficticios)
├── frontend/                        Dashboard · React + Vite + Recharts
│   └── public/config.json           ← aquí va la URL de tu Apps Script
└── .github/workflows/deploy.yml     publica frontend/ en GitHub Pages
```

```
 Cliente / gestor ──▶ GitHub Pages (frontend) ──POST + contraseña──▶ Apps Script (backend) ──▶ Google Sheet privada
```

## Qué muestra

- **KPIs:** capital actual, resultado realizado (primas · acciones · dividendos), rentabilidad anualizada, primas netas
  cobradas, capital comprometido (% del capital, opciones y acciones) y dividendos cobrados (bruto, retención, neto).
- **Estadísticas:** win rate, ARORC medio ponderado, máximo drawdown, mejor y peor mes, plusvalía latente y patrimonio.
- **Evolución del capital** con el drawdown debajo.
- **Próximos vencimientos**: operaciones abiertas agrupadas por esta semana, próximas dos semanas y más adelante.
- **Resultado por mes**, apilado por primas, acciones y dividendos, con el % de cada mes.
- **Capital comprometido por activo** (concentración).
- **Tablas:** abiertas (prima, capital en riesgo, ROC máx., ARORC esperado, colchón OTM, break-even), cerradas con su P&L,
  lotes de acciones (coste base ajustado y resultado del ciclo) y dividendos.

Todos los cálculos por fila los hacen las fórmulas de la hoja; la web solo suma y dibuja, así que siempre cuadra con
la pestaña Resumen.

## Dos contraseñas, dos vistas

| | Cliente | Gestor |
|---|---|---|
| Ver el dashboard | ✔ | ✔ |
| `+ Operación`, `+ Lote`, `+ Dividendo`, editar y borrar | — | ✔ |
| Botón **Cerrar** (cerrada, rolada, vencida, asignada) | — | ✔ |
| Aviso de filas con errores en la columna Control | — | ✔ |

Al cerrar una put como **Asignada**, la web ofrece crear el lote de acciones (strike × contratos × 100) y enlazarlo.
Al asignar una **call cubierta** de un lote, ofrece marcar el lote como *Llamada por call* al strike.
Al añadir un dividendo, elegir el lote rellena el activo y el número de acciones.

## Puesta en marcha

### 1. La hoja de Google
1. Sube `backend/Cartera_Opciones_Cliente.xlsx` a Google Drive, ábrela y **Archivo → Guardar como Hojas de cálculo de Google**.
2. Borra las filas marcadas EJEMPLO (Operaciones, Acciones y Dividendos) y rellena en **Resumen** el cliente y el capital inicial.
3. No compartas la hoja con nadie: la web accede a través del script, no de la hoja.

### 2. El Apps Script (backend)
1. En la hoja: **Extensiones → Apps Script**. Borra lo que haya y pega el contenido de `backend/Code.gs`. Guarda.
2. **Configuración del proyecto** (rueda dentada) → **Propiedades del script** → añade:
   - `CLIENT_PASSWORD` → contraseña del cliente
   - `ADMIN_PASSWORD` → tu contraseña de gestor (distinta y larga)
3. En el editor, elige la función `probar` y pulsa **Ejecutar**. Google pedirá permisos la primera vez: acéptalos.
   En el registro debe salir el número de operaciones, lotes y dividendos.
4. **Implementar → Nueva implementación →** tipo **Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
5. Copia la **URL de la aplicación web** (termina en `/exec`).

> Si más adelante cambias `Code.gs`: **Implementar → Gestionar implementaciones → editar (lápiz) → Versión: nueva → Implementar**.
> Así la URL no cambia.

### 3. GitHub Pages (frontend)
1. Sube el repositorio a GitHub (rama `main`).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Edita `frontend/public/config.json` (en la web de GitHub vale) y pega la URL del paso anterior en `apiUrl`:
   ```json
   { "apiUrl": "https://script.google.com/macros/s/XXXXXXXX/exec", "titulo": "Cartera de opciones" }
   ```
4. Al guardar, la Action publica la web en `https://<usuario>.github.io/P.S.-SERVICIO-OPCIONES-PREMIUM/`.
   Pásale al cliente esa URL y su contraseña.

## Seguridad

- La hoja sigue **privada**. El script se ejecuta con tu cuenta y solo devuelve datos a quien da una contraseña válida.
- Las contraseñas están en las propiedades del script, no en el código ni en GitHub.
- Tras iniciar sesión se usa un token temporal (6 horas). 10 intentos fallidos bloquean el acceso 15 minutos.
- Solo se escribe en las columnas de entrada (cabecera azul); las fórmulas nunca se tocan.
- El repositorio no contiene datos del cliente: `backend/dev/hoja-demo.json` es una cartera ficticia para pruebas.
  Aun así puedes hacer el repo privado si prefieres (Pages desde repo privado requiere GitHub Pro).

## Probar en local

```bash
node backend/dev/test-api.mjs                 # pruebas del Code.gs (8 pruebas)
node backend/dev/mock-server.mjs              # API simulada en http://localhost:8787 con la hoja de demo
cd frontend && npm install
VITE_API_URL=http://localhost:8787 npm run dev   # http://localhost:5173
```
Contraseñas de la demo: cliente `cliente-demo` · gestor `gestor-demo`.
En la API simulada las columnas calculadas no se recalculan al editar (en Google Sheets sí).
