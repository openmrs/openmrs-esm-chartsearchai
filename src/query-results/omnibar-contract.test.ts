import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import routes from '../routes.json';
import en from '../../translations/en.json';
import { OMNIBAR_CONTRACT_VERSION, OMNIBAR_QUERY_RESULTS_SLOT, type OmnibarViewMeta } from '../omnibar-contract/types';

/**
 * The section is registered against the copy of the omnibar contract in `src/omnibar-contract/`. A
 * host mounts it only when it speaks the contract the meta declares, so the two must move together:
 * copy the folder again before raising the number.
 *
 * The app imports the folder's files one by one, not its index: tsconfig leaves the folder out, so
 * only what the app uses is type-checked under this repo's strict settings. The omnibar writes it
 * without them, and `provider-boundary.tsx`, which a view doesn't need, doesn't pass them.
 */
describe('the Query results view registration', () => {
  const view = routes.extensions.find((extension) => extension.name === 'chartsearch-query-results-view');

  it('declares the contract version of the copied folder', () => {
    expect(view?.slot).toBe(OMNIBAR_QUERY_RESULTS_SLOT);
    expect((view?.meta as OmnibarViewMeta).contract).toBe(OMNIBAR_CONTRACT_VERSION);
  });

  it('declares /ask with both its aliases, which the omnibar’s suggestion provider and catalogue held, so no other command mounts it', () => {
    expect((view?.meta as OmnibarViewMeta).command).toEqual({ id: 'ask', aliases: ['ask', 'question'] });
  });

  it('marks /ask as a command that asks ChartSearch, which the omnibar reads from the flag, not the id', () => {
    expect(view?.meta).toMatchObject({ asksModel: 'ChartSearch', commandAsksModel: true });
  });

  it('gives the bar /ask’s translated aliases, label and description', () => {
    expect(en).toMatchObject({
      'omnibarCommand.ask.aliases': 'ask, question',
      'omnibarCommand.ask.label': 'Ask ChartSearch',
      'omnibarCommand.ask.description': 'Ask ChartSearch, an AI, about this chart',
    });
  });

  it('mounts on nothing from the omnibar but the copied folder', () => {
    const dir = __dirname;
    const imports = fs
      .readdirSync(dir)
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .flatMap((file) =>
        [...fs.readFileSync(path.join(dir, file), 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]),
      );
    const fromOmnibar = imports.filter((source) => /omnibar/i.test(source));
    expect(fromOmnibar.length).toBeGreaterThan(0);
    expect(fromOmnibar.filter((source) => !source.startsWith('../omnibar-contract/'))).toEqual([]);
  });
});
