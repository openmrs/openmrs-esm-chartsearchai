/**
 * A live answer that drops a cited finding's own caveat: patient
 * `763e6e5f-c489-4bab-8a55-c379f085dd1c`, asked *"Is aspirin safe for her?"*. The finding [46]
 * ends "The clinical significance of this interaction is unknown."; the answer does not say so,
 * and the backend publishes `unstatedSignificanceQualifiers: [46]` (ADR Decision 136).
 *
 * Measured 2026-10-01 on an OpenMRS 3.7.1 standalone through `POST /chartsearchai/search`
 * (question id 13303). Verbatim as the wire carried it, every key included.
 */
export const ASPIRIN_ANSWER_DROPPING_THE_SIGNIFICANCE_CAVEAT = {
  unstatedFindingSeverities: [],
  questionId: '13303',
  references: [
    {
      index: 6,
      resourceType: 'drug_order',
      resourceUuid: 'i1520000-0000-0000-0000-0000000000c2',
      date: '2026-08-03',
      grounded: null,
      group: 'chart',
      source: null,
      withheldInteractions: 0,
      attachedByTheModule: false,
      attachedFor: [],
    },
    {
      index: 46,
      resourceType: 'safety_finding',
      resourceUuid: 'interaction:Acetylsalicylic acid (aspirin)',
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
    uncited: 0,
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
    'Aspirin can be given, with one caution: it interacts with active order Metoclopramide [6], a Minor problem [46].',
  unstatedSignificanceQualifiers: [46],
  findingCitations: {
    carried: 1,
    cited: 1,
  },
  interactionPairs: {
    found: 1,
    reported: 1,
    belowFloor: [
      {
        drug: 'Acetylsalicylic acid (aspirin)',
        partner: 'lidocaine',
        severity: 'Unknown',
      },
      {
        drug: 'Acetylsalicylic acid (aspirin)',
        partner: 'tiotropium',
        severity: 'Unknown',
      },
    ],
  },
  conditionRuleCoverage: 'absent',
  orderStopDates: [],
  safetyWarnings: [
    {
      type: 'interaction',
      drug: 'Acetylsalicylic acid (aspirin)',
      detail:
        'Acetylsalicylic acid (aspirin) interacts with active order Metoclopramide — Minor. Coadministration with metoclopramide may enhance the rate and extent of absorption of drugs that are mainly absorbed in the small intestine, such as paracetamol, aspirin, and tetracycline. The proposed mechanism is a metoclopramide-mediated increase in gastric emptying. Clinical and laboratory monitoring should be considered and the dose adjusted as appropriate. The clinical significance of this interaction is unknown.',
      severity: 'Minor',
      chartOrderBridges: [],
      namedPartners: ['Metoclopramide'],
      restsOnAnUncorroboratedChartMatch: false,
      aboutAnEndedOrder: false,
      endedOrderStopDate: null,
      aboutACurrentMedication: false,
      currentMedicationOrders: [],
      statedInTheAnswer: false,
      aboutAnotherOfHerMedications: false,
    },
    {
      type: 'contraindication',
      drug: 'Lidocaine',
      detail: 'The patient has a recorded allergy to Lidocaine.',
      severity: null,
      chartOrderBridges: [],
      namedPartners: [],
      restsOnAnUncorroboratedChartMatch: false,
      aboutAnEndedOrder: false,
      endedOrderStopDate: null,
      aboutACurrentMedication: true,
      currentMedicationOrders: [
        {
          orderDisplay: 'Lidocaine',
          orderUuid: 'i1520000-0000-0000-0000-0000000000c2',
        },
      ],
      statedInTheAnswer: false,
      aboutAnotherOfHerMedications: true,
    },
  ],
  unstatedDosingCeilings: [],
  disclaimer:
    "This response is AI-generated and may not be accurate. It is not a substitute for clinical judgment. Always verify against the patient's medical records.",
};
