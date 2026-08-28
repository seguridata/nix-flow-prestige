import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { ProcessService } from './process.service';

@Controller()
export class ProcessController {
  constructor(private readonly process: ProcessService) {}

  @Public()
  @Get('process-definitions')
  list() {
    return this.process.list();
  }

  @Public()
  @Get('process-definitions/:key')
  get(@Param('key') key: string) {
    return this.process.getLatest(key);
  }

  @Public()
  @Get('process-definitions/:key/bpmn')
  async bpmn(@Param('key') key: string) {
    const def = await this.process.getLatest(key);
    return { xml: def.bpmnXml, key: def.key, version: def.version, name: def.name };
  }

  @Public()
  @Get('process-definitions/:key/dmn')
  async dmn(@Param('key') key: string) {
    const def = await this.process.getLatest(key);
    return { xml: def.dmnXml, key: def.key, version: def.version };
  }

  @Public()
  @Put('process-definitions/:key')
  save(
    @Param('key') key: string,
    @Body() body: { bpmnXml?: string; dmnXml?: string; name?: string },
  ) {
    return this.process.saveXml(key, body);
  }

  @Public()
  @Post('process-definitions/:key/decide')
  decide(@Body() body: { tipo?: string }) {
    return this.process.decide(body.tipo ?? 'contrato');
  }

  @Public()
  @Get('process-audit')
  audit(
    @Query('signatureRequestId') signatureRequestId?: string,
    @Query('documentId') documentId?: string,
    @Query('onboardingId') onboardingId?: string,
  ) {
    return this.process.listAudit({ signatureRequestId, documentId, onboardingId });
  }
}
