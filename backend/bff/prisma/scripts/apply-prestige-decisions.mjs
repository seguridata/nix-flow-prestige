import { pathToFileURL } from 'node:url';
import { sandboxUrl, USERS } from './provision-prestige-users.mjs';
const person = username => {
  const u = USERS.find(u => u.username === username);
  return { signerId: u.username, nombre: `${u.firstName} ${u.lastName}`, ...(u.email ? { correo: u.email } : {}) };
};
export function decisionRows() {
  return [
    ...[['ogarcia', 'jalarcon'], ['adiaz', 'jalarcon'], ['bcalatayud', 'jalarcon'], ['maramirez', 'ayarza'], ['ajimenez', 'ayarza'], ['javazquez', 'ayarza']].map(([solicitante, responsable]) => ({ etapa: 'tipoGasto', modalidadGasto: 'Reembolso', solicitante, ...person(responsable) })),
    { etapa: 'tipoGasto', tipoGasto: 'Marketing', ...person('ajimenez') },
    { etapa: 'tipoGasto', concepto: 'Licencias y software: CRM', ...person('ajimenez') },
    { etapa: 'tipoGasto', concepto: 'Aliados', ...person('ajimenez') },
  ];
}
const selectors = ['etapa', 'modalidadGasto', 'solicitante', 'tipoGasto', 'concepto', 'area', 'montoMin', 'montoMax'];
const canon = value => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
export const sameRule = (a, b) => selectors.every(k => String(a[k] ?? '') === String(b[k] ?? ''));
export async function applyDecisions(env, args = [], request = fetch) {
  if (args.some(a => !['--apply', '--sandbox'].includes(a)) || !args.includes('--sandbox')) throw new Error('Uso: --sandbox [--apply]');
  const base = sandboxUrl(env.BFF_URL || 'http://localhost:3000');
  if (!env.BFF_TOKEN) throw new Error('Requiere BFF_TOKEN de administrador en entorno');
  const api = async (path, method = 'GET', body) => {
    const r = await request(`${base}${path}`, { method, headers: { Authorization: `Bearer ${env.BFF_TOKEN}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!r.ok) throw new Error(`BFF ${method} ${path}: HTTP ${r.status}`);
    return r.json();
  };
  const tables = await api('/lookup-tables');
  const t = tables.find(t => t.key === 'responsables-gasto');
  if (!t?.active) throw new Error('Falta tabla activa responsables-gasto');
  const detail = await api(`/lookup-tables/${t.id}`);
  const rows = [];
  let cursor;
  do {
    const page = await api(`/lookup-tables/${t.id}/rows?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    rows.push(...page.items); cursor = page.nextCursor;
  } while (cursor);
  const desired = decisionRows();
  const columns = [...detail.columns];
  for (const [key, label] of [['solicitante', 'Usuario solicitante (autenticado)'], ['modalidadGasto', 'Modalidad del gasto']]) {
    if (!columns.some(c => c.key === key)) columns.push({ key, label, type: 'text' });
  }
  if (!args.includes('--apply')) return { dryRun: true, columnsAdded: columns.length - detail.columns.length, rules: desired };
  for (const values of desired) if (rows.filter(r => sameRule(r.values, values)).length > 1) throw new Error('Reglas duplicadas: revisar tabla antes de aplicar');
  if (columns.length !== detail.columns.length) await api(`/lookup-tables/${t.id}`, 'PUT', { columns });
  const ids = [];
  for (const values of desired) {
    const existing = rows.find(r => sameRule(r.values, values));
    let id = existing?.id;
    if (id) {
      if (canon(existing.values) !== canon(values) || !existing.active) await api(`/lookup-tables/${t.id}/rows/${id}`, 'PUT', { values, active: true });
    } else id = (await api(`/lookup-tables/${t.id}/rows`, 'POST', { values })).id;
    ids.push(id);
  }
  if (!ids.every((id, i) => rows[i]?.id === id)) for (const id of [...ids].reverse()) await api(`/lookup-tables/${t.id}/rows/${id}/move`, 'POST', { toTop: true });
  return { applied: ids.length, table: t.id };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) applyDecisions(process.env, process.argv.slice(2)).then(r => console.log(JSON.stringify(r))).catch(e => { console.error(e.message); process.exitCode = 1; });
