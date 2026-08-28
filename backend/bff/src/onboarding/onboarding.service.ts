import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { OnboardingKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CollaborationService } from '../collaboration/collaboration.service';
import { SigningRouter } from '../signing/signing.router';

function stripDataUrl(value: string) {
  return value.replace(/^data:[\w/+.-]+;base64,/, '');
}

function hashBytes(base64: string) {
  return createHash('sha256').update(stripDataUrl(base64), 'base64').digest('hex');
}

function publicView<T extends { ineFrontBase64?: string | null; ineBackBase64?: string | null; selfieBase64?: string | null }>(
  row: T,
) {
  return {
    ...row,
    ineFrontBase64: row.ineFrontBase64 ? 'present' : null,
    ineBackBase64: row.ineBackBase64 ? 'present' : null,
    selfieBase64: row.selfieBase64 ? 'present' : null,
    hasIneFront: Boolean(row.ineFrontBase64),
    hasIneBack: Boolean(row.ineBackBase64),
    hasSelfie: Boolean(row.selfieBase64),
  };
}

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly collab: CollaborationService,
    private readonly signing: SigningRouter,
  ) {}

  list(tenantId = 'seguridata') {
    return this.prisma.onboardingCase.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 80,
      omit: {
        ineFrontBase64: true,
        ineBackBase64: true,
        selfieBase64: true,
      },
    });
  }

  async get(id: string) {
    const found = await this.prisma.onboardingCase.findUnique({ where: { id } });
    if (!found) throw new NotFoundException(`Onboarding ${id} no encontrado`);
    return publicView(found);
  }

  async create(body: {
    tenantId?: string;
    kind?: OnboardingKind;
    fullName: string;
    email: string;
    curp?: string;
    rfc?: string;
    requestedBy: string;
    requestedByName?: string;
  }) {
    if (!body.fullName?.trim() || !body.email?.trim()) {
      throw new BadRequestException('Nombre y correo son obligatorios');
    }
    const created = await this.prisma.onboardingCase.create({
      data: {
        tenantId: body.tenantId ?? 'seguridata',
        kind: body.kind ?? 'EMPLEADO',
        status: 'DATOS',
        fullName: body.fullName.trim(),
        email: body.email.trim().toLowerCase(),
        curp: body.curp?.trim().toUpperCase(),
        rfc: body.rfc?.trim().toUpperCase(),
        requestedBy: body.requestedBy,
        requestedByName: body.requestedByName,
      },
    });
    await this.collab.audit({
      onboardingId: created.id,
      actorId: body.requestedBy,
      actorName: body.requestedByName,
      action: 'ONBOARDING_CREATED',
      payload: { kind: created.kind, email: created.email },
    });
    return publicView(created);
  }

  async attachIne(id: string, body: { frontBase64?: string; backBase64?: string; actorId: string; actorName?: string }) {
    const current = await this.prisma.onboardingCase.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Onboarding ${id} no encontrado`);
    if (['HABILITADO', 'RECHAZADO'].includes(current.status)) {
      throw new BadRequestException('Este alta ya está cerrada');
    }
    if (!body.frontBase64 && !body.backBase64) {
      throw new BadRequestException('Adjunta el frente o el reverso de la INE');
    }
    const front = body.frontBase64 ?? current.ineFrontBase64;
    const back = body.backBase64 ?? current.ineBackBase64;
    const combined = `${front ?? ''}${back ?? ''}`;
    const ineHash = combined ? hashBytes(combined) : current.ineHash;
    const updated = await this.prisma.onboardingCase.update({
      where: { id },
      data: {
        ineFrontBase64: front,
        ineBackBase64: back,
        ineHash,
        status: front && back ? 'INE' : current.status,
      },
    });
    await this.collab.audit({
      onboardingId: id,
      actorId: body.actorId,
      actorName: body.actorName,
      action: 'INE_CAPTURED',
      payload: { ineHash, hasFront: Boolean(front), hasBack: Boolean(back) },
    });
    return publicView(updated);
  }

  async captureLiveness(
    id: string,
    body: { selfieBase64: string; actorId: string; actorName?: string },
  ) {
    const current = await this.prisma.onboardingCase.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Onboarding ${id} no encontrado`);
    if (!body.selfieBase64) throw new BadRequestException('Se requiere una captura de prueba de vida');
    const bytes = Buffer.from(stripDataUrl(body.selfieBase64), 'base64');
    if (bytes.length < 2_000) throw new BadRequestException('La captura es demasiado pequeña');

    const livenessHash = hashBytes(body.selfieBase64);
    const biometric = this.signing.capabilities().find((c) => c.method === 'BIOMETRICA');
    let livenessOk = false;
    let livenessScore: number | null = null;
    let faceMatchOk = false;
    let biometricSessionId: string | null = null;

    if (biometric?.configured && process.env.BIOMETRIC_PROVIDER_URL) {
      const url = process.env.BIOMETRIC_PROVIDER_URL.replace(/\/$/, '');
      const res = await fetch(`${url}/liveness`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.BIOMETRIC_API_KEY ?? ''}`,
        },
        body: JSON.stringify({ onboardingId: id, imageHash: livenessHash }),
      });
      if (!res.ok) {
        throw new BadRequestException(`Proveedor biométrico respondió ${res.status}`);
      }
      const payload = (await res.json()) as {
        score?: number;
        liveness?: boolean;
        faceMatch?: boolean;
        sessionId?: string;
      };
      livenessScore = payload.score ?? null;
      livenessOk = Boolean(payload.liveness);
      faceMatchOk = Boolean(payload.faceMatch);
      biometricSessionId = payload.sessionId ?? null;
    }

    const readyForReview = Boolean(current.ineFrontBase64 && current.ineBackBase64);
    const updated = await this.prisma.onboardingCase.update({
      where: { id },
      data: {
        selfieBase64: body.selfieBase64,
        livenessHash,
        livenessScore,
        livenessOk,
        faceMatchOk,
        biometricSessionId,
        status: readyForReview ? 'EN_REVISION' : 'PRUEBA_VIDA',
      },
    });
    await this.collab.audit({
      onboardingId: id,
      actorId: body.actorId,
      actorName: body.actorName,
      action: 'LIVENESS_CAPTURED',
      payload: {
        livenessHash,
        livenessOk,
        vendor: Boolean(biometric?.configured),
      },
    });
    if (readyForReview) {
      await this.collab.notify(
        current.requestedBy,
        'Onboarding en revisión',
        `${current.fullName} ya tiene INE y prueba de vida. Falta habilitar la firma.`,
        `/onboarding/${id}`,
      );
    }
    return publicView(updated);
  }

  async verifyIne(id: string, body: { actorId: string; actorName?: string; notes?: string }) {
    const current = await this.prisma.onboardingCase.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Onboarding ${id} no encontrado`);
    if (!current.ineFrontBase64 || !current.ineBackBase64) {
      throw new BadRequestException('Faltan frente y reverso de la INE');
    }
    const updated = await this.prisma.onboardingCase.update({
      where: { id },
      data: {
        ineVerified: true,
        notes: body.notes ?? current.notes,
        status: current.selfieBase64 ? 'EN_REVISION' : 'INE',
      },
    });
    await this.collab.audit({
      onboardingId: id,
      actorId: body.actorId,
      actorName: body.actorName,
      action: 'INE_VERIFIED',
    });
    return publicView(updated);
  }

  async enable(id: string, body: { actorId: string; actorName?: string }) {
    const current = await this.prisma.onboardingCase.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Onboarding ${id} no encontrado`);
    if (!current.ineVerified) {
      throw new BadRequestException('RH debe verificar la INE antes de habilitar la firma');
    }
    if (!current.selfieBase64) {
      throw new BadRequestException('Falta la prueba de vida');
    }
    const signerId = current.email.split('@')[0].replace(/[^a-z0-9._-]/gi, '') || current.id.slice(0, 8);
    const updated = await this.prisma.onboardingCase.update({
      where: { id },
      data: {
        status: 'HABILITADO',
        enabledSignerId: signerId,
        livenessOk: true,
      },
    });
    await this.collab.audit({
      onboardingId: id,
      actorId: body.actorId,
      actorName: body.actorName,
      action: 'SIGNER_ENABLED',
      payload: { enabledSignerId: signerId },
    });
    await this.collab.notify(
      signerId,
      'Identidad habilitada',
      'Ya puedes firmar documentos en Prestige.',
      '/inbox',
    );
    return publicView(updated);
  }

  async reject(id: string, body: { actorId: string; actorName?: string; notes?: string }) {
    const current = await this.prisma.onboardingCase.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Onboarding ${id} no encontrado`);
    const updated = await this.prisma.onboardingCase.update({
      where: { id },
      data: { status: 'RECHAZADO', notes: body.notes ?? current.notes },
    });
    await this.collab.audit({
      onboardingId: id,
      actorId: body.actorId,
      actorName: body.actorName,
      action: 'ONBOARDING_REJECTED',
      payload: { notes: body.notes },
    });
    return publicView(updated);
  }
}
