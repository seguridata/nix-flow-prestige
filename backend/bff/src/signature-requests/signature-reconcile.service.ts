import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { SigningRouter } from '../signing/signing.router';
import { StorageService } from '../storage/storage.service';
import type { EncMeta } from '../storage/object-crypto';
import { SignatureRequestsService } from './signature-requests.service';

/**
 * Fase B — reconciliación de firmas asíncronas. Cada 30 s revisa los firmantes
 * que quedaron `pending` (`Signer.pendingRef`) y le pregunta al adaptador del
 * método si ya concluyó; cierra la firma (`FIRMADO`) o la marca fallida.
 */
@Injectable()
export class SignatureReconcileService {
  private readonly log = new Logger(SignatureReconcileService.name);
  private running = false;

  constructor(
    private readonly signatureRequests: SignatureRequestsService,
    private readonly signing: SigningRouter,
    private readonly storage: StorageService,
  ) {}

  @Interval('signature-reconcile', 30_000)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.reconcileDue();
    } catch (error) {
      this.log.error(`reconcileDue: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async reconcileDue(minAgeSeconds = 20) {
    const pending = await this.signatureRequests.pendingSignatures(minAgeSeconds);
    if (pending.length === 0) return { checked: 0, completed: 0, failed: 0 };

    let completed = 0;
    let failed = 0;

    for (const signer of pending) {
      const req = signer.signatureRequest;
      if (!signer.pendingRef || !signer.usedMethod) continue;

      let pdfBytes: Buffer;
      try {
        pdfBytes = await this.storage.getObject(
          req.document.objectKey,
          req.document.enc as unknown as EncMeta,
        );
      } catch {
        continue;
      }

      const r = await this.signing
        .reconcile(signer.usedMethod, signer.pendingRef, {
          method: signer.usedMethod,
          signerId: signer.signerId,
          signerName: signer.name ?? undefined,
          documentId: req.documentId,
          tenantId: req.tenantId,
          signatureRequestId: req.id,
          documentHash: req.document.hash,
          pdfBytes,
        })
        .catch((e) => ({ status: 'pending' as const, reason: (e as Error).message }));

      if (r.status === 'pending') continue;

      await this.signatureRequests.finalizePending(req.id, signer.signerId, {
        status: r.status,
        signatureHash: r.signatureHash,
        signedPdf: r.signedPdf,
        reason: r.reason,
      });
      if (r.status === 'completed') completed += 1;
      else failed += 1;
    }

    if (completed || failed) this.log.log(`Reconciliación: ${completed} completadas, ${failed} fallidas`);
    return { checked: pending.length, completed, failed };
  }
}
