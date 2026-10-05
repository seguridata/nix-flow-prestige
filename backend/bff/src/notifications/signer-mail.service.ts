import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LINK_PLACEHOLDER, NotificationOutboxService } from './notification-outbox.service';
import { OneTimeLinkService } from './one-time-link.service';
import { templates } from './templates';

/**
 * M13 — orquesta los correos del flujo de firma: emite (o reutiliza) el enlace
 * de un solo uso del firmante y encola el mensaje en la bandeja de salida.
 * Idempotente por `dedupeKey`. No lanza: un fallo de correo no rompe el flujo.
 */
@Injectable()
export class SignerMailService {
  private readonly log = new Logger(SignerMailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: NotificationOutboxService,
    private readonly links: OneTimeLinkService,
  ) {}

  private appUrl(path: string): string {
    const base = (process.env.PUBLIC_WEB_URL ?? 'http://localhost:3001').replace(/\/$/, '');
    return `${base}${path}`;
  }

  private async context(signatureRequestId: string) {
    const request = await this.prisma.signatureRequest.findUnique({
      where: { id: signatureRequestId },
      include: { signers: true, document: true },
    });
    if (!request) return null;
    return {
      request,
      documentTitle: request.document?.filename ?? 'documento',
    };
  }

  /**
   * Emite un enlace de un solo uso para el firmante. Cada correo lleva su propio
   * token (el hash en BD no es reversible); al firmar por un enlace se marca
   * `usedAt` de ese token y no se puede reutilizar.
   */
  async linkUrlFor(signatureRequestId: string, signerId: string, ttlHours?: number): Promise<string> {
    const issued = await this.links.issue({ purpose: 'sign', signatureRequestId, signerId, ttlHours });
    return issued.url;
  }

  async sendInvites(signatureRequestId: string) {
    const ctx = await this.context(signatureRequestId);
    if (!ctx) return;
    for (const signer of ctx.request.signers) {
      await this.sendInvite(signatureRequestId, signer.signerId);
    }
  }

  /**
   * Invitación con enlace de un solo uso para UN firmante. En orden secuencial
   * se usa al crear (solo el primero) y luego al pasar el turno a cada
   * siguiente. Idempotente por `dedupeKey`.
   */
  async sendInvite(signatureRequestId: string, signerId: string) {
    const ctx = await this.context(signatureRequestId);
    if (!ctx) return;
    const signer = ctx.request.signers.find((s) => s.signerId === signerId);
    // Si la firma está delegada, el suplente ya recibió aviso in-app; el correo
    // externo requeriría su dirección (no la capturamos en la delegación).
    if (!signer || signer.delegatedTo || !signer.email) return;
    const url = await this.linkUrlFor(signatureRequestId, signer.signerId);
    const t = templates.signInvite({
      signerName: signer.name ?? undefined,
      requesterName: ctx.request.requestedByName ?? undefined,
      documentTitle: ctx.documentTitle,
      url: LINK_PLACEHOLDER,
    });
    await this.enqueue(signer.email, t, 'signInvite', `invite:${signatureRequestId}:${signer.signerId}`, ctx.request.tenantId, url);
  }

  async sendReminder(signatureRequestId: string, signerId: string, ratio: number) {
    const ctx = await this.context(signatureRequestId);
    if (!ctx) return;
    const signer = ctx.request.signers.find((s) => s.signerId === signerId || s.delegatedTo === signerId);
    const to = this.emailFromSigners(signerId, ctx.request.signers);
    if (!to) return;
    const url = await this.linkUrlFor(signatureRequestId, signerId);
    const t = templates.reminder({
      signerName: signer?.delegatedToName ?? signer?.name ?? undefined,
      documentTitle: ctx.documentTitle,
      url: LINK_PLACEHOLDER,
    });
    const bucket = Math.round(ratio * 100);
    await this.enqueue(to, t, 'reminder', `reminder:${signatureRequestId}:${signerId}:${bucket}`, ctx.request.tenantId, url);
  }

  async sendEscalation(signatureRequestId: string, signerLabel: string, ratio: number) {
    const ctx = await this.context(signatureRequestId);
    if (!ctx) return;
    const recipients = new Set<string>();
    // El emisor sólo recibe correo si su identificador ya es una dirección; no
    // hay directorio de usuarios en el BFF (el aviso in-app lo cubre aparte).
    if (ctx.request.requestedBy?.includes('@')) recipients.add(ctx.request.requestedBy);
    const url = this.appUrl('/sent');
    for (const to of recipients) {
      const t = templates.escalation({
        requesterName: ctx.request.requestedByName ?? undefined,
        signerLabel,
        documentTitle: ctx.documentTitle,
        url,
      });
      await this.enqueue(to, t, 'escalation', `escalation:${signatureRequestId}:${signerLabel}:${Math.round(ratio * 100)}`, ctx.request.tenantId);
    }
  }

  async sendCompleted(signatureRequestId: string) {
    const ctx = await this.context(signatureRequestId);
    if (!ctx) return;
    const manifest = await this.prisma.evidenceManifest.findUnique({ where: { signatureRequestId } });
    const url = manifest
      ? this.appUrl(`/verificar?id=${manifest.manifestId}`)
      : this.appUrl(`/documents/${ctx.request.documentId}`);
    const recipients = new Map<string, string | undefined>();
    for (const s of ctx.request.signers) {
      const to = s.email ?? undefined; // el correo de firma es el del `Signer` de ESTA solicitud
      if (to) recipients.set(to, s.delegatedToName ?? s.name ?? undefined);
    }
    if (ctx.request.requestedBy?.includes('@')) {
      recipients.set(ctx.request.requestedBy, ctx.request.requestedByName ?? undefined);
    }
    for (const [to, name] of recipients) {
      const t = templates.completed({ name, documentTitle: ctx.documentTitle, url });
      await this.enqueue(to, t, 'completed', `completed:${signatureRequestId}:${to}`, ctx.request.tenantId);
    }
  }

  /**
   * Resuelve el correo SÓLO entre los firmantes de la solicitud en curso (nunca
   * con una búsqueda global de `Signer`, que podría cruzar de tenant por
   * coincidencia de username).
   */
  private emailFromSigners(
    idOrEmail: string,
    signers: { signerId: string; delegatedTo: string | null; email: string | null }[],
  ): string | undefined {
    if (idOrEmail.includes('@')) return idOrEmail;
    const s = signers.find((x) => x.signerId === idOrEmail || x.delegatedTo === idOrEmail);
    return s?.email ?? undefined;
  }

  private async enqueue(
    to: string,
    t: { subject: string; html: string },
    template: string,
    dedupeKey: string,
    tenantId?: string,
    link?: string,
  ) {
    try {
      await this.outbox.enqueueEmail({ to, subject: t.subject, html: t.html, template, dedupeKey, tenantId, link });
    } catch (error) {
      this.log.warn(`No se pudo encolar correo (${template}): ${(error as Error).message}`);
    }
  }
}
