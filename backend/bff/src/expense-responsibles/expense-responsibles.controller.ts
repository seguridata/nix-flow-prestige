import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { PageQueryDto } from '../common/pagination';
import { ExpenseResponsiblesService, type ExpenseActor } from './expense-responsibles.service';
import { EXPENSE_STAGES, MAX_IMPORT_ROWS, type ExpenseStage } from './expense-responsibles.resolver';

class ListQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(EXPENSE_STAGES as unknown as string[]) stage?: ExpenseStage;
  @IsOptional() @IsString() @MaxLength(80) area?: string;
  @IsOptional() @IsIn(['true', 'false']) active?: string;
}

/** La validación fina (rangos, correo, longitudes) vive en `parseRow`; aquí solo la forma del cuerpo. */
class RowDto {
  @IsOptional() @IsString() @MaxLength(80) area?: string;
  @IsOptional() @IsString() @MaxLength(120) expenseType?: string | null;
  @IsOptional() @IsString() @MaxLength(120) concept?: string | null;
  @IsOptional() @IsString() @MaxLength(20) stage?: string;
  @IsOptional() minAmount?: number | null;
  @IsOptional() maxAmount?: number | null;
  @IsOptional() @IsString() @MaxLength(200) signerId?: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string | null;
  @IsOptional() @IsString() @MaxLength(254) email?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

class ImportDto {
  // `@Type(() => Object)`: con enableImplicitConversion cada elemento de un `unknown[]` llegaría como Array.
  @IsArray() @ArrayMaxSize(MAX_IMPORT_ROWS) @Type(() => Object) rows!: unknown[];
  @IsOptional() @IsBoolean() replace?: boolean;
}

class ResolveQueryDto {
  @IsIn(EXPENSE_STAGES as unknown as string[]) stage!: ExpenseStage;
  @IsOptional() @IsString() @MaxLength(80) area?: string;
  @IsOptional() @IsString() @MaxLength(120) expenseType?: string;
  @IsOptional() @IsString() @MaxLength(120) concept?: string;
  @IsOptional() @Type(() => Number) @IsNumber() amount?: number;
}

const actorOf = (u: AuthenticatedUser): ExpenseActor => ({ tenantId: u.tenantId, actorId: u.actorId, name: u.name });

/** Matriz de responsables de gasto. `tenantId` sale SIEMPRE del guard (slug), nunca del cuerpo ni de la consulta. */
@Controller('expense-responsibles')
export class ExpenseResponsiblesController {
  constructor(private readonly service: ExpenseResponsiblesService) {}

  @Roles('admin')
  @Get()
  list(@Query() query: ListQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.tenantId, query);
  }

  /** Cualquier usuario autenticado: el formulario del sobre la consulta para mostrar quién autoriza. */
  @Get('resolve')
  resolve(@Query() q: ResolveQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.resolve(user.tenantId, q);
  }

  @Roles('admin')
  @Post('import')
  @HttpCode(200)
  import(@Body() body: ImportDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.importRows(body.rows, body.replace === true, actorOf(user));
  }

  @Roles('admin')
  @Post()
  create(@Body() body: RowDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(body, actorOf(user));
  }

  @Roles('admin')
  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: RowDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.update(id, body, actorOf(user));
  }

  @Roles('admin')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.service.remove(id, actorOf(user));
  }
}
