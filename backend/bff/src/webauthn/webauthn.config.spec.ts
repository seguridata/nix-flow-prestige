import { afterEach, describe, expect, it } from 'vitest';
import { WebauthnConfig } from './webauthn.config';

describe('WebauthnConfig', () => {
  const keys = ['PUBLIC_WEB_URL', 'WEBAUTHN_RP_ID', 'WEBAUTHN_RP_NAME'] as const;
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('deriva rpID del hostname de PUBLIC_WEB_URL cuando no hay override', () => {
    for (const k of keys) saved[k] = process.env[k];
    process.env.PUBLIC_WEB_URL = 'http://localhost:3001';
    delete process.env.WEBAUTHN_RP_ID;
    const cfg = new WebauthnConfig();
    expect(cfg.rpID).toBe('localhost');
    expect(cfg.origin).toBe('http://localhost:3001');
    expect(cfg.rpName).toBe('Prestige');
  });

  it('WEBAUTHN_RP_ID tiene prioridad sobre PUBLIC_WEB_URL', () => {
    for (const k of keys) saved[k] = process.env[k];
    process.env.PUBLIC_WEB_URL = 'https://firmar.prestige.mx';
    process.env.WEBAUTHN_RP_ID = 'prestige.mx';
    const cfg = new WebauthnConfig();
    expect(cfg.rpID).toBe('prestige.mx');
  });
});
