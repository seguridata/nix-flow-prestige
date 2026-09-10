import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationOutboxService } from './notification-outbox.service';
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
      const to = signer.delegatedTo ? await this.emailOf(signer.delegatedTo) : signer.email;
      if (!to) continue;
      const url = await this.linkUrlFor(signatureRequestId, signer.delegatedTo ?? signer.signerId);
      const t = templates.signInvite({
        signerName: signer.delegatedToName ?? signer.name ?? undefined,
        requesterName: ctx.request.requestedByName ?? undefined,
        documentTitle: ctx.documentTitle,
        url,
      });
      await this.enqueue(to, t, 'signInvite', `invite:${signatureRequestId}:${signer.signerId}`);
    }
  }

  async sendReminder(signatureRequestId: string, signerId: string, ratio: number) {
    const ctx = await this.context(signatureRequestId);
    if (!ctx) return;
    const signer = ctx.request.signers.find((s) => s.signerId === signerId || s.delegatedTo === signerId);
    const to = await this.emailOf(signerId, signer?.email ?? undefined);
    if (!to) return;
    const url = await this.linkUrlFor(signatureRequestId, signerId);
    const t = templates.reminder({
      signerName: signer?.delegatedToName ?? signer?.name ?? undefined,
      documentTitle: ctx.documentTitle,
      url,
    });
    const bucket = Math.round(ratio * 100);
    await this.enqueue(to, t, 'reminder', `reminder:${signatureRequestId}:${signerId}:${bucket}`);
  }

  async sendEscalation(signatureRequestId: string, signerLabel: string, ratio: number) {
    const ctx = await this.context(signatureRequestId);
    if (!ctx) return;
    const recipients = new Set<string>();
    if (ctx.request.requestedBy) {
      const e = await this.emailOf(ctx.request.requestedBy);
      if (e) recipients.add(e);
    }
    const url = this.appUrl('/sent');
    for (const to of recipients) {
      const t = templates.escalation({
        requesterName: ctx.request.requestedByName ?? undefined,
        signerLabel,
        documentTitle: ctx.documentTitle,
        url,
      });
      await this.enqueue(to, t, 'escalation', `escalation:${signatureRequestId}:${signerLabel}:${Math.round(ratio * 100)}`);
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
      const to = s.delegatedTo ? await this.emailOf(s.delegatedTo) : s.email;
      if (to) recipients.set(to, s.delegatedToName ?? s.name ?? undefined);
    }
    if (ctx.request.requestedBy) {
      const e = await this.emailOf(ctx.request.requestedBy);
      if (e) recipients.set(e, ctx.request.requestedByName ?? undefined);
    }
    for (const [to, name] of recipients) {
      const t = templates.completed({ name, documentTitle: ctx.documentTitle, url });
      await this.enqueue(to, t, 'completed', `completed:${signatureRequestId}:${to}`);
    }
  }

  /** Resuelve un correo a partir de un identificador (username) o de un `email` ya conocido. */
  private async emailOf(idOrEmail: string, known?: string): Promise<string | undefined> {
    if (known && known.includes('@')) return known;
    if (idOrEmail.includes('@')) return idOrEmail;
    const signer = await this.prisma.signer.findFirst({
      where: { OR: [{ signerId: idOrEmail }, { delegatedTo: idOrEmail }], email: { not: null } },
    });
    return signer?.email ?? undefined;
  }

  private async enqueue(
    to: string,
    t: { subject: string; html: string },
    template: string,
    dedupeKey: string,
  ) {
    try {
      await this.outbox.enqueueEmail({ to, subject: t.subject, html: t.html, template, dedupeKey });
    } catch (error) {
      this.log.warn(`No se pudo encolar correo (${template}): ${(error as Error).message}`);
    }
  }
}
