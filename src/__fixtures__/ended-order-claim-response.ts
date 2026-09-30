/**
 * The answer that said an order had ended with no record behind it: patient
 * `763e6e5f-c489-4bab-8a55-c379f085dd1c`, asked *"The patient is currently on Lamivudine,
 * Nevirapine, Stavudine, is it safe to give Rifampicin?"* of a chart holding no nevirapine order.
 * Measured 2026-09-30 on an OpenMRS 3.7.1 standalone running backend main @ 8a5b6433, through
 * `POST /chartsearchai/search` (question id 13192), five runs byte-identical.
 *
 * Verbatim as the wire carried it, with ONE key added: that build predates the
 * `unsupportedEndedOrderClaims` key (backend ADR Decision 135), and no live answer on a later
 * build makes this claim. `["Nevirapine"]` is what the backend states for this answer's text,
 * pinned by its `LlmInferenceServiceListedMedicationsContextTest
 * .anEndedOrderNoRecordStatesIsReportedByTheDrugItNames`.
 */
export const RIFAMPICIN_ANSWER_CLAIMING_AN_ENDED_ORDER = {
  unstatedFindingSeverities: [],
  questionId: '13192',
  references: [
    {
      index: 51,
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
    {
      index: 47,
      resourceType: 'drug_reference',
      resourceUuid: '9384',
      date: null,
      grounded: null,
      group: 'reference',
      source: 'DDInter 2.0 (via openmrs-ddi-knowledge-base)',
      withheldInteractions: 647,
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
    "Nevirapine's order is no longer in force, but it interacts with Rifampicin (rifampin) — Major. Coadministration with rifampin may substantially decrease the plasma concentrations of nevirapine, although a few studies have suggested that the combination may be used effectively without dosage adjustments [51]. The chart holds no active order for Lamivudine, Nevirapine or Stavudine.",
  findingCitations: {
    carried: 3,
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
    },
    {
      type: 'interaction',
      drug: 'Rifampicin (rifampin)',
      detail:
        'Rifampicin (rifampin) interacts with active order Lidocaine — Minor. Coadministration with inducers of CYP450 1A2 and/or 3A4 may decrease the plasma concentrations of lidocaine, which is primarily metabolized by these isoenzymes.',
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
    },
    {
      type: 'interaction',
      drug: 'Nevirapine',
      detail:
        'Nevirapine interacts with Rifampicin (rifampin), also named in the question — Major. Coadministration with rifampin may substantially decrease the plasma concentrations of nevirapine, although a few studies have suggested that the combination may be used effectively without dosage adjustments. The mechanism is rifampin induction of nevirapine metabolism via CYP450 3A4.',
      severity: 'Major',
      chartOrderBridges: [],
      namedPartners: [],
      restsOnAnUncorroboratedChartMatch: false,
      aboutAnEndedOrder: false,
      endedOrderStopDate: null,
      aboutACurrentMedication: false,
      currentMedicationOrders: [],
      statedInTheAnswer: false,
      aboutAnotherOfHerMedications: false,
    },
  ],
  unstatedDosingCeilings: [],
  disclaimer:
    "This response is AI-generated and may not be accurate. It is not a substitute for clinical judgment. Always verify against the patient's medical records.",
  unsupportedEndedOrderClaims: ['Nevirapine'],
};
