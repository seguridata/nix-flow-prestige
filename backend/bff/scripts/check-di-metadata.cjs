/**
 * Detecta parámetros de constructor que Nest no puede inyectar (tipo `Function`/`Object`
 * sin @Inject). Es el bug que impidió arrancar al BFF con `resolveHost: HostResolver = default`.
 * Los tests de vitest no lo ven (esbuild no emite design:paramtypes): se revisa el build.
 * Uso: `bun run build && bun run check:di`
 */
require('reflect-metadata');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'dist', 'src');
if (!fs.existsSync(root)) {
  console.error('No existe dist/src: ejecuta `nest build` primero.');
  process.exit(2);
}

// main/worker arrancan la app o el worker al importarse: no se cargan.
const SKIP = new Set(['main.js', 'worker.js']);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.js') && !p.endsWith('.spec.js') && !SKIP.has(e.name)) files.push(p);
  }
})(root);

const problems = [];
for (const file of files) {
  let mod;
  try {
    mod = require(file);
  } catch {
    continue; // módulos con efectos de arranque (main.ts, worker): no se cargan
  }
  for (const [name, cls] of Object.entries(mod)) {
    if (typeof cls !== 'function') continue;
    const injectable =
      Reflect.getMetadata('__injectable__', cls) !== undefined ||
      Reflect.getMetadata('path', cls) !== undefined || // controllers
      Reflect.getMetadata('__module__', cls) !== undefined;
    if (!injectable) continue;
    const types = Reflect.getMetadata('design:paramtypes', cls) || [];
    const selfDeps = Reflect.getMetadata('self:paramtypes', cls) || [];
    const explicit = new Set(selfDeps.map((d) => d.index));
    types.forEach((t, i) => {
      if (explicit.has(i)) return;
      if (t === Function || t === Object || t === undefined) {
        problems.push(`${path.relative(root, file)} → ${name} (parámetro #${i}: ${t && t.name})`);
      }
    });
  }
}

if (problems.length) {
  console.error('Parámetros no inyectables (añade @Inject(token) + @Optional() o quítalos del constructor):');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`DI OK: ${files.length} archivos revisados, sin parámetros no inyectables.`);
process.exit(0); // los módulos cargados pueden abrir conexiones (Redis): no esperar
