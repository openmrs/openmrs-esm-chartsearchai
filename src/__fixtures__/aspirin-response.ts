/**
 * A live response whose one safety chip the answer cites and quotes near verbatim: asked *"Is aspirin
 * safe for her?"*, the answer reproduces the interaction finding's detail, minus its last sentence,
 * and cites the finding's own record `[46]`, while every fidelity check the backend runs reports
 * nothing. Drawn in full, the chip repeated the answer's paragraph beside it.
 *
 * Patient `763e6e5f-c489-4bab-8a55-c379f085dd1c` has active orders for botulinum toxin type A,
 * lidocaine, neomycin, metoclopramide and tiotropium. Measured 2026-09-30 on an OpenMRS 3.7.1
 * standalone with the bundled DDInter knowledge base and a local Gemma 4 E4B, through
 * `POST /chartsearchai/search` (question id 13061). Verbatim as the wire carried it, every key
 * included.
 */
export const ASPIRIN_CHIP_THE_ANSWER_CITES = {
  unstatedFindingSeverities: [],
  questionId: '13061',
  references: [
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
    'Acetylsalicylic acid (aspirin) can be given, with one caution: it interacts with active order Metoclopramide — Minor. Coadministration with metoclopramide may enhance the rate and extent of absorption of drugs that are mainly absorbed in the small intestine, such as paracetamol, aspirin, and tetracycline. The proposed mechanism is a metoclopramide-mediated increase in gastric emptying. Clinical and laboratory monitoring should be considered and the dose adjusted as appropriate [46].',
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
    },
  ],
  unstatedDosingCeilings: [],
  disclaimer:
    "This response is AI-generated and may not be accurate. It is not a substitute for clinical judgment. Always verify against the patient's medical records.",
};
