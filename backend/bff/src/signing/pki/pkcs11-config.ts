import { ServiceUnavailableException } from '@nestjs/common';

export interface Pkcs11Config {
  modulePath: string;
  slot: number;
  pin: string;
  keyLabel: string;
}

/**
 * Lee la configuración del HSM. Falta un dato → no hay firma.
 * No inventa módulo, slot, PIN ni etiqueta.
 */
export function readPkcs11Config(env: NodeJS.ProcessEnv): Pkcs11Config {
  const modulePath = env.PKCS11_MODULE?.trim() ?? '';
  const pin = env.PKCS11_PIN?.trim() ?? '';
  const keyLabel = env.PKCS11_KEY_LABEL?.trim() ?? '';
  const slotRaw = env.PKCS11_SLOT?.trim() ?? '0';
  if (!modulePath) {
    throw new ServiceUnavailableException(
      'Falta PKCS11_MODULE. Sin el módulo del HSM no hay firma, y la llave privada no se exporta.',
    );
  }
  if (!pin) {
    throw new ServiceUnavailableException('Falta PKCS11_PIN. Sin PIN el token no abre sesión.');
  }
  if (!keyLabel) {
    throw new ServiceUnavailableException(
      'Falta PKCS11_KEY_LABEL. Sin etiqueta no se elige la llave del token.',
    );
  }
  if (!/^\d+$/.test(slotRaw)) {
    throw new ServiceUnavailableException('PKCS11_SLOT tiene que ser un entero mayor o igual que 0.');
  }
  return { modulePath, slot: Number(slotRaw), pin, keyLabel };
}

export function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join('[redactado]');
}
