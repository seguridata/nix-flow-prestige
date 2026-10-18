import { describe, expect, it } from "vitest";
import {
  currentProcesses,
  matchesProcess,
  versionChanges,
  type ProcessDefinition,
} from "../model";

const make = (
  overrides: Partial<ProcessDefinition> = {},
): ProcessDefinition => ({
  id: "a",
  key: "gastos",
  name: "Gastos",
  version: 1,
  bpmnXml: '<bpmn:process id="adquisiciones"/>',
  ...overrides,
});

describe("process catalogue", () => {
  it("shows a single effective tenant process even when the platform has a higher version", () => {
    const rows = currentProcesses([
      make({ id: "global", version: 30 }),
      make({ id: "local1", version: 1, tenantId: "t", published: true }),
      make({ id: "local2", version: 2, tenantId: "t" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "local2",
      version: 2,
      versionCount: 2,
      publishedVersion: 1,
    });
  });
  it("preserves catalogue version and publication metadata", () => {
    expect(
      currentProcesses([make({ versionCount: 9, publishedVersion: 4 })])[0],
    ).toMatchObject({ versionCount: 9, publishedVersion: 4 });
  });
  it("scopes workflow runs to exact key or BPMN process id, never unrelated names", () => {
    expect(matchesProcess("adquisiciones", make())).toBe(true);
    expect(matchesProcess("gastos", make())).toBe(true);
    expect(matchesProcess("contratoDosPartes", make())).toBe(false);
  });
  it("detects semantic changes in conditions, participants and data rather than only count", () => {
    const flow = {
      variables: [],
      order: "SECUENCIAL" as const,
      slaHours: 72,
      steps: [
        {
          id: "revision",
          label: "Revisión",
          role: "REVISOR" as const,
          who: { type: "fixed" as const, signerId: "a" },
        },
      ],
    };
    const changes = versionChanges(
      make({ flow }),
      make({
        flow: {
          ...flow,
          steps: [{ ...flow.steps[0]!, who: { type: "fixed", signerId: "b" } }],
        },
      }),
    );
    expect(changes).toEqual(["Etapas, responsables o condiciones"]);
  });
});
