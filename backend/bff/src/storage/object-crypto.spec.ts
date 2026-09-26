import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decryptObject, encryptObject } from './object-crypto';

const previous = process.env.STORAGE_MASTER_KEY;

beforeEach(() => {
  process.env.STORAGE_MASTER_KEY = randomBytes(32).toString('base64');
});

afterEach(() => {
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
