/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { DocumentTemplatesService } from './document-templates.service';
import { DocumentTemplatesController } from './document-templates.controller';
import { FlowResolverService } from '../lookup-tables/flow-resolver.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { FakeRedis, pdfBytes, pngBytes, sha } from '../attachments/attachments.fixtures';
import { ROLES_KEY } from '../auth/roles.decorator';
import { DEFAULT_SIGNATURE_POLICY } from '../signing/signature-policy';
import type { TemplateActor } from './template.types';

const admin: TemplateActor = { tenantId: 'T', actorId: 'roberto', name: 'Roberto', isAdmin: true };
const maria: TemplateActor = { tenantId: 'T', actorId: 'maria', name: 'María Pérez', email: 'maria@x.mx', isAdmin: false };
const otroTenant: TemplateActor = { tenantId: 'OTRO', actorId: 'zoe', name: 'Zoe', isAdmin: true };

const variables = (n = 3) => Array.from({ length: n }, (_, i) => ({ key: `campo${i + 1}`, label: `Campo ${i + 1}`, type: 'text' as const, required: i === 0 }));
const flow = (n = 3) => ({
  variables: variables(n),
  steps: [
    { id: 'solicitante', label: 'Solicitante', who: { type: 'initiator' }, role: 'FIRMANTE' },
    { id: 'jefe', label: 'Jefe directo', who: { type: 'ask', prompt: '¿Quién es tu jefe?' }, role: 'FIRMANTE' },
  ],
  order: 'SECUENCIAL',
  slaHours: 48,
});
const specs = [{ key: 'cotizaciones', label: 'Cotizaciones', required: true, min: 3, max: 4, accept: ['pdf', 'image'], maxSizeMB: 5 }];
const body = (over: Record<string, unknown> = {}) => ({ name: 'Solicitud de compra', flow: flow(), methods: ['ACCEPT'], kycPolicy: 'NONE', requirePasskey: false, attachmentSpecs: specs, ...over });

function setup() {
  const rows = new Map<string, any>();
  const objects = new Map<string, Buffer>();
  let n = 0;
  const prisma: any = {
    documentTemplate: {
      findFirst: vi.fn(async ({ where }: any) =>
        [...rows.values()].find(
          (r) =>
            (!where.id || r.id === where.id) &&
            (!where.tenantId || r.tenantId === where.tenantId) &&
            (where.published === undefined || r.published === where.published) &&
            (!where.name || r.name.toLowerCase() === String(where.name.equals).toLowerCase()),
        ) ?? null,
      ),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `tpl${++n}`, createdAt: new Date(), updatedAt: new Date(), flowKey: null, flowVersion: null, ...data };
        rows.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        rows.set(where.id, { ...rows.get(where.id), ...data });
        return rows.get(where.id);
      }),
    },
    lookupTable: { findMany: vi.fn(async () => []) },
    case: { create: vi.fn(async ({ data }: any) => ({ id: 'case1', ...data })), findFirst: vi.fn(async () => ({ id: 'caseX' })) },
    document: { findMany: vi.fn(async () => []) },
  };
  let k = 0;
  const storage: any = {
    putObject: vi.fn(async (o: any) => {
      const key = `${o.prefix}/2026-10-16/u${++k}-${o.filename}`;
      objects.set(key, o.bytes);
      return { objectKey: key, sha256: sha(o.bytes), sizeBytes: o.bytes.length, enc: { alg: 'x' } };
    }),
    getObject: vi.fn(async (key: string) => objects.get(key) ?? Buffer.alloc(0)),
    deleteObject: vi.fn(async (key: string) => void objects.delete(key)),
  };
  let d = 0;
  const documents: any = {
    create: vi.fn(async (p: any) => ({ id: `doc${++d}`, hash: sha(p.bytes), sizeBytes: p.bytes.length, mimeType: p.mimeType ?? 'application/pdf' })),
    participatesInCase: vi.fn(async () => true),
  };
  const requests: any = {
    create: vi.fn(async (b: any) => ({ id: 'sr1', signers: b.signers.map((s: any, i: number) => ({ ...s, signerId: `canon:${s.signerId}`, sortOrder: i })) })),
  };
  const fieldsService: any = { createMany: vi.fn(async (_d: string, f: any[]) => f) };
  const folders: any = { assertOwned: vi.fn(async () => undefined) };
  const audit = { append: vi.fn(async () => undefined) };
  const collab = { audit: vi.fn(async () => undefined) };
  const redis = new FakeRedis();
  const attachments = new AttachmentsService(prisma, storage, { client: () => redis, enabled: true } as any, documents, collab as any);
  const svc = new DocumentTemplatesService(prisma, storage, documents, requests, fieldsService, folders, new FlowResolverService(prisma, audit as any), attachments, { resolve: vi.fn(async () => ({ ...DEFAULT_SIGNATURE_POLICY })) } as any);
  return { svc, prisma, storage, objects, documents, requests, fieldsService, collab, redis, attachments, rows };
}

const stage = (svc: DocumentTemplatesService, id: string, key: string, buf: Buffer, actor = maria, name = 'c.pdf') => svc.stageAttachment(id, key, { buffer: buf, originalname: name }, actor);

describe('POST /document-templates/form (formato digital)', () => {
  it('es solo de admin y va antes de :id', () => {
    expect(Reflect.getMetadata(ROLES_KEY, DocumentTemplatesController.prototype.createForm)).toEqual(['admin']);
  });

  it('crea un FORM sin PDF subido: hoja base generada, campos y cajas calculados, cifrado bajo el tenant', async () => {
    const { svc, prisma, storage, objects } = setup();
    const out: any = await svc.createForm(body(), admin);

    expect(out).toMatchObject({ name: 'Solicitud de compra', kind: 'FORM', published: false, pageCount: 1 });
    expect(out.objectKey).toBeUndefined();
    expect(out.enc).toBeUndefined();
    expect(out.fields.map((f: any) => f.key)).toEqual(['campo1', 'campo2', 'campo3']);
    expect(out.signatureBoxes.map((b: any) => b.stepId)).toEqual(['solicitante', 'jefe']);
    expect(out.attachmentSpecs).toEqual(specs);

    const put = storage.putObject.mock.calls[0]![0];
    expect(put).toMatchObject({ prefix: 'templates/T', tenantId: 'T', contentType: 'application/pdf' });
    expect(put.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const data = prisma.documentTemplate.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ kind: 'FORM', tenantId: 'T', createdBy: 'roberto', published: false, pageCount: 1 });
    expect(data.hash).toBe(createHash('sha256').update(put.bytes).digest('hex'));
    expect(data.objectKey).toMatch(/^templates\/T\//);
    expect((await PDFDocument.load(objects.get(data.objectKey)!)).getPageCount()).toBe(1);
  });

  it('con muchas variables genera varias páginas y los campos apuntan a ellas', async () => {
    const { svc } = setup();
    const out: any = await svc.createForm(body({ flow: flow(60), attachmentSpecs: [] }), admin);
    expect(out.pageCount).toBeGreaterThan(1);
    expect(Math.max(...out.fields.map((f: any) => f.page))).toBeGreaterThan(1);
  });

  it('valida el flujo, los anexos y el tope de variables; no guarda nada si falla', async () => {
    const { svc, storage, prisma } = setup();
    await expect(svc.createForm(body({ flow: { variables: [], steps: [], order: 'SECUENCIAL', slaHours: 1 } }), admin)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.createForm(body({ name: 'x' }), admin)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.createForm(body({ attachmentSpecs: [{ ...specs[0], max: 21 }] }), admin)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.createForm(body({ flow: flow(101) }), admin)).rejects.toThrow(/hasta 100 variables/);
    const tooMany = { ...flow(2), steps: Array.from({ length: 21 }, (_, i) => ({ id: `p${i}`, label: `P${i}`, who: { type: 'initiator' }, role: 'FIRMANTE' })) };
    await expect(svc.createForm(body({ flow: tooMany }), admin)).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(prisma.documentTemplate.create).not.toHaveBeenCalled();
  });

  it('un nombre repetido responde 409 sin guardar el PDF', async () => {
    const { svc, storage } = setup();
    await svc.createForm(body(), admin);
    storage.putObject.mockClear();
    await expect(svc.createForm(body({ name: 'SOLICITUD DE COMPRA' }), admin)).rejects.toBeInstanceOf(ConflictException);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('con id regenera la hoja (nuevo PDF, borra el anterior) y recalcula campos y cajas', async () => {
    const { svc, storage, objects, prisma } = setup();
    const created: any = await svc.createForm(body(), admin);
    const oldKey = prisma.documentTemplate.create.mock.calls[0]![0].data.objectKey;
    const out: any = await svc.createForm({ id: created.id, flow: flow(5) }, admin);
    expect(out.fields).toHaveLength(5);
    expect(out.id).toBe(created.id);
    expect(storage.deleteObject).toHaveBeenCalledWith(oldKey, 'T');
    expect(objects.has(oldKey)).toBe(false);
    expect(out.attachmentSpecs).toEqual(specs); // lo que no viene se conserva
  });

  it('un FORM publicado no se regenera (409) y no se toca el storage', async () => {
    const { svc, storage } = setup();
    const created: any = await svc.createForm(body(), admin);
    await svc.setPublished(created.id, true, admin);
    storage.putObject.mockClear();
    storage.deleteObject.mockClear();
    await expect(svc.createForm({ id: created.id, flow: flow(5) }, admin)).rejects.toBeInstanceOf(ConflictException);
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
    // Despublicado vuelve a poder regenerarse.
    await svc.setPublished(created.id, false, admin);
    await expect(svc.createForm({ id: created.id, flow: flow(5) }, admin)).resolves.toBeDefined();
  });

  it('un formato con PDF propio no se regenera; uno de otro tenant es 404', async () => {
    const { svc, rows } = setup();
    const created: any = await svc.createForm(body(), admin);
    rows.get(created.id).kind = 'PDF';
    await expect(svc.createForm({ id: created.id }, admin)).rejects.toBeInstanceOf(BadRequestException);
    rows.get(created.id).kind = 'FORM';
    await expect(svc.createForm({ id: created.id }, otroTenant)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('PUT sobre un FORM: publicado + cambiar flujo/anexos → 409; el mismo flujo con otro orden de llaves no cuenta; despublicado regenera', async () => {
    const { svc, storage } = setup();
    const created: any = await svc.createForm(body(), admin);
    await svc.setPublished(created.id, true, admin);
    await expect(svc.update(created.id, { flow: flow(4) }, admin)).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.update(created.id, { attachmentSpecs: [{ ...specs[0], max: 2 }] }, admin)).rejects.toBeInstanceOf(ConflictException);
    // jsonb reordena las llaves: el mismo contenido no es un cambio.
    const reordered = JSON.parse(JSON.stringify(flow())) as any;
    reordered.steps = reordered.steps.map((s: any) => Object.fromEntries(Object.entries(s).reverse()));
    await expect(svc.update(created.id, { flow: reordered, category: 'Compras' }, admin)).resolves.toMatchObject({ category: 'Compras' });

    await svc.setPublished(created.id, false, admin);
    storage.putObject.mockClear();
    const out: any = await svc.update(created.id, { attachmentSpecs: [{ ...specs[0], max: 2, min: 2 }] }, admin);
    expect(storage.putObject).toHaveBeenCalledTimes(1);
    expect(out.attachmentSpecs[0]).toMatchObject({ min: 2, max: 2 });
  });

  it('PUT no deja editar a mano los campos de un FORM', async () => {
    const { svc } = setup();
    const created: any = await svc.createForm(body(), admin);
    const out: any = await svc.update(created.id, { fields: [], category: 'X' }, admin);
    expect(out.fields).toHaveLength(3);
  });
});

describe('attachmentSpecs en el alta y la edición de un formato con PDF', () => {
  async function pdf() {
    const p = await PDFDocument.create();
    p.addPage([612, 792]);
    return Buffer.from(await p.save());
  }
  const field = { key: 'campo1', label: 'C', type: 'text', required: true, page: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.04 };
  const meta = (over: Record<string, unknown> = {}) => ({ ...body(), fields: [field], signatureBoxes: [], ...over });

  it('create guarda las especificaciones (kind PDF por omisión) y rechaza las inválidas', async () => {
    const { svc, prisma } = setup();
    await svc.create(meta(), { buffer: await pdf() }, admin);
    expect(prisma.documentTemplate.create.mock.calls[0]![0].data.attachmentSpecs).toEqual(specs);
    expect(prisma.documentTemplate.create.mock.calls[0]![0].data.kind).toBeUndefined(); // default de la columna: 'PDF'
    await expect(svc.create(meta({ name: 'Otro formato', attachmentSpecs: [{ ...specs[0], accept: ['exe'] }] }), { buffer: await pdf() }, admin)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update de un formato con PDF cambia las especificaciones aunque esté publicado', async () => {
    const { svc, rows } = setup();
    const created: any = await svc.create(meta(), { buffer: await pdf() }, admin);
    await svc.setPublished(created.id, true, admin);
    const out: any = await svc.update(created.id, { attachmentSpecs: [{ ...specs[0], key: 'otra' }] }, admin);
    expect(out.attachmentSpecs[0].key).toBe('otra');
    expect(rows.get(created.id).kind).toBeUndefined();
    await expect(svc.update(created.id, { attachmentSpecs: [{ ...specs[0] }, { ...specs[0] }] }, admin)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('POST /document-templates/:id/attachments', () => {
  it('es para cualquier usuario autenticado (sin @Roles) y con el throttle de subidas', () => {
    expect(Reflect.getMetadata(ROLES_KEY, DocumentTemplatesController.prototype.stageAttachment)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, DocumentTemplatesController.prototype.discardAttachment)).toBeUndefined();
    const keys = Reflect.getMetadataKeys(DocumentTemplatesController.prototype.stageAttachment).map(String);
    expect(keys.some((k) => /THROTTLER/i.test(k))).toBe(true);
  });

  it('solo formatos publicados', async () => {
    const { svc } = setup();
    const created: any = await svc.createForm(body(), admin);
    await expect(stage(svc, created.id, 'cotizaciones', pdfBytes(), maria)).rejects.toBeInstanceOf(NotFoundException); // borrador
    await svc.setPublished(created.id, true, admin);
    await expect(stage(svc, created.id, 'cotizaciones', pdfBytes(), maria)).resolves.toMatchObject({ mime: 'application/pdf' });
    await expect(stage(svc, created.id, 'cotizaciones', pdfBytes(), { ...maria, tenantId: 'OTRO' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('instantiate con anexos', () => {
  async function published() {
    const ctx = setup();
    const created: any = await ctx.svc.createForm(body(), admin);
    await ctx.svc.setPublished(created.id, true, admin);
    return { ...ctx, id: created.id as string };
  }
  const input = (attachments: Record<string, string[]>, over: Record<string, unknown> = {}) => ({
    values: { campo1: 'Compra de laptops' },
    askedSigners: { jefe: { signerId: 'carlos' } },
    attachments,
    ...over,
  });
  const stageN = async (ctx: Awaited<ReturnType<typeof published>>, n: number, actor = maria) => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) ids.push((await stage(ctx.svc, ctx.id, 'cotizaciones', pdfBytes(`% ${i}`), actor, `cot${i}.pdf`)).stagedId);
    return ids;
  };

  it('éxito: crea la solicitud y N Documents del mismo expediente con attachmentKey, y audita ATTACHMENTS_ADDED', async () => {
    const ctx = await published();
    const ids = await stageN(ctx, 3);
    const out: any = await ctx.svc.instantiate(ctx.id, input({ cotizaciones: ids }), maria);

    const calls = ctx.documents.create.mock.calls.map((c: any[]) => c[0]);
    expect(calls).toHaveLength(4); // 1 principal + 3 anexos
    expect(calls[0].attachmentKey).toBeUndefined();
    const anexos = calls.slice(1);
    expect(anexos.every((c: any) => c.attachmentKey === 'cotizaciones' && c.caseId === 'case1' && c.tenantId === 'T' && c.mimeType === 'application/pdf')).toBe(true);
    expect(out.attachments).toHaveLength(3);
    expect(out.attachments[0]).toMatchObject({ attachmentKey: 'cotizaciones', documentId: expect.any(String), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });

    const ev = ctx.collab.audit.mock.calls.map((c: any[]) => c[0]).find((e: any) => e.action === 'ATTACHMENTS_ADDED');
    expect(ev).toMatchObject({ tenantId: 'T', actorId: 'maria', signatureRequestId: 'sr1', documentId: 'doc1' });
    expect(ev.payload.specs.cotizaciones.count).toBe(3);
    expect(JSON.stringify(ev)).not.toMatch(/cot\d\.pdf/);
    // Las cargas previas ya no existen y los anexos no son firmantes ni cajas de firma.
    expect([...ctx.redis.kv.keys()].filter((k) => k.startsWith('attach:staged:'))).toEqual([]);
    expect(ctx.requests.create).toHaveBeenCalledTimes(1);
    expect(ctx.requests.create.mock.calls[0]![0].documentId).toBe('doc1');
  });

  it('mínimo no cumplido → 400 y NO se crea nada (ni expediente, ni documentos, ni solicitud), y las cargas siguen vigentes', async () => {
    const ctx = await published();
    const ids = await stageN(ctx, 2);
    const err: any = await ctx.svc.instantiate(ctx.id, input({ cotizaciones: ids }), maria).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify(err.getResponse())).toMatch(/al menos 3/);
    expect(ctx.prisma.case.create).not.toHaveBeenCalled();
    expect(ctx.documents.create).not.toHaveBeenCalled();
    expect(ctx.requests.create).not.toHaveBeenCalled();
    expect([...ctx.redis.kv.keys()].filter((k) => k.startsWith('attach:used:'))).toEqual([]);
    expect([...ctx.redis.kv.keys()].filter((k) => k.startsWith('attach:staged:'))).toHaveLength(2);
  });

  it('sin anexos requeridos (omitidos) → 400 y no crea nada', async () => {
    const ctx = await published();
    await expect(ctx.svc.instantiate(ctx.id, { values: { campo1: 'x' }, askedSigners: { jefe: { signerId: 'c' } } }, maria)).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.documents.create).not.toHaveBeenCalled();
  });

  it('máximo excedido, tipo no aceptado y carga de otro usuario o de otro anexo → 400 sin crear nada', async () => {
    const ctx = await published();
    const five = await stageN(ctx, 4);
    const sixth = (await stage(ctx.svc, ctx.id, 'cotizaciones', pdfBytes('% x'), { ...maria, actorId: 'beto' })).stagedId;
    for (const sel of [{ cotizaciones: [...five, 'no-existe'] }, { cotizaciones: [...five.slice(0, 2), sixth] }, { cotizaciones: five.slice(0, 2), fantasma: ['x'] }]) {
      await expect(ctx.svc.instantiate(ctx.id, input(sel as any), maria)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(ctx.prisma.case.create).not.toHaveBeenCalled();
    expect(ctx.documents.create).not.toHaveBeenCalled();
  });

  it('la misma carga no se usa dos veces: de dos solicitudes simultáneas solo una prospera', async () => {
    const ctx = await published();
    const ids = await stageN(ctx, 3);
    const results = await Promise.allSettled([ctx.svc.instantiate(ctx.id, input({ cotizaciones: ids }), maria), ctx.svc.instantiate(ctx.id, input({ cotizaciones: ids }), maria)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(ctx.prisma.case.create).toHaveBeenCalledTimes(1);
    expect(ctx.documents.create).toHaveBeenCalledTimes(4);
    // Y ya consumidas, un tercer intento no las encuentra.
    await expect(ctx.svc.instantiate(ctx.id, input({ cotizaciones: ids }), maria)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('si falla la creación del documento principal se liberan las reservas y se puede reintentar', async () => {
    const ctx = await published();
    const ids = await stageN(ctx, 3);
    ctx.documents.create.mockRejectedValueOnce(new Error('storage caído'));
    await expect(ctx.svc.instantiate(ctx.id, input({ cotizaciones: ids }), maria)).rejects.toThrow('storage caído');
    expect([...ctx.redis.kv.keys()].filter((k) => k.startsWith('attach:used:'))).toEqual([]);
    await expect(ctx.svc.instantiate(ctx.id, input({ cotizaciones: ids }), maria)).resolves.toMatchObject({ signatureRequestId: 'sr1' });
  });

  it('un formato sin especificaciones sigue funcionando sin tocar los anexos', async () => {
    const ctx = setup();
    const created: any = await ctx.svc.createForm(body({ attachmentSpecs: [] }), admin);
    await ctx.svc.setPublished(created.id, true, admin);
    const out: any = await ctx.svc.instantiate(created.id, { values: { campo1: 'x' }, askedSigners: { jefe: { signerId: 'c' } } }, maria);
    expect(out.attachments).toEqual([]);
    expect(ctx.documents.create).toHaveBeenCalledTimes(1);
    await expect(ctx.svc.instantiate(created.id, { values: { campo1: 'x' }, askedSigners: { jefe: { signerId: 'c' } }, attachments: { a: ['b'] } }, maria)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el PDF base generado se rellena con los datos (el pipeline de fillPdf no cambia)', async () => {
    const ctx = await published();
    const ids = await stageN(ctx, 3);
    await ctx.svc.instantiate(ctx.id, input({ cotizaciones: ids }), maria);
    const main: Buffer = ctx.documents.create.mock.calls[0]![0].bytes;
    expect(main.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect((await PDFDocument.load(main)).getPageCount()).toBe(1);
  });

  it('una imagen aceptada se materializa con su mimeType real', async () => {
    const ctx = await published();
    const ids = [
      ...(await stageN(ctx, 2)),
      (await stage(ctx.svc, ctx.id, 'cotizaciones', pngBytes(), maria, 'captura.pdf')).stagedId,
    ];
    await ctx.svc.instantiate(ctx.id, input({ cotizaciones: ids }), maria);
    const mimes = ctx.documents.create.mock.calls.slice(1).map((c: any[]) => c[0].mimeType);
    expect(mimes).toEqual(['application/pdf', 'application/pdf', 'image/png']);
    expect(ctx.documents.create.mock.calls[3]![0].filename).toBe('captura.png');
  });
});
