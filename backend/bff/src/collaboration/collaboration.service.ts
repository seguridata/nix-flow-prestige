import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CollaborationService {
  constructor(private readonly prisma: PrismaService) {}

  listComments(documentId: string) {
    return this.prisma.documentComment.findMany({
      where: { documentId },
      orderBy: { createdAt: 'asc' },
    });
  }

  addComment(body: { documentId: string; authorId: string; authorName: string; body: string }) {
    return this.prisma.documentComment.create({ data: body });
  }

  listNotifications(userId: string) {
    return this.prisma.userNotification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });
  }

  async notify(userId: string, title: string, body: string, href?: string) {
    return this.prisma.userNotification.create({
      data: { userId, title, body, href },
    });
  }

  async markRead(id: string) {
    return this.prisma.userNotification.update({ where: { id }, data: { read: true } });
  }

  async markAllRead(userId: string) {
    await this.prisma.userNotification.updateMany({ where: { userId, read: false }, data: { read: true } });
    return { ok: true };
  }

  audit(event: {
    signatureRequestId?: string;
    documentId?: string;
    onboardingId?: string;
    actorId: string;
    actorName?: string;
    action: string;
    payload?: unknown;
  }) {
    return this.prisma.processAuditEvent.create({
      data: {
        signatureRequestId: event.signatureRequestId,
        documentId: event.documentId,
        onboardingId: event.onboardingId,
        actorId: event.actorId,
        actorName: event.actorName,
        action: event.action,
        payload: event.payload === undefined ? undefined : (event.payload as object),
      },
    });
  }

  listAudit(params: { signatureRequestId?: string; documentId?: string; onboardingId?: string }) {
    return this.prisma.processAuditEvent.findMany({
      where: {
        signatureRequestId: params.signatureRequestId,
        documentId: params.documentId,
        onboardingId: params.onboardingId,
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  addWatcher(signatureRequestId: string, userId: string, name?: string) {
    return this.prisma.processWatcher.upsert({
      where: { signatureRequestId_userId: { signatureRequestId, userId } },
      create: { signatureRequestId, userId, name },
      update: { name },
    });
  }

  listWatchers(signatureRequestId: string) {
    return this.prisma.processWatcher.findMany({ where: { signatureRequestId } });
  }
}
