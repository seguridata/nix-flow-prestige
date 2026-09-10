import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { LoggerModule } from 'nestjs-pino';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { RealtimeModule } from './realtime/realtime.module';
import { CasesModule } from './cases/cases.module';
import { DocumentsModule } from './documents/documents.module';
import { WorkflowModule } from './workflow/workflow.module';
import { SignatureRequestsModule } from './signature-requests/signature-requests.module';
import { InboxModule } from './inbox/inbox.module';
import { SignatureFieldsModule } from './signature-fields/signature-fields.module';
import { EvidenceModule } from './evidence/evidence.module';
import { StorageModule } from './storage/storage.module';
import { SigningModule } from './signing/signing.module';
import { OperationsModule } from './operations/operations.module';
import { CollaborationModule } from './collaboration/collaboration.module';
import { ProcessModule } from './process/process.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { AvailabilityModule } from './availability/availability.module';
import { NotificationsModule } from './notifications/notifications.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { ControlPlaneModule } from './control-plane/control-plane.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } }
            : undefined,
        redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-prestige-worker-token"]'],
        autoLogging: { ignore: (req) => req.url === '/operations/health' },
      },
    }),
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: Number(process.env.THROTTLE_LIMIT ?? 120) },
    ]),
    ScheduleModule.forRoot(),
    PrismaModule,
    StorageModule,
    AuthModule,
    RealtimeModule,
    CasesModule,
    DocumentsModule,
    WorkflowModule,
    SigningModule,
    SignatureRequestsModule,
    InboxModule,
    SignatureFieldsModule,
    EvidenceModule,
    OperationsModule,
    CollaborationModule,
    ProcessModule,
    OnboardingModule,
    AvailabilityModule,
    NotificationsModule,
    WebhooksModule,
    ControlPlaneModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
