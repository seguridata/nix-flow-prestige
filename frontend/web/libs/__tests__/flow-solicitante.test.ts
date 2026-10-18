import { describe, expect, it } from "vitest";
import { emptyFlow, flowProblems, type Flow } from "@/libs/flow";

const flow = (): Flow => ({
  ...emptyFlow(),
  variables: [],
  steps: [{ id: "firma", label: "Autorizar", role: "FIRMANTE", who: {
    type: "lookup", query: { table: "jefes", match: [{ column: "usuario", op: "eq", source: { var: "solicitante" } }] },
    person: { signerId: "responsable" }, prompt: "Responsable",
  } }],
});

describe("Authenticated requester in lookup configuration", () => {
  it("accepts solicitante without exposing it as an editable form variable", () => {
    expect(flowProblems(flow())).toEqual([]);
    expect(flow().variables).toEqual([]);
  });
  it("accepts requester matching in derived variables", () => {
    const f = flow();
    f.derived = [{ key: "responsable", label: "Responsable", type: "text", column: "responsable", query: { table: "jefes", match: [{ column: "usuario", op: "eq", source: { var: "solicitante" } }] } }];
    expect(flowProblems(f)).toEqual([]);
  });
  it("rejects editable or derived values shadowing the authenticated identity", () => {
    const f = flow();
    f.variables = [{ key: "solicitante", label: "Solicitante", type: "text", required: true }];
    expect(flowProblems(f).length).toBeGreaterThan(0);
    f.variables = [];
    f.derived = [{ key: "solicitante", label: "Solicitante", type: "text", column: "responsable", query: { table: "jefes", match: [] } }];
    expect(flowProblems(f).length).toBeGreaterThan(0);
  });
});
