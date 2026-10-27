import { ConflictException } from '@nestjs/common';

export interface PersonNames {
  fullName: string;
  /** Nombre(s) de pila, p. ej. "Maya Pamela". Si viene junto con `lastName` se usa tal cual. */
  givenNames?: string;
  lastName?: string;
  secondLastName?: string;
}

const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'das', 'do', 'dos', 'san', 'santa', 'van', 'von', 'der', 'den', 'di', 'le']);
const MAX_LENGTH = 40;
const MAX_SUFFIX = 99;

/** Minúsculas, sin acentos y solo letras: lo único que entra en un usuario. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ');
}

function words(text: string | undefined): string[] {
  return fold(text ?? '').split(/\s+/).filter(Boolean);
}

/** "de la Cruz" es un solo apellido: las partículas se pegan a la palabra que sigue. */
function groupParticles(tokens: string[]): string[] {
  const out: string[] = [];
  let pending = '';
  for (const token of tokens) {
    if (PARTICLES.has(token)) {
      pending += token;
      continue;
    }
    out.push(pending + token);
    pending = '';
  }
  return out;
}

export function splitNames(input: PersonNames): { given: string[]; surnames: string[] } {
  const given = words(input.givenNames);
  const first = groupParticles(words(input.lastName)).join('');
  if (given.length > 0 && first) {
    const second = groupParticles(words(input.secondLastName)).join('');
    return { given, surnames: second ? [first, second] : [first] };
  }
  // Solo hay nombre completo: convención mexicana, los dos últimos son apellidos.
  const tokens = groupParticles(words(input.fullName));
  if (tokens.length <= 1) return { given: tokens, surnames: [] };
  if (tokens.length === 2) return { given: [tokens[0]], surnames: [tokens[1]] };
  return { given: tokens.slice(0, -2), surnames: tokens.slice(-2) };
}

/**
 * Candidatos en el orden de la regla de RH:
 *   1. inicial del nombre + primer apellido        (mperez)
 *   2. inicial del segundo nombre + primer apellido (pperez)  si hay segundo nombre
 *   3. inicial del nombre + segundo apellido        (mflores) si hay segundo apellido
 */
export function usernameCandidates(input: PersonNames): string[] {
  const { given, surnames } = splitNames(input);
  const [name, secondName] = given;
  const [lastName, secondLastName] = surnames;
  if (!name) return [];
  if (!lastName) return [name.slice(0, MAX_LENGTH)];
  const list = [`${name[0]}${lastName}`];
  if (secondName) list.push(`${secondName[0]}${lastName}`);
  if (secondLastName) list.push(`${name[0]}${secondLastName}`);
  return [...new Set(list.map((c) => c.slice(0, MAX_LENGTH)))];
}

/** Primer candidato libre; si todos están tomados, el primero con un número al final (mperez2). */
export async function pickUsername(input: PersonNames, isTaken: (username: string) => Promise<boolean>): Promise<string> {
  const candidates = usernameCandidates(input);
  if (candidates.length === 0) {
    throw new ConflictException({ error: 'USERNAME_UNAVAILABLE', message: 'No se pudo generar un usuario a partir del nombre' });
  }
  for (const candidate of candidates) {
    if (!(await isTaken(candidate))) return candidate;
  }
  for (let n = 2; n <= MAX_SUFFIX; n += 1) {
    const candidate = `${candidates[0].slice(0, MAX_LENGTH - String(n).length)}${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new ConflictException({ error: 'USERNAME_UNAVAILABLE', message: 'No hay un usuario libre para este nombre' });
}
