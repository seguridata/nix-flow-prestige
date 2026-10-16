/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Prisma en memoria SOLO para las pruebas de las tablas de consulta: implementa las pocas llamadas que usan
 * `LookupTablesService` y `FlowResolverService`, respetando `where` por tenant. No es código de producción.
 */

/** Espía mínimo (sin depender de vitest para que el archivo compile en el build): guarda las llamadas en `.mock.calls`. */
function spy<A extends any[], R>(fn: (...a: A) => R): ((...a: A) => R) & { mock: { calls: A[] } } {
  const calls: A[] = [];
  const wrapped = ((...a: A) => {
    calls.push(a);
    return fn(...a);
  }) as ((...a: A) => R) & { mock: { calls: A[] } };
  wrapped.mock = { calls };
  return wrapped;
}

type Rec = Record<string, any>;

const matches = (rec: Rec, where: Rec = {}): boolean =>
  Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Rec[]).some((w) => matches(rec, w));
    if (k === 'AND') return (v as Rec[]).every((w) => matches(rec, w));
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      const op = v as Rec;
      if ('in' in op && !(op.in as unknown[]).includes(rec[k])) return false;
      if ('gt' in op && !(rec[k] > op.gt)) return false;
      if ('gte' in op && !(rec[k] >= op.gte)) return false;
      if ('lt' in op && !(rec[k] < op.lt)) return false;
      if ('lte' in op && !(rec[k] <= op.lte)) return false;
      return true;
    }
    return rec[k] === v;
  });

/** Sin mayúsculas ni acentos: lo que hace en SQL la búsqueda (`translate(lower(...))`). */
const fold = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const sorter = (orderBy: Rec[] | Rec | undefined) => {
  const list = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  return (a: Rec, b: Rec) => {
    for (const o of list) {
      const [k, dir] = Object.entries(o)[0] as [string, 'asc' | 'desc'];
      const c = a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0;
      if (c) return dir === 'desc' ? -c : c;
    }
    return 0;
  };
};

const pick = (rec: Rec, select?: Rec) => {
  if (!select) return { ...rec };
  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, rec[k]]));
};

export function makeLookupDb(seed: { tables?: Rec[]; rows?: Rec[]; templates?: Rec[]; definitions?: Rec[] } = {}) {
  let n = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const id = (p: string) => `${p}-${String(++n).padStart(4, '0')}`;
  const state: { tables: Rec[]; rows: Rec[]; templates: Rec[]; definitions: Rec[] } = {
    tables: (seed.tables ?? []).map((t) => ({ revision: 1, active: true, description: null, ...t })),
    rows: (seed.rows ?? []).map((r) => ({ active: true, position: 0, ...r })),
    templates: seed.templates ?? [],
    definitions: seed.definitions ?? [],
  };

  const rowQuery = (args: Rec = {}) => {
    let out = state.rows.filter((r) => matches(r, args.where)).sort(sorter(args.orderBy));
    if (args.cursor) {
      const at = out.findIndex((r) => r.id === args.cursor.id);
      out = at < 0 ? [] : out.slice(at + (args.skip ?? 0));
    }
    if (args.take !== undefined) out = out.slice(0, args.take);
    return out;
  };

  const db: Rec = {
    state,
    lookupTable: {
      findFirst: spy(async (a: Rec) => {
        const t = state.tables.find((x) => matches(x, a.where));
        return t ? pick(t, a.select) : null;
      }),
      findMany: spy(async (a: Rec = {}) => {
        let out = state.tables.filter((x) => matches(x, a.where)).sort(sorter(a.orderBy));
        if (a.take !== undefined) out = out.slice(0, a.take);
        return out.map((t) => {
          const base: Rec = pick(t, a.select);
          if (a.include?._count) base._count = { rows: state.rows.filter((r) => r.tableId === t.id).length };
          if (a.include?.rows) base.rows = rowQuery({ where: { ...a.include.rows.where, tableId: t.id }, orderBy: a.include.rows.orderBy });
          return base;
        });
      }),
      create: spy(async ({ data }: Rec) => {
        const t = { id: id('tbl'), revision: 1, active: true, description: null, createdAt: new Date(), ...data };
        state.tables.push(t);
        return { ...t };
      }),
      updateMany: spy(async ({ where, data }: Rec) => {
        const hit = state.tables.filter((x) => matches(x, where));
        for (const t of hit) {
          for (const [k, v] of Object.entries(data)) {
            if (v && typeof v === 'object' && 'increment' in (v as Rec)) t[k] += (v as Rec).increment;
            else t[k] = v;
          }
        }
        return { count: hit.length };
      }),
      deleteMany: spy(async ({ where }: Rec) => {
        const hit = state.tables.filter((x) => matches(x, where));
        for (const t of hit) {
          state.tables.splice(state.tables.indexOf(t), 1);
          state.rows = state.rows.filter((r) => r.tableId !== t.id); // ON DELETE CASCADE
        }
        return { count: hit.length };
      }),
    },
    lookupRow: {
      findFirst: spy(async (a: Rec) => {
        const r = state.rows.find((x) => matches(x, a.where));
        return r ? pick(r, a.select) : null;
      }),
      findMany: spy(async (a: Rec = {}) => rowQuery(a).map((r) => pick(r, a.select))),
      count: spy(async ({ where }: Rec = {}) => state.rows.filter((r) => matches(r, where)).length),
      aggregate: spy(async ({ where }: Rec) => {
        const ps = state.rows.filter((r) => matches(r, where)).map((r) => r.position);
        return { _max: { position: ps.length ? Math.max(...ps) : null } };
      }),
      create: spy(async ({ data }: Rec) => {
        const r = { id: id('row'), active: true, position: 0, createdAt: new Date(), ...data };
        state.rows.push(r);
        return { ...r };
      }),
      createMany: spy(async ({ data }: Rec) => {
        for (const d of data as Rec[]) state.rows.push({ id: id('row'), active: true, position: 0, ...d });
        return { count: (data as Rec[]).length };
      }),
      updateMany: spy(async ({ where, data }: Rec) => {
        const hit = state.rows.filter((x) => matches(x, where));
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      }),
      deleteMany: spy(async ({ where }: Rec) => {
        const hit = state.rows.filter((x) => matches(x, where));
        state.rows = state.rows.filter((r) => !hit.includes(r));
        return { count: hit.length };
      }),
    },
    documentTemplate: { findMany: spy(async ({ where }: Rec) => state.templates.filter((t) => matches(t, where))) },
    processDefinition: { findMany: spy(async ({ where }: Rec) => state.definitions.filter((t) => matches(t, where))) },
    /**
     * Las transacciones se serializan (cola): en producción lo garantiza el `SELECT … FOR UPDATE` sobre la tabla, y así las
     * pruebas de concurrencia (dos movimientos a la vez) ejercen el mismo contrato.
     */
    $transaction: spy((cb: (tx: Rec) => unknown) => {
      const run = queue.then(() => cb(db));
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    }),
    /** SQL crudo de lectura: el bloqueo `FOR UPDATE` de la tabla y la búsqueda de filas (conteo y página) con `jsonb_each_text`. */
    $queryRaw: spy(async (arg: any, ...rest: any[]) => {
      const strings: readonly string[] = Array.isArray(arg) ? arg : arg.strings;
      const v: any[] = Array.isArray(arg) ? rest : arg.values;
      const sql = strings.join('?');
      if (sql.includes('FOR UPDATE')) {
        const [tableId, tenantId] = v as [string, string];
        return state.tables.some((t) => t.id === tableId && t.tenantId === tenantId) ? [{ id: tableId }] : [];
      }
      if (sql.includes('jsonb_each_text')) {
        // Mismo orden de valores que arma el servicio: tableId, tenantId, [active], patrón LIKE, [position, id], [limit].
        const vals = [...v];
        const tableId = vals.shift();
        const tenantId = vals.shift();
        const active = sql.includes('"active" =') ? (vals.shift() as boolean) : undefined;
        const like = vals.shift() as string;
        const needle = like.slice(1, -1).replace(/\\([\\%_])/g, '$1');
        let out = state.rows
          .filter((r) => r.tableId === tableId && r.tenantId === tenantId && (active === undefined || r.active === active))
          .filter((r) => Object.values(r.values as Rec).some((x) => x !== null && x !== undefined && fold(x).includes(needle)))
          .sort(sorter([{ position: 'asc' }, { id: 'asc' }]));
        if (sql.includes('count(*)')) return [{ n: out.length }];
        if (sql.includes('(r."position", r."id") >')) {
          const [p, i] = vals.splice(0, 2) as [number, string];
          out = out.filter((r) => r.position > p || (r.position === p && r.id > i));
        }
        return out.slice(0, vals.shift() as number).map((r) => ({ id: r.id, values: r.values, position: r.position, active: r.active }));
      }
      throw new Error(`SQL crudo de lectura no soportado por el fake: ${sql}`);
    }),
    /** Las dos sentencias crudas del servicio: reordenar (position) y quitar claves de columnas (values - text[]). */
    $executeRaw: spy(async (strings: TemplateStringsArray, ...v: any[]) => {
      const sql = strings.join('?');
      if (sql.includes('"position"')) {
        const [order, positions, tableId, tenantId] = v as [string[], number[], string, string];
        order.forEach((rowId, i) => {
          const r = state.rows.find((x) => x.id === rowId && x.tableId === tableId && x.tenantId === tenantId);
          if (r) r.position = positions[i];
        });
        return order.length;
      }
      if (sql.includes('"values" -')) {
        const [removed, tableId, tenantId] = v as [string[], string, string];
        for (const r of state.rows.filter((x) => x.tableId === tableId && x.tenantId === tenantId)) {
          r.values = Object.fromEntries(Object.entries(r.values).filter(([k]) => !removed.includes(k)));
        }
        return 1;
      }
      throw new Error(`SQL crudo no soportado por el fake: ${sql}`);
    }),
  };
  return db;
}

export const columnsFixture = [
  { key: 'etapa', label: 'Etapa', type: 'select', options: ['area', 'tipoGasto'] },
  { key: 'area', label: 'Área', type: 'text' },
  { key: 'montoMin', label: 'Monto desde', type: 'number' },
  { key: 'vigencia', label: 'Vigencia', type: 'date' },
  { key: 'signerId', label: 'Responsable', type: 'text' },
  { key: 'nombre', label: 'Nombre', type: 'text' },
  { key: 'correo', label: 'Correo', type: 'text' },
];
