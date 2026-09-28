/**
 * Two live responses about one drug the chart records only as an ended order, whose interaction
 * chips are the same words, `type`, `drug`, `detail` and `severity` alike, and differ only in
 * `aboutAnEndedOrder` and `endedOrderStopDate` (openmrs-module-chartsearchai#472). The first also
 * cites the ended order's own record, so it carries an `orderStopDates` entry; the second cites no
 * ended record, so its `orderStopDates` is `[]` (openmrs-module-chartsearchai#315, #432).
 *
 * Patient `2d384cef-da03-4a3b-beb1-632011eb8654` has active orders for Lamivudine and Nevirapine and
 * a Rifampicin order discontinued on 2026-09-23. Measured 2026-09-28 on an OpenMRS 2.9.0-SNAPSHOT
 * standalone with the bundled DDInter knowledge base, through `POST /chartsearchai/search`. Verbatim
 * as the wire carried them, every key included, so a key the client misspells cannot pass against a
 * fixture spelling it the same way.
 */

/**
 * Asked *"Why was her rifampicin stopped, and does it matter?"*. The chip is about a drug the chart
 * holds only as an ended order, and citation 6 is that order's record: its `date` is the day the
 * order was activated (2026-06-01) and its `orderStopDates` entry the day it stopped (2026-09-23).
 */
export const ENDED_ORDER_NAMED_IN_A_HISTORY_QUESTION = {
  unstatedFindingSeverities: [],
  questionId: '12783',
  references: [
    {
      index: 6,
      resourceType: 'drug_order',
      resourceUuid: '90f83515-a577-4847-b525-f2195d21bd67',
      date: '2026-06-01',
      grounded: true,
      group: 'chart',
      source: null,
      withheldInteractions: 0,
      attachedByTheModule: false,
    },
    {
      index: 11,
      resourceType: 'safety_finding',
      resourceUuid: 'interaction:Rifampicin (rifampin)',
      date: null as unknown as string,
      grounded: null,
      group: 'reference',
      source: null,
      withheldInteractions: 0,
      attachedByTheModule: false,
    },
  ],
  activeOrderClaims: {
    stated: 1,
    uncited: 1,
  },
  unresolvedDrugClass: null,
  findingPartners: {
    named: 1,
    stated: 1,
  },
  misattributedOrderCitations: [],
  interactionClaimPairs: {
    judged: 0,
    misattributedCitations: [],
    unfounded: 0,
  },
  answeredByTheModule: false,
  unfaithfullyRenderedCitations: [],
  cautionLedOverWithholding: [],
  chartReadForSafety: true,
  answer:
    'Rifampicin was stopped on 2026-09-23 [6]. Yes, it matters because Rifampicin interacts with active order Nevirapine, a Major problem [11]. Coadministration with rifampin may substantially decrease the plasma concentrations of nevirapine, although a few studies have suggested that the combination may be used effectively without dosage adjustments. The mechanism is rifampin induction of nevirapine metabolism via CYP450 3A4 [11]. The chart records Rifampicin (rifampin) only as an order no longer in force (ended 2026-09-23), not as a current medication.',
  findingCitations: {
    carried: 1,
    cited: 1,
  },
  interactionPairs: {
    found: 1,
    reported: 1,
  },
  conditionRuleCoverage: 'absent',
  orderStopDates: [
    {
      citation: 6,
      stopDate: '2026-09-23',
    },
  ],
  safetyWarnings: [
    {
      type: 'interaction',
      drug: 'Rifampicin (rifampin)',
      detail:
        'Rifampicin (rifampin) interacts with active order Nevirapine — Major. Coadministration with rifampin may substantially decrease the plasma concentrations of nevirapine, although a few studies have suggested that the combination may be used effectively without dosage adjustments. The mechanism is rifampin induction of nevirapine metabolism via CYP450 3A4.',
      severity: 'Major',
      chartOrderBridges: [],
      namedPartners: ['Nevirapine'],
      restsOnAnUncorroboratedChartMatch: false,
      aboutAnEndedOrder: true,
      endedOrderStopDate: '2026-09-23',
      aboutACurrentMedication: false,
    },
  ],
  unstatedDosingCeilings: [],
  disclaimer:
    "This response is AI-generated and may not be accurate. It is not a substitute for clinical judgment. Always verify against the patient's medical records.",
};

/**
 * The same patient asked *"Can I give her rifampicin?"*. A question proposing the drug keeps the
 * ordinary call, so the chip is word for word the one above with `aboutAnEndedOrder: false`, and no
 * ended record is cited, so `orderStopDates` is `[]`.
 */
export const ENDED_ORDER_DRUG_PROPOSED = {
  unstatedFindingSeverities: [],
  questionId: '12784',
  references: [
    {
      index: 5,
      resourceType: 'drug_order',
      resourceUuid: '22ab3816-8888-4225-8b57-f4792a68863c',
      date: '2026-06-01',
      grounded: null,
      group: 'chart',
      source: null,
      withheldInteractions: 0,
      attachedByTheModule: false,
    },
    {
      index: 11,
      resourceType: 'safety_finding',
      resourceUuid: 'interaction:Rifampicin (rifampin)',
      date: null as unknown as string,
      grounded: null,
      group: 'reference',
      source: null,
      withheldInteractions: 0,
      attachedByTheModule: false,
    },
    {
      index: 10,
      resourceType: 'drug_reference',
      resourceUuid: '9384',
      date: null as unknown as string,
      grounded: null,
      group: 'reference',
      source: 'DDInter 2.0 (via openmrs-ddi-knowledge-base)',
      withheldInteractions: 648,
      attachedByTheModule: false,
    },
  ],
  activeOrderClaims: {
    stated: 1,
    uncited: 1,
  },
  unresolvedDrugClass: null,
  findingPartners: {
    named: 1,
    stated: 1,
  },
  misattributedOrderCitations: [],
  interactionClaimPairs: {
    judged: 0,
    misattributedCitations: [],
    unfounded: 0,
  },
  answeredByTheModule: false,
  unfaithfullyRenderedCitations: [],
  cautionLedOverWithholding: [],
  chartReadForSafety: true,
  answer:
    'No — Rifampicin should not be given: it interacts with active order Nevirapine, a Major problem because rifampin induction of nevirapine metabolism via CYP450 3A4 [11].',
  findingCitations: {
    carried: 1,
    cited: 1,
  },
  interactionPairs: {
    found: 1,
    reported: 1,
  },
  conditionRuleCoverage: 'absent',
  orderStopDates: [],
  safetyWarnings: [
    {
      type: 'interaction',
      drug: 'Rifampicin (rifampin)',
      detail:
        'Rifampicin (rifampin) interacts with active order Nevirapine — Major. Coadministration with rifampin may substantially decrease the plasma concentrations of nevirapine, although a few studies have suggested that the combination may be used effectively without dosage adjustments. The mechanism is rifampin induction of nevirapine metabolism via CYP450 3A4.',
      severity: 'Major',
      chartOrderBridges: [],
      namedPartners: ['Nevirapine'],
      restsOnAnUncorroboratedChartMatch: false,
      aboutAnEndedOrder: false,
      endedOrderStopDate: null,
      aboutACurrentMedication: false,
    },
  ],
  unstatedDosingCeilings: [],
  disclaimer:
    "This response is AI-generated and may not be accurate. It is not a substitute for clinical judgment. Always verify against the patient's medical records.",
};
