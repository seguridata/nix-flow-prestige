import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities';
import { PRESTIGE_TASK_QUEUE } from './shared';

async function run() {
  const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  const namespace = process.env.TEMPORAL_NAMESPACE ?? 'default';

  let connection: NativeConnection | undefined;
  let attempt = 0;
  while (!connection) {
    attempt += 1;
    try {
      connection = await NativeConnection.connect({ address });
    } catch (error) {
      if (attempt === 1 || attempt % 10 === 0) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[worker] Temporal no disponible en ${address} (intento ${attempt}). ` +
            `Espera a que docker compose levante temporal. ${message}`,
        );
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue: PRESTIGE_TASK_QUEUE,
    workflowsPath: require.resolve('./workflows'),
    activities,
  });

  console.log(`[worker] Prestige Temporal worker en cola "${PRESTIGE_TASK_QUEUE}"`);
  await worker.run();
}

run().catch((error) => {
  console.error('[worker] fatal', error);
  process.exit(1);
});
