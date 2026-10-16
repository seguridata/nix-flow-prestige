/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { DocumentTemplatesService } from './document-templates.service';
import { defaultSignatureMethods } from './signature-methods';
import { FlowResolverService } from '../lookup-tables/flow-resolver.service';
import { DEFAULT_SIGNATURE_POLICY, type SignatureMethodName } from '../signing/signature-policy';
import type { TemplateActor } from './template.types';

const admin: TemplateActor = { tenantId: 'T', actorId: 'roberto', name: 'Roberto', isAdmin: true };
const maria: TemplateActor = { tenantId: 'T', actorId: 'maria', name: 'María Pérez', email: 'maria@x.mx', isAdmin: false };

const ALL: SignatureMethodName[] = ['DIGITAL', 'AUTOGRAFA', 'BIOMETRICA', 'ACCEPT', 'PASSKEY'];
const SEGURIDATA: SignatureMethodName[] = ['DIGITAL', 'AUTOGRAFA'];

const flow = () => ({
  variables: [{ key: 'campo1', label: 'Campo 1', type: 'text' as const, required: true }],
  steps: [
    { id: 'solicitante', label: 'Solicitante', who: { type: 'initiator' }, role: 'FIRMANTE' },
    { id: 'jefe', label: 'Jefe directo', who: { type: 'ask', prompt: '¿Quién es tu jefe?' }, role: 'FIRMANTE' },
  ],
  order: 'SECUENCIAL',
  slaHours: 48,
});
/** Cuerpo de un formato digital; sin `methods` salvo que se indiquen. */
const body = (over: Record<string, unknown> = {}) => ({ name: 'Solicitud', flow: flow(), kycPolicy: 'NONE', requirePasskey: false, attachmentSpecs: [], ...over });

function setup(initial: SignatureMethodName[] = ALL) {
  const policy = { allowed: [...initial], version: 4 };
  const signaturePolicy = {
    resolve: vi.fn(async () => ({ ...DEFAULT_SIGNATURE_POLICY, version: policy.version, source: 'tenant' as const, allowedMethods: [...policy.allowed] })),
  };
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
  };
  let k = 0;
  const storage: any = {
    putObject: vi.fn(async (o: any) => {
      const key = `${o.prefix}/2026-10-16/u${++k}-${o.filename}`;
      objects.set(key, o.bytes);
      return { objectKey: key, sizeBytes: o.bytes.length, enc: { alg: 'x' } };
    }),
    getObject: vi.fn(async (key: string) => objects.get(key) ?? Buffer.alloc(0)),
    deleteObject: vi.fn(async (key: string) => void objects.delete(key)),
  };
  const documents: any = { create: vi.fn(async (p: any) => ({ id: 'doc1', bytes: p.bytes })) };
  const requests: any = {
    create: vi.fn(async (b: any) => ({ id: 'sr1', signers: b.signers.map((s: any, i: number) => ({ ...s, signerId: `canon:${s.signerId}`, sortOrder: i })) })),
  };
  const fieldsService: any = { createMany: vi.fn(async (_d: string, f: any[]) => f) };
  const folders: any = { assertOwned: vi.fn(async () => undefined) };
  const svc = new DocumentTemplatesService(
    prisma,
    storage,
    documents,
    requests,
    fieldsService,
    folders,
    new FlowResolverService(prisma, { append: vi.fn() } as any),
    undefined as any,
    signaturePolicy as any,
  );
  return { svc, policy, signaturePolicy, prisma, storage, documents, requests, rows };
}

async function pdfFile() {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  return { buffer: Buffer.from(await pdf.save()), originalname: 'base.pdf' };
}
const pdfMeta = (over: Record<string, unknown> = {}) => ({
  name: 'Vacaciones',
  flow: flow(),
  fields: [{ key: 'campo1', label: 'Campo 1', type: 'text', required: true, page: 1, x: 0.1, y: 0.1, w: 0.5, h: 0.04 }],
  signatureBoxes: [{ stepId: 'solicitante', page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.08 }],
  ...over,
});

const nothingCreated = (w: ReturnType<typeof setup>) => {
  expect(w.prisma.case.create).not.toHaveBeenCalled();
  expect(w.documents.create).not.toHaveBeenCalled();
  expect(w.requests.create).not.toHaveBeenCalled();
};

describe('defaultSignatureMethods (función pura)', () => {
  it('permite los tres simples → ACCEPT, AUTOGRAFA, DIGITAL', () => {
    expect(defaultSignatureMethods({ allowedMethods: ALL })).toEqual(['ACCEPT', 'AUTOGRAFA', 'DIGITAL']);
  });
  it('solo DIGITAL y AUTOGRAFA → AUTOGRAFA, DIGITAL', () => {
    expect(defaultSignatureMethods({ allowedMethods: SEGURIDATA })).toEqual(['AUTOGRAFA', 'DIGITAL']);
  });
  it('solo BIOMETRICA → el primer permitido', () => {
    expect(defaultSignatureMethods({ allowedMethods: ['BIOMETRICA'] })).toEqual(['BIOMETRICA']);
    expect(defaultSignatureMethods({ allowedMethods: ['PASSKEY', 'BIOMETRICA'] })).toEqual(['PASSKEY']);
  });
});

describe('métodos de firma contra la política del tenant: al guardar', () => {
  it('create (PDF) con ACCEPT y política DIGITAL+AUTOGRAFA: 400 claro y no guarda nada', async () => {
    const w = setup(SEGURIDATA);
    const err = await w.svc.create(pdfMeta({ methods: ['ACCEPT'] }), await pdfFile(), admin).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain('v4');
    expect(err.message).toContain('ACCEPT');
    expect(err.message).toContain('Métodos permitidos: DIGITAL, AUTOGRAFA');
    expect(err.message).toMatch(/administrador debe cambiar los métodos de firma del formato/);
    expect(w.storage.putObject).not.toHaveBeenCalled();
    expect(w.prisma.documentTemplate.create).not.toHaveBeenCalled();
  });

  it('create (PDF) con un método permitido se guarda tal cual', async () => {
    const w = setup(SEGURIDATA);
    const out: any = await w.svc.create(pdfMeta({ methods: ['DIGITAL'] }), await pdfFile(), admin);
    expect(out.methods).toEqual(['DIGITAL']);
  });

  it('createForm con ACCEPT y política DIGITAL+AUTOGRAFA: 400 y no guarda nada', async () => {
    const w = setup(SEGURIDATA);
    const err = await w.svc.createForm(body({ methods: ['ACCEPT', 'DIGITAL'] }), admin).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toMatch(/no permite los métodos de firma del formato: ACCEPT\./);
    expect(err.message).not.toMatch(/ACCEPT, DIGITAL/); // solo nombra los no permitidos
    expect(w.storage.putObject).not.toHaveBeenCalled();
    expect(w.prisma.documentTemplate.create).not.toHaveBeenCalled();
  });

  it.each([
    ['permite los tres simples (y más)', ALL, ['ACCEPT', 'AUTOGRAFA', 'DIGITAL']],
    ['solo DIGITAL y AUTOGRAFA', SEGURIDATA, ['AUTOGRAFA', 'DIGITAL']],
    ['solo BIOMETRICA', ['BIOMETRICA'] as SignatureMethodName[], ['BIOMETRICA']],
  ])('createForm sin methods, política que %s → guarda %j', async (_n, allowed, expected) => {
    const omitted = await setup(allowed).svc.createForm(body(), admin);
    expect((omitted as any).methods).toEqual(expected);
    const empty = await setup(allowed).svc.createForm(body({ methods: [] }), admin);
    expect((empty as any).methods).toEqual(expected);
  });

  it('create (PDF) sin methods también toma el valor por defecto de la política', async () => {
    const w = setup(SEGURIDATA);
    const out: any = await w.svc.create(pdfMeta(), await pdfFile(), admin);
    expect(out.methods).toEqual(['AUTOGRAFA', 'DIGITAL']);
  });

  it('createForm regenerar: valida los métodos guardados o los que vengan', async () => {
    const w = setup();
    const created: any = await w.svc.createForm(body({ methods: ['ACCEPT'] }), admin);
    w.policy.allowed = [...SEGURIDATA];
    const err = await w.svc.createForm({ id: created.id, ...body({ methods: undefined }) }, admin).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain('ACCEPT');
    const fixed: any = await w.svc.createForm({ id: created.id, methods: ['DIGITAL'] }, admin);
    expect(fixed.methods).toEqual(['DIGITAL']);
  });

  it('update: valida solo si vienen methods; renombrar un formato con métodos viejos no falla', async () => {
    const w = setup();
    const created: any = await w.svc.createForm(body({ methods: ['ACCEPT'] }), admin);
    w.policy.allowed = [...SEGURIDATA];
    const err = await w.svc.update(created.id, { methods: ['ACCEPT'] }, admin).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain('Métodos permitidos: DIGITAL, AUTOGRAFA');
    expect(w.rows.get(created.id).methods).toEqual(['ACCEPT']); // no se tocó

    const renamed: any = await w.svc.update(created.id, { description: 'Otra descripción' }, admin);
    expect(renamed.methods).toEqual(['ACCEPT']);

    const ok: any = await w.svc.update(created.id, { methods: ['AUTOGRAFA'] }, admin);
    expect(ok.methods).toEqual(['AUTOGRAFA']);
  });
});

describe('métodos de firma contra la política del tenant: al publicar', () => {
  it('publicar un formato cuyos métodos ya no permite la política: 400 y sigue sin publicar', async () => {
    const w = setup();
    const created: any = await w.svc.createForm(body({ methods: ['ACCEPT'] }), admin);
    w.policy.allowed = [...SEGURIDATA];
    const err = await w.svc.setPublished(created.id, true, admin).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toMatch(/ACCEPT/);
    expect(err.message).toMatch(/administrador debe cambiar/);
    expect(w.rows.get(created.id).published).toBe(false);
  });

  it('publicar con métodos permitidos funciona; despublicar nunca consulta la política', async () => {
    const w = setup();
    const created: any = await w.svc.createForm(body({ methods: ['DIGITAL'] }), admin);
    expect(((await w.svc.setPublished(created.id, true, admin)) as any).published).toBe(true);
    w.policy.allowed = ['BIOMETRICA'];
    w.signaturePolicy.resolve.mockClear();
    expect(((await w.svc.setPublished(created.id, false, admin)) as any).published).toBe(false);
    expect(w.signaturePolicy.resolve).not.toHaveBeenCalled();
  });
});

describe('instantiate', () => {
  const values = { values: { campo1: 'x' }, askedSigners: { jefe: { signerId: 'carlos' } } };

  async function published(w: ReturnType<typeof setup>, methods: string[]) {
    const created: any = await w.svc.createForm(body({ methods: ['DIGITAL'] }), admin);
    await w.svc.setPublished(created.id, true, admin);
    w.rows.get(created.id).methods = methods; // simula un formato antiguo / de antes del cambio de política
    return created.id as string;
  }

  it('formato antiguo sin methods: usa el valor por defecto de la política, no ACCEPT fijo', async () => {
    const w = setup(SEGURIDATA);
    const id = await published(w, []);
    await w.svc.instantiate(id, values, maria);
    expect(w.requests.create.mock.calls[0]![0].methods).toEqual(['AUTOGRAFA', 'DIGITAL']);
  });

  it('formato antiguo sin methods y política que permite todo: ACCEPT, AUTOGRAFA, DIGITAL', async () => {
    const w = setup(ALL);
    const id = await published(w, []);
    await w.svc.instantiate(id, values, maria);
    expect(w.requests.create.mock.calls[0]![0].methods).toEqual(['ACCEPT', 'AUTOGRAFA', 'DIGITAL']);
  });

  it('formato con métodos vigentes: los usa tal cual', async () => {
    const w = setup(SEGURIDATA);
    const id = await published(w, ['DIGITAL']);
    await w.svc.instantiate(id, values, maria);
    expect(w.requests.create.mock.calls[0]![0].methods).toEqual(['DIGITAL']);
  });

  it('formato cuyos métodos dejaron de estar permitidos: 400 que pide actualizar el formato y no crea nada', async () => {
    const w = setup(SEGURIDATA);
    const id = await published(w, ['ACCEPT']);
    const err = await w.svc.instantiate(id, values, maria).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toMatch(/necesita actualizarse/);
    expect(err.message).toContain('ACCEPT');
    expect(err.message).toContain('permitidos: DIGITAL, AUTOGRAFA');
    expect(err.message).not.toMatch(/^La política del tenant/); // no es el mensaje genérico de la política
    nothingCreated(w);
    expect(w.storage.getObject).not.toHaveBeenCalled();
  });
});
