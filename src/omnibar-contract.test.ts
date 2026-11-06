import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OMNIBAR_CONTRACT_VERSION } from './omnibar-contract/types';

// Provenance: ./omnibar-contract is src/omnibar-contract/ from openmrs/openmrs-esm-omnibar-app at
// ec92784 (main, 2026-11-03), copied byte for byte. The folder last changed there in c6bd2a2.
// Don't edit the copy: fix the omnibar and copy the folder again, then update these hashes.
const vendoredFrom = 'ec92784e5ca05a5577da438abc02942286b7ace2';
const sha256ByFile = {
  'README.md': '5e0e2a34f4a50421a4f06ab1a6c38930036e81bc9716eeb641274f3fdbf0dce4',
  'index.ts': '5896686c94cb34127c326b204158acd5cd18e1e56066e93f0291d0babb201068',
  'provider-boundary.tsx': 'c48a90eeeffc40a9f5e06610d6f1a4cb2be63f05ba40e6d2d2eb1ca4cdeee40d',
  'query-hints.ts': '10f9795ce44ad0019509a4241c3661dade1058e95ff0cfc008842f640841bcbb',
  'server-unreachable.ts': '3983b518545d58a0f09e7753bf5e63bc43c306578706eff3a4bbd21c2c1008e3',
  'types.ts': '3e19c303bbf9e51dc4e8bd9fe283a0a9394b043547b1d599bdaf11db4e4569bc',
  'view-boundary.tsx': '4e7ae5c9c7948129cf1a3ff1aa98685ef6121450df6ade4220ffb10e0c3da113',
};

const folder = join(dirname(fileURLToPath(import.meta.url)), 'omnibar-contract');

describe(`the omnibar contract copied from omnibar ${vendoredFrom.slice(0, 7)}`, () => {
  it('has exactly the files of that commit, byte for byte', () => {
    expect(readdirSync(folder).sort()).toEqual(Object.keys(sha256ByFile).sort());
    for (const [file, sha256] of Object.entries(sha256ByFile)) {
      expect([
        file,
        createHash('sha256')
          .update(new Uint8Array(readFileSync(join(folder, file))))
          .digest('hex'),
      ]).toEqual([file, sha256]);
    }
  });

  // The omnibar's own conformance rule for the folder: it may import only what every O3 app has.
  it('imports only react, react-i18next, the framework and its own files', () => {
    const allowedPackages = ['react', 'react-i18next', '@openmrs/esm-framework'];
    for (const file of readdirSync(folder).filter((name) => /\.tsx?$/.test(name))) {
      const source = readFileSync(join(folder, file), 'utf8');
      const specifiers = [
        ...source.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/g),
      ].map(([, specifier]) => specifier);
      for (const specifier of specifiers) {
        const ownFile = specifier.startsWith('./') && !specifier.includes('..');
        expect({ file, specifier, allowed: ownFile || allowedPackages.includes(specifier) }).toEqual({
          file,
          specifier,
          allowed: true,
        });
      }
    }
  });

  it('is contract version 1', () => {
    expect(OMNIBAR_CONTRACT_VERSION).toBe(1);
  });
});
