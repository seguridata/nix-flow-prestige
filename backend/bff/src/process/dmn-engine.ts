import { XMLParser } from 'fast-xml-parser';
import { evaluate, unaryTest } from 'feelin';

/**
 * Motor DMN real (M05). Evalúa una `<decisionTable>` DMN 1.1/1.3 contra un
 * contexto de entrada usando FEEL (`feelin`, el mismo motor de expresiones que
 * usa bpmn-io / dmn-js). Soporta hit policies FIRST, UNIQUE, ANY y COLLECT.
 *
 * Sustituye al `match` fijo contra una constante: `decide()` ahora evalúa de
 * verdad el `dmnXml` guardado en `ProcessDefinition`.
 */

export interface DmnDecisionResult {
  decisionId: string;
  hitPolicy: string;
  outputs: Record<string, unknown> | Record<string, unknown>[];
  matchedRules: string[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['decision', 'input', 'output', 'rule', 'inputEntry', 'outputEntry'].includes(name),
  removeNSPrefix: true,
});

function text(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node.trim();
  if (typeof node === 'object' && node && 'text' in node) return String((node as { text?: unknown }).text ?? '').trim();
  return String(node).trim();
}

function coerce(raw: string): unknown {
  if (raw === '') return undefined;
  try {
    return evaluate(raw, {}).value;
  } catch {
    return raw.replace(/^"|"$/g, '');
  }
}

export function evaluateDmn(
  dmnXml: string,
  context: Record<string, unknown>,
  decisionId?: string,
): DmnDecisionResult | null {
  const doc = parser.parse(dmnXml);
  const defs = doc.definitions ?? doc;
  const decisions: Record<string, unknown>[] = Array.isArray(defs.decision) ? defs.decision : [];
  const decision = decisionId
    ? decisions.find((d) => (d as Record<string, string>)['@_id'] === decisionId)
    : decisions[0];
  if (!decision) return null;

  const table = (decision as Record<string, unknown>).decisionTable as Record<string, unknown> | undefined;
  if (!table) return null;

  const hitPolicy = String(table['@_hitPolicy'] ?? 'UNIQUE').toUpperCase();
  const inputs = (Array.isArray(table.input) ? table.input : []) as Record<string, unknown>[];
  const outputs = (Array.isArray(table.output) ? table.output : []) as Record<string, unknown>[];
  const rules = (Array.isArray(table.rule) ? table.rule : []) as Record<string, unknown>[];

  const inputExprs = inputs.map((i) =>
    text((i.inputExpression as Record<string, unknown> | undefined)?.text ?? i.inputExpression),
  );
  const outputNames = outputs.map(
    (o, idx) => String(o['@_name'] ?? o['@_id'] ?? `output_${idx}`),
  );

  const matched: { ruleId: string; out: Record<string, unknown> }[] = [];

  for (const rule of rules) {
    const inputEntries = (Array.isArray(rule.inputEntry) ? rule.inputEntry : []) as unknown[];
    let allMatch = true;
    for (let i = 0; i < inputExprs.length; i++) {
      const testStr = text(inputEntries[i]);
      if (testStr === '' || testStr === '-') continue; // vacío = cualquier valor
      const value = safeEval(inputExprs[i], context);
      let pass = false;
      try {
        pass = unaryTest(testStr, { ...context, '?': value }).value === true;
      } catch {
        pass = false;
      }
      if (!pass) {
        allMatch = false;
        break;
      }
    }
    if (!allMatch) continue;

    const outEntries = (Array.isArray(rule.outputEntry) ? rule.outputEntry : []) as unknown[];
    const out: Record<string, unknown> = {};
    outputNames.forEach((name, idx) => {
      out[name] = coerce(text(outEntries[idx]));
    });
    matched.push({ ruleId: String(rule['@_id'] ?? `rule_${matched.length}`), out });

    if (hitPolicy === 'FIRST' || hitPolicy === 'UNIQUE' || hitPolicy === 'ANY') break;
  }

  if (matched.length === 0) return { decisionId: String(decision['@_id'] ?? 'decision'), hitPolicy, outputs: {}, matchedRules: [] };

  return {
    decisionId: String(decision['@_id'] ?? 'decision'),
    hitPolicy,
    outputs: hitPolicy === 'COLLECT' ? matched.map((m) => m.out) : matched[0].out,
    matchedRules: matched.map((m) => m.ruleId),
  };
}

function safeEval(expr: string, context: Record<string, unknown>): unknown {
  try {
    return evaluate(expr, context).value;
  } catch {
    return context[expr];
  }
}
