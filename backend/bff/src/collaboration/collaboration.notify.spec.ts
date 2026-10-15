import { describe, expect, it, vi } from 'vitest';
import { CollaborationService } from './collaboration.service';

describe('CollaborationService.notify', () => {
  it('persiste la notificación con el tenantId', async () => {
    const create = vi.fn(async () => ({}));
    const svc = new CollaborationService({ userNotification: { create } } as never, {} as never);
    await svc.notify('u1', 'T', 'B', '/inbox', 'acme');
    expect(create).toHaveBeenCalledWith({ data: { userId: 'u1', title: 'T', body: 'B', href: '/inbox', tenantId: 'acme' } });
  });
});
