import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';

export const BIOMETRIC_ENGINE = Symbol('BIOMETRIC_ENGINE');

export interface BiometricInput {
  onboardingId: string;
  selfie: Buffer;
  /** Recorte del retrato de la INE (frente), si se tiene. */
  inePortrait?: Buffer;
}

export interface BiometricResult {
  engine: string;
  livenessOk: boolean;
  livenessScore: number | null;
  faceMatchOk: boolean;
  faceMatchScore: number | null;
  sessionId: string | null;
  reasons: string[];
}

export interface BiometricEngine {
  readonly kind: string;
  available(): Promise<boolean>;
  analyze(input: BiometricInput): Promise<BiometricResult>;
}

/** Sin motor: no bloquea el alta; RH decide en la revisión manual. */
@Injectable()
export class NoopBiometricEngine implements BiometricEngine {
  readonly kind = 'noop';
  async available() {
    return false;
  }
  async analyze(): Promise<BiometricResult> {
    return {
      engine: this.kind,
      livenessOk: false,
      livenessScore: null,
      faceMatchOk: false,
      faceMatchScore: null,
      sessionId: null,
      reasons: ['sin motor biométrico configurado; revisión manual'],
    };
  }
}

/** El proveedor biométrico externo (motor 3D de SeguriData u otro) por HTTP. */
@Injectable()
export class RemoteBiometricEngine implements BiometricEngine {
  readonly kind = 'remote';
  private readonly log = new Logger(RemoteBiometricEngine.name);

  async available() {
    return Boolean(process.env.BIOMETRIC_PROVIDER_URL);
  }

  async analyze(input: BiometricInput): Promise<BiometricResult> {
    const base = process.env.BIOMETRIC_PROVIDER_URL?.replace(/\/$/, '');
    if (!base) throw new BadRequestException('BIOMETRIC_PROVIDER_URL no configurado');
    const imageHash = createHash('sha256').update(input.selfie).digest('hex');
    const res = await fetch(`${base}/liveness`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.BIOMETRIC_API_KEY ?? ''}`,
      },
      body: JSON.stringify({ onboardingId: input.onboardingId, imageHash }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new BadRequestException(`Proveedor biométrico respondió ${res.status}`);
    const p = (await res.json()) as {
      score?: number;
      liveness?: boolean;
      faceMatch?: boolean;
      faceMatchScore?: number;
      sessionId?: string;
    };
    this.log.log(`biometría remota ${input.onboardingId}: liveness=${p.liveness} match=${p.faceMatch}`);
    return {
      engine: this.kind,
      livenessOk: Boolean(p.liveness),
      livenessScore: p.score ?? null,
      faceMatchOk: Boolean(p.faceMatch),
      faceMatchScore: p.faceMatchScore ?? null,
      sessionId: p.sessionId ?? null,
      reasons: [],
    };
  }
}

/**
 * M16 — motor local con `@vladmandic/face-api` + `@tensorflow/tfjs` (CPU, sin
 * binarios nativos). Carga perezosa: si faltan los pesos del modelo
 * (`FACE_MODEL_DIR`) o la decodificación falla, `available()` es `false` y el
 * alta cae a revisión manual — nunca un falso positivo.
 *
 * Face-match: distancia euclídea entre descriptores (umbral 0.6, estándar
 * face-api). Liveness: heurística de nitidez/variación (Laplaciano) sobre el
 * selfie — señal débil pero honesta; el liveness fuerte es del motor remoto.
 */
@Injectable()
export class LocalFaceBiometricEngine implements BiometricEngine {
  readonly kind = 'local-faceapi';
  private readonly log = new Logger(LocalFaceBiometricEngine.name);
  private loaded: Promise<{ faceapi: typeof import('@vladmandic/face-api'); jpeg: typeof import('jpeg-js') } | null> | null =
    null;

  private modelDir(): string {
    return process.env.FACE_MODEL_DIR ?? './models/face';
  }

  private load() {
    if (!this.loaded) {
      this.loaded = (async () => {
        try {
          const tf = await import('@tensorflow/tfjs');
          await tf.setBackend('cpu');
          await tf.ready();
          const faceapi = await import('@vladmandic/face-api');
          const jpeg = await import('jpeg-js');
          const dir = this.modelDir();
          await faceapi.nets.ssdMobilenetv1.loadFromDisk(dir);
          await faceapi.nets.faceLandmark68Net.loadFromDisk(dir);
          await faceapi.nets.faceRecognitionNet.loadFromDisk(dir);
          this.log.log(`face-api cargado desde ${dir}`);
          return { faceapi, jpeg };
        } catch (error) {
          this.log.warn(
            `face-api no disponible (${(error as Error).message}); el alta usará revisión manual`,
          );
          return null;
        }
      })();
    }
    return this.loaded;
  }

  async available() {
    return (await this.load()) !== null;
  }

  private toTensor(faceapi: typeof import('@vladmandic/face-api'), jpeg: typeof import('jpeg-js'), buf: Buffer) {
    const { width, height, data } = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    // face-api acepta un tensor [h,w,3]
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      rgb[j] = data[i];
      rgb[j + 1] = data[i + 1];
      rgb[j + 2] = data[i + 2];
    }
    return faceapi.tf.tensor3d(rgb, [height, width, 3]);
  }

  private laplacianVariance(jpeg: typeof import('jpeg-js'), buf: Buffer): number {
    const { width, height, data } = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    const gray = new Float64Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    let sum = 0;
    let sum2 = 0;
    let n = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const p = y * width + x;
        const lap = 4 * gray[p] - gray[p - 1] - gray[p + 1] - gray[p - width] - gray[p + width];
        sum += lap;
        sum2 += lap * lap;
        n++;
      }
    }
    const mean = sum / n;
    return sum2 / n - mean * mean;
  }

  async analyze(input: BiometricInput): Promise<BiometricResult> {
    const mods = await this.load();
    if (!mods) return new NoopBiometricEngine().analyze();
    const { faceapi, jpeg } = mods;
    const reasons: string[] = [];

    const selfieT = this.toTensor(faceapi, jpeg, input.selfie);
    let faceMatchScore: number | null = null;
    let faceMatchOk = false;
    try {
      const selfieDet = await faceapi
        .detectSingleFace(selfieT as unknown as Parameters<typeof faceapi.detectSingleFace>[0])
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (!selfieDet) reasons.push('no se detectó rostro en el selfie');

      if (selfieDet && input.inePortrait?.length) {
        const ineT = this.toTensor(faceapi, jpeg, input.inePortrait);
        try {
          const ineDet = await faceapi
            .detectSingleFace(ineT as unknown as Parameters<typeof faceapi.detectSingleFace>[0])
            .withFaceLandmarks()
            .withFaceDescriptor();
          if (!ineDet) reasons.push('no se detectó rostro en la INE');
          else {
            const dist = faceapi.euclideanDistance(selfieDet.descriptor, ineDet.descriptor);
            faceMatchScore = Number(Math.max(0, 1 - dist).toFixed(3));
            faceMatchOk = dist < 0.6;
          }
        } finally {
          ineT.dispose();
        }
      } else if (selfieDet && !input.inePortrait?.length) {
        reasons.push('sin retrato de la INE para comparar');
      }
    } finally {
      selfieT.dispose();
    }

    // Liveness heurístico por nitidez (un selfie de pantalla/foto suele ser plano).
    const variance = this.laplacianVariance(jpeg, input.selfie);
    const livenessScore = Number(Math.min(1, variance / 500).toFixed(3));
    const livenessOk = livenessScore >= 0.4;
    if (!livenessOk) reasons.push(`liveness heurístico bajo (${livenessScore})`);

    return {
      engine: this.kind,
      livenessOk,
      livenessScore,
      faceMatchOk,
      faceMatchScore,
      sessionId: createHash('sha256').update(input.selfie).digest('hex').slice(0, 24),
      reasons,
    };
  }
}
