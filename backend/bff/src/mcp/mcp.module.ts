import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProcessModule } from '../process/process.module';
import { McpController } from './mcp.controller';
import { McpAuthGuard } from './mcp-auth.guard';
import { McpService } from './mcp.service';

@Module({ imports: [PrismaModule, ProcessModule], controllers: [McpController], providers: [McpAuthGuard, McpService] })
export class McpModule {}
