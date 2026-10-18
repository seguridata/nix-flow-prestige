import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { temporalConnectionConfig } from './connection-config';

describe('Temporal shared connection configuration', () => {
  it('keeps local development unencrypted and on the existing queue', () => {
    expect(temporalConnectionConfig({})).toEqual({ connection: { address: 'localhost:7233' }, namespace: 'default', taskQueue: 'prestige' });
  });
  it('enables TLS and namespace routing for Cloud API keys', () => {
    expect(temporalConnectionConfig({ TEMPORAL_ADDRESS: 'us-east-1.aws.api.temporal.io:7233', TEMPORAL_NAMESPACE: 'prestige.acme', TEMPORAL_API_KEY: 'test-key', TEMPORAL_TASK_QUEUE: 'premium' })).toEqual({
      connection: { address: 'us-east-1.aws.api.temporal.io:7233', tls: {}, apiKey: 'test-key', metadata: { 'temporal-namespace': 'prestige.acme' } }, namespace: 'prestige.acme', taskQueue: 'premium',
    });
  });
  it('never sends credentials over explicitly plaintext transport', () => {
    expect(() => temporalConnectionConfig({ TEMPORAL_API_KEY: 'test-key', TEMPORAL_TLS: 'false' })).toThrow('TLS');
  });
  it('rejects partial mTLS before attempting a network connection', () => {
    expect(() => temporalConnectionConfig({ TEMPORAL_TLS_CERT_PATH: 'cert.pem' })).toThrow('both');
  });
  it('rejects ambiguous authentication', () => {
    expect(() => temporalConnectionConfig({ TEMPORAL_TLS_CERT_PATH: 'cert.pem', TEMPORAL_TLS_KEY_PATH: 'key.pem', TEMPORAL_API_KEY: 'key' })).toThrow('Choose');
  });
  it('requires authentication and an explicit namespace for Cloud', () => {
    expect(() => temporalConnectionConfig({ TEMPORAL_ADDRESS: 'tenant.tmprl.cloud:7233' })).toThrow('requires');
  });
  it('loads mounted mTLS material for both SDKs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'temporal-config-'));
    try {
      const cert = join(dir, 'cert.pem');
      const key = join(dir, 'key.pem');
      const ca = join(dir, 'ca.pem');
      writeFileSync(cert, 'test certificate');
      writeFileSync(key, 'test private key');
      writeFileSync(ca, 'test CA');
      const config = temporalConnectionConfig({ TEMPORAL_TLS_CERT_PATH: cert, TEMPORAL_TLS_KEY_PATH: key, TEMPORAL_TLS_CA_PATH: ca });
      expect(config.connection.tls).toEqual({ serverRootCACertificate: Buffer.from('test CA'), clientCertPair: { crt: Buffer.from('test certificate'), key: Buffer.from('test private key') } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('recognizes Cloud addresses without an explicit port', () => {
    expect(() => temporalConnectionConfig({ TEMPORAL_ADDRESS: 'tenant.tmprl.cloud' })).toThrow('requires');
  });
  it('rejects invalid TLS toggles', () => {
    expect(() => temporalConnectionConfig({ TEMPORAL_TLS: 'yes' })).toThrow('true or false');
  });
});
