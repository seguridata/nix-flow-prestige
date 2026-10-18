import { BadRequestException } from '@nestjs/common';
import type { SignatureMethodName, SignaturePolicy } from '../signing/signature-policy';

/** Métodos «simples» que se prefieren al armar el valor por defecto de un formato, en este orden. */
export const SIMPLE_SIGNATURE_METHODS: readonly SignatureMethodName[] = ['ACCEPT', 'AUTOGRAFA', 'DIGITAL'];

/**
 * Métodos de firma por defecto de un formato que no trae ninguno: los «simples» ({ACCEPT, AUTOGRAFA, DIGITAL}) que la
 * política permita; si ninguno lo está, el primer método permitido por la política.
 */
export function defaultSignatureMethods(policy: Pick<SignaturePolicy, 'allowedMethods'>): SignatureMethodName[] {
  const simple = SIMPLE_SIGNATURE_METHODS.filter((m) => policy.allowedMethods.includes(m));
  if (simple.length) return [...simple];
  return policy.allowedMethods.length ? [policy.allowedMethods[0]!] : [];
}

/** Métodos del formato que la política del tenant no permite. */
export function disallowedMethods(methods: readonly string[], policy: Pick<SignaturePolicy, 'allowedMethods'>): string[] {
  return methods.filter((m) => !policy.allowedMethods.includes(m as SignatureMethodName));
}

/** 400 al guardar o publicar un formato con métodos que la política no permite. */
export function methodsNotAllowedError(bad: readonly string[], policy: Pick<SignaturePolicy, 'version' | 'allowedMethods'>): BadRequestException {
  return new BadRequestException(
    `La política de firma del tenant (v${policy.version}) no permite los métodos de firma del formato: ${bad.join(', ')}. ` +
      `Métodos permitidos: ${policy.allowedMethods.join(', ')}. ` +
      `El administrador debe cambiar los métodos de firma del formato por alguno de los permitidos.`,
  );
}

/** 400 al llenar un formato cuyos métodos dejaron de estar permitidos (la política cambió después de guardarlo). */
export function staleMethodsError(name: string, bad: readonly string[], policy: Pick<SignaturePolicy, 'version' | 'allowedMethods'>): BadRequestException {
  return new BadRequestException(
    `El formato «${name}» necesita actualizarse: sus métodos de firma (${bad.join(', ')}) ya no los permite la política de firma ` +
      `vigente del tenant (v${policy.version}; permitidos: ${policy.allowedMethods.join(', ')}). ` +
      `Avisa al administrador para que edite el formato y vuelva a publicarlo; no se creó ningún expediente.`,
  );
}
