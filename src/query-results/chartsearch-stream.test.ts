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
        safetyStatus: 'unavailable',
        safetyCheck: { status: 'limited', issues: ['weight_unavailable', 3, 'weight_unavailable'] },
        interactionPairs: { found: 18, reported: 10 },
        unresolvedDrugClass: 'NSAID',
        unfaithfullyRenderedCitations: [7, 'x'],
        unstatedFindingSeverities: [{ citation: 350, rating: ' Major ' }, 351, { citation: 352 }, null],
        misattributedOrderCitations: null,
        activeOrderClaims: { stated: 4, uncited: -1 },
        unsupportedEndedOrderClaims: ['Nevirapine', ' ', 4],
        unstatedSignificanceQualifiers: [46, '47'],
        orderStopDates: [
          { citation: 3, stopDate: '2026-09-23' },
          { citation: 4, stopDate: 'yesterday' },
          { stopDate: '2026-09-23' },
        ],
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
          currentMedicationOrders: [],
          endedOrderStopDate: null,
        },
      ],
      safetyCheck: { status: 'limited', issues: ['weight_unavailable'] },
      interactionPairs: { found: 18, reported: 10 },
      unresolvedDrugClass: 'NSAID',
      unfaithfullyRenderedCitations: [7],
      misattributedOrderCitations: null,
      unstatedFindingSeverities: [{ citation: 350, rating: 'Major' }],
      activeOrderClaims: null,
      unsupportedEndedOrderClaims: ['Nevirapine'],
      unstatedSignificanceQualifiers: [46],
      orderStopDates: [{ citation: 3, stopDate: '2026-09-23' }],
      conditionRuleCoverage: 'absent',
    });
  });

  it('keeps a current medication and an ended order on a finding, and drops what is not one', () => {
    const [own, ended, proposed] = parseStatements({
      safetyWarnings: [
        {
          type: 'contraindication',
          drug: 'Ibuprofen',
          detail: 'The patient has a recorded allergy to Ibuprofen.',
          aboutACurrentMedication: true,
          aboutAnotherOfHerMedications: true,
          currentMedicationOrders: [
            { orderDisplay: ' Advil 400mg ', orderUuid: ' uuid-advil ' },
            { orderDisplay: 'Lidocaine' },
            { orderDisplay: 'L'.repeat(600), orderUuid: 'u'.repeat(600) },
            { orderDisplay: '   ', orderUuid: 'no-name' },
            { orderUuid: 'only-uuid' },
            null,
            'nope',
          ],
          endedOrderStopDate: null,
        },
        {
          type: 'interaction',
          drug: 'Rifampicin',
          detail: 'Rifampicin interacts with active order Nevirapine.',
          aboutAnEndedOrder: true,
          aboutACurrentMedication: 'true',
          endedOrderStopDate: '2026-09-23',
          currentMedicationOrders: 'nope',
        },
        {
          type: 'contraindication',
          drug: 'Aspirin',
          detail: 'The patient has a recorded allergy to Aspirin.',
          aboutACurrentMedication: false,
          aboutAnEndedOrder: false,
          aboutAnotherOfHerMedications: false,
          endedOrderStopDate: 'yesterday',
          currentMedicationOrders: [{ orderDisplay: 1 }],
        },
      ],
    }).safetyWarnings;

    expect(own).toMatchObject({
      aboutACurrentMedication: true,
      currentMedicationOrders: [
        { orderDisplay: 'Advil 400mg', orderUuid: 'uuid-advil' },
        { orderDisplay: 'Lidocaine' },
        { orderDisplay: `${'L'.repeat(499)}…`, orderUuid: `${'u'.repeat(499)}…` },
      ],
      aboutAnotherOfHerMedications: true,
      endedOrderStopDate: null,
    });
    expect(own).not.toHaveProperty('aboutAnEndedOrder');
    expect(ended).toMatchObject({
      aboutAnEndedOrder: true,
      endedOrderStopDate: '2026-09-23',
      currentMedicationOrders: [],
    });
    expect(ended).not.toHaveProperty('aboutACurrentMedication');
    expect(proposed).toEqual({
      type: 'contraindication',
      drug: 'Aspirin',
      detail: 'The patient has a recorded allergy to Aspirin.',
      severity: null,
      chartOrderBridges: [],
      currentMedicationOrders: [],
      endedOrderStopDate: null,
    });
  });

  it('keeps an unconfirmed chart match only when the chip says true', () => {
    const [kept, denied, missing, stringTrue] = parseStatements({
      safetyWarnings: [
        {
          type: 'contraindication',
          drug: 'liver',
          detail: 'Contraindicated with liver disease.',
          restsOnAnUncorroboratedChartMatch: true,
        },
        {
          type: 'contraindication',
          drug: 'liver',
          detail: 'Contraindicated with liver disease.',
          restsOnAnUncorroboratedChartMatch: false,
        },
        {
          type: 'contraindication',
          drug: 'liver',
          detail: 'Contraindicated with liver disease.',
        },
        {
          type: 'contraindication',
          drug: 'liver',
          detail: 'Contraindicated with liver disease.',
          restsOnAnUncorroboratedChartMatch: 'true',
        },
      ],
    }).safetyWarnings;

    expect(kept.restsOnAnUncorroboratedChartMatch).toBe(true);
    expect(denied).not.toHaveProperty('restsOnAnUncorroboratedChartMatch');
    expect(missing).not.toHaveProperty('restsOnAnUncorroboratedChartMatch');
    expect(stringTrue).not.toHaveProperty('restsOnAnUncorroboratedChartMatch');
  });

  it('reads the safety check from safetyCheck, falling back to safetyStatus, and never invents one', () => {
    expect(parseStatements({ safetyCheck: { status: 'unknown' }, safetyStatus: 'checked' }).safetyCheck).toEqual({
      status: 'checked',
      issues: [],
    });
    expect(parseStatements({ safetyCheck: 'limited', safetyStatus: 'clean' }).safetyCheck).toBeNull();
    expect(parseStatements({}).safetyCheck).toBeNull();
  });
});
