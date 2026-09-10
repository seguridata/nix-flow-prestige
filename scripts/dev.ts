#!/usr/bin/env bun
/**
 * Prestige — un comando para todo el sandbox local.
 *
 *   bun run dev              Docker + Prisma + front (3001) + BFF/worker (3000)
 *   bun run dev -- --reset   borra volúmenes y vuelve a subir
 *   bun run down             para la infra (deja volúmenes)
 *   bun run down -- --volumes
 */

import { appendFileSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const BFF_DIR = join(ROOT, "backend", "bff");

const COMPOSE = [
  "docker",
  "compose",
  "--env-file",
  "backend/.env",
  "-f",
  "backend/docker-compose.yml",
] as const;

const args = process.argv.slice(2);
const command = args[0] === "down" ? "down" : "up";
const reset = args.includes("--reset");
const volumes = args.includes("--volumes") || args.includes("-v") || reset;

function log(msg: string) {
  console.log(`\x1b[36m[prestige]\x1b[0m ${msg}`);
}

function fail(msg: string): never {
  console.error(`\x1b[31m[prestige]\x1b[0m ${msg}`);
  process.exit(1);
}

async function run(
  cmd: string[],
  opts: { cwd?: string; quiet?: boolean } = {},
): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd ?? ROOT,
    stdin: "ignore",
    stdout: opts.quiet ? "pipe" : "inherit",
    stderr: opts.quiet ? "pipe" : "inherit",
  });
  return await proc.exited;
}

async function output(cmd: string[]): Promise<{ code: number; text: string }> {
  const proc = Bun.spawn(cmd, {
    cwd: ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, text] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
  return { code, text: text.trim() };
}

function envKeys(text: string): Set<string> {
  return new Set(
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => l.split("=")[0].trim()),
  );
}

function ensureEnv(example: string, dest: string) {
  if (!existsSync(example)) fail(`Falta ${example}`);
  const rel = dest.slice(ROOT.length + 1);
  if (!existsSync(dest)) {
    copyFileSync(example, dest);
    log(`Creado ${rel} desde example`);
    return;
  }
  // El .env ya existe: añade solo las claves nuevas que trae el example.
  const exampleText = readFileSync(example, "utf8");
  const have = envKeys(readFileSync(dest, "utf8"));
  const missing = exampleText
    .split(/\r?\n/)
    .filter((l) => {
      const key = l.split("=")[0].trim();
      return l.includes("=") && !l.trim().startsWith("#") && key && !have.has(key);
    });
  if (missing.length) {
    appendFileSync(dest, `\n# --- claves añadidas automáticamente desde ${rel}.example ---\n${missing.join("\n")}\n`);
    log(`${rel}: añadidas ${missing.length} clave(s) nueva(s) (${missing.map((l) => l.split("=")[0]).join(", ")})`);
  }
}

async function requireCmd(bin: string, hint: string) {
  const result = await output([bin, "--version"]);
  if (result.code !== 0) fail(`No encuentro \`${bin}\`. ${hint}`);
}

async function probeHttp(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return res.status > 0 && res.status < 500;
  } catch {
    return false;
  }
}

async function waitFor(
  label: string,
  check: () => Promise<boolean>,
  timeoutMs: number,
  required: boolean,
): Promise<boolean> {
  const start = Date.now();
  process.stdout.write(`\x1b[36m[prestige]\x1b[0m Esperando ${label}`);
  while (Date.now() - start < timeoutMs) {
    if (await check()) {
      const secs = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  listo (${secs}s)`);
      return true;
    }
    process.stdout.write(".");
    await Bun.sleep(2000);
  }
  console.log("");
  const msg = `${label} no respondió en ${Math.round(timeoutMs / 1000)}s`;
  if (required) fail(msg);
  log(`Aviso: ${msg}. Sigo; el worker reintenta solo.`);
  return false;
}

async function postgresReady() {
  const { code, text } = await output([...COMPOSE, "exec", "-T", "postgres", "pg_isready", "-U", "prestige"]);
  return code === 0 && text.toLowerCase().includes("accepting");
}

async function redisReady() {
  const { code, text } = await output([...COMPOSE, "exec", "-T", "redis", "redis-cli", "ping"]);
  return code === 0 && text.includes("PONG");
}

function printUrls() {
  console.log("");
  log("Listo. URLs:");
  console.log("  App            http://127.0.0.1:3001");
  console.log("  BFF            http://127.0.0.1:3000");
  console.log("  Cockpit        http://127.0.0.1:3001/operations");
  console.log("  Temporal UI    http://127.0.0.1:8088");
  console.log("  MinIO consola  http://127.0.0.1:9001   prestige / prestige-minio");
  console.log("  Keycloak       http://127.0.0.1:8081   admin / admin");
  console.log("");
  log("Ctrl+C para front + BFF. La infra Docker sigue. Para bajarla: bun run down");
  console.log("");
}

async function down() {
  const extra = volumes ? ["-v"] : [];
  log(volumes ? "Bajando infra y volúmenes…" : "Bajando infra (volúmenes se conservan)…");
  const code = await run([...COMPOSE, "down", ...extra]);
  if (code !== 0) fail("docker compose down falló");
}

async function up() {
  const bunMajor = Number(Bun.version.split(".")[0]);
  const bunMinor = Number(Bun.version.split(".")[1] ?? 0);
  if (bunMajor < 1 || (bunMajor === 1 && bunMinor < 3)) {
    fail(`Bun ${Bun.version} es viejo. Necesitas ≥ 1.3 (https://bun.sh)`);
  }

  await requireCmd("docker", "Instala Docker Desktop y deja el motor corriendo.");
  const composeVer = await output(["docker", "compose", "version"]);
  if (composeVer.code !== 0) fail("Necesitas Docker Compose v2 (`docker compose`, con espacio).");

  const dockerInfo = await output(["docker", "info"]);
  if (dockerInfo.code !== 0) fail("Docker no responde. Abre Docker Desktop y reintenta.");

  ensureEnv(join(ROOT, "backend", ".env.example"), join(ROOT, "backend", ".env"));
  ensureEnv(join(BFF_DIR, ".env.example"), join(BFF_DIR, ".env"));

  if (reset) {
    log("Reset: down -v y vuelvo a subir");
    await down();
  }

  log("bun install…");
  if ((await run(["bun", "install"])) !== 0) fail("bun install falló");

  log("Levantando Postgres, Keycloak, Temporal, MinIO, Redis…");
  if ((await run([...COMPOSE, "up", "-d"])) !== 0) fail("docker compose up falló");

  await waitFor("Postgres", postgresReady, 90_000, true);
  await waitFor("Redis", redisReady, 30_000, true);

  log("Prisma migrate + generate…");
  if ((await run(["bunx", "prisma", "migrate", "deploy"], { cwd: BFF_DIR })) !== 0) {
    fail("prisma migrate deploy falló. ¿Postgres healthy? Revisa backend/bff/.env");
  }
  if ((await run(["bunx", "prisma", "generate"], { cwd: BFF_DIR })) !== 0) {
    fail("prisma generate falló");
  }

  await waitFor(
    "MinIO",
    () => probeHttp("http://127.0.0.1:9000/minio/health/live"),
    40_000,
    false,
  );
  await waitFor(
    "Temporal UI",
    () => probeHttp("http://127.0.0.1:8088/"),
    60_000,
    false,
  );
  await waitFor(
    "Keycloak (realm prestige)",
    () => probeHttp("http://127.0.0.1:8081/realms/prestige/.well-known/openid-configuration"),
    120_000,
    false,
  );

  printUrls();

  log("Arrancando front (Next.js :3001) y BFF + worker (:3000)…");
  const child = Bun.spawn(["bunx", "turbo", "run", "dev", "--parallel"], {
    cwd: ROOT,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const shutdown = () => {
    child.kill();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const code = await child.exited;
  process.exit(code ?? 0);
}

if (command === "down") {
  await down();
} else {
  await up();
}
