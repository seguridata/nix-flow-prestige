// Genera prestige-realm.prod.json a partir del realm de desarrollo: sin usuarios demo ni contraseñas,
// TLS obligatorio para clientes externos y sin grant de contraseña directo.
//   node deploy/keycloak/make-prod-realm.mjs https://prestige.example.com
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const origin = (process.argv[2] ?? 'https://prestige.example.com').replace(/\/+$/, '');
const realm = JSON.parse(readFileSync(join(here, '..', '..', 'backend', 'infra', 'keycloak', 'prestige-realm.json'), 'utf8'));

delete realm.users; // sin usuarios demo: los usuarios reales se crean/federan después del import
realm.sslRequired = 'external';
for (const c of realm.clients ?? []) {
  if (c.clientId === 'prestige-web') {
    c.redirectUris = [`${origin}/*`];
    c.webOrigins = [origin];
    c.directAccessGrantsEnabled = false;
  }
}
writeFileSync(join(here, 'prestige-realm.prod.json'), JSON.stringify(realm, null, 2) + '\n');
console.log(`prestige-realm.prod.json escrito (origen ${origin}, ${realm.roles?.realm?.length ?? 0} roles, 0 usuarios)`);
