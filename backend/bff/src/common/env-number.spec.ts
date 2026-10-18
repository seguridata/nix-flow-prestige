import { describe, expect, it } from 'vitest';
import { envPositiveInt } from './env-number';

describe('envPositiveInt', () => {
  it('usa el default si falta, está vacía o es inválida', () => {
    expect(envPositiveInt('X', 5, {})).toBe(5);
    expect(envPositiveInt('X', 5, { X: '' })).toBe(5);
    expect(envPositiveInt('X', 5, { X: 'abc' })).toBe(5);
    expect(envPositiveInt('X', 5, { X: '0' })).toBe(5);
    expect(envPositiveInt('X', 5, { X: '-3' })).toBe(5);
  });
  it('lee enteros válidos y trunca decimales', () => {
    expect(envPositiveInt('X', 5, { X: '40' })).toBe(40);
    expect(envPositiveInt('X', 5, { X: '7.9' })).toBe(7);
  });
});
