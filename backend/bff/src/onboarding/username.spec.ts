import { describe, expect, it } from 'vitest';
import { pickUsername, splitNames, usernameCandidates } from './username';

const free = async () => false;
const takenSet = (...taken: string[]) => async (u: string) => taken.includes(u);

describe('usernameCandidates', () => {
  it('inicial del nombre + primer apellido, con segundo nombre y segundo apellido de respaldo', () => {
    expect(
      usernameCandidates({ fullName: 'x', givenNames: 'Maya Pamela', lastName: 'Perez', secondLastName: 'Flores' }),
    ).toEqual(['mperez', 'pperez', 'mflores']);
  });

  it('sin segundo nombre, el respaldo es el segundo apellido', () => {
    expect(usernameCandidates({ fullName: 'x', givenNames: 'Luis', lastName: 'Sotelo', secondLastName: 'Ruiz' })).toEqual([
      'lsotelo',
      'lruiz',
    ]);
  });

  it('sin acentos, eñes ni signos', () => {
    expect(usernameCandidates({ fullName: 'x', givenNames: 'Álvaro', lastName: 'Núñez' })).toEqual(['anunez']);
  });

  it('las partículas forman parte del apellido', () => {
    expect(usernameCandidates({ fullName: 'x', givenNames: 'Ana', lastName: 'de la Cruz' })).toEqual(['adelacruz']);
    expect(usernameCandidates({ fullName: 'Ana María de la Cruz Soto' })).toEqual(['adelacruz', 'mdelacruz', 'asoto']);
  });

  it('solo con nombre completo: dos palabras son nombre y apellido', () => {
    expect(usernameCandidates({ fullName: 'Juan Pérez' })).toEqual(['jperez']);
  });

  it('solo con nombre completo: tres palabras son un nombre y dos apellidos', () => {
    expect(splitNames({ fullName: 'Luis Sotelo Ruiz' })).toEqual({ given: ['luis'], surnames: ['sotelo', 'ruiz'] });
  });

  it('solo con nombre completo: cuatro palabras son dos nombres y dos apellidos', () => {
    expect(usernameCandidates({ fullName: 'Maya Pamela Perez Flores' })).toEqual(['mperez', 'pperez', 'mflores']);
  });

  it('una sola palabra: el usuario es esa palabra', () => {
    expect(usernameCandidates({ fullName: 'Madonna' })).toEqual(['madonna']);
  });

  it('sin letras no hay candidatos', () => {
    expect(usernameCandidates({ fullName: '123' })).toEqual([]);
  });
});

describe('pickUsername', () => {
  const maya = { fullName: 'x', givenNames: 'Maya Pamela', lastName: 'Perez', secondLastName: 'Flores' };

  it('usa el primero si está libre', async () => {
    expect(await pickUsername(maya, free)).toBe('mperez');
  });

  it('duplicado: inicial del segundo nombre + primer apellido', async () => {
    expect(await pickUsername(maya, takenSet('mperez'))).toBe('pperez');
  });

  it('sin segundo nombre y duplicado: inicial del nombre + segundo apellido', async () => {
    const luis = { fullName: 'x', givenNames: 'Luis', lastName: 'Sotelo', secondLastName: 'Ruiz' };
    expect(await pickUsername(luis, takenSet('lsotelo'))).toBe('lruiz');
  });

  it('agotados los candidatos, agrega un número al primero', async () => {
    expect(await pickUsername(maya, takenSet('mperez', 'pperez', 'mflores'))).toBe('mperez2');
    expect(await pickUsername(maya, takenSet('mperez', 'pperez', 'mflores', 'mperez2'))).toBe('mperez3');
  });

  it('falla de forma explícita si no hay usuario posible', async () => {
    await expect(pickUsername({ fullName: '123' }, free)).rejects.toMatchObject({ response: { error: 'USERNAME_UNAVAILABLE' } });
    await expect(pickUsername(maya, async () => true)).rejects.toMatchObject({ response: { error: 'USERNAME_UNAVAILABLE' } });
  });
});
