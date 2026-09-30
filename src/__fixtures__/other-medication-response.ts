/**
 * A live answer beside which two findings about the patient's OTHER medications were raised:
 * asked about ibuprofen, the answer named her lidocaine and tiotropium orders as interaction
 * partners, which brought her recorded allergies to both into the response. Both chips answer
 * `aboutAnotherOfHerMedications: true`.
 *
 * Patient `763e6e5f-c489-4bab-8a55-c379f085dd1c`, asked *"Can I give her ibuprofen?"*. Measured 2026-09-30
 * on an OpenMRS 3.7.1 standalone, through `POST /chartsearchai/search` (question id 13146).
 * Verbatim as the wire carried it, every key included.
 */
export const IBUPROFEN_BESIDE_HER_OWN_ALLERGIES = {
  unstatedFindingSeverities: [],
  questionId: '13146',
  references: [
    {
      index: 4,
      resourceType: 'drug_order',
      resourceUuid: '238e9b4c-5dc2-4e7c-9089-0e439b9c15b8',
      date: '2026-08-04',
      grounded: null,
      group: 'chart',
      source: null,
      withheldInteractions: 0,
      attachedByTheModule: false,
      attachedFor: [],
    },
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
      index: 8,
      resourceType: 'drug_order',
      resourceUuid: 'i1520000-0000-0000-0000-0000000000c4',
      date: '2026-08-03',
      grounded: null,
      group: 'chart',
      source: null,
      withheldInteractions: 0,
      attachedByTheModule: false,
      attachedFor: [],
    },
    {
      index: 45,
      resourceType: 'drug_reference',
      resourceUuid: '5640',
      date: null,
      grounded: null,
      group: 'reference',
      source: 'DDInter 2.0 (via openmrs-ddi-knowledge-base)',
      withheldInteractions: 704,
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
    'Ibuprofen can be given, with cautions regarding interactions with Lidocaine [6], Metoclopramide [8], and Tiotropium [4], as noted in the drug reference [45].',
  findingCitations: {
    carried: 0,
    cited: 0,
  },
  interactionPairs: {
    found: 0,
    reported: 0,
    belowFloor: [
      {
        drug: 'Ibuprofen',
        partner: 'lidocaine',
        severity: 'Unknown',
      },
      {
        drug: 'Ibuprofen',
        partner: 'metoclopramide',
        severity: 'Unknown',
      },
      {
        drug: 'Ibuprofen',
        partner: 'tiotropium',
        severity: 'Unknown',
      },
    ],
  },
  conditionRuleCoverage: 'absent',
  orderStopDates: [],
  safetyWarnings: [
    {
      type: 'contraindication',
      drug: 'Tiotropium',
      detail: 'The patient has a recorded allergy to Tiotropium.',
      severity: null,
      chartOrderBridges: [],
      namedPartners: [],
      restsOnAnUncorroboratedChartMatch: false,
      aboutAnEndedOrder: false,
      endedOrderStopDate: null,
      aboutACurrentMedication: true,
      currentMedicationOrders: [
        {
          orderDisplay: 'Tiotropium',
          orderUuid: '238e9b4c-5dc2-4e7c-9089-0e439b9c15b8',
        },
      ],
      statedInTheAnswer: false,
      aboutAnotherOfHerMedications: true,
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
