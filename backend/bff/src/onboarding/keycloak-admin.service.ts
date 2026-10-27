import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

export interface NewAccount {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  tenant: string;
}

/** Keycloak rechazó la alta porque ya existe el usuario o el correo. */
export class AccountConflictError extends Error {
  constructor(readonly field: 'username' | 'email') {
    super(`Keycloak: ya existe un usuario con ese ${field === 'email' ? 'correo' : 'nombre de usuario'}`);
  }
}

const TIMEOUT_MS = 8000;
const DEFAULT_ROLES = 'sender,signer';

/**
 * Cuentas de acceso creadas desde el alta de onboarding. Usa una cuenta de servicio del realm
 * (client credentials) con permisos mínimos de usuarios; no el admin del realm master.
 *
 * Apagado si falta cualquiera de KEYCLOAK_ADMIN_CLIENT_ID, KEYCLOAK_ADMIN_CLIENT_SECRET u
 * ONBOARDING_DEFAULT_PASSWORD: el alta sigue funcionando y solo registra el usuario calculado.
 * La contraseña inicial es temporal: Keycloak obliga a cambiarla en el primer ingreso.
 */
@Injectable()
export class KeycloakAdminService {
  private readonly log = new Logger(KeycloakAdminService.name);
  private token: { value: string; expiresAt: number } | undefined;

  private config() {
    const issuer = process.env.KEYCLOAK_ISSUER;
    const clientId = process.env.KEYCLOAK_ADMIN_CLIENT_ID;
    const clientSecret = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET;
    const password = process.env.ONBOARDING_DEFAULT_PASSWORD;
    if (!issuer || !clientId || !clientSecret || !password) return null;
    const url = new URL(issuer);
    const realm = url.pathname.split('/').filter(Boolean).pop();
    if (!realm) return null;
    const base = (process.env.KEYCLOAK_ADMIN_URL || url.origin).replace(/\/$/, '');
    const roles = (process.env.ONBOARDING_ACCOUNT_ROLES ?? DEFAULT_ROLES).split(',').map((r) => r.trim()).filter(Boolean);
    return { base, realm, clientId, clientSecret, password, roles };
  }

  get enabled(): boolean {
    return this.config() !== null;
  }

  private async accessToken(cfg: NonNullable<ReturnType<KeycloakAdminService['config']>>): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 10_000) return this.token.value;
    const res = await fetch(`${cfg.base}/realms/${cfg.realm}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.clientId, client_secret: cfg.clientSecret }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new ServiceUnavailableException(`Keycloak no entregó token de administración (HTTP ${res.status})`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const cfg = this.config();
    if (!cfg) throw new ServiceUnavailableException('La creación de cuentas no está configurada');
    const token = await this.accessToken(cfg);
    return fetch(`${cfg.base}/admin/realms/${cfg.realm}${path}`, {
      ...init,
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}`, ...init.headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  async usernameExists(username: string): Promise<boolean> {
    const res = await this.call(`/users?username=${encodeURIComponent(username)}&exact=true&max=1`);
    if (!res.ok) throw new ServiceUnavailableException(`Keycloak no pudo consultar usuarios (HTTP ${res.status})`);
    return ((await res.json()) as unknown[]).length > 0;
  }

  /** Crea el usuario con contraseña temporal y le asigna los roles. Devuelve el id de Keycloak. */
  async createUser(account: NewAccount): Promise<{ id: string }> {
    const cfg = this.config();
    if (!cfg) throw new ServiceUnavailableException('La creación de cuentas no está configurada');
    const res = await this.call('/users', {
      method: 'POST',
      body: JSON.stringify({
        username: account.username,
        email: account.email,
        firstName: account.firstName,
        lastName: account.lastName,
        enabled: true,
        emailVerified: true,
        attributes: { tenant: [account.tenant] },
        credentials: [{ type: 'password', value: cfg.password, temporary: true }],
      }),
    });
    if (res.status === 409) {
      const message = ((await res.json().catch(() => ({}))) as { errorMessage?: string }).errorMessage ?? '';
      throw new AccountConflictError(/email/i.test(message) ? 'email' : 'username');
    }
    if (!res.ok) throw new ServiceUnavailableException(`Keycloak no pudo crear el usuario (HTTP ${res.status})`);
    const id = res.headers.get('location')?.split('/').pop();
    if (!id) throw new ServiceUnavailableException('Keycloak creó el usuario pero no devolvió su id');
    try {
      await this.assignRoles(id, cfg.roles);
    } catch (error) {
      // Sin roles la cuenta no sirve y quedaría huérfana: se deshace para que el alta se pueda reintentar.
      await this.deleteUser(id).catch(() => undefined);
      throw error;
    }
    return { id };
  }

  private async assignRoles(id: string, names: string[]): Promise<void> {
    if (names.length === 0) return;
    const roles: unknown[] = [];
    for (const name of names) {
      const res = await this.call(`/roles/${encodeURIComponent(name)}`);
      if (!res.ok) throw new ServiceUnavailableException(`Keycloak no tiene el rol ${name} (HTTP ${res.status})`);
      roles.push(await res.json());
    }
    const res = await this.call(`/users/${id}/role-mappings/realm`, { method: 'POST', body: JSON.stringify(roles) });
    if (!res.ok) throw new ServiceUnavailableException(`Keycloak no pudo asignar roles (HTTP ${res.status})`);
  }

  async disableUser(id: string): Promise<void> {
    // Keycloak 26 con perfil de usuario: un PUT parcial puede borrar atributos, se reenvía la representación completa.
    const current = await this.call(`/users/${id}`);
    if (current.status === 404) return;
    if (!current.ok) throw new ServiceUnavailableException(`Keycloak no pudo leer la cuenta (HTTP ${current.status})`);
    const user = (await current.json()) as Record<string, unknown>;
    const res = await this.call(`/users/${id}`, { method: 'PUT', body: JSON.stringify({ ...user, enabled: false }) });
    if (!res.ok && res.status !== 404) {
      this.log.warn(`No se pudo deshabilitar la cuenta ${id} (HTTP ${res.status})`);
      throw new ServiceUnavailableException(`Keycloak no pudo deshabilitar la cuenta (HTTP ${res.status})`);
    }
  }

  async deleteUser(id: string): Promise<void> {
    const res = await this.call(`/users/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new ServiceUnavailableException(`Keycloak no pudo borrar la cuenta (HTTP ${res.status})`);
  }
}
