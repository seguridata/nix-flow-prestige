import { Injectable } from '@nestjs/common';
import { CasesService } from '../cases/cases.service';
import { DocumentsService } from '../documents/documents.service';
import { SignatureRequestsService } from '../signature-requests/signature-requests.service';

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
  private async lookups(documentIds: string[], tenantId?: string) {
    const docs = await this.documents.findManyByIds(documentIds, tenantId);
    const kases = await this.cases.findManyByIds([...docs.values()].map((d) => d.caseId), tenantId);
    return { docs, kases };
  }

  async forSigner(signerId: string, tenantId?: string): Promise<InboxItem[]> {
    const requests = await this.signatureRequests.listAll(signerId, undefined, undefined, undefined, tenantId);
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
        } satisfies InboxItem;
      }),
    );

    return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async forRequester(requestedBy: string, tenantId?: string): Promise<InboxItem[]> {
    const requests = await this.signatureRequests.listAll(
      undefined,
      undefined,
      undefined,
      requestedBy,
      tenantId,
    );
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
          pendingSigners: pending.map((s) => s.name ?? s.signerId),
          signers: request.signers.map((s) => ({
            signerId: s.signerId,
            name: s.name,
            status: s.status,
          })),
        };
      }),
    );
    return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
}
