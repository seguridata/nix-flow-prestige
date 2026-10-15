import { describe, expect, it, vi } from 'vitest';
import { genReqId, ignoreHealthLog, isSafeCorrelationId, logCustomProps, resolveCorrelationId } from './log-context';

describe('log-context', () => {
  it('acepta ids seguros y rechaza los inseguros', () => {
    expect(isSafeCorrelationId('abc-123-DEF')).toBe(true);
    expect(isSafeCorrelationId('a'.repeat(64))).toBe(true);
    expect(isSafeCorrelationId('a'.repeat(65))).toBe(false);
    expect(isSafeCorrelationId('')).toBe(false);
    expect(isSafeCorrelationId('a b')).toBe(false);
    expect(isSafeCorrelationId('x\r\nSet-Cookie: a=b')).toBe(false);
    expect(isSafeCorrelationId(undefined)).toBe(false);
  });

  it('resolveCorrelationId conserva el seguro y genera otro si no', () => {
    expect(resolveCorrelationId('req-1')).toBe('req-1');
    const gen = resolveCorrelationId('mal id!');
    expect(gen).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveCorrelationId(undefined)).not.toBe(gen);
  });

  it('genReqId lo devuelve en la respuesta', () => {
    const setHeader = vi.fn();
    const id = genReqId({ headers: { 'x-correlation-id': 'abc-1' } }, { setHeader });
    expect(id).toBe('abc-1');
    expect(setHeader).toHaveBeenCalledWith('x-correlation-id', 'abc-1');
  });

  it('customProps agrega tenantId y actorId solo si hay usuario', () => {
    expect(logCustomProps({ user: { tenantId: 'acme', actorId: 'u1' } })).toEqual({ tenantId: 'acme', actorId: 'u1' });
    expect(logCustomProps({})).toEqual({});
  });

  it('no registra las sondas de salud (con o sin query)', () => {
    for (const url of ['/operations/health', '/operations/health/live', '/operations/health/ready?x=1']) {
      expect(ignoreHealthLog({ url })).toBe(true);
    }
    expect(ignoreHealthLog({ url: '/documents' })).toBe(false);
    expect(ignoreHealthLog({ url: '/operations/health-other' })).toBe(false);
  });
});
