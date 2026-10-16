/**
 * ADR-004: barrido estático. Recorre backend/bff/src (sin specs) y falla si alguna
 * lectura/escritura MASIVA sobre un modelo con `tenantId` no fija `tenantId` en el
 * `where` (o un alta con objeto literal no lo trae en `data`), salvo que:
 *  - la consulta esté dentro de `runAsSystem(razón, …)`, o
 *  - su `modelo.operación` figure en `SYSTEM_EXCEPTIONS` del guard (con su justificación).
 * `where`/`data` que no son literales (variables, spreads de otro objeto) no se pueden
 * evaluar estáticamente: los cubre la prueba con el cliente real (tenant-guard.enforce.spec).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { SYSTEM_EXCEPTIONS, tenantModels } from './tenant-guard';

const SRC = join(__dirname, '..');
const MASS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'groupBy',
  'aggregate',
  'updateMany',
  'updateManyAndReturn',
  'deleteMany',
]);
const CREATES = new Set(['create', 'createMany', 'createManyAndReturn', 'upsert']);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function files(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

const keyOf = (p: ts.ObjectLiteralElementLike) => (p.name ? p.name.getText() : null);
const isUndefinedLiteral = (p: ts.ObjectLiteralElementLike) =>
  ts.isPropertyAssignment(p) && p.initializer.getText() === 'undefined';

/** 'yes' fija tenantId; 'no' seguro que no; 'dyn' no evaluable estáticamente. */
function hasTenant(node: ts.Expression | undefined): 'yes' | 'no' | 'dyn' {
  if (!node || !ts.isObjectLiteralExpression(node)) return 'dyn';
  let dyn = false;
  for (const p of node.properties) {
    if (ts.isSpreadAssignment(p)) {
      dyn = true;
      continue;
    }
    const k = keyOf(p);
    if (k === 'tenantId' || k?.startsWith('tenantId_')) {
      if (isUndefinedLiteral(p)) continue;
      return 'yes';
    }
    if (k === 'AND' && ts.isPropertyAssignment(p)) {
      const i = p.initializer;
      for (const e of ts.isArrayLiteralExpression(i) ? i.elements : [i]) {
        const r = hasTenant(e);
        if (r === 'yes') return 'yes';
        if (r === 'dyn') dyn = true;
      }
    }
    if (k === 'OR' && ts.isPropertyAssignment(p) && ts.isArrayLiteralExpression(p.initializer)) {
      const rs = p.initializer.elements.map(hasTenant);
      if (rs.length > 0 && rs.every((r) => r === 'yes')) return 'yes';
    }
  }
  return dyn ? 'dyn' : 'no';
}

const insideRunAsSystem = (n: ts.Node): boolean => {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === 'runAsSystem') return true;
  }
  return false;
};

function violations(): string[] {
  const models = new Set([...tenantModels()].map(lowerFirst));
  const out: string[] = [];
  for (const file of files(SRC)) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const rel = relative(SRC, file).split(sep).join('/');
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const op = n.expression.name.text;
        const target = n.expression.expression;
        if (ts.isPropertyAccessExpression(target) && models.has(target.name.text)) {
          const model = target.name.text;
          const arg = n.arguments[0];
          let bad = false;
          if (MASS.has(op)) {
            if (arg && ts.isObjectLiteralExpression(arg)) {
              const w = arg.properties.find((p) => keyOf(p) === 'where');
              const where = w && ts.isPropertyAssignment(w) ? w.initializer : undefined;
              // La guarda deja pasar un where con `id` (direccionado por PK): ver cabecera de tenant-guard.ts.
              const byId =
                where && ts.isObjectLiteralExpression(where) && where.properties.some((p) => keyOf(p) === 'id');
              bad = hasTenant(where) === 'no' && !byId;
            } else if (!arg) {
              bad = true;
            }
          } else if (CREATES.has(op) && arg && ts.isObjectLiteralExpression(arg)) {
            const key = op === 'upsert' ? 'create' : 'data';
            const d = arg.properties.find((p) => keyOf(p) === key);
            const data = d && ts.isPropertyAssignment(d) ? d.initializer : undefined;
            bad = hasTenant(data) === 'no';
          }
          if (bad && !insideRunAsSystem(n) && !SYSTEM_EXCEPTIONS[`${model}.${op}`]) {
            const { line } = sf.getLineAndCharacterOfPosition(n.getStart());
            out.push(`${rel}:${line + 1} ${model}.${op}`);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

describe('TENANT_GUARD: barrido estático de backend/bff/src', () => {
  it('ninguna consulta masiva o alta sobre modelos con tenantId queda sin acotar', () => {
    expect(violations()).toEqual([]);
  });

  it('el barrido detecta el patrón original (control)', () => {
    const sf = ts.createSourceFile(
      'x.ts',
      "prisma.signatureField.findMany({ where: { documentId } }); prisma.policy.findFirst({ where: { tenant: { OR: [] } } });",
      ts.ScriptTarget.Latest,
      true,
    );
    const where = (sf.statements[0] as ts.ExpressionStatement).expression as ts.CallExpression;
    const obj = (where.arguments[0] as ts.ObjectLiteralExpression).properties[0] as ts.PropertyAssignment;
    expect(hasTenant(obj.initializer)).toBe('no');
  });
});
