import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { inspectRuntimeSecrets } from './runtime-secrets';

const master = randomBytes(32).toString('base64');

function env(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    STORAGE_MASTER_KEY: master,
    WORKER_SHARED_SECRET: 'secreto-de-worker-local',
    PKI_PASSPHRASE: 'frase-propia-del-entorno',
    KEYCLOAK_ISSUER: 'http://127.0.0.1:8081/realms/prestige',
    DATABASE_URL: 'postgresql://prestige:prestige@127.0.0.1:5432/prestige',
    NODE_ENV: 'development',
    ...extra,
  };
}

describe('inspectRuntimeSecrets', () => {
  it('acepta llaves propias en local y avisa si la passphrase es el ejemplo', () => {
    const local = inspectRuntimeSecrets(env({ PKI_PASSPHRASE: 'prestige-pki-dev' }));
    expect(local.fatal).toEqual([]);
    expect(local.warnings.join(' ')).toMatch(/ejemplo/);
    expect(inspectRuntimeSecrets(env({})).fatal).toEqual([]);
  });

  it('rechaza REPLACE_ME y la passphrase de ejemplo fuera de localhost o en production', () => {
    expect(inspectRuntimeSecrets(env({ STORAGE_MASTER_KEY: 'REPLACE_ME_32_BYTE_BASE64_KEY' })).fatal.join(' ')).toMatch(
      /STORAGE_MASTER_KEY/,
    );
    expect(
      inspectRuntimeSecrets(env({ PKI_PASSPHRASE: 'prestige-pki-dev', NODE_ENV: 'production' })).fatal.join(' '),
    ).toMatch(/prestige-pki-dev/);
    expect(
      inspectRuntimeSecrets(
        env({
          PKI_PASSPHRASE: 'prestige-pki-dev',
          KEYCLOAK_ISSUER: 'https://id.ejemplo.mx/realms/prestige',
        }),
      ).fatal.join(' '),
    ).toMatch(/localhost/);
  });
});
