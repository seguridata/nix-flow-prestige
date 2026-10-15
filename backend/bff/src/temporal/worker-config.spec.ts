import { describe, expect, it } from 'vitest';
import { temporalWorkerLimits } from './worker-config';

describe('temporalWorkerLimits', () => {
  it('defaults razonables', () => {
    expect(temporalWorkerLimits({})).toEqual({
      maxConcurrentActivityTaskExecutions: 20,
      maxCachedWorkflows: 250,
      shutdownGraceTime: 30_000,
    });
  });
  it('se configura por env e ignora valores inválidos', () => {
    expect(
      temporalWorkerLimits({
        TEMPORAL_MAX_CONCURRENT_ACTIVITIES: '5',
        TEMPORAL_MAX_CACHED_WORKFLOWS: 'x',
        TEMPORAL_SHUTDOWN_GRACE_SECONDS: '90',
      }),
    ).toEqual({ maxConcurrentActivityTaskExecutions: 5, maxCachedWorkflows: 250, shutdownGraceTime: 90_000 });
  });
});
