import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { SigningRouter } from '../signing/signing.router';
import { StorageService } from '../storage/storage.service';

@Controller('operations')
export class OperationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signing: SigningRouter,
    private readonly storage: StorageService,
  ) {}

  @Public()
  @Get('health')
  async health() {
    let postgres = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      postgres = true;
    } catch {
      postgres = false;
    }
    return {
      service: 'prestige-bff',
      postgres,
      objectStorage: this.storage.enabled,
      temporalAddress: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
      redis: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
      biometric: this.signing.capabilities().find((c) => c.method === 'BIOMETRICA'),
      adapters: this.signing.capabilities(),
      at: new Date().toISOString(),
    };
  }

  @Get('summary')
  async summary() {
    const [requests, completed, pendingTasks, runs] = await Promise.all([
      this.prisma.signatureRequest.count(),
      this.prisma.signatureRequest.count({ where: { status: 'COMPLETADA' } }),
      this.prisma.humanTask.count({ where: { status: { in: ['CREADA', 'ASIGNADA'] } } }),
      this.prisma.workflowRun.count(),
    ]);
    return { requests, completed, pendingTasks, runs };
  }

  @Get('overview')
  async overview() {
    const soon = new Date(Date.now() + 24 * 3600_000);
    const now = new Date();
    const [
      byRequest,
      byOnboarding,
      byTask,
      slaRisk,
      overdueTasks,
      reviewOnboarding,
      brokenRuns,
      activity,
    ] = await Promise.all([
      this.prisma.signatureRequest.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.onboardingCase.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.humanTask.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.signatureRequest.findMany({
        where: { status: { in: ['PENDIENTE', 'EN_FIRMA'] }, expiresAt: { lte: soon } },
        orderBy: { expiresAt: 'asc' },
        take: 8,
        select: { id: true, documentId: true, status: true, expiresAt: true, requestedByName: true },
      }),
      this.prisma.humanTask.findMany({
        where: { status: { in: ['CREADA', 'ASIGNADA'] }, dueAt: { lte: now } },
        orderBy: { dueAt: 'asc' },
        take: 8,
        select: { id: true, name: true, signerId: true, dueAt: true, signatureRequestId: true },
      }),
      this.prisma.onboardingCase.findMany({
        where: { status: 'EN_REVISION' },
        orderBy: { updatedAt: 'desc' },
        take: 8,
        select: { id: true, fullName: true, email: true, status: true },
      }),
      this.prisma.workflowRun.findMany({
        where: { OR: [{ status: 'LOCAL' }, { lastError: { not: null } }] },
        orderBy: { updatedAt: 'desc' },
        take: 8,
        select: { id: true, workflowId: true, status: true, lastError: true, signatureRequestId: true },
      }),
      this.prisma.processAuditEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: {
          id: true,
          action: true,
          actorName: true,
          actorId: true,
          documentId: true,
          onboardingId: true,
          signatureRequestId: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      byRequest: Object.fromEntries(byRequest.map((r) => [r.status, r._count._all])),
      byOnboarding: Object.fromEntries(byOnboarding.map((r) => [r.status, r._count._all])),
      byTask: Object.fromEntries(byTask.map((r) => [r.status, r._count._all])),
      attention: {
        slaRisk,
        overdueTasks,
        reviewOnboarding,
        brokenRuns,
      },
      activity,
    };
  }

  @Get('search')
  async search(@Query('q') q = '') {
    const term = q.trim();
    if (term.length < 2) return { documents: [], onboarding: [], requests: [] };
    const [documents, onboarding, requests] = await Promise.all([
      this.prisma.document.findMany({
        where: { filename: { contains: term, mode: 'insensitive' } },
        take: 8,
        select: { id: true, filename: true, caseId: true },
      }),
      this.prisma.onboardingCase.findMany({
        where: {
          OR: [
            { fullName: { contains: term, mode: 'insensitive' } },
            { email: { contains: term, mode: 'insensitive' } },
            { curp: { contains: term, mode: 'insensitive' } },
          ],
        },
        take: 8,
        select: { id: true, fullName: true, email: true, status: true },
      }),
      this.prisma.signatureRequest.findMany({
        where: {
          OR: [
            { id: { startsWith: term } },
            { requestedByName: { contains: term, mode: 'insensitive' } },
          ],
        },
        take: 8,
        select: { id: true, documentId: true, status: true, requestedByName: true },
      }),
    ]);
    return { documents, onboarding, requests };
  }
}
