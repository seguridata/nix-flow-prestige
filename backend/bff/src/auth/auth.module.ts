import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { WorkerGuard } from './worker.guard';

/**
 * Cadena de guards globales (se ejecutan en orden):
 *   1. JwtAuthGuard  — verifica el access token de Keycloak, salvo @Public().
 *   2. RolesGuard    — exige los roles de @Roles(...) si la ruta los declara.
 * WorkerGuard NO es global: se aplica con @UseGuards() en el controller
 * interno del worker.
 */
@Global()
@Module({
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    WorkerGuard,
  ],
  exports: [WorkerGuard],
})
export class AuthModule {}
