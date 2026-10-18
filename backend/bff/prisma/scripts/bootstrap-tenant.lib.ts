/**
 * Lógica pura (sin BD ni process.*) de `bootstrap-tenant.ts`: parseo y
 * validación de argumentos. Se prueba en src/workflow/bootstrap-tenant.spec.ts.
 */

export const KNOWN_ROLES = ['signer', 'sender', 'rh', 'auditor', 'admin', 'platform_admin'] as const;
export const DEFAULT_ROLES = ['admin', 'sender', 'signer'] as const;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

export interface BootstrapOptions {
  tenant: string;
  userId: string;
  roles: string[];
  name: string | null;
  email: string | null;
  tenantName: string;
  dryRun: boolean;
}

export type ParseResult =
  | { ok: true; options: BootstrapOptions }
  | { ok: false; errors: string[]; help: boolean };

export const USAGE = `Uso:
  bun run bootstrap:tenant -- --tenant <slug> --user-id <usuario> [--roles a,b,c] [--name "Nombre"] [--email correo] [--tenant-name "Nombre del tenant"] [--dry-run]

Argumentos (también por entorno: BOOTSTRAP_TENANT, BOOTSTRAP_USER_ID, BOOTSTRAP_ROLES, BOOTSTRAP_NAME, BOOTSTRAP_EMAIL, BOOTSTRAP_TENANT_NAME):
  --tenant        slug del tenant (minúsculas, dígitos y guiones; es el valor del claim "tenant" del token)
  --user-id       preferred_username (o sub) del usuario en Keycloak
  --roles         roles separados por coma (por defecto: ${DEFAULT_ROLES.join(',')}). Conocidos: ${KNOWN_ROLES.join(', ')}
  --name          nombre visible de la membresía (opcional)
  --email         correo de la membresía (opcional)
  --tenant-name   nombre del tenant si se crea (por defecto, el slug)
  --dry-run       no escribe en la BD; sólo muestra lo que haría
  --help          muestra esta ayuda`;

const VALUE_FLAGS: Record<string, keyof BootstrapOptions | 'tenantName'> = {
  '--tenant': 'tenant',
  '--user-id': 'userId',
  '--roles': 'roles',
  '--name': 'name',
  '--email': 'email',
  '--tenant-name': 'tenantName',
};

export function parseRoles(raw: string): string[] {
  return [...new Set(raw.split(',').map((r) => r.trim()).filter(Boolean))];
}

/** Convierte argv (sin node/script) + env en opciones validadas. */
export function parseBootstrapArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
): ParseResult {
  const errors: string[] = [];
  const raw: Record<string, string | undefined> = {
    tenant: env.BOOTSTRAP_TENANT,
    userId: env.BOOTSTRAP_USER_ID,
    roles: env.BOOTSTRAP_ROLES,
    name: env.BOOTSTRAP_NAME,
    email: env.BOOTSTRAP_EMAIL,
    tenantName: env.BOOTSTRAP_TENANT_NAME,
  };
  let dryRun = false;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    let inline: string | undefined;
    const eq = arg.indexOf('=');
    if (arg.startsWith('--') && eq > 0) {
      inline = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }
    const key = VALUE_FLAGS[arg];
    if (!key) {
      errors.push(`Argumento desconocido: ${arg}`);
      continue;
    }
    const value = inline ?? argv[++i];
    if (value === undefined || value.startsWith('--')) {
      errors.push(`Falta el valor de ${arg}`);
      continue;
    }
    raw[key] = value;
  }

  if (help) return { ok: false, errors: [], help: true };

  const tenant = (raw.tenant ?? '').trim();
  if (!tenant) errors.push('Falta --tenant (slug del tenant).');
  else if (!SLUG_RE.test(tenant)) {
    errors.push(`--tenant "${tenant}" no es un slug válido (minúsculas, dígitos y guiones, 2-63 caracteres).`);
  }

  const userId = (raw.userId ?? '').trim();
  if (!userId) errors.push('Falta --user-id (preferred_username del usuario en Keycloak).');
  else if (/\s/.test(userId)) errors.push('--user-id no debe contener espacios.');

  const roles = raw.roles === undefined ? [...DEFAULT_ROLES] : parseRoles(raw.roles);
  if (roles.length === 0) errors.push('--roles no puede estar vacío.');
  const unknown = roles.filter((r) => !(KNOWN_ROLES as readonly string[]).includes(r));
  if (unknown.length > 0) {
    errors.push(`Roles desconocidos: ${unknown.join(', ')}. Válidos: ${KNOWN_ROLES.join(', ')}.`);
  }

  const email = raw.email?.trim() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(`--email "${email}" no es un correo válido.`);

  if (errors.length > 0) return { ok: false, errors, help: false };
  return {
    ok: true,
    options: {
      tenant,
      userId,
      roles,
      name: raw.name?.trim() || null,
      email,
      tenantName: raw.tenantName?.trim() || tenant,
      dryRun,
    },
  };
}
