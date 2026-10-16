import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities';
import { temporalConnectionConfig } from './connection-config';
import { temporalWorkerLimits } from './worker-config';

async function run() {
  const { connection: options, namespace, taskQueue } = temporalConnectionConfig();
  const address = options.address;

  let connection: NativeConnection | undefined;
  let attempt = 0;
  while (!connection) {
    attempt += 1;
    try {
      connection = await NativeConnection.connect(options);
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
    taskQueue,
    workflowsPath: require.resolve('./workflows'),
    activities,
    ...temporalWorkerLimits(),
  });

  console.log(`[worker] Prestige Temporal worker en cola "${taskQueue}"`);
  try {
    await worker.run();
  } finally {
    await connection.close();
  }
}

run().catch((error) => {
  console.error('[worker] fatal', error);
  process.exit(1);
});
