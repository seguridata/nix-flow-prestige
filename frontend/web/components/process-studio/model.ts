import type { Flow } from "@/libs/flow";

export interface ProcessDefinition {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  version: number;
  bpmnXml: string;
  dmnXml?: string | null;
  flow?: Flow | null;
  published?: boolean;
  tenantId?: string | null;
  versionCount?: number;
  publishedVersion?: number | null;
  source?: "tenant" | "platform";
  createdAt?: string;
}

/** Defensive grouping also handles legacy APIs returning all versions. Tenant overrides platform. */
export function currentProcesses(
  definitions: ProcessDefinition[],
): ProcessDefinition[] {
  const grouped = new Map<string, ProcessDefinition[]>();
  for (const row of definitions)
    grouped.set(row.key, [...(grouped.get(row.key) ?? []), row]);
  return [...grouped.values()]
    .map((versions) => {
      const owned = versions.filter((v) => v.tenantId || v.source === "tenant");
      const effective = (owned.length ? owned : versions).sort(
        (a, b) => b.version - a.version,
      );
      const latest = effective[0]!;
      return {
        ...latest,
        versionCount: latest.versionCount ?? effective.length,
        publishedVersion:
          latest.publishedVersion ??
          effective.find((v) => v.published)?.version ??
          null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es-MX"));
}

export function versionChanges(
  before: ProcessDefinition,
  after: ProcessDefinition,
): string[] {
  const changes: string[] = [];
  if (before.name !== after.name) changes.push("Nombre del proceso");
  if (before.description !== after.description) changes.push("Descripción");
  if (before.bpmnXml !== after.bpmnXml) changes.push("Diagrama BPMN");
  if (before.dmnXml !== after.dmnXml) changes.push("Decisiones DMN");
  const a = before.flow;
  const b = after.flow;
  if (JSON.stringify(a?.variables) !== JSON.stringify(b?.variables))
    changes.push("Datos de la solicitud");
  if (JSON.stringify(a?.derived) !== JSON.stringify(b?.derived))
    changes.push("Consultas y datos calculados");
  if (JSON.stringify(a?.steps) !== JSON.stringify(b?.steps))
    changes.push("Etapas, responsables o condiciones");
  if (a?.order !== b?.order) changes.push("Orden de aprobación");
  if (a?.slaHours !== b?.slaHours) changes.push("Plazo de atención");
  return changes;
}

export function matchesProcess(
  runKey: string,
  definition: Pick<ProcessDefinition, "key" | "bpmnXml">,
): boolean {
  const ids = [
    ...definition.bpmnXml.matchAll(
      /<(?:\w+:)?process\b[^>]*\bid=["']([^"']+)["']/g,
    ),
  ].map((m) => m[1]);
  return [definition.key, ...ids].includes(runKey);
}
