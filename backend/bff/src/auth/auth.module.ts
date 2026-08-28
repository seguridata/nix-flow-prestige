import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Registra JwtAuthGuard como guard global (APP_GUARD): protege todas las
 * rutas del backend por default, salvo las marcadas explícitamente con
 * @Public(). Ver public.decorator.ts y jwt-auth.guard.ts.
 */
@Module({
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AuthModule {}
