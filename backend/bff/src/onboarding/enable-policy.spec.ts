import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { baseSignerId, decideEnableMode, uniqueSignerId } from './enable-policy';

const base = { livenessOk: false, faceMatchOk: false, biometricEngine: 'noop' as string | null };

describe('decideEnableMode', () => {
  it('motor aprobó liveness y coincidencia → engine', () => {
    expect(
      decideEnableMode({ livenessOk: true, faceMatchOk: true, biometricEngine: 'local-faceapi' }, {}),
    ).toBe('engine');
  });

  it('sin motor (noop) decide RH → manual, sin pedir anulación', () => {
    expect(decideEnableMode(base, {})).toBe('manual');
    expect(decideEnableMode({ ...base, biometricEngine: null }, {})).toBe('manual');
  });

  it('el motor corrió y NO pasó → 409 BIOMETRIC_NOT_PASSED', () => {
    const c = { livenessOk: true, faceMatchOk: false, biometricEngine: 'local-faceapi' };
    expect(() => decideEnableMode(c, {})).toThrow(ConflictException);
    try {
      decideEnableMode(c, {});
    } catch (e) {
      expect((e as ConflictException).getResponse()).toMatchObject({ error: 'BIOMETRIC_NOT_PASSED' });
    }
  });

  it('anulación solo con override=true y motivo de ≥ 10 caracteres', () => {
    const c = { livenessOk: false, faceMatchOk: false, biometricEngine: 'remote' };
    expect(() => decideEnableMode(c, { override: true })).toThrow(ConflictException);
    expect(() => decideEnableMode(c, { override: true, notes: 'corto' })).toThrow(ConflictException);
    expect(() => decideEnableMode(c, { override: false, notes: 'motivo suficientemente largo' })).toThrow(
      ConflictException,
    );
    expect(decideEnableMode(c, { override: true, notes: '  revisión presencial con INE  ' })).toBe(
      'manual-override',
    );
  });

  it('liveness ok pero sin coincidencia facial tampoco pasa solo', () => {
    expect(() =>
      decideEnableMode({ livenessOk: true, faceMatchOk: false, biometricEngine: 'remote' }, {}),
    ).toThrow(ConflictException);
  });
});

describe('signerId único', () => {
  it('baseSignerId toma la parte local sin caracteres raros y cae al id del alta', () => {
    expect(baseSignerId('Ana.Lopez+x@empresa.mx', 'abcdef123456')).toBe('Ana.Lopezx');
    expect(baseSignerId('@x.mx', 'abcdef123456')).toBe('abcdef12');
  });

  it('libre → devuelve el base', async () => {
    expect(await uniqueSignerId('ana', 'ana@a.mx', 'id-1', async () => false)).toBe('ana');
  });

  it('lo usa OTRO correo habilitado → sufijo estable derivado del id del alta', async () => {
    const taken = new Set(['ana']);
    const id = await uniqueSignerId('ana', 'ana@b.mx', 'a1b2c3-d4e5', async (c) => taken.has(c));
    expect(id).toBe('ana-a1b2c3');
    // idempotente: mismo alta → mismo resultado
    expect(await uniqueSignerId('ana', 'ana@b.mx', 'a1b2c3-d4e5', async (c) => taken.has(c))).toBe(id);
  });

  it('base y sufijo ocupados → 409 SIGNER_ID_COLLISION', async () => {
    await expect(uniqueSignerId('ana', 'ana@b.mx', 'a1b2c3', async () => true)).rejects.toThrow(ConflictException);
  });
});
