#!/bin/sh
# Aplica las migraciones pendientes y arranca el proceso. El worker de Temporal
# usa la misma imagen con RUN_MIGRATIONS=false (sólo el BFF migra).
set -eu

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] prisma migrate deploy"
  /opt/prisma-cli/node_modules/.bin/prisma migrate deploy --schema ./prisma/schema.prisma
fi

exec "$@"
