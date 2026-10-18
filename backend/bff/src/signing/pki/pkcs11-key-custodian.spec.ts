import { ServiceUnavailableException } from '@nestjs/common';
import forge from 'node-forge';
import { afterEach, describe, expect, it } from 'vitest';
import { Pkcs11KeyCustodian } from './pkcs11-key-custodian';
import { readPkcs11Config } from './pkcs11-config';
import { bindGraphene, type GrapheneLike } from './pkcs11-graphene';

const ENV_KEYS = ['PKCS11_MODULE', 'PKCS11_SLOT', 'PKCS11_PIN', 'PKCS11_KEY_LABEL'] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('readPkcs11Config', () => {
  it('exige módulo, PIN y etiqueta, y no inventa valores', () => {
    expect(() => readPkcs11Config({})).toThrow(ServiceUnavailableException);
    expect(() => readPkcs11Config({ PKCS11_MODULE: '/opt/hsm.so' })).toThrow(/PKCS11_PIN/);
    expect(() =>
      readPkcs11Config({ PKCS11_MODULE: '/opt/hsm.so', PKCS11_PIN: 'pin' }),
    ).toThrow(/PKCS11_KEY_LABEL/);
    expect(() =>
      readPkcs11Config({
        PKCS11_MODULE: '/opt/hsm.so',
        PKCS11_PIN: 'pin',
        PKCS11_KEY_LABEL: 'sello',
        PKCS11_SLOT: 'no',
      }),
    ).toThrow(/PKCS11_SLOT/);

    expect(
      readPkcs11Config({
        PKCS11_MODULE: '/opt/hsm.so',
        PKCS11_PIN: 'pin',
        PKCS11_KEY_LABEL: 'sello',
      }),
    ).toMatchObject({ modulePath: '/opt/hsm.so', slot: 0, keyLabel: 'sello' });
  });
});

describe('Pkcs11KeyCustodian', () => {
  it('no devuelve PKCS#12 y reutiliza la sesión abierta', async () => {
    process.env.PKCS11_MODULE = '/opt/hsm.so';
    process.env.PKCS11_PIN = 'pin-secreto';
    process.env.PKCS11_KEY_LABEL = 'sello';
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
    cert.validity.notAfter = new Date('2027-01-01T00:00:00Z');
    cert.setSubject([{ name: 'commonName', value: 'Sello' }]);
    cert.setIssuer([{ name: 'commonName', value: 'PSC' }]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const pem = forge.pki.certificateToPem(cert);

    let opened = 0;
    const custodian = new Pkcs11KeyCustodian();
    custodian.opener = () => {
      opened += 1;
      return {
        certificatePem: pem,
        chainPem: [],
        signRsaPkcs1: (digestInfo) => Buffer.from(keys.privateKey.sign(digestInfo.toString('binary'), 'NONE'), 'binary'),
      };
    };

    const first = await custodian.getSigningMaterial('ana', 'Ana');
    const second = await custodian.getSigningMaterial('ana', 'Ana');
    expect(opened).toBe(1);
    expect(first).toBe(second);
    expect(first.p12).toBeUndefined();
    expect(first.passphrase).toBeUndefined();
    expect(first.signRsaPkcs1).toBeTypeOf('function');
    expect(first.certificate.subject).toContain('Sello');
  });

  it('redacta el PIN si el módulo falla', async () => {
    process.env.PKCS11_MODULE = '/opt/hsm.so';
    process.env.PKCS11_PIN = 'pin-secreto';
    process.env.PKCS11_KEY_LABEL = 'sello';
    const custodian = new Pkcs11KeyCustodian();
    custodian.opener = () => {
      throw new Error('login rechazado para pin-secreto');
    };
    await expect(custodian.getSigningMaterial('ana')).rejects.toThrow(ServiceUnavailableException);
    await expect(custodian.getSigningMaterial('ana')).rejects.toThrow(/\[redactado\]/);
    await expect(custodian.getSigningMaterial('ana')).rejects.not.toThrow(/pin-secreto/);
  });
});

describe('bindGraphene', () => {
  it('firma con la llave del token y no lee su valor', () => {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '02';
    cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
    cert.validity.notAfter = new Date('2027-01-01T00:00:00Z');
    cert.setSubject([{ name: 'commonName', value: 'Sello' }]);
    cert.setIssuer([{ name: 'commonName', value: 'PSC' }]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');
    const keyId = Buffer.from([9]);
    const templates: Record<string, unknown>[] = [];
    const privateKey = {
      id: keyId,
      get value() {
        throw new Error('CKA_VALUE');
      },
      toType() {
        return this;
      },
    };
    const session = {
      login() {},
      find(template: Record<string, unknown>) {
        templates.push(template);
        if (template.class === 2) return { length: 1, items: () => privateKey };
        return {
          length: 1,
          items: () => ({ id: keyId, label: 'sello', value: der }),
        };
      },
      createSign(_algorithm: string, key: unknown) {
        if (key !== privateKey) throw new Error('la firma no usa el handle de la llave');
        return {
          update() {},
          final() {
            return Buffer.from('firma');
          },
        };
      },
    };
    const graphene: GrapheneLike = {
      Module: {
        load() {
          return {
            initialize() {},
            getSlots() {
              return { flags: 1, open: () => session };
            },
            finalize() {},
          };
        },
      },
      SlotFlag: { TOKEN_PRESENT: 1 },
      ObjectClass: { PRIVATE_KEY: 2, CERTIFICATE: 3 },
      CertificateType: { X_509: 0 },
    };

    const handle = bindGraphene(graphene, {
      modulePath: '/opt/hsm.so',
      slot: 0,
      pin: 'pin-secreto',
      keyLabel: 'sello',
    });

    expect(templates.some((template) => 'value' in template)).toBe(false);
    expect(handle.certificatePem).toContain('BEGIN CERTIFICATE');
    expect(handle.signRsaPkcs1(Buffer.from('digest-info')).toString()).toBe('firma');
    expect(forge.pki.certificateFromPem(handle.certificatePem).subject.getField('CN')?.value).toBe('Sello');
  });
});
