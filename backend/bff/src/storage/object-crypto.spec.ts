import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decryptObject, encryptObject } from './object-crypto';

const previous = process.env.STORAGE_MASTER_KEY;

beforeEach(() => {
  process.env.STORAGE_MASTER_KEY = randomBytes(32).toString('base64');
});

afterEach(() => {
  delete process.env.STORAGE_MASTER_KEY_V2;
  delete process.env.STORAGE_ACTIVE_KID;
  if (previous === undefined) delete process.env.STORAGE_MASTER_KEY;
  else process.env.STORAGE_MASTER_KEY = previous;
});

describe('encryptObject / decryptObject', () => {
  it('round-trip: el claro vuelve igual y el ciphertext no lo es', () => {
    const plain = Buffer.from('INE frente + llave de firma', 'utf8');
    const { ciphertext, enc } = encryptObject(plain);
    expect(ciphertext.equals(plain)).toBe(false);
    expect(enc.alg).toBe('AES-256-GCM');
    expect(enc.dek.wrapped).not.toBe(plain.toString('base64'));
    expect(decryptObject(ciphertext, enc).equals(plain)).toBe(true);
  });

  it('dos cifrados del mismo claro no reutilizan IV ni DEK', () => {
    const plain = Buffer.from('mismo-documento');
    const a = encryptObject(plain);
    const b = encryptObject(plain);
    expect(a.enc.iv).not.toBe(b.enc.iv);
    expect(a.enc.dek.wrapped).not.toBe(b.enc.dek.wrapped);
    expect(decryptObject(a.ciphertext, a.enc).equals(plain)).toBe(true);
    expect(decryptObject(b.ciphertext, b.enc).equals(plain)).toBe(true);
  });

  it('rechaza ciphertext alterado y tag alterado', () => {
    const plain = Buffer.from('expediente');
    const { ciphertext, enc } = encryptObject(plain);
    const flipped = Buffer.from(ciphertext);
    flipped[0] ^= 0xff;
    expect(() => decryptObject(flipped, enc)).toThrow();
    expect(() => decryptObject(ciphertext, { ...enc, tag: randomBytes(16).toString('base64') })).toThrow();
  });

  it('otra llave maestra no abre el sobre', () => {
    const plain = Buffer.from('no se abre');
    const { ciphertext, enc } = encryptObject(plain);
    process.env.STORAGE_MASTER_KEY = randomBytes(32).toString('base64');
    expect(() => decryptObject(ciphertext, enc)).toThrow();
  });

  it('exige base64 de 32 bytes y un algoritmo conocido', () => {
    process.env.STORAGE_MASTER_KEY = 'REPLACE_ME_32_BYTE_BASE64_KEY';
    expect(() => encryptObject(Buffer.from('x'))).toThrow(/32 bytes/);
    delete process.env.STORAGE_MASTER_KEY;
    expect(() => encryptObject(Buffer.from('x'))).toThrow(/no está configurada/);
    process.env.STORAGE_MASTER_KEY = randomBytes(32).toString('base64');
    const { ciphertext, enc } = encryptObject(Buffer.from('x'));
    expect(() => decryptObject(ciphertext, { ...enc, alg: 'AES-128-CBC' as 'AES-256-GCM' })).toThrow(/no soportado/);
  });
});

describe('kid y AAD de tenant', () => {
  it('cifra con kid v1 por defecto y sin aad', () => {
    const { enc } = encryptObject(Buffer.from('x'));
    expect(enc.dek.kid).toBe('v1');
    expect(enc.aad).toBeUndefined();
  });

  it('objeto antiguo (sin kid ni aad) sigue descifrando con la llave actual', () => {
    const plain = Buffer.from('antiguo');
    const { ciphertext, enc } = encryptObject(plain);
    const legacy = { ...enc, dek: { wrapped: enc.dek.wrapped, iv: enc.dek.iv, tag: enc.dek.tag } };
    expect(decryptObject(ciphertext, legacy).equals(plain)).toBe(true);
  });

  it('rotación: objetos v1 y v2 conviven con ambas llaves configuradas', () => {
    const plain = Buffer.from('rotacion');
    const old = encryptObject(plain);
    process.env.STORAGE_MASTER_KEY_V2 = randomBytes(32).toString('base64');
    process.env.STORAGE_ACTIVE_KID = 'v2';
    const fresh = encryptObject(plain);
    expect(old.enc.dek.kid).toBe('v1');
    expect(fresh.enc.dek.kid).toBe('v2');
    expect(decryptObject(old.ciphertext, old.enc).equals(plain)).toBe(true);
    expect(decryptObject(fresh.ciphertext, fresh.enc).equals(plain)).toBe(true);
    delete process.env.STORAGE_MASTER_KEY_V2;
    expect(() => decryptObject(fresh.ciphertext, fresh.enc)).toThrow(/STORAGE_MASTER_KEY_V2/);
  });

  it('AAD de tenant: round-trip con el mismo tenant, falla con otro o sin tenant', () => {
    const plain = Buffer.from('expediente del tenant');
    const { ciphertext, enc } = encryptObject(plain, { tenantId: 'tenant-a' });
    expect(enc.aad).toBe('tenant');
    expect(decryptObject(ciphertext, enc, { tenantId: 'tenant-a' }).equals(plain)).toBe(true);
    expect(() => decryptObject(ciphertext, enc, { tenantId: 'tenant-b' })).toThrow();
    expect(() => decryptObject(ciphertext, enc)).toThrow(/tenantId/);
  });

  it('rechaza un kid con caracteres inválidos', () => {
    expect(() => encryptObject(Buffer.from('x'), { kid: '../v1' })).toThrow(/inválido/);
  });
});
