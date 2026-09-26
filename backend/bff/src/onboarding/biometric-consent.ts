import { createHash } from 'node:crypto';

/**
 * Texto que el titular acepta antes de que se capture su INE o su biometría.
 * La versión entra al expediente; el hash ata la aceptación a esta redacción.
 * LFPDPPP (DOF 20 de marzo de 2025, vigente desde el 21): los datos sensibles
 * exigen consentimiento expreso y por escrito. La biometría y la credencial
 * para votar lo son.
 */
export const BIOMETRIC_CONSENT_VERSION = '2026-09-22';

export const BIOMETRIC_CONSENT_TEXT = `Consentimiento expreso y por escrito para datos sensibles (LFPDPPP)

Responsable: SeguriData, a través de Prestige, para el alta de la persona titular como firmante.

Datos sensibles que se tratan, y solo si marco la casilla:
- Imagen del frente y del reverso de mi credencial para votar (INE), incluidos fotografía, CURP y datos de identificación que la credencial contiene.
- Imagen facial y prueba de vida capturadas con la cámara, para compararlas con la fotografía de la credencial.

Finalidades: verificar mi identidad, habilitarme para firmar documentos y conservar el expediente de esa verificación. No se usan para otra finalidad ni se crean bases de datos biométricas ajenas a este alta.

La casilla no viene marcada. Si no la marco, Prestige no guarda la credencial ni la captura facial. Puedo ejercer acceso, rectificación, cancelación y oposición ante el responsable por el mismo canal con el que me dieron de alta.

Al marcar la casilla dejo constancia escrita de esta aceptación: quedan guardados este texto, su versión, la fecha y hora.`;

export function biometricConsentHash(text: string = BIOMETRIC_CONSENT_TEXT): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
