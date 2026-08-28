import { Module } from '@nestjs/common';
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
import { DemoModule } from './demo/demo.module';
import { CollaborationModule } from './collaboration/collaboration.module';
import { ProcessModule } from './process/process.module';
import { OnboardingModule } from './onboarding/onboarding.module';

@Module({
  imports: [
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
    DemoModule,
    CollaborationModule,
    ProcessModule,
    OnboardingModule,
  ],
})
export class AppModule {}
