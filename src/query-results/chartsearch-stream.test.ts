import { describe, expect, it } from 'vitest';
import { createSseParser, parseReferences, parseStatements, type SseEvent } from './chartsearch-stream';

const parse = (chunks: Array<string>) => {
  const events: Array<SseEvent> = [];
  const parser = createSseParser((event) => events.push(event));
  chunks.forEach((chunk) => parser.push(chunk));
  return events;
};

describe('the ChartSearch stream parser', () => {
  it('reads events as ChartSearch writes them, across chunk boundaries', () => {
    expect(
      parse(['event: tok', 'en\ndata: The pa', 'tient\n\nevent: token\ndata: line one\ndata: line two\n\n']),
    ).toEqual([
      { event: 'token', data: 'The patient' },
      { event: 'token', data: 'line one\nline two' },
    ]);
  });

  it('skips keep-alive comments, even between an event’s lines', () => {
    expect(parse([': keep-alive\n\nevent: done\n: keep-alive\ndata: {}\n\n'])).toEqual([{ event: 'done', data: '{}' }]);
  });

  it('keeps a token’s own leading space after the one the format adds', () => {
    expect(parse(['event: token\ndata:  word\n\n'])).toEqual([{ event: 'token', data: ' word' }]);
  });

  it('treats \\r\\n split across chunks as one line ending', () => {
    expect(parse(['event: token\r', '\ndata: x\r\n\r\n'])).toEqual([{ event: 'token', data: 'x' }]);
  });

  it('drops an event the stream never finished', () => {
    expect(parse(['event: token\ndata: half'])).toEqual([]);
  });
});

describe('reading ChartSearch payloads', () => {
  it('keeps only references with an index and a type, with safe defaults', () => {
    expect(
      parseReferences([
        { index: 3, resourceType: 'order', date: '2025-03-15', grounded: null, group: 'chart', source: null },
        { index: 'x', resourceType: 'obs' },
        { index: 4, resourceType: 'drug_reference', grounded: 'yes', group: 'reference', withheldInteractions: 2 },
        null,
      ]),
    ).toEqual([
      {
        index: 3,
        resourceType: 'order',
        date: '2025-03-15',
        grounded: null,
        group: 'chart',
        source: null,
        withheldInteractions: 0,
        attachedByTheModule: false,
      },
      {
        index: 4,
        resourceType: 'drug_reference',
        date: null,
        grounded: null,
        group: 'reference',
        source: null,
        withheldInteractions: 2,
        attachedByTheModule: false,
      },
    ]);
    expect(parseReferences('nope')).toBeNull();
  });

  it('cuts any one field from the server short, so it can’t fill the page', () => {
    const [warning] = parseStatements({
      safetyWarnings: [{ type: 'x'.repeat(10_000), detail: 'd'.repeat(100_000), chartOrderBridges: [] }],
    }).safetyWarnings;
    expect(warning.detail).toHaveLength(5_000);
    expect(warning.detail.endsWith('…')).toBe(true);
    expect(warning.type).toHaveLength(500);
    expect(
      parseReferences([{ index: 1, resourceType: 'r'.repeat(10_000), source: 's'.repeat(10_000) }])?.[0],
    ).toMatchObject({
      resourceType: expect.stringMatching(/^r{499}…$/),
      source: expect.stringMatching(/^s{499}…$/),
    });
  });

  it('reads the statements, leaving out what isn’t the right shape', () => {
    expect(
      parseStatements({
        safetyWarnings: [
          {
            type: 'interaction',
            drug: 'Aspirin',
            detail: 'Aspirin interacts with active order Warfarin.',
            severity: ' Major ',
            chartOrderBridges: [{ substance: 'Ibuprofen', orderDisplay: 'Advil 400mg' }, { substance: 1 }],
          },
          { type: 'overdose' },
        ],
        interactionPairs: { found: 18, reported: 10 },
        unresolvedDrugClass: 'NSAID',
        unfaithfullyRenderedCitations: [7, 'x'],
        misattributedOrderCitations: null,
        activeOrderClaims: { stated: 4, uncited: -1 },
        conditionRuleCoverage: 'absent',
      }),
    ).toEqual({
      safetyWarnings: [
        {
          type: 'interaction',
          drug: 'Aspirin',
          detail: 'Aspirin interacts with active order Warfarin.',
          severity: 'Major',
          chartOrderBridges: [{ substance: 'Ibuprofen', orderDisplay: 'Advil 400mg' }],
        },
      ],
      interactionPairs: { found: 18, reported: 10 },
      unresolvedDrugClass: 'NSAID',
      unfaithfullyRenderedCitations: [7],
      misattributedOrderCitations: null,
      unstatedFindingSeverities: null,
      activeOrderClaims: null,
      conditionRuleCoverage: 'absent',
    });
  });
});
