/** HTTP real: sincroniza ejemplo con --apply, conserva tablas y prueba ruteo autenticado. Ejecutar con bun. */
import assert from 'node:assert/strict';
import { runSeed, FORM_NAME, canon, type TablesPort, type TemplatesPort } from '../prisma/scripts/seed-example-gastos.lib';
// @ts-expect-error Operational ESM helper.
import { sandboxUrl } from '../prisma/scripts/provision-prestige-users.mjs';

async function main() {
const base = sandboxUrl(process.env.BFF_URL || 'http://127.0.0.1:3000');
const issuer = sandboxUrl(process.env.KEYCLOAK_URL || 'http://localhost:8081');
const password = process.env.PRESTIGE_USER_PASSWORD;
if (!password) throw new Error('Falta PRESTIGE_USER_PASSWORD en entorno');
const apply = process.argv.includes('--apply');
async function login(username: string): Promise<string> {
  const r = await fetch(`${issuer}/realms/prestige/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'prestige-web', username, password: password! }), signal: AbortSignal.timeout(20000) });
  assert.equal(r.status, 200, `OIDC ${username} HTTP ${r.status}`);
  return (await r.json()).access_token;
}
const token = await login('draygoza');
let mutations = 0;
async function api(path: string, method = 'GET', body?: unknown, access = token): Promise<any> {
  const r = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`${method} ${path}: HTTP ${r.status}`);
  if (method !== 'GET' && !path.endsWith('/preview-flow')) mutations++;
  return r.status === 204 ? null : r.json();
}
async function tableSnapshot() {
  const tables = (await api('/lookup-tables')).filter((t: any) => ['responsables-gasto', 'roles-adquisiciones'].includes(t.key));
  const result = [];
  for (const t of tables) {
    const detail = await api(`/lookup-tables/${t.id}`);
    const rows = []; let cursor: string | null = null;
    do {
      const page = await api(`/lookup-tables/${t.id}/rows?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      rows.push(...page.items); cursor = page.nextCursor;
    } while (cursor);
    result.push({ ...detail, rows });
  }
  return result;
}
const before = await tableSnapshot();
assert.equal(before.length, 2, 'Tablas existentes requeridas; no sembrar una matriz vacía');
const deps: { tables: TablesPort; templates: TemplatesPort } = {
  tables: { list: () => api('/lookup-tables'), create: body => api('/lookup-tables', 'POST', body), createRow: (id, body) => api(`/lookup-tables/${id}/rows`, 'POST', body) },
  templates: { list: () => api('/document-templates?all=true'), get: id => api(`/document-templates/${id}`), update: (id, patch) => api(`/document-templates/${id}`, 'PUT', patch), createForm: body => api('/document-templates/form', 'POST', body), setPublished: (id, published) => api(`/document-templates/${id}/${published ? 'publish' : 'unpublish'}`, 'POST') },
};
const report = await runSeed(deps, { tenant: 'seguridata', dryRun: !apply, force: true });
assert.equal(report.exitCode, 0, report.lines.map(l => l.text).join('; '));
assert.equal(canon(await tableSnapshot()), canon(before), 'El seed no debe cambiar matriz ni roles');
if (!apply) {
  console.log(JSON.stringify({ dryRun: true, report: report.lines }));
} else {
  const written = mutations;
  const again = await runSeed(deps, { tenant: 'seguridata', dryRun: false, force: true });
  assert.equal(again.exitCode, 0);
  assert.equal(mutations, written, 'La segunda corrida debe hacer cero mutaciones');
  const forms = await api('/document-templates?all=true');
  const matches = forms.filter((f: any) => f.name === FORM_NAME);
  assert.equal(matches.length, 1, 'Un solo formato de gastos');
  const form = await api(`/document-templates/${matches[0].id}`);
  assert.equal(form.published, true);
  assert.ok(form.flow.variables.some((v: any) => v.key === 'modalidadGasto'));
  const values = { area: 'QA', tipoGasto: 'Marketing', concepto: 'Marketing: Publicidad', monto: 10, modalidadGasto: 'Reembolso' };
  const checks: Array<{ user: string; scenario: string; expected: string }> = [];
  async function check(user: string, access: string, input: unknown, expected: string, scenario: string) {
    const preview = await api(`/document-templates/${form.id}/preview-flow`, 'POST', { values: input }, access);
    assert.equal(preview.steps.find((s: any) => s.stepId === 'AUT_TIPO')?.resolved?.signerId, expected, `${user}: ${scenario}`);
    checks.push({ user, scenario, expected });
  }
  for (const [user, expected] of [['ogarcia','jalarcon'], ['adiaz','jalarcon'], ['bcalatayud','jalarcon'], ['maramirez','ayarza'], ['ajimenez','ayarza'], ['javazquez','ayarza']]) {
    const access = await login(user!);
    await check(user!, access, values, expected!, 'reembolso');
    await check(user!, access, { ...values, solicitante: expected === 'ayarza' ? 'ogarcia' : 'ajimenez' }, expected!, 'suplantación rechazada');
    await check(user!, access, { ...values, modalidadGasto: 'Compra' }, 'ajimenez', 'compra Marketing');
  }
  for (const concepto of ['Licencias y software: CRM', 'Aliados']) await check('draygoza', token, { ...values, tipoGasto: 'Bienes y servicios', concepto, modalidadGasto: 'Compra' }, 'ajimenez', concepto);
  assert.equal(canon(await tableSnapshot()), canon(before));
  console.log(JSON.stringify({ template: form.id, firstRunMutations: written, secondRunMutations: 0, tablesUnchanged: true, checks }));
}

}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
