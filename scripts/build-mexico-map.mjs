/**
 * scripts/build-mexico-map.mjs — Genera src/lib/geo/mexico-states.ts
 *
 * Proyecta (Mercator) el GeoJSON de estados de México a trazos SVG en un
 * viewBox de 760×520 y los indexa por clave INEGI de 2 letras (la misma que
 * guarda app.leads.state_code). Así el mapa del tablero de marketing se
 * renderiza sin d3 ni peticiones externas (CSP: default-src 'self').
 *
 * Uso:
 *   curl -sL -o /tmp/mexicoHigh.json https://raw.githubusercontent.com/angelnmara/geojson/master/mexicoHigh.json
 *   node scripts/build-mexico-map.mjs /tmp/mexicoHigh.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const src = process.argv[2];
if (!src) { console.error('uso: node scripts/build-mexico-map.mjs <mexicoHigh.json>'); process.exit(1); }

const W = 760, H = 520, PAD = 10;
const geo = JSON.parse(readFileSync(src, 'utf8'));

// ISO 3166-2:MX → clave INEGI usada por el formulario / app.leads.state_code
const ISO_TO_INEGI = {
  'MX-AGU': 'AG', 'MX-BCN': 'BC', 'MX-BCS': 'BS', 'MX-CAM': 'CM', 'MX-CHP': 'CS', 'MX-CHH': 'CH',
  'MX-COA': 'CO', 'MX-COL': 'CL', 'MX-CMX': 'DF', 'MX-DIF': 'DF', 'MX-DUR': 'DG', 'MX-GUA': 'GT',
  'MX-GRO': 'GR', 'MX-HID': 'HG', 'MX-JAL': 'JC', 'MX-MEX': 'MC', 'MX-MIC': 'MN', 'MX-MOR': 'MS',
  'MX-NAY': 'NT', 'MX-NLE': 'NL', 'MX-OAX': 'OA', 'MX-PUE': 'PU', 'MX-QUE': 'QT', 'MX-ROO': 'QR',
  'MX-SLP': 'SL', 'MX-SIN': 'SI', 'MX-SON': 'SO', 'MX-TAB': 'TB', 'MX-TAM': 'TM', 'MX-TLA': 'TL',
  'MX-VER': 'VZ', 'MX-YUC': 'YN', 'MX-ZAC': 'ZS',
};

const rad = (d) => (d * Math.PI) / 180;
const merc = ([lon, lat]) => [rad(lon), Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2))];

// bounding box en coordenadas proyectadas
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
const eachPoint = (coords, fn) => (Array.isArray(coords[0]) ? coords.forEach((c) => eachPoint(c, fn)) : fn(coords));
for (const f of geo.features) eachPoint(f.geometry.coordinates, (p) => {
  const [x, y] = merc(p);
  if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
});
const scale = Math.min((W - PAD * 2) / (maxX - minX), (H - PAD * 2) / (maxY - minY));
const ox = PAD + ((W - PAD * 2) - (maxX - minX) * scale) / 2;
const oy = PAD + ((H - PAD * 2) - (maxY - minY) * scale) / 2;
const project = (p) => {
  const [x, y] = merc(p);
  return [ox + (x - minX) * scale, oy + (maxY - y) * scale];
};

// Simplificación Ramer-Douglas-Peucker (tolerancia en px del viewBox): el
// detalle sub-píxel no aporta nada a un mapa coroplético de 760 px de ancho.
const TOL = 0.7;
const rdp = (pts) => {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let maxD = 0, idx = 0;
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d = Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= TOL) return [a, b];
  return rdp(pts.slice(0, idx + 1)).slice(0, -1).concat(rdp(pts.slice(idx)));
};

// Un anillo es cerrado (primer punto == último): se parte en dos mitades para
// que RDP tenga extremos distintos y no colapse el polígono entero.
const simplifyRing = (ring) => {
  const mid = Math.floor(ring.length / 2);
  return rdp(ring.slice(0, mid + 1)).slice(0, -1).concat(rdp(ring.slice(mid)));
};

const ringToPath = (ring) => {
  const pts = simplifyRing(ring.map(project)).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  let d = '', last = null;
  for (const [x, y] of pts) {
    if (last && last[0] === x && last[1] === y) continue; // colapsa puntos idénticos tras redondear
    d += (last ? 'L' : 'M') + x + ' ' + y;
    last = [x, y];
  }
  return d + 'Z';
};

const states = geo.features
  .map((f) => {
    const code = ISO_TO_INEGI[f.properties.id];
    if (!code) throw new Error(`Sin clave INEGI para ${f.properties.id}`);
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const d = polys.map((poly) => poly.map(ringToPath).join('')).join('');
    return { code, name: f.properties.name, d };
  })
  .sort((a, b) => a.code.localeCompare(b.code));

const out = `/**
 * src/lib/geo/mexico-states.ts — GENERADO por scripts/build-mexico-map.mjs. No editar a mano.
 *
 * Trazos SVG (Mercator, viewBox 0 0 ${W} ${H}) de los 32 estados, indexados por
 * clave INEGI (app.leads.state_code). Fuente: angelnmara/geojson mexicoHigh.json.
 */
export const MEXICO_MAP_VIEWBOX = '0 0 ${W} ${H}';

export interface MexicoStatePath { code: string; name: string; d: string }

export const MEXICO_STATES: MexicoStatePath[] = ${JSON.stringify(states, null, 2).replace(/"(code|name|d)":/g, '$1:')};
`;

const dest = resolve('src/lib/geo/mexico-states.ts');
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, out);
console.log(`ok → ${dest} (${states.length} estados, ${(out.length / 1024).toFixed(0)} KB)`);
