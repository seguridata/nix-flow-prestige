/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';

const bytes = Buffer.from('%PDF-1.4 anexo');

function setup() {
  const docs: Record<string, any> = {
    main: { id: 'main', caseId: 'caseA', tenantId: 'A', filename: 'f.pdf', hash: 'h0', mimeType: 'application/pdf', attachmentKey: null, objectKey: 'documents/A/caseA/x/main.pdf', enc: {} },
    ann: { id: 'ann', caseId: 'caseA', tenantId: 'A', filename: 'cot.pdf', hash: 'h1', mimeType: 'application/pdf', attachmentKey: 'cotizaciones', objectKey: 'documents/A/caseA/x/cot.pdf', enc: {} },
  };
  const created: any[] = [];
  const prisma: any = {
    case: {
      findUnique: async ({ where }: any) => (where.id === 'caseA' ? { id: 'caseA', tenantId: 'A' } : null),
      findFirst: async ({ where }: any) => (where.id === 'caseA' && where.tenantId === 'A' ? { ownerId: 'ana' } : null),
    },
    signer: {
      count: async ({ where }: any) =>
        where.OR.some((o: any) => o.signerId === 'carlos') && where.signatureRequest.tenantId === 'A' && where.signatureRequest.document.caseId === 'caseA' ? 1 : 0,
    },
    document: {
      findFirst: async ({ where }: any) => {
        const d = docs[where.id];
        return d && d.tenantId === where.tenantId ? d : null;
      },
      findMany: vi.fn(async () => Object.values(docs)),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `new${created.length}`, createdAt: new Date(), presentedObjectKey: null, ...data };
        created.push(row);
        return row;
      }),
    },
  };
  const storage: any = {
    putObject: vi.fn(async (o: any) => ({
      objectKey: `${o.prefix}/2026/u-${o.filename}`,
      sha256: createHash('sha256').update(o.bytes).digest('hex'),
      sizeBytes: o.bytes.length,
      enc: {},
    })),
    getObject: vi.fn(async () => bytes),
  };
  const collab: any = { audit: vi.fn(async () => undefined) };
  return { svc: new DocumentsService(prisma, storage, collab), prisma, storage, collab, created };
}

describe('Documents: anexos (ADR-008)', () => {
  it('create de un anexo: mimeType detectado, congelado, attachmentKey y auditoría sin nombre de archivo', async () => {
    const { svc, storage, created, collab } = setup();
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('x')]);
    const doc = await svc.create({ caseId: 'caseA', filename: 'Mi foto privada.png', bytes: png, tenantId: 'A', actorId: 'ana', attachmentKey: 'soporte', mimeType: 'image/png' });
    expect(storage.putObject).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'image/png', tenantId: 'A', prefix: 'documents/A/caseA' }));
    expect(created[0]).toMatchObject({ attachmentKey: 'soporte', mimeType: 'image/png', locked: true });
    expect(created[0].frozenAt).toBeInstanceOf(Date);
    expect(doc.hash).toMatch(/^[0-9a-f]{64}$/);
    const ev = collab.audit.mock.calls[0][0];
    expect(ev.action).toBe('DOC_UPLOADED');
    expect(JSON.stringify(ev)).not.toContain('Mi foto privada');
    expect(ev.payload).toMatchObject({ attachmentKey: 'soporte', mimeType: 'image/png' });
  });

  it('create de un anexo exige un mimeType de la lista; un documento normal sigue exigiendo PDF y nace sin congelar', async () => {
    const { svc, created } = setup();
    await expect(
      svc.create({ caseId: 'caseA', filename: 'a.exe', bytes: Buffer.from('MZ'), tenantId: 'A', actorId: 'ana', attachmentKey: 'x', mimeType: 'application/x-msdownload' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create({ caseId: 'caseA', filename: 'a.pdf', bytes: Buffer.from('no es pdf'), tenantId: 'A', actorId: 'ana' })).rejects.toBeInstanceOf(BadRequestException);
    await svc.create({ caseId: 'caseA', filename: 'a.pdf', bytes, tenantId: 'A', actorId: 'ana' });
    expect(created[0]).toMatchObject({ locked: false, frozenAt: null, mimeType: 'application/pdf' });
    expect(created[0].attachmentKey).toBeUndefined();
  });

  it('list nunca incluye anexos (no son documentos a firmar)', async () => {
    const { svc, prisma } = setup();
    await svc.list('caseA', 'A');
    expect(prisma.document.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: 'A', caseId: 'caseA', attachmentKey: null });
  });

  it('descarga de un anexo: dueño y firmante sí; ajeno, sin identidad y otro tenant no', async () => {
    const { svc } = setup();
    await expect(svc.getContent('ann', 'A', { actorId: 'ana' })).resolves.toMatchObject({ filename: 'cot.pdf' });
    await expect(svc.getContent('ann', 'A', { actorId: 'carlos' })).resolves.toMatchObject({ hash: 'h1' });
    await expect(svc.getContent('ann', 'A', { actorId: 'zoe' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.getContent('ann', 'A')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.getContent('ann', 'B', { actorId: 'ana' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('get de un anexo sigue la misma regla; los documentos normales siguen abiertos al tenant', async () => {
    const { svc } = setup();
    await expect(svc.get('ann', 'A', { actorId: 'zoe' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.get('ann', 'A', { actorId: 'carlos' })).resolves.toMatchObject({ id: 'ann' });
    // El resto no se cierra: cualquiera del tenant lo lee como hasta hoy.
    await expect(svc.get('main', 'A', { actorId: 'zoe' })).resolves.toMatchObject({ id: 'main' });
    await expect(svc.getContent('main', 'A')).resolves.toMatchObject({ filename: 'f.pdf' });
  });

  it('el controlador pasa la identidad del usuario a la lectura (ni siquiera un admin ajeno lee un anexo)', async () => {
    const { svc } = setup();
    const spy = vi.spyOn(svc, 'getContent');
    const ctl = new DocumentsController(svc);
    const res: any = { status: () => res, setHeader: () => res, end: () => undefined };
    await ctl.getContent('ann', res, { tenantId: 'A', actorId: 'carlos', roles: [] } as any);
    expect(spy).toHaveBeenCalledWith('ann', 'A', { actorId: 'carlos' });
    await expect(ctl.getContent('ann', res, { tenantId: 'A', actorId: 'zoe', roles: ['admin'] } as any)).rejects.toBeInstanceOf(NotFoundException);
  });
});
