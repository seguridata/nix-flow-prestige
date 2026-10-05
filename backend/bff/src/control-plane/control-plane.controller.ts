import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  Allow,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { PageQueryDto } from '../common/pagination';
import { ControlPlaneService, isPlatformAdmin } from './control-plane.service';
import { SloService } from './slo.service';

const SLUG = /^[a-z0-9-]{2,40}$/;
const PRINCIPAL = /^[A-Za-z0-9._@+-]{1,120}$/;

class CatalogQueryDto extends PageQueryDto {
  @IsOptional() @IsString() @MaxLength(200)
  kind?: string;
}

class CreateTenantDto {
  @Matches(SLUG, { message: 'slug inválido (a-z0-9-)' }) slug!: string;
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
}
class UpdateTenantDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
class MemberDto {
  @Matches(PRINCIPAL, { message: 'userId inválido' }) userId!: string;
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(40, { each: true }) roles?: string[];
  @IsOptional() @IsBoolean() active?: boolean;
}
class PolicyDto {
  @IsString() @MinLength(1) @MaxLength(120) key!: string;
  @Allow() value!: unknown;
}
class CatalogDto {
  @IsString() @MinLength(1) @MaxLength(60) kind!: string;
  @IsString() @MinLength(1) @MaxLength(120) key!: string;
  @IsString() @MinLength(1) @MaxLength(200) label!: string;
  @IsOptional() @Allow() meta?: unknown;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

/**
 * M15 — control plane. Rol `admin` (acotado a su propio tenant); tenants y SLO
 * global requieren `platform_admin`. `:tenant` acepta id o slug.
 */
@ApiTags('control-plane')
@Roles('admin')
@Controller('admin')
export class ControlPlaneController {
  constructor(
    private readonly cp: ControlPlaneService,
    private readonly slo: SloService,
  ) {}

  /** Solo operador de plataforma (rol `platform_admin`). */
  @Roles('platform_admin')
  @Get('tenants')
  tenants() {
    return this.cp.listTenants();
  }

  @Roles('platform_admin')
  @Post('tenants')
  createTenant(@Body() body: CreateTenantDto) {
    return this.cp.createTenant(body);
  }

  @Roles('platform_admin')
  @Patch('tenants/:id')
  updateTenant(@Param('id') id: string, @Body() body: UpdateTenantDto) {
    return this.cp.updateTenant(id, body);
  }

  @Get('tenants/:tenant/members')
  async members(@Param('tenant') tenant: string, @Query() page: PageQueryDto, @CurrentUser() user: AuthenticatedUser) {
    await this.cp.assertOwnTenant(tenant, user);
    return this.cp.listMembers(tenant, page);
  }

  @Put('tenants/:tenant/members')
  async upsertMember(
    @Param('tenant') tenant: string,
    @Body() body: MemberDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.cp.assertOwnTenant(tenant, user);
    return this.cp.upsertMember(tenant, body);
  }

  @Delete('tenants/:tenant/members/:userId')
  async removeMember(
    @Param('tenant') tenant: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.cp.assertOwnTenant(tenant, user);
    return this.cp.removeMember(tenant, userId);
  }

  @Get('tenants/:tenant/policies')
  async policies(@Param('tenant') tenant: string, @Query() page: PageQueryDto, @CurrentUser() user: AuthenticatedUser) {
    await this.cp.assertOwnTenant(tenant, user);
    return this.cp.listPolicies(tenant, page);
  }

  @Put('tenants/:tenant/policies')
  async setPolicy(
    @Param('tenant') tenant: string,
    @Body() body: PolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.cp.assertOwnTenant(tenant, user);
    return this.cp.setPolicy(tenant, body.key, body.value, user.actorId);
  }

  @Get('tenants/:tenant/catalogs')
  async catalogs(
    @Param('tenant') tenant: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CatalogQueryDto,
  ) {
    await this.cp.assertOwnTenant(tenant, user);
    return this.cp.listCatalog(tenant, query.kind, query);
  }

  @Put('tenants/:tenant/catalogs')
  async upsertCatalog(
    @Param('tenant') tenant: string,
    @Body() body: CatalogDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.cp.assertOwnTenant(tenant, user);
    return this.cp.upsertCatalog(tenant, body);
  }

  @Delete('tenants/:tenant/catalogs/:kind/:key')
  async removeCatalog(
    @Param('tenant') tenant: string,
    @Param('kind') kind: string,
    @Param('key') key: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.cp.assertOwnTenant(tenant, user);
    return this.cp.removeCatalog(tenant, kind, key);
  }

  @Get('slo')
  sloSnapshot(@CurrentUser() user: AuthenticatedUser) {
    // Vista global solo para platform_admin; el resto ve únicamente su tenant.
    return this.slo.snapshot(isPlatformAdmin(user) ? undefined : user.tenantId);
  }
}
