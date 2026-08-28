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

  async forSigner(signerId: string): Promise<InboxItem[]> {
    const requests = await this.signatureRequests.list(signerId);

    const items = await Promise.all(
      requests.map(async (request) => {
        const document = await this.documents.find(request.documentId);
        const signer = request.signers.find(
          (s) => s.signerId === signerId || s.delegatedTo === signerId,
        );
        const kase = document ? await this.cases.find(document.caseId) : null;

        return {
          signatureRequestId: request.id,
          documentId: request.documentId,
          documentTitle: document?.filename ?? 'Documento',
          caseTitle: kase?.title ?? '',
          requestedByName: request.requestedByName ?? 'Prestige',
          status: request.status,
          myStatus: signer?.status ?? 'PENDIENTE',
          methods: request.methods,
          createdAt: request.createdAt.toISOString(),
        } satisfies InboxItem;
      }),
    );

    return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async forRequester(requestedBy: string): Promise<InboxItem[]> {
    const requests = await this.signatureRequests.list(undefined, undefined, undefined, requestedBy);
    const items = await Promise.all(
      requests.map(async (request) => {
        const document = await this.documents.find(request.documentId);
        const kase = document ? await this.cases.find(document.caseId) : null;
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
