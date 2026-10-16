import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TenantIdResolver } from './tenant-id-resolver';

@Global()
@Module({
  providers: [PrismaService, TenantIdResolver],
  exports: [PrismaService, TenantIdResolver],
})
export class PrismaModule {}
