/**
 * Two live responses whose contraindication chips are the same words, `type`, `drug` and `detail`
 * alike, and differ only in `aboutACurrentMedication`. That is the shape
 * openmrs-module-chartsearchai#527 was filed on, and its first patient is the first one here: one
 * patient already takes the drug, and for the other the question proposes it. #535 put the key on
 * the wire. The backend README says the chip's `detail` does not change with the key, so the key is
 * the only thing on the chip telling those two apart.
 *
 * Measured 2026-09-28 on an OpenMRS 2.9.0-SNAPSHOT standalone with the bundled DDInter knowledge
 * base, backend carrying #535. Verbatim as the wire carried them, including keys this panel does
 * not read, so a key the client misspells cannot pass against a fixture spelling it the same way.
 */

/**
 * Patient `e30bc8f0-08bb-406c-986a-2b153a495603`, who has a recorded ibuprofen allergy and active
 * orders for Advil 400mg and Aspirin 81mg, asked *"any allergies?"*. Both chips are about a
 * medication the patient already takes, and the answer names neither order.
 */
export const ALLERGY_TO_A_CURRENT_MEDICATION = {
  answer: 'Yes — an allergy is recorded: Ibuprofen (drug allergen) [1].',
  references: [
    {
      index: 1,
      resourceType: 'allergy',
      resourceUuid: '9fc487de-0f41-4969-a6b1-e6c10f77c181',
      date: null as unknown as string,
      grounded: true,
      group: 'chart',
      source: null,
      withheldInteractions: 0,
      attachedByTheModule: false,
    },
  ],
  safetyWarnings: [
    {
      type: 'contraindication',
      drug: 'Acetylsalicylic acid (aspirin)',
      detail:
        "Acetylsalicylic acid (aspirin) is in the same cross-reactivity group (NSAID) as the patient's allergy to Ibuprofen — possible cross-reactivity",
      severity: null,
      chartOrderBridges: [],
      namedPartners: [],
      restsOnAnUncorroboratedChartMatch: false,
      aboutAnEndedOrder: false,
      endedOrderStopDate: null,
      aboutACurrentMedication: true,
    },
    {
      type: 'contraindication',
      drug: 'Ibuprofen',
      detail: 'The patient has a recorded allergy to Ibuprofen.',
      severity: null,
      chartOrderBridges: [],
      namedPartners: [],
      restsOnAnUncorroboratedChartMatch: false,
      aboutAnEndedOrder: false,
      endedOrderStopDate: null,
      aboutACurrentMedication: true,
    },
  ],
};

/**
 * Patient `71c5a6eb-b47c-4ec1-93fd-9d4a568ac724`, who has the same recorded ibuprofen allergy and
 * NO ibuprofen order, asked *"Can I give her ibuprofen?"*. The first chip is word for word the
 * ibuprofen chip above with the key `false`: the drug is proposed, not taken.
 */
export const ALLERGY_TO_A_PROPOSED_DRUG = {
  answer:
    'No — Ibuprofen should not be given: The patient has a recorded allergy to Ibuprofen [1], a reason to withhold it [438]. Additionally, Ibuprofen interacts with active order Acetylsalicylic acid (aspirin) [3], a Major reason to withhold it [439].',
  references: [
    {
      index: 3,
      resourceType: 'drug_order',
      resourceUuid: 'eab3e8a9-0301-4e11-a007-74f556fd8cbf',
      date: '2026-08-04',
      grounded: null,
      group: 'chart',
      source: null,
      withheldInteractions: 0,
      attachedByTheModule: false,
    },
    {
      index: 1,
      resourceType: 'allergy',
      resourceUuid: 'e0d7be38-abcc-4120-9f2a-24f3c1ef60a5',
      date: null as unknown as string,
      grounded: null,
      group: 'chart',
      source: null,
      withheldInteractions: 0,
      attachedByTheModule: false,
    },
    {
      index: 2,
      resourceType: 'allergy',
      resourceUuid: 'h1440000-0000-4000-8000-000000000a03',
      date: null as unknown as string,
      grounded: null,
      group: 'chart',
      source: null,
      withheldInteractions: 0,
      attachedByTheModule: true,
    },
    {
      index: 438,
      resourceType: 'safety_finding',
      resourceUuid: 'contraindication:Ibuprofen',
      date: null as unknown as string,
      grounded: null,
      group: 'reference',
      source: null,
      withheldInteractions: 0,
      attachedByTheModule: false,
    },
    {
      index: 439,
      resourceType: 'safety_finding',
      resourceUuid: 'interaction:Ibuprofen',
      date: null as unknown as string,
      grounded: null,
      group: 'reference',
      source: null,
      withheldInteractions: 0,
      attachedByTheModule: false,
    },
  ],
  safetyWarnings: [
    {
      type: 'contraindication',
      drug: 'Ibuprofen',
      detail: 'The patient has a recorded allergy to Ibuprofen.',
      severity: null,
      chartOrderBridges: [],
      namedPartners: [],
      restsOnAnUncorroboratedChartMatch: false,
      aboutAnEndedOrder: false,
      endedOrderStopDate: null,
      aboutACurrentMedication: false,
    },
    {
      type: 'interaction',
      drug: 'Ibuprofen',
      detail:
        'Ibuprofen interacts with active order Acetylsalicylic acid (aspirin) — Major. The antiplatelet and cardioprotective effect of low-dose aspirin may be antagonized by coadministration of some nonsteroidal anti-inflammatory drugs (NSAIDs). Ibuprofen has been specifically implicated, and there is evidence that others including indomethacin, naproxen, and tiaprofenic acid may also interact. The mechanism is competitive inhibition of platelet cyclooxygenase by certain NSAIDs, which, unlike aspirin, bind reversibly at the active site of the enzyme and cause a temporary rather than persistent depression of thromboxane formation and thromboxane-dependent platelet function. The combined use of aspirin with NSAIDs in general may increase the potential for serious gastrointestinal (GI) toxicity, including inflammation, bleeding, ulceration, and perforation. Ibuprofen is in the same cross-reactivity group (NSAID) as active order Acetylsalicylic acid (aspirin) — possible additive or duplicate-class therapy',
      severity: 'Major',
      chartOrderBridges: [],
      namedPartners: ['Acetylsalicylic acid (aspirin)'],
      restsOnAnUncorroboratedChartMatch: false,
      aboutAnEndedOrder: false,
      endedOrderStopDate: null,
      aboutACurrentMedication: false,
    },
  ],
};
