import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import { parseTemplateMeta } from './template-meta';

/**
 * Regresión: el ValidationPipe global usa enableImplicitConversion y convertía cada campo del
 * formato en un Array, así que guardar un formato ya creado fallaba con «formato inválido».
 */
describe('UpdateTemplateDto con el ValidationPipe global', () => {
  it('conserva los campos como objetos', async () => {
    const { UpdateTemplateDto } = await import('./document-templates.controller');
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });
    const field = { key: 'dato_1', label: 'N', type: 'text', required: true, page: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.03 };
    const flow = { variables: [{ key: 'dato_1', label: 'N', type: 'text', required: true }], steps: [{ id: 'a', label: 'x', who: { type: 'initiator' }, role: 'FIRMANTE' }], order: 'SECUENCIAL', slaHours: 72 };
    const out = (await pipe.transform({ name: 'Solicitud', fields: [field], flow }, { type: 'body', metatype: UpdateTemplateDto })) as { fields: unknown[] };
    expect(Array.isArray(out.fields[0])).toBe(false);
    expect(parseTemplateMeta({ ...out, methods: ['AUTOGRAFA'], kycPolicy: 'NONE', requirePasskey: false }, 1).errors).toEqual([]);
  });
});
