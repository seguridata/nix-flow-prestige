import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { STABLE_ORDER, finishPage, pageArgs, prismaPage, type PageQueryDto } from '../common/pagination';
import { AuditChainService } from './audit-chain.service';

@Injectable()
export class CollaborationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditChain: AuditChainService,
  ) {}

  /** 404 (no 403) si el documento no existe o es de otro tenant: no filtra existencia. */
  async assertDocumentInTenant(documentId: string, tenantId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, tenantId },
      select: { id: true },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado');
  }

  async assertSignatureRequestInTenant(signatureRequestId: string, tenantId: string) {
    const req = await this.prisma.signatureRequest.findFirst({
      where: { id: signatureRequestId, tenantId },
      select: { id: true },
    });
    if (!req) throw new NotFoundException('Solicitud no encontrada');
  }

  async assertOnboardingInTenant(onboardingId: string, tenantId: string) {
    const c = await this.prisma.onboardingCase.findFirst({
      where: { id: onboardingId, tenantId },
      select: { id: true },
    });
    if (!c) throw new NotFoundException('Onboarding no encontrado');
  }

  async listComments(documentId: string, tenantId: string) {
    await this.assertDocumentInTenant(documentId, tenantId);
    return this.prisma.documentComment.findMany({
      where: { documentId, OR: [{ tenantId }, { tenantId: null }] },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addComment(body: {
    documentId: string;
    authorId: string;
    authorName: string;
    body: string;
    tenantId: string;
  }) {
    await this.assertDocumentInTenant(body.documentId, body.tenantId);
    return this.prisma.documentComment.create({ data: body });
  }

  /**
   * Notificaciones del usuario. `tenantId` null = filas anteriores al
   * particionado por tenant (o emitidas sin contexto); siguen siendo del
   * usuario, por eso el filtro principal es `userId`.
   */
  async listNotifications(userId: string, tenantId: string, page?: PageQueryDto) {
    const args = pageArgs(page);
    const rows = await this.prisma.userNotification.findMany({
      where: { userId, OR: [{ tenantId }, { tenantId: null }] },
      orderBy: STABLE_ORDER,
      ...prismaPage(args),
    });
    return finishPage(rows, args);
  }

  async notify(userId: string, title: string, body: string, href?: string, tenantId?: string) {
    return this.prisma.userNotification.create({
      data: { userId, title, body, href, tenantId },
    });
  }

  /** Sólo marca si la notificación es del usuario (y tenant); si no, 404. */
  async markRead(id: string, userId: string, tenantId: string) {
    const res = await this.prisma.userNotification.updateMany({
      where: { id, userId, OR: [{ tenantId }, { tenantId: null }] },
      data: { read: true },
    });
    if (res.count === 0) throw new NotFoundException('Notificación no encontrada');
    return { ok: true };
  }

  async markAllRead(userId: string, tenantId: string) {
    await this.prisma.userNotification.updateMany({
      where: { userId, read: false, OR: [{ tenantId }, { tenantId: null }] },
      data: { read: true },
    });
    return { ok: true };
  }

  /** M11 — todo evento de auditoría entra por la cadena inmutable. */
  audit(event: {
    signatureRequestId?: string;
    documentId?: string;
    onboardingId?: string;
    actorId: string;
    actorName?: string;
    action: string;
    payload?: unknown;
    tenantId?: string;
  }) {
    return this.auditChain.append(event);
  }

  /**
   * Eventos de auditoría del tenant. Si se pasa un recurso, primero se
   * comprueba que pertenezca al tenant (404 si no). Sin recurso: sólo los
   * eventos del tenant (nunca los de otros).
   */
  async listAudit(
    params: { signatureRequestId?: string; documentId?: string; onboardingId?: string },
    tenantId: string,
    page?: PageQueryDto,
  ) {
    if (params.signatureRequestId) await this.assertSignatureRequestInTenant(params.signatureRequestId, tenantId);
    if (params.documentId) await this.assertDocumentInTenant(params.documentId, tenantId);
    if (params.onboardingId) await this.assertOnboardingInTenant(params.onboardingId, tenantId);
    // Línea de tiempo: orden cronológico ascendente (createdAt asc, id asc).
    const args = pageArgs(page);
    const rows = await this.prisma.processAuditEvent.findMany({
      where: {
        tenantId,
        signatureRequestId: params.signatureRequestId,
        documentId: params.documentId,
        onboardingId: params.onboardingId,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      ...prismaPage(args),
    });
    return finishPage(rows, args);
  }

  async addWatcher(signatureRequestId: string, userId: string, tenantId: string, name?: string) {
    await this.assertSignatureRequestInTenant(signatureRequestId, tenantId);
    return this.prisma.processWatcher.upsert({
      where: { signatureRequestId_userId: { signatureRequestId, userId } },
      create: { signatureRequestId, userId, name, tenantId },
      update: { name },
    });
  }

  async listWatchers(signatureRequestId: string, tenantId: string) {
    await this.assertSignatureRequestInTenant(signatureRequestId, tenantId);
    return this.prisma.processWatcher.findMany({
      where: { signatureRequestId, OR: [{ tenantId }, { tenantId: null }] },
    });
  }
}
