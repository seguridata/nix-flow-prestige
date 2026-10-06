import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { DocumentTemplate, KycPolicy, Prisma, SignatureMethod } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { EncMeta } from '../storage/object-crypto';
import { DocumentsService } from '../documents/documents.service';
import { SignatureRequestsService } from '../signature-requests/signature-requests.service';
import { SignatureFieldsService } from '../signature-fields/signature-fields.service';
import { FoldersService } from '../folders/folders.service';
import { flowToBpmn, missingForConditions, resolveFlow } from '../flow/flow';
import type { Flow, FlowValues, ResolvedStep, Who } from '../flow/flow.types';
import { countPages, fillPdf } from './pdf-fill';
import { parseTemplateMeta, type TemplateMeta } from './template-meta';
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
}

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
      select: { id: true, name: true, description: true, category: true, published: true, createdAt: true, fields: true, flow: true },
    });
    return rows.map(({ fields, flow, ...r }) => ({
      ...r,
      fieldCount: Array.isArray(fields) ? fields.length : 0,
      stepCount: (flow as unknown as Flow | null)?.steps?.length ?? 0,
    }));
  }

  /** Detalle sin `objectKey` ni `enc` (nunca salen del servidor). */
  async get(id: string, actor: TemplateActor) {
    const { objectKey: _k, enc: _e, tenantId: _t, ...detail } = await this.visible(id, actor);
    void _k; void _e; void _t;
    return detail;
  }

  async getPdf(id: string, actor: TemplateActor): Promise<{ bytes: Buffer; filename: string }> {
    const t = await this.visible(id, actor);
    const bytes = await this.storage.getObject(t.objectKey, t.enc as unknown as EncMeta);
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
    const meta = this.validated(rawMeta, pageCount);
    await this.assertNameFree(actor.tenantId, meta.name);

    const stored = await this.storage.putObject({
      prefix: `templates/${actor.tenantId}`,
      filename: `${meta.name}.pdf`,
      bytes: file.buffer,
      contentType: 'application/pdf',
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
      ...Object.fromEntries(Object.entries((rawMeta ?? {}) as Record<string, unknown>).filter(([, v]) => v !== undefined)),
    };
    const meta = this.validated(merged, current.pageCount);
    if (meta.name.toLowerCase() !== current.name.toLowerCase()) await this.assertNameFree(actor.tenantId, meta.name);
    await this.prisma.documentTemplate.update({ where: { id }, data: this.data(meta) });
    return this.get(id, actor);
  }

  async setPublished(id: string, published: boolean, actor: TemplateActor) {
    await this.visible(id, actor);
    await this.prisma.documentTemplate.update({ where: { id }, data: { published } });
    return this.get(id, actor);
  }

  async remove(id: string, actor: TemplateActor): Promise<void> {
    const t = await this.visible(id, actor);
    await this.prisma.documentTemplate.delete({ where: { id } });
    await this.storage.deleteObject(t.objectKey).catch((e: Error) => this.log.warn(`No se pudo borrar ${t.objectKey}: ${e.message}`));
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
    return {
      steps: resolveFlow(flow, values).map((r) => ({
        stepId: r.step.id,
        label: r.step.label,
        role: r.step.role,
        who: r.step.who,
        active: r.active,
      })),
      missing: missingForConditions(flow, values).filter((k) => required.has(k)),
    };
  }

  async instantiate(id: string, input: InstantiateInput, actor: TemplateActor) {
    const t = await this.visible(id, actor);
    const flow = t.flow as unknown as Flow;
    const fields = t.fields as unknown as TemplateField[];
    const boxes = t.signatureBoxes as unknown as SignatureBox[];

    // 1) Todo lo que puede fallar por datos del usuario, ANTES de crear nada.
    const clean = this.coerceValues(flow, fields, input.values, actor);
    const resolved = resolveFlow(flow, clean);
    const { signers, stepSigner } = this.signersFor(resolved, input.askedSigners ?? {}, actor);
    if (input.folderId) await this.folders.assertOwned(input.folderId, { tenantId: actor.tenantId, ownerId: actor.actorId });

    // 2) PDF rellenado.
    const base = await this.storage.getObject(t.objectKey, t.enc as unknown as EncMeta);
    const filled = await fillPdf(base, fields, clean);

    // 3) Expediente (nuevo o uno propio) y documento.
    const firstText = flow.variables.find((v) => v.type === 'text' && clean[v.key])?.key;
    const title = (input.title?.trim() || `${t.name}${firstText ? ` — ${clean[firstText]}` : ''}`).slice(0, 200);
    const caseId = input.caseId
      ? await this.ownCase(input.caseId, actor)
      : (
          await this.prisma.case.create({
            data: { tenantId: actor.tenantId, title: title.length >= 3 ? title : `${title} (formato)`, ownerId: actor.actorId, folderId: input.folderId ?? null },
          })
        ).id;
    const document = await this.documents.create({
      caseId,
      filename: `${t.name.replace(/[\\/:*?"<>|]+/g, '-')}.pdf`,
      bytes: filled,
      tenantId: actor.tenantId,
      actorId: actor.actorId,
      actorName: actor.name,
    });

    // 4) Solicitud de firma (llamada interna: no pasa por el guard de roles del controlador).
    const request = await this.requests.create({
      documentId: document.id,
      methods: t.methods.length ? (t.methods as SignatureMethod[]) : ['ACCEPT'],
      order: flow.order,
      slaHours: flow.slaHours,
      requestedBy: actor.actorId,
      requestedByName: actor.name,
      tenantId: actor.tenantId,
      signers: signers.map((s) => ({ signerId: s.signerId, name: s.name, email: s.email, role: s.role })),
      requirePasskey: t.requirePasskey,
      kycPolicy: t.kycPolicy as KycPolicy,
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
      steps: resolved.map((r) => ({ stepId: r.step.id, label: r.step.label, role: r.step.role, who: r.step.who, active: r.active })),
    };
  }

  // ───────────────────────── internos ─────────────────────────

  private validated(raw: unknown, pageCount: number): TemplateMeta {
    const { meta, errors } = parseTemplateMeta(raw, pageCount);
    if (!meta) throw new BadRequestException({ message: 'El formato no es válido', errors });
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

  /** Participantes de los pasos activos, sin repetir personas, y a qué firmante cae cada paso. */
  private signersFor(
    resolved: ResolvedStep[],
    asked: NonNullable<InstantiateInput['askedSigners']>,
    actor: TemplateActor,
  ) {
    const signers: { signerId: string; name?: string; email?: string; role: 'FIRMANTE' | 'REVISOR' }[] = [];
    const stepSigner = new Map<string, number>();
    const seen = new Map<string, number>();

    for (const { step, active } of resolved) {
      if (!active && (step.when?.length ?? 0) > 0) continue;
      const person = this.person(step.who, step.id, step.label, asked, actor);
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

  private person(who: Who, stepId: string, label: string, asked: NonNullable<InstantiateInput['askedSigners']>, actor: TemplateActor) {
    if (who.type === 'initiator') return { signerId: actor.actorId, name: actor.name, email: actor.email };
    if (who.type === 'fixed') return { signerId: who.signerId, name: who.name, email: who.email };
    const a = asked[stepId];
    if (!a?.signerId?.trim()) throw new BadRequestException(`Indica quién participa en «${label}»`);
    return { signerId: a.signerId.trim(), name: a.name, email: a.email };
  }
}
