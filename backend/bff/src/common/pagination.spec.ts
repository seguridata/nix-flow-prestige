import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { LEGACY_ARRAY_CAP, PageQueryDto, finishPage, pageArgs, prismaPage } from './pagination';

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id-${n - i}` }));

describe('pagination', () => {
  it('sin limit ni cursor: modo compat (array, tope 200)', () => {
    const a = pageArgs({});
    expect(a.paged).toBe(false);
    expect(prismaPage(a)).toEqual({ take: LEGACY_ARRAY_CAP });
    const r = rows(3);
    expect(finishPage(r, a)).toBe(r);
  });

  it('limit por defecto 50 cuando solo hay cursor y máx 200', () => {
    expect(pageArgs({ cursor: 'x' }).limit).toBe(50);
    expect(pageArgs({ limit: 5000 }).limit).toBe(200);
    expect(pageArgs({ limit: 0.2 }).limit).toBe(50);
  });

  it('pide limit+1 y usa skip:1 con cursor', () => {
    expect(prismaPage(pageArgs({ limit: 10 }))).toEqual({ take: 11 });
    expect(prismaPage(pageArgs({ limit: 10, cursor: 'abc' }))).toEqual({
      take: 11,
      skip: 1,
      cursor: { id: 'abc' },
    });
  });

  it('devuelve nextCursor = último id de la página cuando hay más', () => {
    const a = pageArgs({ limit: 2 });
    expect(finishPage(rows(3), a)).toEqual({ items: [{ id: 'id-3' }, { id: 'id-2' }], nextCursor: 'id-2' });
  });

  it('nextCursor null en la última página', () => {
    const a = pageArgs({ limit: 5 });
    expect(finishPage(rows(2), a)).toEqual({ items: rows(2), nextCursor: null });
  });

  it('DTO valida rangos de limit', () => {
    const ok = plainToInstance(PageQueryDto, { limit: '50', cursor: 'abc' });
    expect(validateSync(ok)).toHaveLength(0);
    expect(validateSync(plainToInstance(PageQueryDto, { limit: '201' }))).not.toHaveLength(0);
    expect(validateSync(plainToInstance(PageQueryDto, { limit: '0' }))).not.toHaveLength(0);
  });
});
