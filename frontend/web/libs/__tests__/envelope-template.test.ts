import { describe, expect, it } from "vitest";
import { applyEnvelopeTemplate, draftToTemplateBody, type EnvelopeTemplate } from "@/libs/envelope-template";

const template: EnvelopeTemplate = {
  id: "t1",
  tenantId: "seguridata",
  name: "Contrato estándar",
  order: "PARALELO",
  kycPolicy: "ONCE",
  allowedMethods: ["DIGITAL", "ACCEPT"],
  requirePasskey: true,
  slaHours: 48,
  createdAt: "2026-10-05T00:00:00.000Z",
};

describe("applyEnvelopeTemplate", () => {
  it("copia métodos, orden, kyc, passkey y sla sin mutar la plantilla", () => {
    const draft = applyEnvelopeTemplate(template);
    draft.methods.push("AUTOGRAFA");
    expect(template.allowedMethods).toEqual(["DIGITAL", "ACCEPT"]);
    expect(draft).toMatchObject({
      sequential: false,
      kycPolicy: "ONCE",
      requirePasskey: true,
      slaHours: 48,
    });
    expect(draft.methods).toEqual(["DIGITAL", "ACCEPT", "AUTOGRAFA"]);
  });

  it("un orden SECUENCIAL queda como sequential", () => {
    expect(applyEnvelopeTemplate({ ...template, order: "SECUENCIAL" }).sequential).toBe(true);
  });
});

describe("draftToTemplateBody", () => {
  it("recorta el nombre y traduce el orden", () => {
    expect(
      draftToTemplateBody("  Nómina  ", {
        methods: ["ACCEPT"],
        sequential: true,
        kycPolicy: "NONE",
        requirePasskey: false,
        slaHours: 72,
      }),
    ).toEqual({
      name: "Nómina",
      order: "SECUENCIAL",
      kycPolicy: "NONE",
      allowedMethods: ["ACCEPT"],
      requirePasskey: false,
      slaHours: 72,
    });
  });
});
