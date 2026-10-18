import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from '@temporalio/client';
import type { NativeConnectionOptions } from '@temporalio/worker';

/** Shared by the API, reconciler and worker. Secrets are never logged. */
export function temporalConnectionConfig(env: NodeJS.ProcessEnv = process.env) {
  const address = env.TEMPORAL_ADDRESS?.trim() || 'localhost:7233';
  const namespace = env.TEMPORAL_NAMESPACE?.trim() || 'default';
  const apiKey = env.TEMPORAL_API_KEY?.trim();
  const cert = env.TEMPORAL_TLS_CERT_PATH;
  const key = env.TEMPORAL_TLS_KEY_PATH;
  const ca = env.TEMPORAL_TLS_CA_PATH;
  if (!!cert !== !!key) throw new Error('Temporal TLS requires both certificate and key paths');
  if (apiKey && cert) throw new Error('Choose Temporal API key or mTLS authentication');
  if (env.TEMPORAL_TLS && !['true', 'false'].includes(env.TEMPORAL_TLS)) {
    throw new Error('TEMPORAL_TLS must be true or false');
  }
  const cloud = /\.(tmprl\.cloud|temporal\.io)(?::\d+)?$/.test(address);
  const secure = !!(apiKey || cert || ca || cloud || env.TEMPORAL_TLS === 'true');
  if (secure && env.TEMPORAL_TLS === 'false') throw new Error('Temporal credentials require TLS');
  if (cloud && (!env.TEMPORAL_NAMESPACE?.trim() || namespace === 'default' || (!apiKey && !cert))) {
    throw new Error('Temporal Cloud requires a namespace and API key or mTLS');
  }
  const tls = secure ? {
    ...(ca ? { serverRootCACertificate: readFileSync(ca) } : {}),
    ...(cert && key ? { clientCertPair: { crt: readFileSync(cert), key: readFileSync(key) } } : {}),
  } : undefined;
  const connection = {
    address,
    ...(tls ? { tls } : {}),
    ...(apiKey ? { apiKey, metadata: { 'temporal-namespace': namespace } } : {}),
  } satisfies ConnectionOptions & NativeConnectionOptions;
  return { connection, namespace, taskQueue: env.TEMPORAL_TASK_QUEUE?.trim() || 'prestige' };
}
