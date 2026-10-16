import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateRowDto, CreateTableDto, ImportRowsDto, ReorderDto, RowsQueryDto, TestQueryDto, UpdateRowDto, UpdateTableDto } from './lookup-tables.dto';
import { LookupTablesService, type LookupActor } from './lookup-tables.service';

const actorOf = (u: AuthenticatedUser): LookupActor => ({ tenantId: u.tenantId, actorId: u.actorId, name: u.name });

/**
 * Tablas de consulta (ADR-008). SOLO administradores. `tenantId` sale SIEMPRE del guard (slug), nunca del cuerpo ni de la
 * consulta. No hay endpoint público de consulta: los flujos consultan desde el servidor al crear la solicitud.
 */
@Controller('lookup-tables')
export class LookupTablesController {
  constructor(private readonly service: LookupTablesService) {}

  @Roles('admin')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.tenantId);
  }

  @Roles('admin')
  @Post()
  create(@Body() body: CreateTableDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(body, actorOf(user));
  }

  @Roles('admin')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.get(id, user.tenantId);
  }

  @Roles('admin')
  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateTableDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.update(id, body, actorOf(user));
  }

  @Roles('admin')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.service.remove(id, actorOf(user));
  }

  @Roles('admin')
  @Get(':id/rows')
  rows(@Param('id', ParseUUIDPipe) id: string, @Query() query: RowsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.listRows(id, query, user.tenantId);
  }

  @Roles('admin')
  @Post(':id/rows')
  createRow(@Param('id', ParseUUIDPipe) id: string, @Body() body: CreateRowDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.createRow(id, body, actorOf(user));
  }

  // Las rutas fijas (`reorder`, `import`) van ANTES de `rows/:rowId`.
  @Roles('admin')
  @Post(':id/rows/reorder')
  @HttpCode(200)
  reorder(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReorderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.reorder(id, body.ids, actorOf(user));
  }

  @Roles('admin')
  @Post(':id/rows/import')
  @HttpCode(200)
  import(@Param('id', ParseUUIDPipe) id: string, @Body() body: ImportRowsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.importRows(id, body.rows, body.replace === true, actorOf(user));
  }

  @Roles('admin')
  @Put(':id/rows/:rowId')
  updateRow(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('rowId', ParseUUIDPipe) rowId: string,
    @Body() body: UpdateRowDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateRow(id, rowId, body, actorOf(user));
  }

  @Roles('admin')
  @Delete(':id/rows/:rowId')
  @HttpCode(204)
  async removeRow(@Param('id', ParseUUIDPipe) id: string, @Param('rowId', ParseUUIDPipe) rowId: string, @CurrentUser() user: AuthenticatedUser) {
    await this.service.removeRow(id, rowId, actorOf(user));
  }

  /** Dry-run: qué filas coinciden con unos valores de prueba y por qué cada una coincide o falla. No escribe nada. */
  @Roles('admin')
  @Post(':id/test')
  @HttpCode(200)
  test(@Param('id', ParseUUIDPipe) id: string, @Body() body: TestQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.test(id, body.query, body.inputs, user.tenantId);
  }
}
