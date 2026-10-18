import { describe, expect, it } from 'vitest';
import { cloudEvent, EVENT_TYPES } from './cloud-events';

describe('cloudEvent', () => {
  it('usa el tenant recibido en `tenantid`', () => {
    const e = cloudEvent({ type: EVENT_TYPES.requestCompleted, tenantId: 'acme', data: { ok: true } });
    expect(e.tenantid).toBe('acme');
  });

  it('sin tenant NO atribuye el evento a "seguridata": falla', () => {
    expect(() => cloudEvent({ type: 'x', data: {} } as never)).toThrow(/tenantId/);
    expect(() => cloudEvent({ type: 'x', tenantId: '', data: {} })).toThrow(/tenantId/);
  });
});
