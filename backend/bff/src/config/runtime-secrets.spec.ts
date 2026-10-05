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

describe('inspectRuntimeSecrets — endurecimiento de producción', () => {
  const prodOk = (extra: NodeJS.ProcessEnv = {}) =>
    env({
      NODE_ENV: 'production',
      KEYCLOAK_ISSUER: 'https://id.ejemplo.mx/realms/prestige',
      DATABASE_URL: 'postgresql://prestige:Xk39!zz@db.interno:5432/prestige',
      S3_ACCESS_KEY: 'AKIAREAL',
      S3_SECRET_KEY: 'secreto-real-largo',
      SMTP_HOST: 'smtp.ejemplo.mx',
      TSA_URL: 'https://tsa.seguridata.mx/tsr',
      ...extra,
    });
  const keyPresent = () => true;

  it('una configuración de producción completa no tiene fatales', () => {
    expect(inspectRuntimeSecrets(prodOk(), keyPresent).fatal).toEqual([]);
  });

  it.each([
    ['S3 por defecto', { S3_ACCESS_KEY: 'prestige', S3_SECRET_KEY: 'prestige-minio' }, /S3_/],
    ['S3 vacío', { S3_ACCESS_KEY: '', S3_SECRET_KEY: '' }, /S3_/],
    [
      'DATABASE_URL con password prestige',
      { DATABASE_URL: 'postgresql://prestige:prestige@db:5432/prestige' },
      /DATABASE_URL/,
    ],
    ['sin KEYCLOAK_ISSUER', { KEYCLOAK_ISSUER: '' }, /KEYCLOAK_ISSUER/],
    ['sin SMTP_HOST', { SMTP_HOST: '' }, /SMTP_HOST/],
    ['sin TSA_URL', { TSA_URL: '' }, /TSA_URL/],
  ])('production: %s es fatal', (_name, extra, re) => {
    expect(inspectRuntimeSecrets(prodOk(extra as NodeJS.ProcessEnv), keyPresent).fatal.join(' ')).toMatch(re);
  });

  it('production: falta la llave Ed25519 del manifiesto es fatal', () => {
    expect(inspectRuntimeSecrets(prodOk(), () => false).fatal.join(' ')).toMatch(/Ed25519/);
  });

  it('fuera de production los mismos problemas son solo warnings', () => {
    const res = inspectRuntimeSecrets(
      env({ S3_ACCESS_KEY: 'prestige', S3_SECRET_KEY: 'prestige-minio', SMTP_HOST: '', TSA_URL: '' }),
      () => false,
    );
    expect(res.fatal).toEqual([]);
    expect(res.warnings.join(' ')).toMatch(/S3_/);
    expect(res.warnings.join(' ')).toMatch(/Ed25519/);
  });
});
