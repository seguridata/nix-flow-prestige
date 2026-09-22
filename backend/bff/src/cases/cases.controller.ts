import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { CasesService, type Case } from './cases.service';

class CreateCaseDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;
}

class ListCasesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  tenantId?: string;
}

@Controller('cases')
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @Roles('sender', 'admin')
  @Post()
  create(@Body() body: CreateCaseDto, @CurrentUser() user: AuthenticatedUser): Promise<Case> {
    return this.cases.create({ tenantId: user.tenantId, title: body.title });
  }

  @Get()
  list(@Query() query: ListCasesQueryDto, @CurrentUser() user: AuthenticatedUser): Promise<Case[]> {
    return this.cases.list(user.tenantId);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<Case> {
    return this.cases.getOrThrow(id, user.tenantId);
  }
}
