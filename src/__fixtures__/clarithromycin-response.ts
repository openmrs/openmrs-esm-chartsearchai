import type { AiReference, AiSafetyWarning } from '../api/chartsearchai';

/**
 * The live drug-safety response this disclosure rendering was designed against, shared by the
 * resolver's unit tests and the panel's rendering tests so one measured fact has one home.
 *
 * Measured on a RefApp 3.7.1 standalone, backend `main` @ `4dd1fea4` with the bundled DDInter
 * knowledge base, patient `dc8560c9-6d2b-45bf-861c-8fcf562ec9b1` asked *"Is it safe to start
 * her on clarithromycin?"*.
 *
 * THREE answer shapes are exported, because the model produces all three for this one question
 * and each defeats a different part of the resolver. Keeping them together is the point: the
 * panel test's expected ratings are the resolver's OUTPUT over prose × warnings, so they depend
 * on dataset-format details (the ` — ` separator, the substance-vs-order-display vocabulary,
 * which findings carry a bridge) that only these fixtures state. Two copies of that drifted
 * silently once already.
 */

/**
 * Shape A, verbatim: the answer names each partner by its knowledge-base SUBSTANCE
 * ("Methylprednisolone") and states no rating for any of the five findings — the response
 * quoted in the backend README, and the one issue #26 was filed on.
 */
export const ANSWER_BY_SUBSTANCE =
  'No — Clarithromycin should not be started: The patient has a recorded allergy to Clarithromycin [349]. ' +
  'Furthermore, Clarithromycin interacts with active order Methylprednisolone [177] [350], ' +
  'Clarithromycin interacts with active order Budesonide [166] [351], ' +
  'Clarithromycin interacts with active order Prednisone [155] [352], ' +
  'Clarithromycin interacts with active order Dexamethasone [12] [353], and ' +
  'Clarithromycin interacts with active order Hydrocortisone [14] [354].';

/**
 * Shape B: the answer names each partner by the CHART's order display ("Solu-Medrol
 * 125mg/5ml") and repeats every finding's marker inside its own statement.
 *
 * Both of those are verbatim from a live re-ask of the same question — and each defeats a
 * different part of the resolver: `safetyWarnings[].detail` names the substance, not the order
 * display, and a repeated index used to have its claim text blanked. The only edit is the
 * removal of the *"a Major problem because"* clauses the live answer carried, because with them
 * present the backend correctly reports `unstatedFindingSeverities: []` and there is nothing to
 * resolve. So the naming and the repetition are observed; this exact combination with the
 * ratings absent is assembled from two independently observed halves.
 */
export const ANSWER_BY_ORDER_DISPLAY =
  'No — Clarithromycin should not be prescribed: the patient has a recorded allergy to Clarithromycin [349]. ' +
  'Furthermore, Clarithromycin interacts with active order Solu-Medrol 125mg/5ml [350], because coadministration ' +
  'with potent inhibitors of CYP450 3A4 increases plasma concentrations of methylprednisolone, leading to ' +
  'increased adrenal suppression [350]. Clarithromycin interacts with active order Pulmicort 90mcg [351], ' +
  'because coadministration with potent inhibitors of CYP454 3A4 increases the systemic bioavailability of ' +
  'budesonide [351]. Clarithromycin interacts with active order Prednisone Co 5mg [352], because ' +
  'coadministration with inhibitors of CYP450 3A4 increases the plasma concentrations and pharmacologic effects ' +
  'of corticosteroids [352]. Clarithromycin interacts with active order Dexamethasone Injection vial 8mg [353], ' +
  'because coadministration with inhibitors of CYP454 3A4 increases the plasma concentrations and pharmacologic ' +
  'effects of steroids [353]. Clarithromycin interacts with active order Hydrocortisone Injection vial 100mg ' +
  '[354], because coadministration with inhibitors of CYP45O 3A4 increases the plasma concentrations and ' +
  'pharmacologic effects of the corticosteroids [354].';

/**
 * The response's references, verbatim in wire order. Note `[3]`, the recorded allergy the
 * MODULE attached: it carries no `[N]` marker in ANY of the three answers, and its `date` is null.
 * Six `safety_finding` entries: 349 is a contraindication with its own `resourceUuid`, and
 * 350-354 are interactions that all share one — which is why `(type, drug)` cannot identify
 * which warning holds a given citation's rating.
 */
export const REFERENCES: AiReference[] = [
  { index: 12, resourceType: 'drug_order', resourceUuid: 'h1440000-0000-4000-8000-000000000109', date: '2026-08-05', group: 'chart' }, // prettier-ignore
  { index: 14, resourceType: 'drug_order', resourceUuid: 'h1440000-0000-4000-8000-000000000173', date: '2026-08-05', group: 'chart' }, // prettier-ignore
  { index: 166, resourceType: 'visit', resourceUuid: '5829aef8-dcec-4eeb-b105-c74fd35e1b3e', date: '2024-09-09', group: 'chart' }, // prettier-ignore
  { index: 155, resourceType: 'encounter', resourceUuid: '830e6354-017e-424e-a229-b3a47c4d1d79', date: '2024-09-09', group: 'chart' }, // prettier-ignore
  { index: 177, resourceType: 'condition', resourceUuid: 'b20a10fb-9925-4c01-ac5a-d656f9db9457', date: '2024-05-13', group: 'chart' }, // prettier-ignore
  {
    index: 3,
    resourceType: 'allergy',
    resourceUuid: 'a172c001-0000-4000-8000-000000000013',
    date: null as unknown as string,
    group: 'chart',
    attachedByTheModule: true,
  },
  {
    index: 349,
    resourceType: 'safety_finding',
    resourceUuid: 'contraindication:Clarithromycin',
    date: null as unknown as string,
    group: 'reference',
  },
  ...[350, 351, 352, 353, 354].map((index) => ({
    index,
    resourceType: 'safety_finding',
    resourceUuid: 'interaction:Clarithromycin',
    date: null as unknown as string,
    group: 'reference',
  })),
];

/**
 * Builds one interaction warning in the bundled dataset's own shape: the note is
 * `<lead> — <severity>. <mechanism>`, and the chip appends it.
 *
 * The ` — ` separator is load-bearing for the `leadClause` group and is deliberately written
 * here rather than in each test — changing it must redden the panel tests too, which is only
 * true while every test builds its warnings through this. That is why `drug` is a parameter:
 * a test needing a second candidate set used to hand-write the template and so kept its own
 * copy of the separator.
 *
 * That "only true while" was a claim, not a fact, for as long as it stood here: three callers
 * had not been converted, and the most consequential was the property fuzzer. Measured before
 * conversion — changing this separator to ` :: ` reddened 26 tests and left the fuzzer's 8,000
 * generated answers GREEN, so the module's broadest guard was proving the safety property
 * about a note format nothing else expected. After: 27, the fuzzer among them. Re-run that
 * probe rather than trusting this paragraph if you add a caller.
 */
export const interaction = (
  partner: string,
  severity: string,
  orderDisplay?: string,
  drug = 'Clarithromycin',
): AiSafetyWarning => ({
  type: 'interaction',
  drug,
  detail: `${drug} interacts with active order ${partner} — ${severity}. Coadministration with potent inhibitors of CYP450 3A4 …`,
  severity,
  chartOrderBridges: orderDisplay ? [{ substance: partner, orderDisplay }] : [],
});

/**
 * The response's safety warnings, verbatim as to type/drug/severity and bridges.
 *
 * Only the first two INTERACTIONS carry a `chartOrderBridges` entry — index [1] and [2], since
 * [0] is the contraindication. Measured, and the reason the resolver needs more than one lead
 * group: the other three interactions were attributed to no order, so nothing on them states the
 * chart's name for the partner. The two that DO bridge are exactly the two Majors.
 */
export const SAFETY_WARNINGS: AiSafetyWarning[] = [
  {
    type: 'contraindication',
    drug: 'Clarithromycin',
    detail: 'The patient has a recorded allergy to Clarithromycin.',
    severity: null,
    chartOrderBridges: [],
  },
  interaction('Methylprednisolone', 'Major', 'Solu-Medrol 125mg/5ml'),
  interaction('Budesonide', 'Major', 'Pulmicort 90mcg'),
  interaction('Prednisone', 'Moderate'),
  interaction('Dexamethasone', 'Moderate'),
  interaction('Hydrocortisone', 'Moderate'),
];

/**
 * Shape C, verbatim from a live answer: asked to list the interactions one line each naming
 * only the order, the model wrote a bare list — no module phrasing to quote at all, and only
 * the chart's order displays.
 *
 * Two of the five findings carry a bridge and three do not, so before the partner tier existed
 * this resolved exactly two of five and the list rendered half-badged.
 */
export const ANSWER_BARE_LIST =
  'Solu-Medrol 125mg/5ml [350]\nPulmicort 90mcg [351]\nPrednisone Co 5mg [352]\n' +
  'Dexamethasone Injection vial 8mg [353]\nHydrocortisone Injection vial 100mg [354]';

/**
 * One `safety_finding` reference, in the shape the wire actually carries: `reference` group and a
 * null date. Ten tests used to rebuild this literal inline with `date: ''`, which is a value the
 * backend never sends — harmless while nothing reads `date`, and wrong the moment something does.
 */
export const safetyFindingRef = (index: number, type = 'interaction', drug = 'Clarithromycin'): AiReference => ({
  index,
  resourceType: 'safety_finding',
  resourceUuid: `${type}:${drug}`,
  date: null as unknown as string,
  group: 'reference',
});

/** The citations the backend reported as unable to be the drug order their sentence names. */
export const MISATTRIBUTED = [177, 166, 155];

/** The citations of findings whose rating the answer states nowhere. */
export const UNSTATED = [350, 351, 352, 353, 354];
