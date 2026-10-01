/**
 * A live answer to a list question proposing fluconazole: two findings about fluconazole and one
 * about the listed nevirapine against her lidocaine order, which carries
 * `aboutADrugOtherThanTheOneProposed: true` (openmrs-module-chartsearchai ADR Decision 137).
 *
 * Patient `763e6e5f-c489-4bab-8a55-c379f085dd1c`, asked *"The patient is currently on
 * Lamivudine, Nevirapine, Stavudine, is it safe to give Fluconazole?"*. Measured 2026-10-01 on an
 * OpenMRS 3.7.1 standalone through `POST /chartsearchai/search` (question id 13317).
 * Verbatim as the wire carried it, every key included.
 */
export const FLUCONAZOLE_BESIDE_A_LISTED_NEVIRAPINE_FINDING = {
  unstatedFindingSeverities: [],
  questionId: '13317',
  references: [
    {
      index: 50,
      resourceType: 'safety_finding',
      resourceUuid: 'interaction:Fluconazole',
      date: null,
      grounded: null,
      group: 'reference',
      source: null,
      withheldInteractions: 0,
      attachedByTheModule: false,
      attachedFor: [],
    },
    {
      index: 51,
      resourceType: 'safety_finding',
      resourceUuid: 'interaction:Fluconazole',
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
    stated: 1,
    uncited: 1,
  },
  doseCeilingCoverage: 'absent',
  unresolvedDrugClass: null,
  findingPartners: {
    named: 1,
    stated: 1,
  },
  unfoundedFindingSeverities: [],
  misattributedOrderCitations: [],
  interactionClaimPairs: {
    judged: 0,
    misattributedCitations: [],
    unfounded: 0,
  },
  answeredByTheModule: false,
  unfaithfullyRenderedCitations: [],
  unsupportedEndedOrderClaims: [],
  cautionLedOverWithholding: [],
  chartReadForSafety: true,
  answer:
    'Fluconazole can be given, with two cautions: Fluconazole interacts with Nevirapine, a Moderate problem [51]. Coadministration with fluconazole may increase the plasma concentrations of drugs that are substrates of CYP450 3A4. The mechanism is decreased clearance due to inhibition of CYP450 3A4-mediated metabolism by fluconazole, a moderate inhibitor of the isoenzyme [51]. Additionally, Fluconazole interacts with active order Lidocaine, a Moderate problem [50]. Coadministration with fluconazole may increase the plasma concentrations of drugs that are substrates of CYP450 3A4. The mechanism is decreased clearance due to inhibition of CYP450 3A4-mediated metabolism by fluconazole, a moderate inhibitor of the isoenzyme [50]. The chart holds no active order for Lamivudine, Nevirapine or Stavudine.',
  unstatedSignificanceQualifiers: [],
  findingCitations: {
    carried: 3,
    cited: 2,
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
      aboutADrugOtherThanTheOneProposed: true,
    },
    {
      type: 'interaction',
      drug: 'Fluconazole',
      detail:
        'Fluconazole interacts with active order Lidocaine — Moderate. Coadministration with fluconazole may increase the plasma concentrations of drugs that are substrates of CYP450 3A4. The mechanism is decreased clearance due to inhibition of CYP450 3A4-mediated metabolism by fluconazole, a moderate inhibitor of the isoenzyme.',
      severity: 'Moderate',
      chartOrderBridges: [],
      namedPartners: ['Lidocaine'],
      restsOnAnUncorroboratedChartMatch: false,
      aboutAnEndedOrder: false,
      endedOrderStopDate: null,
      aboutACurrentMedication: false,
      currentMedicationOrders: [],
      statedInTheAnswer: false,
      aboutAnotherOfHerMedications: false,
      aboutADrugOtherThanTheOneProposed: false,
    },
    {
      type: 'interaction',
      drug: 'Fluconazole',
      detail:
        'Fluconazole interacts with Nevirapine, also named in the question — Moderate. Coadministration with fluconazole may increase the plasma concentrations of drugs that are substrates of CYP450 3A4. The mechanism is decreased clearance due to inhibition of CYP450 3A4-mediated metabolism by fluconazole, a moderate inhibitor of the isoenzyme.',
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
      aboutADrugOtherThanTheOneProposed: false,
    },
  ],
  unstatedDosingCeilings: [],
  disclaimer:
    "This response is AI-generated and may not be accurate. It is not a substitute for clinical judgment. Always verify against the patient's medical records.",
};
