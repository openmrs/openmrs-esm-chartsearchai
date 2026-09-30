/**
 * A live answer about one of the patient's own medications: her lidocaine allergy against
 * her lidocaine order (a contraindication naming the order in `currentMedicationOrders`),
 * two interaction chips about her lidocaine, and her tiotropium allergy marked
 * `aboutAnotherOfHerMedications`.
 *
 * Patient `763e6e5f-c489-4bab-8a55-c379f085dd1c`, asked
 * *"Is her lidocaine safe given her allergies?"*. Measured 2026-09-30 on an OpenMRS 3.7.1
 * standalone, through `POST /chartsearchai/search` (question id 13147). Verbatim as the wire
 * carried it, every key included.
 */
export const LIDOCAINE_QUESTION_ABOUT_HER_OWN_ORDER = {
  unstatedFindingSeverities: [],
  questionId: '13147',
  references: [
    {
      index: 1,
      resourceType: 'allergy',
      resourceUuid: '2442c512-a43e-11f1-93d0-deb0bf1c9adc',
      date: null,
      grounded: null,
      group: 'chart',
      source: null,
      withheldInteractions: 0,
      attachedByTheModule: true,
      attachedFor: [46],
    },
    {
      index: 46,
      resourceType: 'safety_finding',
      resourceUuid: 'contraindication:Lidocaine',
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
      resourceType: 'safety_finding',
      resourceUuid: 'interaction:Lidocaine',
      date: null,
      grounded: null,
      group: 'reference',
      source: null,
      withheldInteractions: 0,
      attachedByTheModule: false,
      attachedFor: [],
    },
    {
      index: 48,
      resourceType: 'safety_finding',
      resourceUuid: 'interaction:Lidocaine',
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
  cautionLedOverWithholding: [],
  chartReadForSafety: true,
  answer:
    'Lidocaine is related to a Major interaction with active order Metoclopramide [47], which is a reason to change a medication this patient is already taking. Additionally, the patient has a recorded allergy to Lidocaine [46].',
  findingCitations: {
    carried: 4,
    cited: 2,
  },
  interactionPairs: {
    found: 2,
    reported: 2,
    belowFloor: [
      {
        drug: 'Lidocaine',
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
      aboutAnotherOfHerMedications: false,
    },
    {
      type: 'interaction',
      drug: 'Lidocaine',
      detail:
        'Lidocaine interacts with active order Metoclopramide — Major. Coadministration of local anesthetics with other oxidizing agents that can also induce methemoglobinemia such as antimalarials (e.g., chloroquine, primaquine, quinine, tafenoquine), nitrates and nitrites, sulfonamides, aminosalicylic acid, dapsone, dimethyl sulfoxide, flutamide, metoclopramide, nitrofurantoin, phenazopyridine, phenobarbital, phenytoin, and rasburicase may increase the risk.',
      severity: 'Major',
      chartOrderBridges: [],
      namedPartners: ['Metoclopramide'],
      restsOnAnUncorroboratedChartMatch: false,
      aboutAnEndedOrder: false,
      endedOrderStopDate: null,
      aboutACurrentMedication: true,
      currentMedicationOrders: [],
      statedInTheAnswer: false,
      aboutAnotherOfHerMedications: false,
    },
    {
      type: 'interaction',
      drug: 'Lidocaine',
      detail:
        'Lidocaine interacts with active order Neomycin — Minor. Limited in vitro data suggest that some aminoglycosides may enhance the neuromuscular blocking properties of lidocaine. Data are available for neomycin only. No special precautions are necessary.',
      severity: 'Minor',
      chartOrderBridges: [],
      namedPartners: ['Neomycin'],
      restsOnAnUncorroboratedChartMatch: false,
      aboutAnEndedOrder: false,
      endedOrderStopDate: null,
      aboutACurrentMedication: true,
      currentMedicationOrders: [],
      statedInTheAnswer: false,
      aboutAnotherOfHerMedications: false,
    },
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
  ],
  unstatedDosingCeilings: [],
  disclaimer:
    "This response is AI-generated and may not be accurate. It is not a substitute for clinical judgment. Always verify against the patient's medical records.",
};
