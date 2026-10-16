/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AttachmentsService, STAGING_TTL_MS, type AttachmentActor } from './attachments.service';
import { DocumentsService } from '../documents/documents.service';
import { FakeRedis, docxBytes, exeBytes, htmlBytes, pdfBytes, pngBytes, sha, svgBytes } from './attachments.fixtures';

const A: AttachmentActor = { tenantId: 'T', actorId: 'ana', name: 'Ana' };
const spec = { key: 'cotizaciones', label: 'Cotizaciones', required: true, min: 2, max: 3, accept: ['pdf', 'image'], maxSizeMB: 1 };
const spec2 = { key: 'soporte', label: 'Soporte', required: false, min: 0, max: 2, accept: ['any'], maxSizeMB: 1 };

function setup(over: { published?: boolean; specs?: unknown[] } = {}) {
  const redis = new FakeRedis();
  const objects = new Map<string, Buffer>();
  let n = 0;
  const storage = {
    putObject: vi.fn(async (o: any) => {
      const key = `${o.prefix}/2026-10-16/u${++n}-${o.filename}`;
      objects.set(key, o.bytes);
      return { objectKey: key, sha256: sha(o.bytes), sizeBytes: o.bytes.length, enc: { alg: 'x' } };
    }),
    getObject: vi.fn(async (key: string) => {
      const b = objects.get(key);
      if (!b) throw new Error('no existe');
      return b;
    }),
    deleteObject: vi.fn(async (key: string) => void objects.delete(key)),
  };
  const template = { id: 'tpl1', tenantId: 'T', published: over.published ?? true, attachmentSpecs: over.specs ?? [spec, spec2] };
  const prisma = {
    documentTemplate: {
      findFirst: vi.fn(async ({ where }: any) => {
        if (where.id !== template.id || where.tenantId !== template.tenantId) return null;
        if (where.published === true && !template.published) return null;
        return template;
      }),
    },
    document: { findMany: vi.fn(async () => []) },
  };
  let d = 0;
  const documents = {
    create: vi.fn(async (p: any) => ({ id: `doc${++d}`, hash: sha(p.bytes), sizeBytes: p.bytes.length, mimeType: p.mimeType })),
    participatesInCase: vi.fn(async () => true),
  };
  const collab = { audit: vi.fn(async () => undefined) };
  const svc = new AttachmentsService(prisma as any, storage as any, { client: () => redis, enabled: true } as any, documents as any, collab as any);
  return { svc, redis, storage, objects, prisma, documents, collab, template };
}

const file = (buffer: Buffer, originalname = 'archivo.pdf') => ({ buffer, originalname });

describe('stage (carga previa)', () => {
  it('acepta un PDF real, lo cifra bajo el prefijo del tenant y devuelve {stagedId,name,size,mime,sha256}', async () => {
    const { svc, storage, redis } = setup();
    const bytes = pdfBytes();
    const r = await svc.stage('tpl1', 'cotizaciones', file(bytes, 'Cot 1.pdf'), A);
    expect(r).toMatchObject({ name: 'Cot 1.pdf', size: bytes.length, mime: 'application/pdf', sha256: sha(bytes) });
    expect(r.stagedId).toMatch(/^[0-9a-f-]{36}$/);
    const put = storage.putObject.mock.calls[0]![0];
    expect(put).toMatchObject({ prefix: 'documents/T/staged', tenantId: 'T', contentType: 'application/pdf' });
    // El estado vive en Redis, con vigencia de 24 h.
    const meta = JSON.parse(redis.kv.get(`attach:staged:T:${r.stagedId}`)!);
    expect(meta).toMatchObject({ tenantId: 'T', actorId: 'ana', templateId: 'tpl1', specKey: 'cotizaciones' });
    expect(meta.expiresAt - meta.createdAt).toBe(STAGING_TTL_MS);
  });

  it('el tipo se decide por CONTENIDO: extensión .pdf con un PNG dentro no pasa donde solo se acepta PDF', async () => {
    const { svc, storage } = setup({ specs: [{ ...spec, accept: ['pdf'] }] });
    await expect(svc.stage('tpl1', 'cotizaciones', file(pngBytes(), 'foto.pdf'), A)).rejects.toThrow(/se detectó PNG/);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('un PDF real con extensión mentirosa .exe se acepta y se guarda con extensión .pdf', async () => {
    const { svc } = setup();
    const r = await svc.stage('tpl1', 'cotizaciones', file(pdfBytes(), 'cotizacion.exe'), A);
    expect(r.name).toBe('cotizacion.pdf');
  });

  it('ignora el mimetype que declare el cliente', async () => {
    const { svc } = setup();
    await expect(svc.stage('tpl1', 'cotizaciones', { buffer: exeBytes(), originalname: 'a.pdf', mimetype: 'application/pdf' } as any, A)).rejects.toThrow(/ejecutables/);
  });

  it('rechaza ejecutables, html y svg aunque se llamen .pdf (y no guarda nada)', async () => {
    const { svc, storage } = setup({ specs: [{ ...spec, accept: ['any'] }] });
    for (const b of [exeBytes(), htmlBytes(), svgBytes()]) {
      await expect(svc.stage('tpl1', 'cotizaciones', file(b, 'x.pdf'), A)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('rechaza un tipo que la especificación no acepta (Word donde solo hay PDF)', async () => {
    const { svc } = setup({ specs: [{ ...spec, accept: ['pdf'] }] });
    await expect(svc.stage('tpl1', 'cotizaciones', file(docxBytes(), 'a.pdf'), A)).rejects.toThrow(/no acepta este tipo/);
  });

  it('tamaño: más de maxSizeMB responde 413; vacío, 400', async () => {
    const { svc } = setup();
    const big = Buffer.concat([pdfBytes(), Buffer.alloc(1024 * 1024)]);
    await expect(svc.stage('tpl1', 'cotizaciones', file(big), A)).rejects.toMatchObject({ status: 413 });
    await expect(svc.stage('tpl1', 'cotizaciones', file(Buffer.alloc(0)), A)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.stage('tpl1', 'cotizaciones', undefined, A)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('límite de archivos por especificación (max) y se libera al quitar uno', async () => {
    const { svc } = setup();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await svc.stage('tpl1', 'cotizaciones', file(pdfBytes(`% ${i}`)), A)).stagedId);
    await expect(svc.stage('tpl1', 'cotizaciones', file(pdfBytes('% 4')), A)).rejects.toBeInstanceOf(ConflictException);
    await svc.discard(ids[0]!, A);
    await expect(svc.stage('tpl1', 'cotizaciones', file(pdfBytes('% 5')), A)).resolves.toBeDefined();
  });

  it('specKey desconocido o ausente → 400; formato en borrador u de otro tenant → 404', async () => {
    const { svc } = setup();
    await expect(svc.stage('tpl1', 'nope', file(pdfBytes()), A)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.stage('tpl1', undefined, file(pdfBytes()), A)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.stage('tpl1', 'cotizaciones', file(pdfBytes()), { ...A, tenantId: 'OTRO' })).rejects.toBeInstanceOf(NotFoundException);
    const draft = setup({ published: false });
    await expect(draft.svc.stage('tpl1', 'cotizaciones', file(pdfBytes()), A)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sin Redis no hay staging (503), nunca estado en el proceso', async () => {
    const { svc } = setup();
    (svc as any).redis = { client: () => null, enabled: false };
    await expect(svc.stage('tpl1', 'cotizaciones', file(pdfBytes()), A)).rejects.toMatchObject({ status: 503 });
  });
});

describe('discard', () => {
  it('otro usuario u otro tenant no puede quitar una carga ajena (404), y no se toca el storage', async () => {
    const { svc, storage } = setup();
    const { stagedId } = await svc.stage('tpl1', 'cotizaciones', file(pdfBytes()), A);
    await expect(svc.discard(stagedId, { ...A, actorId: 'beto' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.discard(stagedId, { ...A, tenantId: 'OTRO' })).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.deleteObject).not.toHaveBeenCalled();
    await svc.discard(stagedId, A);
    expect(storage.deleteObject).toHaveBeenCalledTimes(1);
  });

  it('una carga ya reservada por una solicitud no se puede quitar (409)', async () => {
    const { svc } = setup();
    const { stagedId } = await svc.stage('tpl1', 'cotizaciones', file(pdfBytes()), A);
    const meta = (await svc.resolveSelection({ id: 'tpl1', attachmentSpecs: [{ ...spec, min: 1, required: true }] }, { cotizaciones: [stagedId] }, A))[0]!;
    await svc.claim([meta]);
    await expect(svc.discard(stagedId, A)).rejects.toBeInstanceOf(ConflictException);
  });
});

async function stageN(svc: AttachmentsService, specKey: string, n: number, actor = A) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push((await svc.stage('tpl1', specKey, file(pdfBytes(`% ${specKey}${i}`), `c${i}.pdf`), actor)).stagedId);
  return ids;
}

describe('resolveSelection (valida TODO antes de crear nada)', () => {
  it('mínimo no cumplido y obligatorio ausente → 400 con todos los motivos, sin reservar nada', async () => {
    const { svc, redis } = setup();
    const [one] = await stageN(svc, 'cotizaciones', 1);
    const before = [...redis.kv.keys()].filter((k) => k.startsWith('attach:used:')).length;
    const err = await svc.resolveSelection({ id: 'tpl1', attachmentSpecs: [spec, spec2] }, { cotizaciones: [one] }, A).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify(err.getResponse())).toMatch(/al menos 2/);
    expect([...redis.kv.keys()].filter((k) => k.startsWith('attach:used:')).length).toBe(before);

    const none = await svc.resolveSelection({ id: 'tpl1', attachmentSpecs: [spec, spec2] }, {}, A).catch((e) => e);
    expect(JSON.stringify(none.getResponse())).toMatch(/Falta el anexo «Cotizaciones»/);
  });

  it('máximo excedido, specKey que no existe, repetidos', async () => {
    const { svc } = setup();
    const ids = await stageN(svc, 'cotizaciones', 3);
    const t = { id: 'tpl1', attachmentSpecs: [{ ...spec, max: 2 }] };
    expect(JSON.stringify((await svc.resolveSelection(t, { cotizaciones: ids }, A).catch((e) => e)).getResponse())).toMatch(/como máximo 2/);
    expect(JSON.stringify((await svc.resolveSelection(t, { cotizaciones: [ids[0], ids[0]] }, A).catch((e) => e)).getResponse())).toMatch(/repetidos/);
    expect(JSON.stringify((await svc.resolveSelection(t, { cotizaciones: [ids[0], ids[1]], fantasma: ['x'] }, A).catch((e) => e)).getResponse())).toMatch(/no pide el anexo «fantasma»/);
  });

  it('éxito: devuelve las cargas en el orden de las especificaciones', async () => {
    const { svc } = setup();
    const cot = await stageN(svc, 'cotizaciones', 2);
    const sop = await stageN(svc, 'soporte', 1);
    const r = await svc.resolveSelection({ id: 'tpl1', attachmentSpecs: [spec, spec2] }, { soporte: sop, cotizaciones: cot }, A);
    expect(r.map((x) => x.specKey)).toEqual(['cotizaciones', 'cotizaciones', 'soporte']);
  });

  it('una carga de OTRO usuario o de OTRO tenant se rechaza como «no existe»', async () => {
    const { svc } = setup();
    const ids = await stageN(svc, 'cotizaciones', 2);
    const t = { id: 'tpl1', attachmentSpecs: [spec] };
    for (const actor of [{ ...A, actorId: 'beto' }, { ...A, tenantId: 'OTRO' }]) {
      const e = await svc.resolveSelection(t, { cotizaciones: ids }, actor).catch((x) => x);
      expect(JSON.stringify(e.getResponse())).toMatch(/no existe o ya caducó/);
    }
  });

  it('una carga hecha para otro anexo o con el tipo cambiado en la especificación se rechaza', async () => {
    const { svc } = setup();
    const soporte = await stageN(svc, 'soporte', 2);
    const e1 = await svc.resolveSelection({ id: 'tpl1', attachmentSpecs: [spec] }, { cotizaciones: soporte }, A).catch((e) => e);
    expect(JSON.stringify(e1.getResponse())).toMatch(/otro anexo/);
    const cot = await stageN(svc, 'cotizaciones', 2);
    const e2 = await svc.resolveSelection({ id: 'tpl1', attachmentSpecs: [{ ...spec, accept: ['image'] }] }, { cotizaciones: cot }, A).catch((e) => e);
    expect(JSON.stringify(e2.getResponse())).toMatch(/no es de un tipo aceptado/);
    const e3 = await svc.resolveSelection({ id: 'tpl1', attachmentSpecs: [{ ...spec, maxSizeMB: 0.00001 }] }, { cotizaciones: cot }, A).catch((e) => e);
    expect(JSON.stringify(e3.getResponse())).toMatch(/pesa más de/);
  });

  it('caducidad: una carga con más de 24 h se rechaza', async () => {
    const { svc, redis } = setup();
    const ids = await stageN(svc, 'cotizaciones', 2);
    for (const id of ids) {
      const k = `attach:staged:T:${id}`;
      const m = JSON.parse(redis.kv.get(k)!);
      redis.kv.set(k, JSON.stringify({ ...m, expiresAt: Date.now() - 1 }));
    }
    const e = await svc.resolveSelection({ id: 'tpl1', attachmentSpecs: [spec] }, { cotizaciones: ids }, A).catch((x) => x);
    expect(JSON.stringify(e.getResponse())).toMatch(/caducó/);
  });

  it('una carga ya usada se rechaza; claim es todo o nada', async () => {
    const { svc, redis } = setup();
    const ids = await stageN(svc, 'cotizaciones', 2);
    const t = { id: 'tpl1', attachmentSpecs: [spec] };
    const first = await svc.resolveSelection(t, { cotizaciones: ids }, A);
    await svc.claim(first);
    const e = await svc.resolveSelection(t, { cotizaciones: ids }, A).catch((x) => x);
    expect(JSON.stringify(e.getResponse())).toMatch(/ya se usó/);
    // Carrera: otra solicitud reservó la segunda carga entre la validación y la reserva.
    redis.kv.delete(`attach:used:T:${ids[0]}`);
    await expect(svc.claim(first)).rejects.toBeInstanceOf(ConflictException);
    expect(redis.kv.has(`attach:used:T:${ids[0]}`)).toBe(false); // lo reservado a medias se liberó
  });

  it('formato sin especificaciones y sin selección no hace nada; con selección → 400', async () => {
    const { svc } = setup();
    expect(await svc.resolveSelection({ id: 'tpl1', attachmentSpecs: [] }, undefined, A)).toEqual([]);
    await expect(svc.resolveSelection({ id: 'tpl1', attachmentSpecs: [] }, { x: ['y'] }, A)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('materialize + recordAdded', () => {
  it('cada carga pasa a ser un Document del expediente con attachmentKey, mimeType real y hash; la carga se borra', async () => {
    const { svc, documents, objects, redis, collab } = setup();
    const cot = await stageN(svc, 'cotizaciones', 2);
    const png = (await svc.stage('tpl1', 'soporte', file(pngBytes(), 'foto.png'), A)).stagedId;
    const resolved = await svc.resolveSelection({ id: 'tpl1', attachmentSpecs: [spec, spec2] }, { cotizaciones: cot, soporte: [png] }, A);
    await svc.claim(resolved);
    const out = await svc.materialize(resolved, { caseId: 'case1', actor: A });

    expect(out).toHaveLength(3);
    const calls = documents.create.mock.calls.map((c: any[]) => c[0]);
    expect(calls.map((c) => c.attachmentKey)).toEqual(['cotizaciones', 'cotizaciones', 'soporte']);
    expect(calls.every((c) => c.caseId === 'case1' && c.tenantId === 'T' && c.actorId === 'ana')).toBe(true);
    expect(calls[2]).toMatchObject({ mimeType: 'image/png', filename: 'foto.png' });
    expect(out[0]!.sha256).toBe(sha(calls[0].bytes));
    // Las cargas previas ya no existen (ni objeto ni metadatos).
    expect(objects.size).toBe(0);
    expect([...redis.kv.keys()].filter((k) => k.startsWith('attach:staged:'))).toEqual([]);

    await svc.recordAdded(out, { caseId: 'case1', signatureRequestId: 'sr1', documentId: 'main', actor: A });
    const ev = (collab.audit.mock.calls[0] as any[])[0];
    expect(ev).toMatchObject({ action: 'ATTACHMENTS_ADDED', tenantId: 'T', actorId: 'ana', signatureRequestId: 'sr1', documentId: 'main' });
    expect(ev.payload.caseId).toBe('case1');
    expect(ev.payload.specs.cotizaciones.count).toBe(2);
    expect(ev.payload.specs.soporte.count).toBe(1);
    const expectedHash = createHash('sha256').update([...ev.payload.specs.cotizaciones.hashes].join('\n')).digest('hex');
    expect(ev.payload.specs.cotizaciones.hash).toBe(expectedHash);
    // Sin nombres de archivo en la bitácora.
    expect(JSON.stringify(ev)).not.toMatch(/foto\.png|c0\.pdf/);
  });

  it('si falla a la mitad se liberan las reservas y las cargas siguen vigentes', async () => {
    const { svc, documents, redis } = setup();
    const ids = await stageN(svc, 'cotizaciones', 2);
    const resolved = await svc.resolveSelection({ id: 'tpl1', attachmentSpecs: [spec] }, { cotizaciones: ids }, A);
    await svc.claim(resolved);
    documents.create.mockRejectedValueOnce(new Error('boom'));
    await expect(svc.materialize(resolved, { caseId: 'case1', actor: A })).rejects.toThrow('boom');
    expect([...redis.kv.keys()].filter((k) => k.startsWith('attach:used:'))).toEqual([]);
    expect(redis.kv.has(`attach:staged:T:${ids[0]}`)).toBe(true);
  });

  it('si el objeto de la carga cambió (hash distinto) no se materializa', async () => {
    const { svc, objects } = setup();
    const ids = await stageN(svc, 'cotizaciones', 2);
    const resolved = await svc.resolveSelection({ id: 'tpl1', attachmentSpecs: [spec] }, { cotizaciones: ids }, A);
    objects.set(resolved[0]!.meta.objectKey, Buffer.from('%PDF-manipulado'));
    await expect(svc.materialize(resolved, { caseId: 'c', actor: A })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('barrido de caducadas', () => {
  it('borra el objeto y los metadatos vencidos, es idempotente y respeta lo vigente y lo reservado', async () => {
    const { svc, objects, redis, storage } = setup();
    const [old1, old2, fresh] = await stageN(svc, 'cotizaciones', 3);
    const [reserved] = await stageN(svc, 'soporte', 1);
    // old1/old2/reserved vencen; fresh no.
    const future = Date.now() + STAGING_TTL_MS + 1000;
    const expiring = new Set([old1, old2, reserved]);
    for (const [member, score] of [...redis.z.get('attach:expiry')!.entries()]) {
      const [, id] = JSON.parse(member) as [string, string];
      if (!expiring.has(id!)) redis.z.get('attach:expiry')!.set(member, score + 10 * STAGING_TTL_MS);
    }
    await redis.set(`attach:used:T:${reserved}`, '1');

    const r1 = await svc.sweepExpired(future);
    expect(r1).toEqual({ removed: 2, skipped: 1 });
    expect(redis.kv.has(`attach:staged:T:${old1}`)).toBe(false);
    expect(redis.kv.has(`attach:staged:T:${fresh}`)).toBe(true);
    expect(redis.kv.has(`attach:staged:T:${reserved}`)).toBe(true);
    expect(objects.size).toBe(2);
    expect(storage.deleteObject).toHaveBeenCalledTimes(2);

    const r2 = await svc.sweepExpired(future);
    expect(r2.removed).toBe(0);
    expect(storage.deleteObject).toHaveBeenCalledTimes(2);

    // Liberada la reserva, el siguiente barrido la recoge.
    redis.kv.delete(`attach:used:T:${reserved}`);
    expect((await svc.sweepExpired(future)).removed).toBe(1);
  });

  it('sin Redis no hace nada', async () => {
    const { svc } = setup();
    (svc as any).redis = { client: () => null, enabled: false };
    expect(await svc.sweepExpired()).toEqual({ removed: 0, skipped: 0 });
  });
});

describe('lectura: GET /cases/:id/attachments y descarga', () => {
  it('lista [{documentId,attachmentKey,filename,sizeBytes,mimeType,hash}] solo para quien participa', async () => {
    const { svc, prisma, documents } = setup();
    prisma.document.findMany.mockResolvedValueOnce([
      { id: 'd1', attachmentKey: 'cotizaciones', filename: 'a.pdf', sizeBytes: 10, mimeType: 'application/pdf', hash: 'h1' },
    ] as never);
    const out = await svc.listForCase('case1', A);
    expect(out).toEqual([{ documentId: 'd1', attachmentKey: 'cotizaciones', filename: 'a.pdf', sizeBytes: 10, mimeType: 'application/pdf', hash: 'h1' }]);
    expect((prisma.document.findMany.mock.calls[0] as any[])[0].where).toMatchObject({ caseId: 'case1', tenantId: 'T', attachmentKey: { not: null } });

    documents.participatesInCase.mockResolvedValueOnce(false as never);
    await expect(svc.listForCase('case1', { ...A, actorId: 'ajeno' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

/** Regla real de participación (DocumentsService) con una base simulada de 2 tenants. */
describe('participatesInCase (DocumentsService): dueño y firmantes sí; ajenos y otros tenants no', () => {
  const cases = [
    { id: 'caseA', tenantId: 'A', ownerId: 'ana' },
    { id: 'caseB', tenantId: 'B', ownerId: 'bruno' },
  ];
  const signers = [
    { signerId: 'carlos', delegatedTo: null, tenantId: 'A', caseId: 'caseA' },
    { signerId: 'dora', delegatedTo: 'suplente', tenantId: 'A', caseId: 'caseA' },
    { signerId: 'eva', delegatedTo: null, tenantId: 'B', caseId: 'caseB' },
  ];
  const prisma: any = {
    case: { findFirst: async ({ where }: any) => cases.find((c) => c.id === where.id && c.tenantId === where.tenantId) ?? null },
    signer: {
      count: async ({ where }: any) =>
        signers.filter(
          (s) =>
            where.OR.some((o: any) => (o.signerId && o.signerId === s.signerId) || (o.delegatedTo && o.delegatedTo === s.delegatedTo)) &&
            s.tenantId === where.signatureRequest.tenantId &&
            s.caseId === where.signatureRequest.document.caseId,
        ).length,
    },
  };
  const docs = new DocumentsService(prisma, {} as any, {} as any);

  it('dueño, firmante y delegado del expediente', async () => {
    expect(await docs.participatesInCase('caseA', 'A', 'ana')).toBe(true);
    expect(await docs.participatesInCase('caseA', 'A', 'carlos')).toBe(true);
    expect(await docs.participatesInCase('caseA', 'A', 'suplente')).toBe(true);
  });

  it('A no lee de B; un ajeno del mismo tenant tampoco; sin identidad, nadie', async () => {
    expect(await docs.participatesInCase('caseB', 'A', 'ana')).toBe(false);
    expect(await docs.participatesInCase('caseB', 'A', 'eva')).toBe(false);
    expect(await docs.participatesInCase('caseA', 'B', 'carlos')).toBe(false);
    expect(await docs.participatesInCase('caseA', 'A', 'zoe')).toBe(false);
    expect(await docs.participatesInCase('caseA', 'A', undefined)).toBe(false);
    expect(await docs.participatesInCase('caseA', '', 'ana')).toBe(false);
  });

  it('un firmante de otro expediente del mismo tenant no lee los anexos de éste', async () => {
    expect(await docs.participatesInCase('caseA', 'A', 'eva')).toBe(false);
  });
});
