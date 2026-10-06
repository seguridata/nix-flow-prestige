import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { EvidenceController } from './evidence.controller';

const user = { tenantId: 't1' } as never;

describe('EvidenceController.byRequest', () => {
  it('404 cuando no hay evidencia (solicitud ajena o sin evidencia, sin distinguir)', async () => {
    const evidence = { findByRequest: vi.fn(async () => null) };
    const ctrl = new EvidenceController(evidence as never);
    await expect(ctrl.byRequest('sr-1', user)).rejects.toBeInstanceOf(NotFoundException);
    expect(evidence.findByRequest).toHaveBeenCalledWith('sr-1', 't1');
  });

  it('devuelve el manifiesto cuando existe', async () => {
    const manifest = { manifestId: 'm1' };
    const ctrl = new EvidenceController({ findByRequest: vi.fn(async () => manifest) } as never);
    await expect(ctrl.byRequest('sr-1', user)).resolves.toBe(manifest);
  });
});
