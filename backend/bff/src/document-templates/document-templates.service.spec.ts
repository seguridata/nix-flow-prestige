/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PDFDocument, PDFRawStream, PDFArray, PDFName, decodePDFRawStream } from 'pdf-lib';
import { DocumentTemplatesService } from './document-templates.service';
import { DocumentTemplatesController } from './document-templates.controller';
import { fillPdf } from './pdf-fill';
import { parseTemplateMeta } from './template-meta';
import { ROLES_KEY } from '../auth/roles.decorator';
import type { Flow } from '../flow/flow.types';
import type { TemplateActor, TemplateField } from './template.types';

/** Texto de contenido (operadores) de una página, ya descomprimido. */
function pageContent(doc: PDFDocument, index: number): string {
  const contents = doc.getPage(index).node.lookup(PDFName.of('Contents'));
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
  return streams
    .map((st) => (st instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(st).decode()).toString('latin1') : ''))
    .join(' ')
    .toUpperCase();
}

async function basePdf(pages = 2): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) pdf.addPage([612, 792]);
  return Buffer.from(await pdf.save());
}

const flow: Flow = {
  order: 'SECUENCIAL',
  slaHours: 48,
  variables: [
    { key: 'nombre', label: 'Nombre', type: 'text', required: true },
    { key: 'dias', label: 'Días', type: 'number', required: true },
    { key: 'inicio', label: 'Inicio', type: 'date', required: false },
  ],
  steps: [
    { id: 'solicitante', label: 'Solicitante', who: { type: 'initiator' }, role: 'FIRMANTE' },
    { id: 'jefe', label: 'Jefe directo', who: { type: 'ask', prompt: '¿Quién es tu jefe?' }, role: 'FIRMANTE' },
    {
      id: 'director',
      label: 'Dirección',
      who: { type: 'fixed', signerId: 'roberto', name: 'Roberto' },
      role: 'FIRMANTE',
      when: [{ variable: 'dias', op: '>', value: 5 }],
    },
    { id: 'rh', label: 'RH', who: { type: 'fixed', signerId: 'rh1' }, role: 'REVISOR' },
  ],
};

const fields: TemplateField[] = [
  { key: 'nombre', label: 'Nombre', type: 'text', required: true, page: 1, x: 0.1, y: 0.1, w: 0.5, h: 0.04, prefill: 'user.name' },
  { key: 'dias', label: 'Días', type: 'number', required: true, page: 1, x: 0.1, y: 0.2, w: 0.2, h: 0.04 },
  { key: 'inicio', label: 'Inicio', type: 'date', required: false, page: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.04, prefill: 'today' },
];

const boxes = [
  { stepId: 'solicitante', page: 2, x: 0.1, y: 0.8, w: 0.3, h: 0.08 },
  { stepId: 'director', page: 2, x: 0.5, y: 0.8, w: 0.3, h: 0.08 },
];

const admin: TemplateActor = { tenantId: 'T', actorId: 'roberto', name: 'Roberto', isAdmin: true };
const empleado: TemplateActor = { tenantId: 'T', actorId: 'maria', name: 'María Pérez', email: 'maria@x.mx', isAdmin: false };

async function setup(over: { published?: boolean; tenantId?: string } = {}) {
  const pdf = await basePdf();
  const row = {
    id: 'tpl1',
    tenantId: over.tenantId ?? 'T',
    name: 'Vacaciones',
    published: over.published ?? true,
    objectKey: 'k',
    enc: {},
    pageCount: 2,
    fields,
    signatureBoxes: boxes,
    flow,
    methods: ['ACCEPT'],
    kycPolicy: 'NONE',
    requirePasskey: false,
    createdBy: 'roberto',
    createdAt: new Date(),
    flowKey: null,
    flowVersion: null,
    description: null,
    category: null,
    hash: 'h',
    sizeBytes: pdf.length,
    updatedAt: new Date(),
  };
  const prisma = {
    documentTemplate: {
      findFirst: vi.fn(async ({ where }: any) => {
        if (where.id && where.id !== row.id) return null;
        if (where.tenantId && where.tenantId !== row.tenantId) return null;
        if (where.published === true && !row.published) return null;
        return row;
      }),
    },
    case: {
      create: vi.fn(async ({ data }: any) => ({ id: 'case1', ...data })),
      findFirst: vi.fn(async () => ({ id: 'caseX' })),
    },
  };
  const storage = { getObject: vi.fn(async () => pdf), putObject: vi.fn(), deleteObject: vi.fn() };
  const documents = { create: vi.fn(async (p: any) => ({ id: 'doc1', bytes: p.bytes })) };
  const requests = {
    create: vi.fn(async (b: any) => ({
      id: 'sr1',
      signers: b.signers.map((s: any, i: number) => ({ ...s, signerId: `canon:${s.signerId}`, sortOrder: i })),
    })),
  };
  const fieldsService = { createMany: vi.fn(async (_d: string, f: any[]) => f) };
  const folders = { assertOwned: vi.fn(async () => undefined) };
  const svc = new DocumentTemplatesService(prisma as any, storage as any, documents as any, requests as any, fieldsService as any, folders as any);
  return { svc, prisma, storage, documents, requests, fieldsService, folders, pdf };
}

describe('instantiate', () => {
  it('rellena el PDF, crea expediente + documento y la solicitud con el flujo resuelto', async () => {
    const { svc, documents, requests, prisma, pdf } = await setup();
    const out = await svc.instantiate('tpl1', { values: { nombre: 'María Pérez', dias: 3 }, askedSigners: { jefe: { signerId: 'carlos' } } }, empleado);

    const bytes: Buffer = documents.create.mock.calls[0]![0].bytes;
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bytes.equals(pdf)).toBe(false);
    expect(prisma.case.create.mock.calls[0]![0].data).toMatchObject({ tenantId: 'T', ownerId: 'maria' });
    expect(prisma.case.create.mock.calls[0]![0].data.title).toContain('Vacaciones — María Pérez');

    const req = requests.create.mock.calls[0]![0];
    expect(req.signers.map((s: any) => s.signerId)).toEqual(['maria', 'carlos', 'rh1']); // sin director: 3 días
    expect(req).toMatchObject({ methods: ['ACCEPT'], order: 'SECUENCIAL', slaHours: 48, requestedBy: 'maria', tenantId: 'T' });
    expect(out).toMatchObject({ caseId: 'case1', documentId: 'doc1', signatureRequestId: 'sr1' });
    expect(out.steps.map((s) => `${s.stepId}:${s.active}`)).toEqual(['solicitante:true', 'jefe:true', 'director:false', 'rh:true']);
  });

  it('con más de 5 días entra el director y su caja de firma se coloca a su nombre', async () => {
    const { svc, requests, fieldsService } = await setup();
    await svc.instantiate('tpl1', { values: { nombre: 'Ana', dias: 8 }, askedSigners: { jefe: { signerId: 'carlos' } } }, empleado);
    expect(requests.create.mock.calls[0]![0].signers.map((s: any) => s.signerId)).toEqual(['maria', 'carlos', 'roberto', 'rh1']);
    const placed = fieldsService.createMany.mock.calls[0]![1];
    expect(placed.map((f: any) => f.signerId)).toEqual(['canon:maria', 'canon:roberto']);
    expect(placed[0]).toMatchObject({ type: 'SIGNATURE', page: 2, xPct: 0.1, widthPct: 0.3 });
  });

  it('sin la persona de un paso «preguntar» responde 400 y no crea nada', async () => {
    const { svc, prisma, documents, requests } = await setup();
    await expect(svc.instantiate('tpl1', { values: { nombre: 'Ana', dias: 2 } }, empleado)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.case.create).not.toHaveBeenCalled();
    expect(documents.create).not.toHaveBeenCalled();
    expect(requests.create).not.toHaveBeenCalled();
  });

  it('valida requeridos y tipos con mensajes en español', async () => {
    const { svc } = await setup();
    const err: any = await svc.instantiate('tpl1', { values: { dias: 'muchos' } }, { ...empleado, name: undefined }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse().errors).toEqual(['Falta «Nombre»', '«Días» debe ser un número']);
  });

  it('aplica el autollenado cuando el valor viene vacío (nombre del usuario)', async () => {
    const { svc, prisma } = await setup();
    await svc.instantiate('tpl1', { values: { dias: 2 }, askedSigners: { jefe: { signerId: 'carlos' } } }, empleado);
    expect(prisma.case.create.mock.calls[0]![0].data.title).toContain('María Pérez');
  });

  it('una persona repetida en el flujo aparece una sola vez', async () => {
    const { svc, requests } = await setup();
    await svc.instantiate('tpl1', { values: { nombre: 'Ana', dias: 2 }, askedSigners: { jefe: { signerId: 'MARIA' } } }, empleado);
    expect(requests.create.mock.calls[0]![0].signers.map((s: any) => s.signerId)).toEqual(['maria', 'rh1']);
  });

  it('un usuario sin rol de remitente puede instanciar (el servicio no exige roles)', async () => {
    const { svc } = await setup();
    await expect(
      svc.instantiate('tpl1', { values: { nombre: 'Ana', dias: 2 }, askedSigners: { jefe: { signerId: 'carlos' } } }, { ...empleado, isAdmin: false }),
    ).resolves.toMatchObject({ signatureRequestId: 'sr1' });
    const proto = DocumentTemplatesController.prototype as any;
    expect(Reflect.getMetadata(ROLES_KEY, proto.instantiate)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, proto.previewFlow ?? proto.preview)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, proto.create)).toEqual(['admin']);
    expect(Reflect.getMetadata(ROLES_KEY, proto.publish)).toEqual(['admin']);
    expect(Reflect.getMetadata(ROLES_KEY, proto.remove)).toEqual(['admin']);
  });

  it('valida la carpeta destino del usuario', async () => {
    const { svc, folders } = await setup();
    await svc.instantiate('tpl1', { values: { nombre: 'Ana', dias: 2 }, askedSigners: { jefe: { signerId: 'c' } }, folderId: 'f1' }, empleado);
    expect(folders.assertOwned).toHaveBeenCalledWith('f1', { tenantId: 'T', ownerId: 'maria' });
  });
});

describe('aislamiento y visibilidad', () => {
  it('otro tenant → 404 en detalle, pdf, preview e instanciar', async () => {
    const { svc } = await setup();
    const otro: TemplateActor = { ...admin, tenantId: 'OTRO' };
    await expect(svc.get('tpl1', otro)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.getPdf('tpl1', otro)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.previewFlow('tpl1', {}, otro)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.instantiate('tpl1', { values: {} }, otro)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('un borrador es 404 para quien no es admin y visible para el admin', async () => {
    const { svc } = await setup({ published: false });
    await expect(svc.get('tpl1', empleado)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.instantiate('tpl1', { values: {} }, empleado)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.get('tpl1', admin)).resolves.toMatchObject({ id: 'tpl1' });
  });

  it('el detalle nunca expone objectKey, enc ni tenantId', async () => {
    const { svc } = await setup();
    const detail = (await svc.get('tpl1', empleado)) as Record<string, unknown>;
    expect(detail).not.toHaveProperty('objectKey');
    expect(detail).not.toHaveProperty('enc');
    expect(detail).not.toHaveProperty('tenantId');
    expect(detail).toHaveProperty('flow');
  });
});

describe('previewFlow', () => {
  it('marca qué pasos aplican y qué variable requerida falta para decidirlo', async () => {
    const { svc } = await setup();
    const none = await svc.previewFlow('tpl1', {}, empleado);
    expect(none.missing).toEqual(['dias']);
    expect(none.steps.find((s) => s.stepId === 'director')!.active).toBe(false);
    const big = await svc.previewFlow('tpl1', { dias: 9 }, empleado);
    expect(big.missing).toEqual([]);
    expect(big.steps.find((s) => s.stepId === 'director')!.active).toBe(true);
  });
});

describe('fillPdf', () => {
  it('imprime el texto en la página indicada (hex de Helvetica) y tolera caracteres fuera de WinAnsi', async () => {
    const base = await basePdf();
    const out = await fillPdf(base, fields, { nombre: 'Ana Ruiz ✓ 日本', dias: '3', inicio: '2026-10-05' });
    expect(out.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    const hex = (t: string) => Buffer.from(t, 'latin1').toString('hex').toUpperCase();
    expect(pageContent(doc, 0)).toContain(hex('Ana Ruiz ? ??')); // lo no codificable pasa a «?»
    expect(pageContent(doc, 0)).toContain(hex('3'));
    expect(pageContent(doc, 1)).toContain(hex('05/10/2026')); // fecha en DD/MM/AAAA, en la página 2
  });

  it('un texto larguísimo no revienta: se reduce y se recorta', async () => {
    const base = await basePdf();
    await expect(fillPdf(base, fields, { nombre: 'X'.repeat(500) })).resolves.toBeInstanceOf(Buffer);
  });
});

describe('parseTemplateMeta', () => {
  const ok = { name: 'Vacaciones', flow, fields, signatureBoxes: boxes, methods: ['ACCEPT'] };

  it('acepta un formato correcto', () => {
    expect(parseTemplateMeta(ok, 2).errors).toEqual([]);
  });

  it('cada campo debe ser una variable del flujo y caer en una página existente', () => {
    const bad = { ...ok, fields: [{ ...fields[0], key: 'fantasma' }, { ...fields[1], page: 3 }] };
    const errs = parseTemplateMeta(bad, 2).errors.join('\n');
    expect(errs).toMatch(/fantasma/);
    expect(errs).toMatch(/página debe estar entre 1 y 2/);
  });

  it('rechaza cajas fuera de página, pasos inexistentes y flujos inválidos', () => {
    expect(parseTemplateMeta({ ...ok, fields: [{ ...fields[0], x: 0.8, w: 0.5 }] }, 2).errors.join()).toMatch(/se sale de la página/);
    expect(parseTemplateMeta({ ...ok, signatureBoxes: [{ ...boxes[0], stepId: 'nadie' }] }, 2).errors.join()).toMatch(/nadie/);
    expect(parseTemplateMeta({ ...ok, flow: { ...flow, steps: [] } }, 2).errors.join()).toMatch(/al menos un paso/);
  });
});
