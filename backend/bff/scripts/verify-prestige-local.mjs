/** Prueba reproducible contra servicios reales del sandbox; no imprime tokens ni contraseñas. */
import assert from 'node:assert/strict';
import { applyDecisions } from '../prisma/scripts/apply-prestige-decisions.mjs';
import { sandboxUrl } from '../prisma/scripts/provision-prestige-users.mjs';

const base = sandboxUrl(process.env.BFF_URL || 'http://127.0.0.1:3000');
const issuer = sandboxUrl(process.env.KEYCLOAK_ISSUER?.replace(/\/realms\/prestige\/?$/, '') || process.env.KEYCLOAK_URL || 'http://localhost:8081');
const user = process.env.PRESTIGE_TEST_USER || 'draygoza';
if (!process.env.PRESTIGE_USER_PASSWORD) throw new Error('Configurar PRESTIGE_USER_PASSWORD en entorno');
const login = await fetch(`${issuer}/realms/prestige/protocol/openid-connect/token`, {
  method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'prestige-web', username: user, password: process.env.PRESTIGE_USER_PASSWORD }),
  signal: AbortSignal.timeout(15000),
});
if (login.status !== 200) {
  const error = await login.json();
  throw new Error(`Login OIDC HTTP ${login.status}: ${error.error}: ${error.error_description}`);
}
const { access_token: token } = await login.json();
const request = (path, extra = {}) => fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}`, ...extra }, signal: AbortSignal.timeout(20000) });
assert.equal((await fetch(`${base}/lookup-tables`)).status, 401, 'Sin token no se leen tablas');
assert.equal((await request('/lookup-tables', { 'X-Tenant-Id': 'tenant-inexistente-e2e' })).status, 403, 'No cambia a tenant ajeno');
const health = await (await request('/operations/health')).json();
assert.equal(health.postgres, true);
assert.equal(health.objectStorage, true);
for (const path of ['/lookup-tables', '/document-templates?all=true', '/chat/drafts/templates']) {
  assert.equal((await request(path)).status, 200, path);
}
if (process.argv.includes('--apply-decisions')) {
  const result = await applyDecisions({ ...process.env, BFF_URL: base, BFF_TOKEN: token }, ['--sandbox', '--apply']);
  console.log(JSON.stringify({ decisions: result.applied }));
}
console.log(JSON.stringify({ verified: ['OIDC', '401 sin token', '403 tenant ajeno', 'Postgres', 'MinIO', 'tablas', 'formatos', 'borradores'], user }));
