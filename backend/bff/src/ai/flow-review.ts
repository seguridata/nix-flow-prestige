import { validateFlow } from '../flow/flow';
import type { Condition, Flow } from '../flow/flow.types';

export interface Finding {
  id: string;
  severity: 'error' | 'warn' | 'info';
  title: string;
  detail: string;
  stepId?: string;
  /** `regla`: se comprueba con código, sin IA. `ia`: opinión de un modelo. */
  source: 'regla' | 'ia';
}

/** Cota inferior/superior que imponen las condiciones numéricas sobre una variable. */
function impossible(conds: Condition[]): boolean {
  const byVar = new Map<string, Condition[]>();
  for (const c of conds) if (typeof c.value === 'number') byVar.set(c.variable, [...(byVar.get(c.variable) ?? []), c]);
  for (const list of byVar.values()) {
    let lo = -Infinity;
    let loStrict = false;
    let hi = Infinity;
    let hiStrict = false;
    for (const c of list) {
      const v = c.value as number;
      if ((c.op === '>' || c.op === '>=' || c.op === '==') && (v > lo || (v === lo && c.op === '>'))) {
        lo = v;
        loStrict = c.op === '>';
      }
      if ((c.op === '<' || c.op === '<=' || c.op === '==') && (v < hi || (v === hi && c.op === '<'))) {
        hi = v;
        hiStrict = c.op === '<';
      }
    }
    if (lo > hi || (lo === hi && (loStrict || hiStrict))) return true;
  }
  return false;
}

/**
 * Revisión determinista de un flujo: lo que se puede comprobar con reglas no necesita un modelo.
 * Si el flujo no pasa `validateFlow`, solo se devuelven esos errores (el resto no tiene sentido).
 */
export function reviewFlow(flow: Flow): Finding[] {
  const invalid = validateFlow(flow);
  if (invalid.length) {
    return invalid.map((title, i) => ({ id: `invalido-${i + 1}`, severity: 'error' as const, title, detail: 'El sistema rechazaría este flujo al guardarlo.', source: 'regla' as const }));
  }
  const out: Finding[] = [];
  const add = (f: Omit<Finding, 'source'>) => out.push({ ...f, source: 'regla' });

  if (flow.order === 'SECUENCIAL' && flow.slaHours < flow.steps.length * 8) {
    add({ id: 'sla-ajustado', severity: 'warn', title: `Plazo de ${flow.slaHours} h para ${flow.steps.length} pasos en secuencia`, detail: 'Es válido, pero deja menos de 8 horas por paso y es probable que venza.' });
  }
  if (!flow.steps.some((s) => s.role === 'FIRMANTE')) {
    add({ id: 'sin-firmantes', severity: 'warn', title: 'Ningún paso es de firma', detail: 'Todos los pasos son de revisión, así que nadie firmará el documento.' });
  }
  const seen = new Map<string, string>();
  for (const s of flow.steps) {
    const key = s.label.trim().toLowerCase();
    if (seen.has(key)) add({ id: 'paso-repetido', severity: 'warn', title: `El paso «${s.label}» aparece más de una vez`, detail: 'Si es la misma persona, quizá sobra uno.', stepId: s.id });
    seen.set(key, s.id);
  }
  const initiators = flow.steps.filter((s) => s.who.type === 'initiator');
  if (initiators.length > 1) {
    add({ id: 'iniciador-repetido', severity: 'info', title: `Quien inicia participa en ${initiators.length} pasos`, detail: 'Si no es intencional, parece un paso duplicado.' });
  }
  for (const s of flow.steps) {
    if (s.when?.length && impossible(s.when)) {
      add({ id: 'condicion-imposible', severity: 'error', title: `Las condiciones de «${s.label}» nunca se cumplen juntas`, detail: 'Piden un rango de valores que no existe, así que el paso jamás se activará.', stepId: s.id });
    }
  }
  return out;
}
