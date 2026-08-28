import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { CasesService, type Case } from './cases.service';

@Controller('cases')
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @Public()
  @Post()
  create(@Body() body: { tenantId: string; title: string }): Promise<Case> {
    return this.cases.create(body);
  }

  @Public()
  @Get()
  list(@Query('tenantId') tenantId?: string): Promise<Case[]> {
    return this.cases.list(tenantId);
  }

  @Public()
  @Get(':id')
  get(@Param('id') id: string): Promise<Case> {
    return this.cases.getOrThrow(id);
  }
}
