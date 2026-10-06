import { describe, expect, it } from 'vitest';
import type { SignatureMethod } from '@prisma/client';
import { allowedMethodsForRequest, creationWarnings, requestHasPadesSignature } from './allowed-methods';

const ALL: SignatureMethod[] = ['DIGITAL', 'AUTOGRAFA', 'BIOMETRICA', 'ACCEPT', 'PASSKEY'];
const signed = (usedMethod: SignatureMethod) => ({ status: 'FIRMADO', usedMethod });

describe('allowedMethodsForRequest', () => {
  it('sin firma previa deja pasar todos los métodos (incluida AUTOGRAFA)', () => {
    const r = { methods: ALL, signers: [{ status: 'PENDIENTE' }, { status: 'PENDIENTE' }] };
    expect(allowedMethodsForRequest(r)).toEqual(ALL);
  });

  it('tras una firma DIGITAL excluye los métodos que estampan (AUTOGRAFA)', () => {
    const r = { methods: ALL, signers: [signed('DIGITAL'), { status: 'PENDIENTE' }] };
    expect(allowedMethodsForRequest(r)).toEqual(['DIGITAL', 'BIOMETRICA', 'ACCEPT', 'PASSKEY']);
  });

  it('secuencial: firmante 2 sólo ve DIGITAL/ACCEPT/PASSKEY tras la DIGITAL del 1', () => {
    const r = { methods: ['DIGITAL', 'AUTOGRAFA', 'ACCEPT', 'PASSKEY'] as SignatureMethod[], signers: [signed('DIGITAL'), { status: 'PENDIENTE' }] };
    expect(allowedMethodsForRequest(r)).toEqual(['DIGITAL', 'ACCEPT', 'PASSKEY']);
  });

  it('una firma previa no PAdES (AUTOGRAFA/ACCEPT) no restringe nada', () => {
    const r = { methods: ALL, signers: [signed('AUTOGRAFA'), signed('ACCEPT'), { status: 'PENDIENTE' }] };
    expect(allowedMethodsForRequest(r)).toEqual(ALL);
  });

  it('una DIGITAL no concluida (EN_PROCESO/PENDIENTE) no cuenta como firma presente', () => {
    const r = { methods: ALL, signers: [{ status: 'EN_PROCESO', usedMethod: 'DIGITAL' as const }] };
    expect(requestHasPadesSignature(r)).toBe(false);
    expect(allowedMethodsForRequest(r)).toEqual(ALL);
  });

  it('paralelo: aplica igual en cuanto alguien ya firmó DIGITAL', () => {
    const r = { methods: ['DIGITAL', 'AUTOGRAFA'] as SignatureMethod[], signers: [signed('DIGITAL'), { status: 'PENDIENTE' }] };
    expect(allowedMethodsForRequest(r)).toEqual(['DIGITAL']);
  });
});

describe('creationWarnings', () => {
  it('SECUENCIAL con visual + DIGITAL avisa', () => {
    expect(creationWarnings('SECUENCIAL', ['DIGITAL', 'AUTOGRAFA'])).toEqual(['VISUAL_AFTER_DIGITAL_ORDER']);
  });
  it('PARALELO, sólo visual o sólo DIGITAL no avisan', () => {
    expect(creationWarnings('PARALELO', ['DIGITAL', 'AUTOGRAFA'])).toEqual([]);
    expect(creationWarnings('SECUENCIAL', ['AUTOGRAFA', 'ACCEPT'])).toEqual([]);
    expect(creationWarnings('SECUENCIAL', ['DIGITAL', 'ACCEPT'])).toEqual([]);
  });
});
