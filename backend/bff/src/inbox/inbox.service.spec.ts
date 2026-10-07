/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { InboxService } from './inbox.service';

const expires = new Date('2026-10-08T14:00:00Z');

function request(over: Record<string, unknown> = {}) {
  return {
    id: 'sr1',
    documentId: 'd1',
    status: 'EN_FIRMA',
    order: 'SECUENCIAL',
    methods: ['AUTOGRAFA'],
    requestedByName: 'Ana Ruiz',
    createdAt: new Date('2026-10-06T10:00:00Z'),
    expiresAt: expires,
    signers: [
      { signerId: 'carlos', name: 'Carlos', status: 'PENDIENTE', sortOrder: 1, delegatedTo: null },
      { signerId: 'maria', name: 'María', status: 'FIRMADO', sortOrder: 0, delegatedTo: null },
    ],
    ...over,
  };
}

function svc(requests: unknown[]) {
  const signatureRequests = { listAll: vi.fn(async () => requests) };
  const documents = { findManyByIds: vi.fn(async () => new Map([['d1', { id: 'd1', caseId: 'c1', filename: 'Contrato.pdf' }]])) };
  const cases = { findManyByIds: vi.fn(async () => new Map([['c1', { id: 'c1', title: 'Torre Norte' }]])) };
  return new InboxService(signatureRequests as any, documents as any, cases as any);
}

describe('InboxService: vencimiento y firmantes', () => {
  it('forSigner devuelve expiresAt y los firmantes en orden', async () => {
    const [item] = await svc([request()]).forSigner('carlos', 'T');
    expect(item!.expiresAt).toBe(expires.toISOString());
    expect(item!.signers!.map((s) => s.signerId)).toEqual(['maria', 'carlos']);
    expect(item!.myTurn).toBe(true);
  });

  it('forSigner: sin vencimiento devuelve null, no undefined', async () => {
    const [item] = await svc([request({ expiresAt: null })]).forSigner('carlos', 'T');
    expect(item!.expiresAt).toBeNull();
  });

  it('forRequester devuelve expiresAt', async () => {
    const [item] = await svc([request()]).forRequester('ana', 'T');
    expect(item!.expiresAt).toBe(expires.toISOString());
  });
});
