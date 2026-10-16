import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { DocumentTemplate, KycPolicy, Prisma, SignatureMethod } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService, assertTenantKey } from '../storage/storage.service';
import type { EncMeta } from '../storage/object-crypto';
import { DocumentsService } from '../documents/documents.service';
import { SignatureRequestsService } from '../signature-requests/signature-requests.service';
import { SignatureFieldsService } from '../signature-fields/signature-fields.service';
import { FoldersService } from '../folders/folders.service';
import { flowToBpmn, missingForConditions, publicFlow, publicWho } from '../flow/flow';
import type { Flow, FlowValues, ResolvedStep, Who } from '../flow/flow.types';
import { FlowResolverService, type AwaitingInput, type LookupPick } from '../lookup-tables/flow-resolver.service';
import { countPages, fillPdf } from './pdf-fill';
import { buildFormPdf, type FormPdfResult } from './form-pdf';
import { AttachmentsService, type MaterializedAttachment } from '../attachments/attachments.service';
import { parseAttachmentSpecs } from '../attachments/attachment-specs';
import { parseTemplateMeta, type TemplateMeta } from './template-meta';
import { SignaturePolicyService } from '../signing/signature-policy';
import { defaultSignatureMethods, disallowedMethods, methodsNotAllowedError, staleMethodsError } from './signature-methods';
import type { SignatureBox, TemplateActor, TemplateField } from './template.types';

const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;
const MAX_VALUES = 50;
const MAX_VALUE_LEN = 500;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface InstantiateInput {
  values: Record<string, string | number>;
  askedSigners?: Record<string, { signerId: string; name?: string; email?: string }>;
  folderId?: string;
  caseId?: string;
  title?: string;
  /** ADR-008 — `{ [specKey]: stagedId[] }`: cargas previas (`POST :id/attachments`) que pasan a ser anexos del expediente. */
  attachments?: Record<string, string[]>;
}

/** Serialización con llaves ordenadas: jsonb no conserva el orden y JSON.stringify daría falsos cambios. */
function canon(v: unknown): string {
  const sort = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(sort)
      : x && typeof x === 'object'
        ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort((x as Record<string, unknown>)[k])]))
        : x;
  return JSON.stringify(sort(v ?? null));
}

const MAX_FORM_VARIABLES = 100;

@Injectable()
export class DocumentTemplatesService {
  private readonly log = new Logger(DocumentTemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly documents: DocumentsService,
    private readonly requests: SignatureRequestsService,
    private readonly fieldsService: SignatureFieldsService,
    private readonly folders: FoldersService,
    private readonly resolver: FlowResolverService,
    private readonly attachments: AttachmentsService,
    private readonly signaturePolicy: SignaturePolicyService,
  ) {}

  /** Formato del tenant; a quien no es admin los borradores le responden 404 (no se revela que existen). */
  private async visible(id: string, actor: TemplateActor): Promise<DocumentTemplate> {
    const found = await this.prisma.documentTemplate.findFirst({
      where: { id, tenantId: actor.tenantId, ...(actor.isAdmin ? {} : { published: true }) },
    });
    if (!found) throw new NotFoundException('Formato no encontrado');
    return found;
  }

  async list(actor: TemplateActor, all: boolean) {
    const rows = await this.prisma.documentTemplate.findMany({
      where: { tenantId: actor.tenantId, ...(actor.isAdmin && all ? {} : { published: true }) },
      orderBy: [{ name: 'asc' }],
      select: { id: true, name: true, description: true, category: true, published: true, createdAt: true, fields: true, flow: true, kind: true, attachmentSpecs: true },
    });
    return rows.map(({ fields, flow, attachmentSpecs, ...r }) => ({
      ...r,
      attachmentCount: Array.isArray(attachmentSpecs) ? attachmentSpecs.length : 0,
      fieldCount: Array.isArray(fields) ? fields.length : 0,
      stepCount: (flow as unknown as Flow | null)?.steps?.length ?? 0,
    }));
  }

  /** Detalle sin `objectKey` ni `enc` (nunca salen del servidor). */
  async get(id: string, actor: TemplateActor) {
    const { objectKey: _k, enc: _e, tenantId: _t, ...detail } = await this.visible(id, actor);
    void _k; void _e; void _t;
    // Quien llena el formato no ve la configuración de las consultas (ADR-008 §2).
    return actor.isAdmin ? detail : { ...detail, flow: publicFlow(detail.flow) };
  }

  async getPdf(id: string, actor: TemplateActor): Promise<{ bytes: Buffer; filename: string }> {
    const t = await this.visible(id, actor);
    assertTenantKey(actor.tenantId, t.objectKey);
    const bytes = await this.storage.getObject(t.objectKey, t.enc as unknown as EncMeta, actor.tenantId);
    return { bytes, filename: `${t.name}.pdf` };
  }

  async create(rawMeta: unknown, file: { buffer: Buffer; originalname?: string } | undefined, actor: TemplateActor) {
    if (!file?.buffer?.length) throw new BadRequestException('Falta el PDF base del formato');
    if (file.buffer.length > MAX_TEMPLATE_BYTES) throw new BadRequestException('El PDF base pesa más de 10 MB');
    if (file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new BadRequestException('El archivo no es un PDF válido');

    let pageCount: number;
    try {
      pageCount = await countPages(file.buffer);
    } catch {
      throw new BadRequestException('No se pudo leer el PDF base');
    }
    const meta = await this.withMethods(this.validated(rawMeta, pageCount), actor.tenantId, true);
    await this.resolver.assertTables(meta.flow, actor.tenantId);
    await this.assertNameFree(actor.tenantId, meta.name);

    const stored = await this.storage.putObject({
      prefix: `templates/${actor.tenantId}`,
      filename: `${meta.name}.pdf`,
      bytes: file.buffer,
      contentType: 'application/pdf',
      tenantId: actor.tenantId,
    });
    const created = await this.prisma.documentTemplate.create({
      data: {
        ...this.data(meta),
        tenantId: actor.tenantId,
        objectKey: stored.objectKey,
        enc: stored.enc as unknown as Prisma.InputJsonValue,
        hash: createHash('sha256').update(file.buffer).digest('hex'),
        sizeBytes: stored.sizeBytes,
        pageCount,
        published: false,
        createdBy: actor.actorId,
      },
    });
    return this.get(created.id, actor);
  }

  /**
   * ADR-008 §7 — formato DIGITAL: sin PDF subido. Genera la hoja base (variables, anexos, cajas de firma por paso) y
   * calcula `fields` y `signatureBoxes`. Con `id` regenera uno propio de tipo FORM que aún no esté publicado (409 si lo está).
   */
  async createForm(rawBody: unknown, actor: TemplateActor) {
    const body = (rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody) ? rawBody : {}) as Record<string, unknown>;
    const { id, ...given } = body;
    if (id === undefined || id === null) {
      const built = await this.buildForm(given);
      const gen = built.gen;
      const meta = await this.withMethods(built.meta, actor.tenantId, true);
      await this.resolver.assertTables(meta.flow, actor.tenantId);
      await this.assertNameFree(actor.tenantId, meta.name);
      const stored = await this.storeFormPdf(meta.name, gen.pdf, actor);
      try {
        const created = await this.prisma.documentTemplate.create({
          data: {
            ...this.data(meta),
            tenantId: actor.tenantId,
            kind: 'FORM',
            objectKey: stored.objectKey,
            enc: stored.enc as unknown as Prisma.InputJsonValue,
            hash: createHash('sha256').update(gen.pdf).digest('hex'),
            sizeBytes: stored.sizeBytes,
            pageCount: gen.pageCount,
            published: false,
            createdBy: actor.actorId,
          },
        });
        return this.get(created.id, actor);
      } catch (e) {
        await this.storage.deleteObject(stored.objectKey, actor.tenantId).catch(() => undefined);
        throw e;
      }
    }
    if (typeof id !== 'string') throw new BadRequestException('El id del formato no es válido');
    const current = await this.visible(id, actor);
    if (current.kind !== 'FORM') throw new BadRequestException('Ese formato trae su propio PDF: no es un formato digital');
    if (current.published) throw new ConflictException('El formato está publicado: despublícalo para regenerar su hoja');
    const merged = {
      name: current.name,
      description: current.description,
      category: current.category,
      flow: current.flow,
      methods: current.methods,
      kycPolicy: current.kycPolicy,
      requirePasskey: current.requirePasskey,
      flowKey: current.flowKey,
      flowVersion: current.flowVersion,
      attachmentSpecs: current.attachmentSpecs,
      ...Object.fromEntries(Object.entries(given).filter(([, v]) => v !== undefined)),
    };
    return this.regenerateForm(current, merged, actor);
  }

  /** Valida el cuerpo, genera la hoja y revalida con los campos y cajas calculados contra las páginas reales. */
  private async buildForm(raw: Record<string, unknown>): Promise<{ meta: TemplateMeta; gen: FormPdfResult }> {
    const base = { ...raw, fields: [], signatureBoxes: [] };
    const pre = this.validated(base, 1);
    if (pre.flow.variables.length > MAX_FORM_VARIABLES) {
      throw new BadRequestException(`Un formato digital admite hasta ${MAX_FORM_VARIABLES} variables`);
    }
    const gen = await buildFormPdf({
      name: pre.name,
      description: pre.description,
      variables: pre.flow.variables,
      steps: pre.flow.steps,
      attachmentSpecs: pre.attachmentSpecs,
    });
    const meta = this.validated({ ...base, fields: gen.fields, signatureBoxes: gen.signatureBoxes }, gen.pageCount);
    return { meta, gen };
  }

  private storeFormPdf(name: string, bytes: Buffer, actor: TemplateActor) {
    return this.storage.putObject({
      prefix: `templates/${actor.tenantId}`,
      filename: `${name}.pdf`,
      bytes,
      contentType: 'application/pdf',
      tenantId: actor.tenantId,
    });
  }

  /** Reemplaza la hoja base de un FORM no publicado y recalcula sus campos y cajas. */
  private async regenerateForm(current: DocumentTemplate, merged: Record<string, unknown>, actor: TemplateActor, validateMethods = true) {
    const built = await this.buildForm(merged);
    const gen = built.gen;
    const meta = await this.withMethods(built.meta, actor.tenantId, validateMethods);
    await this.resolver.assertTables(meta.flow, actor.tenantId);
    if (meta.name.toLowerCase() !== current.name.toLowerCase()) await this.assertNameFree(actor.tenantId, meta.name);
    assertTenantKey(actor.tenantId, current.objectKey);
    const stored = await this.storeFormPdf(meta.name, gen.pdf, actor);
    try {
      await this.prisma.documentTemplate.update({
        where: { id: current.id },
        data: {
          ...this.data(meta),
          objectKey: stored.objectKey,
          enc: stored.enc as unknown as Prisma.InputJsonValue,
          hash: createHash('sha256').update(gen.pdf).digest('hex'),
          sizeBytes: stored.sizeBytes,
          pageCount: gen.pageCount,
        },
      });
    } catch (e) {
      await this.storage.deleteObject(stored.objectKey, actor.tenantId).catch(() => undefined);
      throw e;
    }
    await this.storage.deleteObject(current.objectKey, actor.tenantId).catch((e: Error) => this.log.warn(`No se pudo borrar ${current.objectKey}: ${e.message}`));
    return this.get(current.id, actor);
  }

  /** Carga previa de un anexo (solo formatos publicados). Ver `AttachmentsService.stage`. */
  stageAttachment(templateId: string, specKey: string | undefined, file: { buffer: Buffer; originalname?: string } | undefined, actor: TemplateActor) {
    return this.attachments.stage(templateId, specKey, file, { tenantId: actor.tenantId, actorId: actor.actorId, name: actor.name });
  }

  discardAttachment(stagedId: string, actor: TemplateActor) {
    return this.attachments.discard(stagedId, { tenantId: actor.tenantId, actorId: actor.actorId, name: actor.name });
  }

  async update(id: string, rawMeta: unknown, actor: TemplateActor) {
    const current = await this.visible(id, actor);
    // Edición parcial: lo que no venga conserva el valor actual.
    const merged = {
      name: current.name,
      description: current.description,
      category: current.category,
      fields: current.fields,
      signatureBoxes: current.signatureBoxes,
      flow: current.flow,
      methods: current.methods,
      kycPolicy: current.kycPolicy,
      requirePasskey: current.requirePasskey,
      flowKey: current.flowKey,
      flowVersion: current.flowVersion,
      attachmentSpecs: current.attachmentSpecs,
      ...Object.fromEntries(Object.entries((rawMeta ?? {}) as Record<string, unknown>).filter(([, v]) => v !== undefined)),
    };
    if (current.kind === 'FORM') {
      // La hoja de un formato digital la genera el sistema: campos y cajas no se editan a mano.
      merged.fields = current.fields;
      merged.signatureBoxes = current.signatureBoxes;
      const patch = (rawMeta ?? {}) as Record<string, unknown>;
      const layoutChanged = (['name', 'description', 'flow', 'attachmentSpecs'] as const).some(
        (k) => patch[k] !== undefined && canon(patch[k]) !== canon(current[k]),
      );
      if (layoutChanged) {
        if (current.published) throw new ConflictException('El formato está publicado: despublícalo para cambiar su hoja, flujo o anexos');
        return this.regenerateForm(current, merged, actor, patch.methods !== undefined);
      }
    }
    // Los métodos de firma se validan contra la política del tenant solo si vienen en la edición (o al publicar).
    const meta = await this.withMethods(
      this.validated(merged, current.pageCount),
      actor.tenantId,
      (rawMeta as { methods?: unknown } | null | undefined)?.methods !== undefined,
    );
    // Solo si el flujo viene en la edición: renombrar un formato no debe fallar porque una tabla se desactivó después.
    if ((rawMeta as { flow?: unknown } | null | undefined)?.flow !== undefined) await this.resolver.assertTables(meta.flow, actor.tenantId);
    if (meta.name.toLowerCase() !== current.name.toLowerCase()) await this.assertNameFree(actor.tenantId, meta.name);
    await this.prisma.documentTemplate.update({ where: { id }, data: this.data(meta) });
    return this.get(id, actor);
  }

  async setPublished(id: string, published: boolean, actor: TemplateActor) {
    const current = await this.visible(id, actor);
    if (published && current.methods.length) {
      // Publicar un formato con métodos que la política no permite lo dejaría fallando al llenarlo: se avisa aquí.
      const policy = await this.signaturePolicy.resolve(actor.tenantId);
      const bad = disallowedMethods(current.methods, policy);
      if (bad.length) throw methodsNotAllowedError(bad, policy);
    }
    await this.prisma.documentTemplate.update({ where: { id }, data: { published } });
    return this.get(id, actor);
  }

  async remove(id: string, actor: TemplateActor): Promise<void> {
    const t = await this.visible(id, actor);
    assertTenantKey(actor.tenantId, t.objectKey); // antes de borrar la fila: no se toca un objeto ajeno
    await this.prisma.documentTemplate.delete({ where: { id } });
    await this.storage.deleteObject(t.objectKey, actor.tenantId).catch((e: Error) => this.log.warn(`No se pudo borrar ${t.objectKey}: ${e.message}`));
  }

  async bpmn(id: string, actor: TemplateActor) {
    const t = await this.visible(id, actor);
    return { xml: flowToBpmn(t.flow as unknown as Flow, { key: t.flowKey ?? `formato-${t.id.slice(0, 8)}`, name: t.name }) };
  }

  async previewFlow(id: string, rawValues: Record<string, unknown>, actor: TemplateActor) {
    const t = await this.visible(id, actor);
    const flow = t.flow as unknown as Flow;
    const values = this.looseValues(rawValues);
    const required = new Set(flow.variables.filter((v) => v.required).map((v) => v.key));
    const { resolved, picks, awaiting } = await this.resolver.resolve(flow, values, actor.tenantId);
    return {
      steps: resolved.map((r) => ({
        stepId: r.step.id,
        label: r.step.label,
        role: r.step.role,
        who: publicWho(r.step.who),
        active: r.active,
        ...this.lookupInfo(r, picks, awaiting),
      })),
      missing: missingForConditions(flow, values).filter((k) => required.has(k)),
    };
  }

  async instantiate(id: string, input: InstantiateInput, actor: TemplateActor) {
    const t = await this.visible(id, actor);
    // 0) Métodos de firma: si la política cambió desde que se guardó el formato, falla aquí, antes de crear nada.
    const policy = await this.signaturePolicy.resolve(actor.tenantId);
    const methods = (t.methods.length ? t.methods : defaultSignatureMethods(policy)) as SignatureMethod[];
    const stale = disallowedMethods(methods, policy);
    if (stale.length) throw staleMethodsError(t.name, stale, policy);
    const flow = t.flow as unknown as Flow;
    const fields = t.fields as unknown as TemplateField[];
    const boxes = t.signatureBoxes as unknown as SignatureBox[];

    // 1) Todo lo que puede fallar por datos del usuario, ANTES de crear nada.
    const clean = this.coerceValues(flow, fields, input.values, actor);
    const resolution = await this.resolver.resolve(flow, clean, actor.tenantId, { strict: true });
    const { resolved, picks, awaiting } = resolution;
    const { signers, stepSigner } = this.signersFor(resolved, input.askedSigners ?? {}, actor, picks);
    if (input.folderId) await this.folders.assertOwned(input.folderId, { tenantId: actor.tenantId, ownerId: actor.actorId });
    // Anexos (ADR-008): TODO se valida aquí, antes de crear nada.
    const attachmentActor = { tenantId: actor.tenantId, actorId: actor.actorId, name: actor.name };
    const wantsAttachments = parseAttachmentSpecs(t.attachmentSpecs).specs.length > 0 || Object.keys(input.attachments ?? {}).length > 0;
    const selected = wantsAttachments ? await this.attachments.resolveSelection(t, input.attachments, attachmentActor) : [];

    // 2) PDF rellenado.
    assertTenantKey(actor.tenantId, t.objectKey);
    const base = await this.storage.getObject(t.objectKey, t.enc as unknown as EncMeta, actor.tenantId);
    const filled = await fillPdf(base, fields, clean);
    // Reserva atómica de las cargas (una carga solo va a una solicitud); si algo falla antes de materializarlas se liberan.
    await this.attachments?.claim(selected);
    const guard = <T>(p: Promise<T>): Promise<T> =>
      p.catch(async (e) => {
        await this.attachments?.release(selected);
        throw e;
      });

    // 3) Expediente (nuevo o uno propio) y documento.
    const firstText = flow.variables.find((v) => v.type === 'text' && clean[v.key])?.key;
    const title = (input.title?.trim() || `${t.name}${firstText ? ` — ${clean[firstText]}` : ''}`).slice(0, 200);
    const caseId = input.caseId
      ? await guard(this.ownCase(input.caseId, actor))
      : (
          await guard(
            this.prisma.case.create({
              data: { tenantId: actor.tenantId, title: title.length >= 3 ? title : `${title} (formato)`, ownerId: actor.actorId, folderId: input.folderId ?? null },
            }),
          )
        ).id;
    const document = await guard(
      this.documents.create({
        caseId,
        filename: `${t.name.replace(/[\\/:*?"<>|]+/g, '-')}.pdf`,
        bytes: filled,
        tenantId: actor.tenantId,
        actorId: actor.actorId,
        actorName: actor.name,
      }),
    );
    // Anexos: cada carga pasa a ser un Document del mismo expediente (attachmentKey, cifrado con AAD del tenant, hash, congelado).
    const attached: MaterializedAttachment[] = selected.length ? await this.attachments.materialize(selected, { caseId, actor: attachmentActor }) : [];

    // 4) Solicitud de firma (llamada interna: no pasa por el guard de roles del controlador).
    const request = await this.requests.create({
      documentId: document.id,
      methods,
      order: flow.order,
      slaHours: flow.slaHours,
      requestedBy: actor.actorId,
      requestedByName: actor.name,
      tenantId: actor.tenantId,
      signers: signers.map((s) => ({ signerId: s.signerId, name: s.name, email: s.email, role: s.role })),
      requirePasskey: t.requirePasskey,
      kycPolicy: t.kycPolicy as KycPolicy,
    });

    if (attached.length) {
      await this.attachments
        .recordAdded(attached, { caseId, signatureRequestId: request.id, documentId: document.id, actor: attachmentActor })
        .catch((e: Error) => this.log.warn(`No se pudo auditar ATTACHMENTS_ADDED de ${request.id}: ${e.message}`));
    }

    await this.resolver.recordResolved({
      tenantId: actor.tenantId,
      actorId: actor.actorId,
      templateId: t.id,
      requestId: request.id,
      documentId: document.id,
      resolution,
    });

    // 5) Cajas de firma de los pasos activos, a nombre del firmante ya resuelto (identidad canónica).
    let signatureFieldsPlaced = 0;
    const placed = boxes
      .filter((b) => stepSigner.has(b.stepId))
      .map((b) => {
        const signer = request.signers[stepSigner.get(b.stepId)!];
        return signer
          ? { documentId: document.id, signerId: signer.signerId, type: 'SIGNATURE' as const, page: b.page, xPct: b.x, yPct: b.y, widthPct: b.w, heightPct: b.h }
          : null;
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);
    if (placed.length) {
      try {
        signatureFieldsPlaced = (await this.fieldsService.createMany(document.id, placed, actor.tenantId)).length;
      } catch (e) {
        // La solicitud ya existe: no se revierte; el remitente puede colocar las cajas a mano.
        this.log.warn(`No se colocaron las cajas de firma de ${document.id}: ${(e as Error).message}`);
      }
    }

    return {
      caseId,
      documentId: document.id,
      signatureRequestId: request.id,
      signatureFieldsPlaced,
      attachments: attached.map((a) => ({ documentId: a.documentId, attachmentKey: a.specKey, sha256: a.sha256 })),
      steps: resolved.map((r) => ({ stepId: r.step.id, label: r.step.label, role: r.step.role, who: publicWho(r.step.who), active: r.active, ...this.lookupInfo(r, picks, awaiting) })),
    };
  }

  // ───────────────────────── internos ─────────────────────────

  private validated(raw: unknown, pageCount: number): TemplateMeta {
    const { meta, errors } = parseTemplateMeta(raw, pageCount);
    if (!meta) throw new BadRequestException({ message: 'El formato no es válido', errors });
    return meta;
  }

  /**
   * Métodos de firma del formato contra la política de firma efectiva del tenant. Con `validate`: sin métodos → los
   * «simples» que la política permita (ver `defaultSignatureMethods`); con métodos no permitidos → 400 accionable.
   */
  private async withMethods(meta: TemplateMeta, tenantId: string, validate: boolean): Promise<TemplateMeta> {
    if (!validate) return meta;
    const policy = await this.signaturePolicy.resolve(tenantId);
    if (!meta.methods.length) return { ...meta, methods: defaultSignatureMethods(policy) };
    const bad = disallowedMethods(meta.methods, policy);
    if (bad.length) throw methodsNotAllowedError(bad, policy);
    return meta;
  }

  private data(meta: TemplateMeta) {
    return {
      name: meta.name,
      description: meta.description ?? null,
      category: meta.category ?? null,
      fields: meta.fields as unknown as Prisma.InputJsonValue,
      signatureBoxes: meta.signatureBoxes as unknown as Prisma.InputJsonValue,
      flow: meta.flow as unknown as Prisma.InputJsonValue,
      flowKey: meta.flowKey ?? null,
      flowVersion: meta.flowVersion ?? null,
      methods: meta.methods as SignatureMethod[],
      kycPolicy: meta.kycPolicy as KycPolicy,
      requirePasskey: meta.requirePasskey,
      attachmentSpecs: meta.attachmentSpecs as unknown as Prisma.InputJsonValue,
    };
  }

  private async assertNameFree(tenantId: string, name: string) {
    const clash = await this.prisma.documentTemplate.findFirst({
      where: { tenantId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (clash) throw new ConflictException(`Ya existe un formato llamado «${name}»`);
  }

  private async ownCase(caseId: string, actor: TemplateActor): Promise<string> {
    const kase = await this.prisma.case.findFirst({
      where: { id: caseId, tenantId: actor.tenantId, OR: [{ ownerId: actor.actorId }, { ownerId: null }] },
      select: { id: true },
    });
    if (!kase) throw new NotFoundException('Expediente no encontrado');
    return kase.id;
  }

  /** Para la vista previa: convierte lo que haya capturado, sin exigir que esté completo. */
  private looseValues(raw: Record<string, unknown>): FlowValues {
    const out: FlowValues = {};
    for (const [k, v] of Object.entries(raw ?? {}).slice(0, MAX_VALUES)) {
      if (typeof v === 'string' || typeof v === 'number') out[k] = typeof v === 'string' ? v.slice(0, MAX_VALUE_LEN) : v;
    }
    return out;
  }

  /** Valida requeridos y tipos, aplica el autollenado y devuelve los valores como texto. */
  private coerceValues(
    flow: Flow,
    fields: TemplateField[],
    raw: Record<string, string | number>,
    actor: TemplateActor,
  ): Record<string, string> {
    const entries = Object.entries(raw ?? {});
    if (entries.length > MAX_VALUES) throw new BadRequestException(`Máximo ${MAX_VALUES} valores`);
    if (entries.some(([, v]) => typeof v === 'string' && v.length > MAX_VALUE_LEN)) {
      throw new BadRequestException(`Cada valor admite hasta ${MAX_VALUE_LEN} caracteres`);
    }
    const prefillOf = (key: string) => fields.find((f) => f.key === key && f.prefill)?.prefill;
    const today = new Date().toISOString().slice(0, 10);

    const clean: Record<string, string> = {};
    const errors: string[] = [];
    for (const v of flow.variables) {
      let value = raw?.[v.key] === undefined || raw?.[v.key] === null ? '' : String(raw[v.key]).trim();
      if (!value) {
        const p = prefillOf(v.key);
        value = p === 'user.name' ? (actor.name ?? '') : p === 'user.email' ? (actor.email ?? '') : p === 'today' ? today : '';
      }
      if (!value) {
        if (v.required) errors.push(`Falta «${v.label}»`);
        continue;
      }
      if (v.type === 'number' && Number.isNaN(Number(value))) errors.push(`«${v.label}» debe ser un número`);
      else if (v.type === 'date' && !ISO_DATE_RE.test(value.slice(0, 10))) errors.push(`«${v.label}» debe ser una fecha AAAA-MM-DD`);
      else if (v.type === 'select' && !(v.options ?? []).includes(value)) errors.push(`«${v.label}»: elige una de las opciones`);
      clean[v.key] = value;
    }
    if (errors.length) throw new BadRequestException({ message: 'Revisa los datos del formato', errors });
    return clean;
  }

  /**
   * Para la vista previa y el resultado: quién salió de la consulta; `awaiting` (variables que faltan) mientras los datos de
   * entrada no estén completos; `unresolved` solo si estaban completos y la tabla no devolvió a nadie.
   */
  private lookupInfo(r: ResolvedStep, picks: Map<string, LookupPick | null>, awaiting: Map<string, AwaitingInput[]>) {
    if (!r.active || r.step.who.type !== 'lookup') return {};
    const wait = awaiting.get(r.step.id);
    if (wait?.length) return { awaiting: wait.map(({ key, label }) => ({ key, label })) };
    const m = picks.get(r.step.id);
    return m ? { resolved: { signerId: m.signerId, name: m.name, email: m.email } } : { unresolved: true as const };
  }

  /** Participantes de los pasos activos, sin repetir personas, y a qué firmante cae cada paso. */
  private signersFor(
    resolved: ResolvedStep[],
    asked: NonNullable<InstantiateInput['askedSigners']>,
    actor: TemplateActor,
    picks: Map<string, LookupPick | null> = new Map(),
  ) {
    const signers: { signerId: string; name?: string; email?: string; role: 'FIRMANTE' | 'REVISOR' }[] = [];
    const stepSigner = new Map<string, number>();
    const seen = new Map<string, number>();

    for (const { step, active } of resolved) {
      if (!active && (step.when?.length ?? 0) > 0) continue;
      const person = this.person(step.who, step.id, step.label, asked, actor, picks);
      const key = person.signerId.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, signers.length);
        signers.push({ ...person, role: step.role });
      }
      stepSigner.set(step.id, seen.get(key)!);
    }
    if (signers.length === 0) throw new BadRequestException('El flujo no resolvió ningún firmante');
    return { signers, stepSigner };
  }

  private person(
    who: Who,
    stepId: string,
    label: string,
    asked: NonNullable<InstantiateInput['askedSigners']>,
    actor: TemplateActor,
    picks: Map<string, LookupPick | null>,
  ) {
    if (who.type === 'initiator') return { signerId: actor.actorId, name: actor.name, email: actor.email };
    if (who.type === 'fixed') return { signerId: who.signerId, name: who.name, email: who.email };
    if (who.type === 'lookup') {
      const m = picks.get(stepId);
      // Sin coincidencia en la consulta se comporta como «preguntar» (usa askedSigners[stepId]).
      if (m) return { signerId: m.signerId, name: m.name ?? undefined, email: m.email ?? undefined };
    }
    const a = asked[stepId];
    if (!a?.signerId?.trim()) throw new BadRequestException(`Indica quién participa en «${label}»`);
    return { signerId: a.signerId.trim(), name: a.name, email: a.email };
  }
}
