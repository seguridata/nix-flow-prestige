import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PageQueryDto } from '../common/pagination';
import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { WorkflowService } from './workflow.service';

class StartInstanceDto {
  @IsString() @MinLength(1) @MaxLength(200)
  caseId!: string;

  @IsOptional() @IsObject()
  variables?: Record<string, unknown>;
}

class ReassignDto {
  @IsString() @MinLength(1) @MaxLength(200)
  userId!: string;
}

@Controller()
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}

  @Roles('sender', 'admin')
  @Post('workflows/:key/instances')
  start(@Param('key') key: string, @Body() body: StartInstanceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.workflow.startInstanceForUser(user, key, body.caseId, body.variables ?? {});
  }

  /** Tareas del usuario autenticado. */
  @Get('tasks')
  list(@Query() page: PageQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.workflow.listTasks({ assignee: user.actorId, tenantId: user.tenantId }, page);
  }

  @Post('tasks/:id/complete')
  complete(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: Record<string, unknown> = {},
  ) {
    return this.workflow.completeTask(id, body, user);
  }

  /** Reclamar una tarea para el usuario autenticado. */
  @Post('tasks/:id/claim')
  claim(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workflow.claimTask(id, user);
  }

  /** Reasignar a otra persona: acción de supervisión. */
  @Roles('sender', 'admin')
  @Post('tasks/:id/reassign')
  reassign(@Param('id') id: string, @Body() body: ReassignDto, @CurrentUser() user: AuthenticatedUser) {
    return this.workflow.reassignTask(id, body.userId, user);
  }

  @Get('workflows')
  listRuns(@Query() page: PageQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.workflow.listRuns(user.tenantId, page);
  }

  @Get('workflows/by-request/:signatureRequestId')
  describe(@Param('signatureRequestId') signatureRequestId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workflow.describe(signatureRequestId, user.tenantId);
  }
}
