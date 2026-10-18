import { describe, expect, it } from 'vitest';
import { AI_THROTTLE, ONBOARDING_THROTTLE, UPLOAD_THROTTLE, throttleTracker } from './throttle-tracker';

describe('throttleTracker', () => {
  it('autenticado: tenantId:actorId', () => {
    expect(throttleTracker({ user: { tenantId: 'acme', actorId: 'u1' }, ip: '1.1.1.1' })).toBe('acme:u1');
  });
  it('mismo usuario desde otra IP comparte cupo; otro tenant no', () => {
    const a = throttleTracker({ user: { tenantId: 'acme', actorId: 'u1' }, ip: '1.1.1.1' });
    expect(throttleTracker({ user: { tenantId: 'acme', actorId: 'u1' }, ip: '2.2.2.2' })).toBe(a);
    expect(throttleTracker({ user: { tenantId: 'otro', actorId: 'u1' }, ip: '1.1.1.1' })).not.toBe(a);
  });
  it('sin usuario o usuario incompleto: IP', () => {
    expect(throttleTracker({ ip: '9.9.9.9' })).toBe('9.9.9.9');
    expect(throttleTracker({ user: { actorId: 'u1' }, ip: '9.9.9.9' })).toBe('9.9.9.9');
    expect(throttleTracker({ socket: { remoteAddress: '8.8.8.8' } })).toBe('8.8.8.8');
    expect(throttleTracker({})).toBe('unknown');
  });
  it('límites por defecto razonables y más estrictos que el global (120)', () => {
    for (const t of [UPLOAD_THROTTLE, ONBOARDING_THROTTLE, AI_THROTTLE]) {
      expect(t.default.limit).toBeGreaterThan(0);
      expect(t.default.limit).toBeLessThan(120);
      expect(t.default.ttl).toBe(60_000);
    }
  });
});
