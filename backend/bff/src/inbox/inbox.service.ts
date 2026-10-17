import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CasesService } from '../cases/cases.service';
import { DocumentsService } from '../documents/documents.service';
import { SignatureRequestsService } from '../signature-requests/signature-requests.service';
import { pageArgs, type Page, type PageQueryDto } from '../common/pagination';

export interface InboxItem {
  signatureRequestId: string;
  documentId: string;
  documentTitle: string;
  caseTitle: string;
  requestedByName: string;
  status: string;
  myStatus: string;
  methods: string[];
  createdAt: string;
  pendingSigners?: string[];
  signers?: { signerId: string; name?: string | null; status: string }[];
  /** Orden de la solicitud: SECUENCIAL | PARALELO. */
  order?: string;
  /** SECUENCIAL: firmante al que le toca ahora (primer PENDIENTE del orden). */
  currentSignerId?: string;
  /** ¿Puede firmar ya el destinatario de esta bandeja? */
  myTurn?: boolean;
  /** Vencimiento de la solicitud (ISO), o null si no tiene. */
  expiresAt?: string | null;
}

/**
 * Compone la vista "bandeja de entrada" de un firmante uniendo
 * solicitudes de firma + documento + caso. Vive en el BFF (no en el
 * cliente) para no exponer N llamadas encadenadas al navegador y para
 * mantener el principio de "un solo lugar de composición" del Workflow Port.
 */
@Injectable()
export class InboxService {
  constructor(
    private readonly signatureRequests: SignatureRequestsService,
    private readonly documents: DocumentsService,
    private readonly cases: CasesService,
  ) {}

  /** Documentos y casos en 2 consultas en lote (antes: 2 por solicitud). */
  private async lookups(documentIds: string[], tenantId: string) {
    const docs = await this.documents.findManyByIds(documentIds, tenantId);
    const kases = await this.cases.findManyByIds([...docs.values()].map((d) => d.caseId), tenantId);
    return { docs, kases };
  }

  private async validateCursor(page: PageQueryDto | undefined, actorId: string, tenantId: string, sent: boolean) {
    if (!page?.cursor) return;
    try {
      const request = await this.signatureRequests.getOrThrow(page.cursor, tenantId);
      const visible = sent ? request.requestedBy === actorId
        : request.signers.some(s => s.signerId === actorId || s.delegatedTo === actorId);
      if (visible) return;
    } catch (error) {
      // Hide resource existence, but preserve unexpected infrastructure failures as server errors.
      if (!(error instanceof NotFoundException)) throw error;
    }
    throw new BadRequestException('Cursor no disponible para esta bandeja. Actualiza el listado.');
  }

  forSigner(signerId: string, tenantId: string): Promise<InboxItem[]>;
  forSigner(signerId: string, tenantId: string, page: PageQueryDto): Promise<InboxItem[] | Page<InboxItem>>;
  async forSigner(signerId: string, tenantId: string, page?: PageQueryDto): Promise<InboxItem[] | Page<InboxItem>> {
    await this.validateCursor(page, signerId, tenantId, false);
    const result = pageArgs(page).paged
      ? await this.signatureRequests.list(signerId, undefined, undefined, undefined, tenantId, page)
      : await this.signatureRequests.listAll(signerId, undefined, undefined, undefined, tenantId);
    const requests = Array.isArray(result) ? result : result.items;
    const { docs, kases } = await this.lookups(requests.map((r) => r.documentId), tenantId);

    const items = await Promise.all(
      requests.map(async (request) => {
        const document = docs.get(request.documentId) ?? null;
        const signer = request.signers.find(
          (s) => s.signerId === signerId || s.delegatedTo === signerId,
        );
        const kase = document ? (kases.get(document.caseId) ?? null) : null;

        const currentSignerId =
          request.order === 'SECUENCIAL'
            ? [...request.signers]
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .find((s) => s.status === 'PENDIENTE')?.signerId
            : undefined;
        const myStatus = signer?.status ?? 'PENDIENTE';
        const myTurn =
          myStatus === 'PENDIENTE' &&
          (request.order !== 'SECUENCIAL' || currentSignerId === signer?.signerId);

        return {
          signatureRequestId: request.id,
          documentId: request.documentId,
          documentTitle: document?.filename ?? 'Documento',
          caseTitle: kase?.title ?? '',
          requestedByName: request.requestedByName ?? 'Prestige',
          status: request.status,
          myStatus,
          methods: request.methods,
          createdAt: request.createdAt.toISOString(),
          order: request.order,
          currentSignerId,
          myTurn,
          expiresAt: request.expiresAt?.toISOString() ?? null,
          signers: [...request.signers]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((s) => ({ signerId: s.signerId, name: s.name, status: s.status })),
        } satisfies InboxItem;
      }),
    );

    // Preserve the database's stable createdAt desc / id desc order and opaque cursor.
    return Array.isArray(result) ? items : { items, nextCursor: result.nextCursor };
  }

  forRequester(requestedBy: string, tenantId: string): Promise<InboxItem[]>;
  forRequester(requestedBy: string, tenantId: string, page: PageQueryDto): Promise<InboxItem[] | Page<InboxItem>>;
  async forRequester(requestedBy: string, tenantId: string, page?: PageQueryDto): Promise<InboxItem[] | Page<InboxItem>> {
    await this.validateCursor(page, requestedBy, tenantId, true);
    const result = pageArgs(page).paged
      ? await this.signatureRequests.list(undefined, undefined, undefined, requestedBy, tenantId, page)
      : await this.signatureRequests.listAll(undefined, undefined, undefined, requestedBy, tenantId);
    const requests = Array.isArray(result) ? result : result.items;
    const { docs, kases } = await this.lookups(requests.map((r) => r.documentId), tenantId);
    const items = await Promise.all(
      requests.map(async (request) => {
        const document = docs.get(request.documentId) ?? null;
        const kase = document ? (kases.get(document.caseId) ?? null) : null;
        const pending = request.signers.filter((s) => s.status === 'PENDIENTE');
        return {
          signatureRequestId: request.id,
          documentId: request.documentId,
          documentTitle: document?.filename ?? 'Documento',
          caseTitle: kase?.title ?? '',
          requestedByName: request.requestedByName ?? 'Prestige',
          status: request.status,
          myStatus: pending.length ? `FALTAN ${pending.length}` : 'COMPLETO',
          methods: request.methods,
          createdAt: request.createdAt.toISOString(),
          expiresAt: request.expiresAt?.toISOString() ?? null,
          pendingSigners: pending.map((s) => s.name ?? s.signerId),
          signers: request.signers.map((s) => ({
            signerId: s.signerId,
            name: s.name,
            status: s.status,
          })),
        };
      }),
    );
    return Array.isArray(result) ? items : { items, nextCursor: result.nextCursor };
  }
}
