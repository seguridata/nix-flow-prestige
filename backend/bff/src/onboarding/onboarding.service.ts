import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { OnboardingCase, OnboardingKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CollaborationService } from '../collaboration/collaboration.service';
import { SigningRouter } from '../signing/signing.router';
import { StorageService } from '../storage/storage.service';
import type { EncMeta } from '../storage/object-crypto';

/** Referencia a un objeto cifrado en storage (lo que se guarda en las columnas Json). */
interface StoredRef {
  key: string;
  sha256: string;
  size: number;
  enc: EncMeta;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Oculta las referencias de storage y expone banderas `has*`. */
function publicView(row: OnboardingCase) {
  const { ineFront, ineBack, selfie, ...rest } = row;
  return {
    ...rest,
    hasIneFront: ineFront != null,
    hasIneBack: ineBack != null,
    hasSelfie: selfie != null,
  };
}

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly collab: CollaborationService,
    private readonly signing: SigningRouter,
    private readonly storage: StorageService,
  ) {}

  list(tenantId = 'seguridata') {
    return this.prisma.onboardingCase.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 80,
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

  private async store(prefix: string, filename: string, bytes: Buffer, contentType: string): Promise<StoredRef> {
    const s = await this.storage.putObject({ prefix, filename, bytes, contentType });
    return { key: s.objectKey, sha256: s.sha256, size: s.sizeBytes, enc: s.enc };
  }

  async attachIne(
    id: string,
    body: { front?: Buffer; back?: Buffer; actorId: string; actorName?: string },
  ) {
    const current = await this.prisma.onboardingCase.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Onboarding ${id} no encontrado`);
    if (['HABILITADO', 'RECHAZADO'].includes(current.status)) {
      throw new BadRequestException('Este alta ya está cerrada');
    }
    if (!body.front?.length && !body.back?.length) {
      throw new BadRequestException('Adjunta el frente o el reverso de la INE');
    }

    const ineFront: StoredRef | null = body.front?.length
      ? await this.store('onboarding/ine', `${id}-frente.jpg`, body.front, 'image/jpeg')
      : (current.ineFront as unknown as StoredRef | null);
    const ineBack: StoredRef | null = body.back?.length
      ? await this.store('onboarding/ine', `${id}-reverso.jpg`, body.back, 'image/jpeg')
      : (current.ineBack as unknown as StoredRef | null);

    // ineHash: SHA-256 del conjunto ordenado de hashes de frente+reverso presentes.
    const parts = [ineFront?.sha256, ineBack?.sha256].filter(Boolean) as string[];
    const ineHash = parts.length ? sha256(Buffer.from(parts.join(':'))) : current.ineHash;

    const updated = await this.prisma.onboardingCase.update({
      where: { id },
      data: {
        ineFront: ineFront as unknown as object,
        ineBack: ineBack as unknown as object,
        ineHash,
        status: ineFront && ineBack ? 'INE' : current.status,
      },
    });
    await this.collab.audit({
      onboardingId: id,
      actorId: body.actorId,
      actorName: body.actorName,
      action: 'INE_CAPTURED',
      payload: { ineHash, hasFront: Boolean(ineFront), hasBack: Boolean(ineBack) },
    });
    return publicView(updated);
  }

  async captureLiveness(
    id: string,
    body: { selfie: Buffer; actorId: string; actorName?: string },
  ) {
    const current = await this.prisma.onboardingCase.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Onboarding ${id} no encontrado`);
    if (!body.selfie?.length) throw new BadRequestException('Se requiere una captura de prueba de vida');
    if (body.selfie.length < 2_000) throw new BadRequestException('La captura es demasiado pequeña');

    const selfie = await this.store('onboarding/selfie', `${id}-selfie.jpg`, body.selfie, 'image/jpeg');
    const livenessHash = selfie.sha256;

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

    const readyForReview = Boolean(current.ineFront && current.ineBack);
    const updated = await this.prisma.onboardingCase.update({
      where: { id },
      data: {
        selfie: selfie as unknown as object,
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
      payload: { livenessHash, livenessOk, vendor: Boolean(biometric?.configured) },
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
    if (!current.ineFront || !current.ineBack) {
      throw new BadRequestException('Faltan frente y reverso de la INE');
    }
    const updated = await this.prisma.onboardingCase.update({
      where: { id },
      data: {
        ineVerified: true,
        notes: body.notes ?? current.notes,
        status: current.selfie ? 'EN_REVISION' : 'INE',
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
    if (!current.selfie) {
      throw new BadRequestException('Falta la prueba de vida');
    }
    const signerId = current.email.split('@')[0].replace(/[^a-z0-9._-]/gi, '') || current.id.slice(0, 8);
    const updated = await this.prisma.onboardingCase.update({
      where: { id },
      data: { status: 'HABILITADO', enabledSignerId: signerId, livenessOk: true },
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
