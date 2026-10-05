import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { SignatureField, SignatureFieldType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type { SignatureField, SignatureFieldType };

export interface SignatureFieldInput {
  documentId: string;
  signerId: string;
  type: SignatureFieldType;
  page: number;
  /** Coordenadas normalizadas 0..1 relativas a la página renderizada, para
   *  que el campo sobreviva a zoom/re-render del visor de PDF. */
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  required?: boolean;
}

const PCT_FIELDS: (keyof SignatureFieldInput)[] = ['xPct', 'yPct', 'widthPct', 'heightPct'];

function assertValid(field: SignatureFieldInput) {
  if (!field.documentId) throw new BadRequestException('documentId es requerido');
  if (!field.signerId) throw new BadRequestException('signerId es requerido');
  if (!field.type) throw new BadRequestException('type es requerido');
  if (!Number.isInteger(field.page) || field.page < 1) {
    throw new BadRequestException('page debe ser un entero >= 1');
  }
  for (const key of PCT_FIELDS) {
    const value = field[key] as number;
    if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 1) {
      throw new BadRequestException(`${key} debe ser un número entre 0 y 1`);
    }
  }
}

/**
 * Colocación de campos de firma (M-fields): permite a quien envía un
 * documento marcar exactamente dónde debe firmar/rubricar/fechar cada
 * firmante, guardando coordenadas normalizadas (0..1) para que el campo
 * se mantenga alineado sin importar el zoom o el tamaño del visor.
 */
@Injectable()
export class SignatureFieldsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 404 si el documento no existe o pertenece a otro tenant. */
  private async assertDocument(documentId: string, tenantId: string) {
    if (!tenantId) throw new BadRequestException('tenantId es requerido');
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, tenantId },
      select: { id: true },
    });
    if (!doc) throw new NotFoundException(`Documento ${documentId} no encontrado`);
  }

  async create(body: SignatureFieldInput, tenantId: string) {
    assertValid(body);
    await this.assertDocument(body.documentId, tenantId);
    return this.prisma.signatureField.create({
      data: {
        tenantId,
        documentId: body.documentId,
        signerId: body.signerId,
        type: body.type,
        page: body.page,
        xPct: body.xPct,
        yPct: body.yPct,
        widthPct: body.widthPct,
        heightPct: body.heightPct,
        required: body.required ?? true,
      },
    });
  }

  async listByDocument(documentId: string, tenantId: string) {
    if (!documentId) throw new BadRequestException('documentId es requerido');
    await this.assertDocument(documentId, tenantId);
    return this.prisma.signatureField.findMany({
      where: { documentId },
      orderBy: [{ page: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * El campo se considera del tenant por su documento (los campos previos al
   * hardening pueden tener `tenantId` nulo): 404 si el documento es ajeno.
   */
  async remove(id: string, tenantId: string) {
    if (!tenantId) throw new BadRequestException('tenantId es requerido');
    const found = await this.prisma.signatureField.findFirst({
      where: { id, document: { tenantId } },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`Campo de firma ${id} no encontrado`);
    await this.prisma.signatureField.deleteMany({ where: { id, document: { tenantId } } });
    return { id };
  }

  /**
   * Reemplaza de forma atómica todos los campos de un documento por el
   * conjunto enviado — así el remitente puede agregar, mover y borrar
   * campos libremente en el editor y guardar el resultado final en un
   * solo POST idempotente. El documento se valida contra el tenant ANTES de
   * borrar nada: un documento ajeno responde 404 y no se toca.
   */
  async createMany(documentId: string, fields: SignatureFieldInput[], tenantId: string) {
    if (!documentId) throw new BadRequestException('documentId es requerido');
    const mismatched = fields.some((f) => f.documentId && f.documentId !== documentId);
    if (mismatched) {
      throw new BadRequestException('Todos los campos deben pertenecer al mismo documentId');
    }
    // El caller manda documentId una sola vez a nivel del bulk request; se
    // inyecta en cada campo aquí para no obligar a repetirlo por elemento.
    fields = fields.map((f) => ({ ...f, documentId }));
    fields.forEach(assertValid);
    await this.assertDocument(documentId, tenantId);

    return this.prisma.$transaction(async (tx) => {
      await tx.signatureField.deleteMany({ where: { documentId } });
      if (fields.length === 0) return [];
      await tx.signatureField.createMany({
        data: fields.map((f) => ({
          tenantId,
          documentId,
          signerId: f.signerId,
          type: f.type,
          page: f.page,
          xPct: f.xPct,
          yPct: f.yPct,
          widthPct: f.widthPct,
          heightPct: f.heightPct,
          required: f.required ?? true,
        })),
      });
      return tx.signatureField.findMany({
        where: { documentId },
        orderBy: [{ page: 'asc' }, { createdAt: 'asc' }],
      });
    });
  }
}
