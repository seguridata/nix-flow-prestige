import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { WorkflowService } from './workflow.service';

@Controller()
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}

  @Public()
  @Post('workflows/:key/instances')
  start(
    @Param('key') key: string,
    @Body() body: { caseId: string; variables?: Record<string, unknown> },
  ) {
    return this.workflow.startInstance(key, body.caseId, body.variables ?? {});
  }

  @Public()
  @Get('tasks')
  list(@Query('assignee') assignee?: string, @Query('candidateGroup') candidateGroup?: string) {
    return this.workflow.listTasks({ assignee, candidateGroup });
  }

  @Public()
  @Post('tasks/:id/complete')
  complete(@Param('id') id: string, @Body() body: Record<string, unknown> = {}) {
    return this.workflow.completeTask(id, body);
  }

  @Public()
  @Post('tasks/:id/claim')
  claim(@Param('id') id: string, @Body() body: { userId: string }) {
    return this.workflow.claimTask(id, body.userId);
  }

  @Public()
  @Post('tasks/:id/reassign')
  reassign(@Param('id') id: string, @Body() body: { userId: string }) {
    return this.workflow.reassignTask(id, body.userId);
  }

  @Public()
  @Get('workflows')
  listRuns() {
    return this.workflow.listRuns();
  }

  @Public()
  @Get('workflows/by-request/:signatureRequestId')
  describe(@Param('signatureRequestId') signatureRequestId: string) {
    return this.workflow.describe(signatureRequestId);
  }
}
