/**
 * A live answer to a question listing three drugs the chart holds no active order for: both
 * nevirapine chips rest on the question's list, and carry `listedDrugsNotOnHerChart`
 * (openmrs-module-chartsearchai ADR Decision 133).
 *
 * Patient `763e6e5f-c489-4bab-8a55-c379f085dd1c`, asked *"The patient is currently on
 * Lamivudine, Nevirapine, Stavudine, is it safe to give Amlodipine?"*. Measured 2026-09-30 on an
 * OpenMRS 3.7.1 standalone, through `POST /chartsearchai/search` (question id 13172).
 * Verbatim as the wire carried it, every key included.
 */
export const AMLODIPINE_BESIDE_A_LISTED_NEVIRAPINE = {
  unstatedFindingSeverities: [],
  questionId: '13172',
  references: [
    {
      index: 50,
      resourceType: 'safety_finding',
      resourceUuid: 'interaction:Nevirapine',
      date: null,
      grounded: null,
      group: 'reference',
      source: null,
      withheldInteractions: 0,
      attachedByTheModule: false,
      attachedFor: [],
    },
  ],
  activeOrderClaims: {
    stated: 0,
    uncited: 0,
  },
  doseCeilingCoverage: 'absent',
  unresolvedDrugClass: null,
  findingPartners: null,
  unfoundedFindingSeverities: [],
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
    'Amlodipine can be given, with one caution: coadministration with nevirapine may decrease the plasma concentrations and therapeutic efficacy of drugs that are substrates of CYP450 3A4, a Moderate problem [50]. The chart holds no active order for Lamivudine, Nevirapine or Stavudine.',
  findingCitations: {
    carried: 2,
    cited: 1,
  },
  interactionPairs: {
    found: 1,
    reported: 1,
    belowFloor: null,
  },
  conditionRuleCoverage: 'absent',
  orderStopDates: [],
  safetyWarnings: [
    {
      type: 'interaction',
      drug: 'Nevirapine',
      detail:
        'Nevirapine interacts with active order Lidocaine — Minor. Coadministration with inducers of CYP450 1A2 and/or 3A4 may decrease the plasma concentrations of lidocaine, which is primarily metabolized by these isoenzymes.',
      severity: 'Minor',
      chartOrderBridges: [],
      namedPartners: ['Lidocaine'],
      restsOnAnUncorroboratedChartMatch: false,
      aboutAnEndedOrder: false,
      endedOrderStopDate: null,
      aboutACurrentMedication: false,
      currentMedicationOrders: [],
      statedInTheAnswer: false,
      aboutAnotherOfHerMedications: false,
      listedDrugsNotOnHerChart: ['Nevirapine'],
    },
    {
      type: 'interaction',
      drug: 'Nevirapine',
      detail:
        'Nevirapine interacts with Amlodipine, also named in the question — Moderate. Coadministration with nevirapine may decrease the plasma concentrations and therapeutic efficacy of drugs that are substrates of CYP450 3A4. The proposed mechanism is increased clearance due to nevirapine-mediated induction of CYP450 3A4.',
      severity: 'Moderate',
      chartOrderBridges: [],
      namedPartners: [],
      restsOnAnUncorroboratedChartMatch: false,
      aboutAnEndedOrder: false,
      endedOrderStopDate: null,
      aboutACurrentMedication: false,
      currentMedicationOrders: [],
      statedInTheAnswer: false,
      aboutAnotherOfHerMedications: false,
      listedDrugsNotOnHerChart: ['Nevirapine'],
    },
  ],
  unstatedDosingCeilings: [],
  disclaimer:
    "This response is AI-generated and may not be accurate. It is not a substitute for clinical judgment. Always verify against the patient's medical records.",
};
