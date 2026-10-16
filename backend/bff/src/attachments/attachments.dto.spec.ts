import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import { CasesController } from '../cases/cases.controller';
import { ROLES_KEY } from '../auth/roles.decorator';

/**
 * El ValidationPipe global es whitelist + forbidNonWhitelisted + enableImplicitConversion: un DTO al que le falte
 * un campo nuevo responde 400, y un `unknown[]` de objetos sin `@Type(() => Object)` llega como Array de Arrays.
 */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });
const spec = { key: 'cotizaciones', label: 'Cotizaciones', required: true, min: 3, max: 5, accept: ['pdf'], maxSizeMB: 10 };
const flow = { variables: [{ key: 'a', label: 'A', type: 'text', required: true }], steps: [{ id: 's', label: 'S', who: { type: 'initiator' }, role: 'FIRMANTE' }], order: 'SECUENCIAL', slaHours: 24 };

describe('DTOs de anexos con el ValidationPipe global', () => {
  it('UpdateTemplateDto conserva attachmentSpecs como objetos', async () => {
    const { UpdateTemplateDto } = await import('../document-templates/document-templates.controller');
    const out = (await pipe.transform({ attachmentSpecs: [spec] }, { type: 'body', metatype: UpdateTemplateDto })) as { attachmentSpecs: unknown[] };
    expect(Array.isArray(out.attachmentSpecs[0])).toBe(false);
    expect(out.attachmentSpecs[0]).toEqual(spec);
  });

  it('CreateFormDto acepta el cuerpo de un formato digital y rechaza fields/signatureBoxes (los calcula el sistema)', async () => {
    const { CreateFormDto } = await import('../document-templates/document-templates.controller');
    const ok = (await pipe.transform({ name: 'Formato', flow, methods: ['ACCEPT'], attachmentSpecs: [spec] }, { type: 'body', metatype: CreateFormDto })) as { attachmentSpecs: unknown[] };
    expect(ok.attachmentSpecs[0]).toEqual(spec);
    await expect(pipe.transform({ name: 'Formato', flow, fields: [] }, { type: 'body', metatype: CreateFormDto })).rejects.toThrow();
    await expect(pipe.transform({ name: 'Formato', id: 'no-es-uuid' }, { type: 'body', metatype: CreateFormDto })).rejects.toThrow();
  });

  it('instantiate acepta attachments {specKey: [stagedId]} sin perderlos', async () => {
    const { InstantiateDto } = await import('../document-templates/document-templates.controller');
    const out = (await pipe.transform({ values: { a: 'x' }, attachments: { cotizaciones: ['a', 'b'] } }, { type: 'body', metatype: InstantiateDto })) as { attachments: Record<string, string[]> };
    expect(out.attachments).toEqual({ cotizaciones: ['a', 'b'] });
  });
});

describe('GET /cases/:id/attachments', () => {
  it('lo puede pedir cualquier usuario autenticado (la regla es dueño o firmante, no un rol) y delega con la identidad del usuario', async () => {
    expect(Reflect.getMetadata(ROLES_KEY, CasesController.prototype.attachmentsOf)).toBeUndefined();
    const listForCase = vi.fn(async () => []);
    const ctl = new CasesController({} as never, { listForCase } as never);
    await ctl.attachmentsOf('case1', { tenantId: 'T', actorId: 'carlos', name: 'Carlos' } as never);
    expect(listForCase).toHaveBeenCalledWith('case1', { tenantId: 'T', actorId: 'carlos', name: 'Carlos' });
  });
});
