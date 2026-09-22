import { randomUUID } from 'node:crypto';

/**
 * M14 — evento en formato CloudEvents 1.0 (spec.cloudevents.io). El `data` es
 * el cuerpo específico del dominio; el sobre es estable entre tipos.
 */
export interface CloudEvent<T = unknown> {
  specversion: '1.0';
  id: string;
  source: string;
  type: string;
  subject?: string;
  time: string;
  datacontenttype: 'application/json';
  tenantid: string;
  data: T;
}

export const EVENT_TYPES = {
  requestCompleted: 'mx.seguridata.prestige.request.completed',
  evidenceSealed: 'mx.seguridata.prestige.evidence.sealed',
  onboardingEnabled: 'mx.seguridata.prestige.onboarding.enabled',
} as const;

export type KnownEventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export function cloudEvent<T>(params: {
  type: string;
  data: T;
  subject?: string;
  tenantId?: string;
  source?: string;
}): CloudEvent<T> {
  return {
    specversion: '1.0',
    id: randomUUID(),
    source: params.source ?? '/prestige/bff',
    type: params.type,
    subject: params.subject,
    time: new Date().toISOString(),
    datacontenttype: 'application/json',
    tenantid: params.tenantId ?? 'seguridata',
    data: params.data,
  };
}
