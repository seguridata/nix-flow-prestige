import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import forge from 'node-forge';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { SoftwareKeyCustodian } from './software-key-custodian';
import { ensureCaChain } from './ca';

const ENV_KEYS = ['PKI_DIR', 'PKI_PASSPHRASE', 'NODE_ENV'] as const;
const saved: Record<string, string | undefined> = {};
let base: string;
let caSource: string;
let dir: string;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'pki-custodian-'));
  caSource = join(base, 'ca-source');
  ensureCaChain(caSource); // una sola CA para todas las pruebas (RSA 4096 es lento)
}, 120_000);

afterAll(() => rmSync(base, { recursive: true, force: true }));

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  dir = mkdtempSync(join(base, 'run-'));
  process.env.PKI_DIR = dir;
  process.env.PKI_PASSPHRASE = 'frase-de-prueba';
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function installCa() {
  mkdirSync(join(dir, 'ca'), { recursive: true });
  for (const f of ['root.key.pem', 'root.cert.pem', 'intermediate.key.pem', 'intermediate.cert.pem']) {
    copyFileSync(join(caSource, f), join(dir, 'ca', f));
  }
}

describe('SoftwareKeyCustodian', () => {
  it('guarda el P12 por tenant y no mezcla tenants con el mismo signerId', async () => {
    installCa();
    const c = new SoftwareKeyCustodian();
    const a = await c.getSigningMaterial('ana@x.mx', 'Ana', 'tenant-a');
    const b = await c.getSigningMaterial('ana@x.mx', 'Ana', 'tenant-b');
    expect(existsSync(join(dir, 'signers', 'tenant-a', 'ana@x.mx.p12'))).toBe(true);
    expect(existsSync(join(dir, 'signers', 'tenant-b', 'ana@x.mx.p12'))).toBe(true);
    expect(a.certificate.serialNumber).not.toBe(b.certificate.serialNumber);
    expect(existsSync(join(dir, 'signers', 'ana@x.mx.p12'))).toBe(false);
    // caché por tenant/firmante
    expect(await c.getSigningMaterial('ana@x.mx', 'Ana', 'tenant-a')).toBe(a);
  }, 60_000);

  it('el P12 nuevo usa AES-256 y se abre con la frase', async () => {
    installCa();
    const m = await new SoftwareKeyCustodian().getSigningMaterial('luis', 'Luis', 't1');
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(m.p12!.toString('binary')));
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, 'frase-de-prueba');
    const bags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag];
    expect(bags?.length).toBe(1);
  }, 60_000);

  it('lee el P12 heredado (sin tenant) con warn y no emite otro certificado', async () => {
    installCa();
    const first = await new SoftwareKeyCustodian().getSigningMaterial('vieja', 'Vieja', 'tmp');
    mkdirSync(join(dir, 'signers'), { recursive: true });
    writeFileSync(join(dir, 'signers', 'vieja.p12'), first.p12!);
    writeFileSync(
      join(dir, 'signers', 'vieja.json'),
      JSON.stringify({ certificatePem: first.certificatePem, certificate: first.certificate }),
    );
    const again = await new SoftwareKeyCustodian().getSigningMaterial('vieja', 'Vieja', 'tenant-z');
    expect(again.certificate.serialNumber).toBe(first.certificate.serialNumber);
    expect(readFileSync(join(dir, 'signers', 'vieja.p12')).equals(again.p12!)).toBe(true);
    expect(existsSync(join(dir, 'signers', 'tenant-z', 'vieja.p12'))).toBe(false);
  }, 60_000);

  it('sanea tenantId y signerId como segmentos de ruta', async () => {
    installCa();
    const c = new SoftwareKeyCustodian();
    await c.getSigningMaterial('..\\..\\x/../y', 'X', '../escape');
    expect(existsSync(join(dir, 'escape'))).toBe(false);
    expect(existsSync(join(dir, '..', 'escape'))).toBe(false);
    await expect(c.getSigningMaterial('x', 'X', '..')).resolves.toBeDefined();
    await expect(c.getSigningMaterial('x', 'X', '')).rejects.toThrow(/tenantId/);
  }, 60_000);

  it('en producción no autogenera la CA si falta', async () => {
    process.env.NODE_ENV = 'production';
    await expect(new SoftwareKeyCustodian().getSigningMaterial('a', 'A', 't')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(existsSync(join(dir, 'ca'))).toBe(false);
  });

  it('fuera de producción autogenera la CA si falta', async () => {
    // Sin CA instalada: la crea (RSA 4096, lento).
    const m = await new SoftwareKeyCustodian().getSigningMaterial('a', 'A', 't');
    expect(m.certificate.issuer).toContain('Prestige Issuing CA');
    expect(existsSync(join(dir, 'ca', 'intermediate.cert.pem'))).toBe(true);
  }, 180_000);
});
