import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditChainService } from '../collaboration/audit-chain.service';
import {
  DerivedMissError,
  deriveValues,
  flowTableKeys,
  isObj,
  resolveFlow,
  type DerivedResult,
  type LookupExecutor,
  type LookupHit,
} from '../flow/flow';
import type { Flow, FlowValues, ResolvedStep } from '../flow/flow.types';
import { runLookup, type EngineTable, type LookupColumn } from './lookup-engine';
import { checkFlowAgainstTables } from './lookup-validation';

/** Persona que salió de la fila de una consulta. */
export interface LookupPick {
  signerId: string;
  name: string | null;
  email: string | null;
}

/** Qué se consultó y qué fila salió (sin valores de celdas): lo que queda en la auditoría `LOOKUP_RESOLVED`. */
export interface StepLookupTrace {
  stepId: string;
  table: string;
  /** null si la tabla no existe o está inactiva. */
  revision: number | null;
  /** null si no hubo coincidencia (el paso cae a «preguntar»). */
  rowId: string | null;
}

export interface FlowResolution {
  /** Valores capturados más las variables derivadas. */
  values: FlowValues;
  /** Pasos del flujo con `active` ya calculado con las derivadas. */
  resolved: ResolvedStep[];
  /** Por paso `lookup` activo: la persona, o null si no hubo coincidencia (→ preguntar). */
  picks: Map<string, LookupPick | null>;
  derived: DerivedResult[];
  steps: StepLookupTrace[];
}

type Json = unknown;
const cellText = (v: Json): string | null => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

/**
 * Resuelve las consultas de un flujo para UNA solicitud (ADR-008 §5): calcula las variables derivadas, decide qué pasos
 * aplican y resuelve cada participante `lookup` activo. Carga las tablas UNA vez por llamada, siempre acotadas al tenant.
 * Sin estado en el proceso.
 */
@Injectable()
export class FlowResolverService {
  private readonly log = new Logger(FlowResolverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditChainService,
  ) {}

  /**
   * `strict` (al crear la solicitud): una variable derivada con `onMiss: 'fail'` sin coincidencia responde 400.
   * Sin `strict` (vista previa) esa variable solo queda vacía.
   */
  async resolve(flow: Flow, values: FlowValues, tenantId: string, opts: { strict?: boolean } = {}): Promise<FlowResolution> {
    const tables = await this.load(flow, values, tenantId);
    const run: LookupExecutor = async (query, inputs): Promise<LookupHit | null> => {
      const t = tables.get(query.table);
      return t ? runLookup(t, query, inputs).hit : null;
    };

    let merged = values;
    let derived: DerivedResult[] = [];
    try {
      ({ values: merged, derived } = await deriveValues(flow, values, run, { strict: opts.strict }));
    } catch (e) {
      if (e instanceof DerivedMissError) {
        throw new BadRequestException(`No se pudo determinar «${e.label}» con los datos capturados. Revisa la solicitud o avisa a un administrador.`);
      }
      throw e;
    }

    const resolved = resolveFlow(flow, merged);
    const picks = new Map<string, LookupPick | null>();
    const steps: StepLookupTrace[] = [];
    for (const r of resolved) {
      const who = r.step.who;
      if (!r.active || who.type !== 'lookup') continue;
      const table = tables.get(who.query.table);
      const hit = table ? runLookup(table, who.query, merged).hit : null;
      const signerId = hit ? cellText(hit.values[who.person.signerId]) : null;
      // Una fila sin responsable (celda vacía) no resuelve a nadie: se pregunta, igual que sin coincidencia.
      const pick: LookupPick | null =
        hit && signerId
          ? {
              signerId,
              name: who.person.name ? cellText(hit.values[who.person.name]) : null,
              email: who.person.email ? cellText(hit.values[who.person.email]) : null,
            }
          : null;
      picks.set(r.step.id, pick);
      steps.push({ stepId: r.step.id, table: who.query.table, revision: table?.revision ?? null, rowId: pick && hit ? hit.rowId : null });
    }
    return { values: merged, resolved, picks, derived, steps };
  }

  /**
   * UNA carga de tablas (con sus filas activas) para todas las consultas de la solicitud. Sin derivadas solo se cargan las
   * de los pasos `lookup` que aplican; con derivadas se cargan todas las citadas (aún no se sabe qué pasos aplican).
   */
  private async load(flow: Flow, values: FlowValues, tenantId: string): Promise<Map<string, EngineTable>> {
    const keys = new Set<string>();
    for (const d of flow.derived ?? []) keys.add(d.query.table);
    const lookupSteps = flow.steps.filter((s) => s.who.type === 'lookup');
    if (lookupSteps.length) {
      const candidates = flow.derived?.length ? lookupSteps : resolveFlow(flow, values).filter((r) => r.active).map((r) => r.step).filter((s) => s.who.type === 'lookup');
      for (const s of candidates) if (s.who.type === 'lookup') keys.add(s.who.query.table);
    }
    const out = new Map<string, EngineTable>();
    if (!keys.size) return out;

    const tables = await this.prisma.lookupTable.findMany({
      where: { tenantId, key: { in: [...keys] }, active: true },
      include: { rows: { where: { tenantId, active: true }, orderBy: [{ position: 'asc' }, { id: 'asc' }] } },
    });
    for (const t of tables) {
      if (t.tenantId !== tenantId) continue; // defensa en profundidad: nunca una tabla de otro tenant
      out.set(t.key, {
        key: t.key,
        revision: t.revision,
        columns: Array.isArray(t.columns) ? (t.columns as unknown as LookupColumn[]) : [],
        rows: t.rows
          .filter((r) => r.tenantId === tenantId)
          .map((r) => ({ id: r.id, position: r.position, active: r.active, values: isObj(r.values) ? (r.values as Record<string, unknown>) : {} })),
      });
    }
    return out;
  }

  /**
   * Al crear o editar un formato: las tablas que cita el flujo deben existir y estar activas en el tenant, y las columnas
   * y operadores deben cuadrar con su definición. Responde 400 con los motivos.
   */
  async assertTables(flow: Flow, tenantId: string): Promise<void> {
    const keys = flowTableKeys(flow);
    if (!keys.length) return;
    const tables = await this.prisma.lookupTable.findMany({
      where: { tenantId, key: { in: keys }, active: true },
      select: { key: true, columns: true },
    });
    const map = new Map(tables.map((t) => [t.key, Array.isArray(t.columns) ? (t.columns as unknown as LookupColumn[]) : []]));
    const errors = checkFlowAgainstTables(flow, map);
    if (errors.length) throw new BadRequestException({ message: 'El formato consulta tablas que no cuadran', errors });
  }

  /**
   * Auditoría `LOOKUP_RESOLVED` al crear la solicitud: qué tabla, qué revisión y qué fila decidió cada paso. Sin valores
   * personales (ni nombres ni correos). Sin consultas no hay evento. Un fallo de la cadena se registra, no deshace la solicitud.
   */
  async recordResolved(input: {
    tenantId: string;
    actorId: string;
    templateId: string;
    requestId: string;
    documentId?: string;
    resolution: Pick<FlowResolution, 'steps' | 'derived'>;
  }): Promise<void> {
    const { steps, derived } = input.resolution;
    if (!steps.length && !derived.length) return;
    try {
      await this.audit.append({
        tenantId: input.tenantId,
        actorId: input.actorId,
        signatureRequestId: input.requestId,
        documentId: input.documentId,
        action: 'LOOKUP_RESOLVED',
        payload: {
          tenantId: input.tenantId,
          actorId: input.actorId,
          templateId: input.templateId,
          requestId: input.requestId,
          steps: steps.map((s) => ({ stepId: s.stepId, table: s.table, revision: s.revision, rowId: s.rowId })),
          derived: derived.map((d) => ({ key: d.key, table: d.table, revision: d.revision, rowId: d.rowId })),
        },
      });
    } catch (e) {
      this.log.error(`No se pudo registrar LOOKUP_RESOLVED de ${input.requestId}: ${(e as Error).message}`);
    }
  }
}
