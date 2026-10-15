import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ManifestSigner } from './manifest-signer';

const prev = { PKI_DIR: process.env.PKI_DIR, NODE_ENV: process.env.NODE_ENV };
let tmp: string | undefined;

afterEach(() => {
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

function emptyPkiDir() {
  tmp = mkdtempSync(join(tmpdir(), 'manifest-'));
  // ManifestSigner resuelve PKI_DIR relativo a cwd.
  process.env.PKI_DIR = relative(process.cwd(), tmp);
}

describe('ManifestSigner sin llave', () => {
  it('fuera de producción guarda sin firmar (warn)', () => {
    emptyPkiDir();
    process.env.NODE_ENV = 'test';
    const s = new ManifestSigner();
    expect(s.sign({ a: 1 }).signature).toBeNull();
  });

  it('en producción falla: no emite manifiestos sin firmar', () => {
    emptyPkiDir();
    process.env.NODE_ENV = 'production';
    expect(() => new ManifestSigner()).toThrow(/sin firmar/);
  });
});
