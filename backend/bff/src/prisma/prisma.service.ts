import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PrismaService.name);

  async onModuleInit() {
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      try {
        await this.$connect();
        this.log.log('Postgres conectado');
        return;
      } catch (error) {
        this.log.warn(
          `Postgres no disponible (intento ${attempt}/30): ${(error as Error).message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    throw new Error('No se pudo conectar a Postgres en DATABASE_URL');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
