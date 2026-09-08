import { describe, expect, it } from 'vitest';
import type { AiReference, AiSafetyWarning } from '../api/chartsearchai';
import {
  citationGroupPattern,
  claimTextByCitation,
  isReferenceData,
  namesLead,
  REFERENCE_RESOURCE_TYPES,
  parseCitationIndices,
  referenceKind,
  resolveFindingSeverities,
  severityTone,
} from './safety-disclosure';

import {
  ANSWER_BARE_LIST,
  ANSWER_BY_ORDER_DISPLAY,
  ANSWER_BY_SUBSTANCE,
  ANSWER_MECHANISM_CLAUSES,
  ANSWER_RESTATED_SUBJECT,
  ANSWER_TWO_FAMILIES,
  interaction,
  REFERENCES,
  SAFETY_WARNINGS,
  safetyFindingRef,
  TWO_FAMILY_REFS,
  TWO_FAMILY_WARNINGS,
  UNSTATED,
} from '../__fixtures__/clarithromycin-response';

const ANSWER = ANSWER_BY_SUBSTANCE;

describe('isReferenceData', () => {
  it('recognises every reference resource type, not just drug_reference', () => {
    for (const resourceType of REFERENCE_RESOURCE_TYPES) {
      expect(isReferenceData({ index: 1, resourceType, resourceUuid: 'x', date: '' })).toBe(true);
    }
  });

  it('prefers the response’s own group over the resource type', () => {
    // A reference-group entry whose type this client has never heard of still must not navigate.
    expect(
      isReferenceData({ index: 1, resourceType: 'some_future_type', resourceUuid: 'x', date: '', group: 'reference' }),
    ).toBe(true);
  });

  it('treats chart records as navigable', () => {
    expect(isReferenceData({ index: 1, resourceType: 'allergy', resourceUuid: 'x', date: '', group: 'chart' })).toBe(
      false,
    );
    expect(isReferenceData({ index: 1, resourceType: 'drug_order', resourceUuid: 'x', date: '' })).toBe(false);
  });
});

describe('severityTone', () => {
  it('recognises the bundled knowledge base’s vocabulary, case- and space-insensitively', () => {
    expect(severityTone('Major')).toBe('major');
    expect(severityTone('  moderate ')).toBe('moderate');
    expect(severityTone('MINOR')).toBe('minor');
    expect(severityTone('Unknown')).toBe('unknown');
  });

  it('treats a word it does not recognise as unrated rather than as a tier', () => {
    // An operator's own dataset supplies its own words; colouring one as a tier would assert a
    // ranking the dataset never stated.
    expect(severityTone('Severe')).toBe('unrated');
    expect(severityTone('')).toBe('unrated');
  });
});

describe('stripExclusions must not delete the cited finding’s own subject', () => {
  it('does not strip a SHORT "besides" clause either', () => {
    // The sibling below is caught by the four-token bound alone, so this one pins the removal of
    // `besides` from the list itself: one token, so the bound would let it through.
    const answer =
      'Clarithromycin will raise her Solu-Medrol 125mg/5ml levels, besides Prednisone, so watch for adrenal suppression [352].';
    expect([...resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [352])]).toEqual([]);
  });

  it('does not treat "besides" as exclusive — it is additive in English', () => {
    // "besides X" means IN ADDITION TO X. Stripping it left Solu-Medrol as the only candidate
    // named and rendered Major where the truth is Moderate; written "as well as" the same
    // sentence correctly refuses, so the strip was turning a refusal into a WRONG rating.
    const answer =
      'Clarithromycin will raise her Solu-Medrol 125mg/5ml levels, besides those of Prednisone Co 5mg, so watch for adrenal suppression [352].';
    expect([...resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [352])]).toEqual([]);
  });

  it('does not reach back past the noun the writer actually excluded', () => {
    // The span was bounded by CHARACTERS with a lazy quantifier that backtracks, so
    // leftmost-match ate the longest run before " aside," — here the module's own anchoring
    // phrase for Prednisone. Rendered Major against a truth of Moderate. Now bounded to four
    // tokens, which a drug display fits and a clause does not.
    const answer =
      'Clarithromycin interacts with active order Prednisone Co 5mg though dose timing aside, Solu-Medrol 125mg/5ml carries the same mechanism [352].';
    expect([...resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [352])]).toEqual([]);
  });

  it('leaves an "except" clause alone when it is longer than a drug name', () => {
    const answer =
      'Every steroid is affected except Prednisone Co 5mg at her current dose, and Solu-Medrol 125mg/5ml most of all [352].';
    expect([...resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [352])]).toEqual([]);
  });

  it('still strips the forms that are genuinely exclusive', () => {
    // The positive control: the recovery cycle 10 measured must survive the tightening.
    const answer = 'Hydrocortisone aside, the order that matters is Solu-Medrol 125mg/5ml [350].';
    expect(resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350]).get(350)).toBe('Major');
  });
});

describe('an exclusion clause in an EARLIER sentence is not about this claim', () => {
  it('refuses when the strip would otherwise delete the subject out of the head', () => {
    // The last recorded open residual of the head-rule class, closed by stripping only the head's
    // LAST sentence — the part that is the first citation's claim window — rather than the whole
    // head. "except for Solu-Medrol 125mg/5ml" sits in an earlier sentence, so it is not about
    // [350]'s claim; stripping it there deleted the subject and rendered Prednisone's rating.
    // Closing it cost nothing: the corpus is unchanged at 80 ratings. The alternative measured
    // four live ratings.
    const answer =
      'No corticosteroid is safe here, except for Solu-Medrol 125mg/5ml, which is the worst of them. The rise is above what Prednisone Co 5mg gives [350].';
    expect([...resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350])]).toEqual([]);
  });

  it('still strips an exclusion clause in the SAME sentence as the marker', () => {
    // The control, and why the strip must still reach the last sentence: this is the recovery the
    // strip exists for.
    const answer = 'Hydrocortisone aside, the order that matters is Solu-Medrol 125mg/5ml [350].';
    expect(resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350]).get(350)).toBe('Major');
  });
});

describe('a colon after a marker is a label separator, not a sentence close', () => {
  it('keeps the forward claim alive after a colon, which is what lets the set object', () => {
    // `:` is deliberately absent from the set of terminators that zero a forward claim, and
    // nothing discriminated that until this test: the whole suite and the property sweep stayed
    // green with `:` added. It is load-bearing anyway — over a 3,840-answer sweep of
    // colon-after-marker shapes, adding it resolves 64 MORE answers and every one of the 64 is a
    // wrong rating, because zeroing that claim costs the set its right to object and the
    // trailing reading's election, scavenged from the lead-in, then stands.
    //
    // The example the comment beside that clause used to offer refuses either way, so it was
    // evidence for nothing. This one discriminates: with `:` treated as a close it renders
    // {350: Moderate, 351: Major} and 350 is Budesonide, which is Major.
    const answer = 'Prednisone is the lesser worry, but the greater one is [350]: Budesonide [351] Budesonide';
    expect([...resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350, 351])]).toEqual([]);
  });
});

describe('a subject the answer names that no citation will claim', () => {
  it('refuses across TWELVE phrasings of the same comparison, not just those on a word list', () => {
    // The measurement that retired the second word list in this file. A comparison-marker list
    // was added for the live wrong rating below, then measured: 11 of these 12 still rendered the
    // wrong rating. What closes all twelve is the HEAD rule — the subject is named in the answer,
    // before the set's first marker, and no citation claims it. Removing the word list afterwards
    // changed nothing.
    const head = 'Her Solu-Medrol 125mg/5ml is the order at issue [17]. ';
    for (const contrast of [
      'far more than those of Prednisone',
      'over those of Prednisone',
      'compared with Prednisone',
      'versus Prednisone',
      'beyond those of Prednisone',
      'in contrast to Prednisone',
      'relative to Prednisone',
      '; Prednisone is milder',
      ', not Prednisone',
      '\u2014 Prednisone is the lesser worry',
      'well above Prednisone',
      'unlike Prednisone',
    ]) {
      const answer = `${head}Clarithromycin raises its levels ${contrast} [350].`;
      expect([...resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350])]).toEqual([]);
    }
  });

  it('refuses when an earlier family member is named with a citation of its own', () => {
    // This asserted a RESOLUTION for one cycle, on the strength of an exemption for a mention
    // that "cites itself". The exemption meant "some bracketed number sits within two words of
    // this name", which a trailing chart citation on an order display always satisfies — the
    // form this module's own fixture carries verbatim, and the form the resolver elsewhere calls
    // the ordinary one. So it exempted the leftover subject on exactly the prose the head rule
    // exists for: 1,696 of 1,696 resolving answers of that class carried a wrong rating, none
    // resolved correctly, and one was captured verbatim from the running server.
    //
    // It cost 5 live ratings to remove (`q1_mixed`, `q6_interleaved`) and this assertion with
    // them. Same trade as every other refusal here, and the same reason: an answer that names a
    // family member the citations do not account for has not said which finding is which.
    const answer =
      'Clarithromycin interacts with active order Methylprednisolone [16]. Additionally, it interacts with active order Prednisone [352].';
    expect([...resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [352])]).toEqual([]);
  });

  it('refuses the live shape where a chart citation used to exempt the leftover', () => {
    // Captured verbatim from the running server. "Its exposure rise" is Solu-Medrol's, and the
    // AUC figure is copied out of the Methylprednisolone warning's own detail — so the sentence
    // is about that finding (Major) and Prednisone is the comparison only.
    for (const answer of [
      'Solu-Medrol 125mg/5ml [17]. Its exposure rise is increased systemic exposure by approximately 100 percent compared to Prednisone [350].',
      'Clarithromycin interacts with active order Methylprednisolone [177]. That interaction is graver than the one with Prednisone [350].',
      'Solu-Medrol 125mg/5ml, Pulmicort 90mcg [166], and Prednisone Co 5mg are all active. The steepest rise of the three is bigger than what Prednisone Co 5mg gives [350].',
    ]) {
      expect([...resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350])]).toEqual([]);
    }
  });

  it('refuses where an "X aside," clause had swallowed the subject', () => {
    // The trailing exclusion form allowed four tokens for the excluded name, so a two-token
    // "dose timing aside" preceded by a four-token order display took the drug with it. Bounded
    // to two tokens now: "dose timing aside," still strips, and the order display stays in the
    // head where it belongs.
    for (const answer of [
      'Solu-Medrol 125mg/5ml dose timing aside, the exposure rise is bigger than anything Prednisone Co 5mg would cause [350].',
      'Her Solu-Medrol 125mg/5ml dose timing aside, she is stable. The exposure rise is well above Prednisone Co 5mg [350].',
    ]) {
      expect([...resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350])]).toEqual([]);
    }
  });
});

describe('a drug the claim COMPARES AGAINST is not its subject', () => {
  it('refuses where the subject sits one sentence back, behind a chart citation', () => {
    // Live-reproducible on the demo chart, and a Major/Moderate swap on the REAL ratings: the
    // server returned "Her active order is recorded in [17]. Clarithromycin raises its levels far
    // more than those of prednisone … [364]." and the module rendered Prednisone's rating for the
    // Methylprednisolone finding, whose mechanism clause the sentence quotes verbatim.
    //
    // No window in any reading, nor the tail, ever contains the subject — so every objection was
    // structurally silent and the only candidate named was the one the claim says the effect is
    // GREATER THAN. Root cause was two bounds cancelling: the foreign-marker widening exists for
    // this prose in ONE sentence, and the sentence-break bound undoes it across a full stop.
    // 200,000 generated answers of the class resolved 110,514 and every one was wrong.
    const answer =
      'Her Solu-Medrol 125mg/5ml is the order at issue [17]. Clarithromycin raises its levels far more than those of Prednisone [350].';
    expect([...resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350])]).toEqual([]);
  });

  it('refuses the same shape across a line break, and other comparison wordings', () => {
    for (const contrast of [
      'raises its levels far more than those of Prednisone',
      'is the bigger problem rather than Prednisone',
      'matters here as opposed to Prednisone',
      'is the concern instead of Prednisone',
      'is implicated but not Prednisone',
      'is the graver one whereas Prednisone is milder',
    ]) {
      const answer = `Her Solu-Medrol 125mg/5ml is the order at issue [17]\nClarithromycin ${contrast} [350].`;
      expect([...resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350])]).toEqual([]);
    }
  });

  it('still resolves when the comparison names something that is not a candidate', () => {
    // The control: stripping a comparison clause must not cost a rating when the drug it names
    // is not one of the set's candidates.
    const answer =
      'Clarithromycin interacts with active order Solu-Medrol 125mg/5ml, far more than with placebo [350].';
    expect(resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350]).get(350)).toBe('Major');
  });
});

describe('a finding no prose can name', () => {
  it('refuses the whole set rather than donating its citation to a sibling', () => {
    // A rated chip with an empty `detail` and no bridges has zero leads in every group, so no
    // window can name it — and every window that mentions its bridged sibling then names exactly
    // one candidate, unanimously, in all three readings. `electCandidate` returns a confident
    // winner and all four objections agree with it. Measured: Major rendered for the answer's
    // Prednisone sentence against a truth of Minor.
    //
    // Both halves are reachable: `discriminatingLeads` already notes that an operator's dataset
    // can rate a rule and leave its note empty, and a note truncating to the subject drug yields
    // a lead the same function drops as non-discriminating.
    const warnings: AiSafetyWarning[] = [
      interaction('Methylprednisolone', 'Major', 'Solu-Medrol 125mg/5ml'),
      { type: 'interaction', drug: 'Clarithromycin', detail: '', severity: 'Minor', chartOrderBridges: [] },
    ];
    const refs = [safetyFindingRef(352)];
    for (const answer of [
      'Clarithromycin interacts with active order Prednisone, a weaker effect than for Methylprednisolone [352].',
      'Clarithromycin interacts with active order Prednisone by the same route it affects Solu-Medrol 125mg/5ml [352].',
    ]) {
      expect([...resolveFindingSeverities(answer, refs, warnings, [352])]).toEqual([]);
    }
  });
});

describe('the two contest rules that survive the tail rule', () => {
  it('refuses where the forward-disagreement rule is the ONLY objection', () => {
    // Rule 1 was discriminated by NOTHING until this shape: disabling it left all 310 tests
    // green, and the test named for it ("refuses a swap the shift-consistency rule cannot see")
    // had been caught up with by the tail rule, which now refuses that answer earlier.
    //
    // Rule 1 survives precisely where the tail rule's carve-out applies. Here the tail restates
    // the LAST citation's own election, so the tail rule stands down by design — and an earlier
    // citation's forward election still disagrees with trailing's, which only rule 1 can see.
    // Without it: {350: Moderate, 352: Major} against a truth of {350: Major, 352: Moderate}.
    const answer =
      'Prednisone is the lesser worry, but the greater one is [350]\nSolu-Medrol 125mg/5ml [352]\nSolu-Medrol 125mg/5ml';
    expect([...resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350, 352])]).toEqual([]);
  });

  it('resolves a subject restated by its order display — the carve-out the rule above covers', () => {
    // The live answer the carve-out rests on, now a committed fixture rather than a citation to
    // a scratch corpus. A candidate in the tail does not object when it is the last citation's
    // own election; without that, this restatement reads as a subject left over and the rating
    // is discarded.
    expect(resolveFindingSeverities(ANSWER_RESTATED_SUBJECT, REFERENCES, SAFETY_WARNINGS, [350]).get(350)).toBe(
      'Major',
    );
  });
});

describe('the partner may sit a whole clause away from its marker', () => {
  it('resolves a measured answer whose evidence is never adjacent to its marker', () => {
    // The refutation of proximity-as-evidence, kept as a test because the idea keeps coming back.
    // Every election here is eight to fifteen words from its marker, separated by a mechanism
    // clause, and every one is correct. A distance test closes the rotation class at the same
    // price as the rule that shipped and takes this answer with it.
    const resolved = resolveFindingSeverities(
      ANSWER_MECHANISM_CLAUSES,
      REFERENCES,
      SAFETY_WARNINGS,
      [350, 351, 352, 354],
    );
    expect(Object.fromEntries(resolved)).toStrictEqual({
      350: 'Major',
      351: 'Major',
      352: 'Moderate',
      354: 'Moderate',
    });
  });
});

describe('a subject left over past the set’s last own marker', () => {
  it('refuses a rotation whose last forward window a foreign marker emptied', () => {
    // The residual cycle 10 recorded and could not close. Every contest was silent: the
    // disagreement gate needs the forward reading to name at every cited index and `[14]`
    // empties [352]'s window; the NAMED rule is blind to a rotation by construction; and the
    // block rule reads the same direction as trailing. Rendered {350: Moderate, 352: Major}
    // against a truth of {350: Major, 352: Moderate} — a swapped pair.
    const answer =
      'Hydrocortisone Injection vial 100mg matters less than [350]\nSolu-Medrol 125mg/5ml [352]\n[14] Prednisone Co 5mg';
    expect([...resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350, 352])]).toEqual([]);
  });

  it('refuses it when a full stop empties that window instead', () => {
    // The other way to empty it, through the terminator rule rather than a marker. Same shape,
    // same outcome, and the tail test cannot be evaded by either because it does not read a
    // claim window at all.
    const answer =
      'Hydrocortisone Injection vial 100mg matters less than [350]\nSolu-Medrol 125mg/5ml [352].\nPrednisone Co 5mg';
    expect([...resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350, 352])]).toEqual([]);
  });

  it('refuses a measured answer whose last sentence belongs to another family — 13 ratings', () => {
    // This asserted a RESOLUTION until the tail became per-set and marker-transparent, and the
    // reversal is the price of closing the rotation class. Methylprednisolone is a candidate of
    // the Clarithromycin family AND the subject of the closing sentence, which carries the OTHER
    // family's citations — so it sits in this set's tail and reads as a subject left over.
    //
    // Measured cost across the whole live corpus: 98 ratings to 85, on three answers
    // (`n5_worst_first`, `q14_dropone`, `q4_screen_all`), all lost for this same reason. Against
    // that: cutting the tail at the ANSWER's last marker instead left the rule DORMANT wherever
    // any citation followed the dangling name, which is the ordinary form on this chart — and
    // that family resolved 35,010 answers of which 35,010 carried a wrong rating.
    //
    // 13 blanks against a class that is wrong every time it fires. The premise this module rests
    // on decides it, and the premise is not a preference: a clinician reading a Major finding
    // badged Moderate has been actively misled, where a missing badge sends them to the chart.
    const resolved = resolveFindingSeverities(
      ANSWER_TWO_FAMILIES,
      TWO_FAMILY_REFS,
      TWO_FAMILY_WARNINGS,
      [363, 364, 365, 366, 355, 356, 357],
    );
    expect([...resolved]).toEqual([]);
    // The second family never resolved here either, for an unrelated and correct reason: its
    // three markers sit in one adjacent run, so they share one claim that names all three
    // candidates and elects none. Asserted so the empty result above is not read as this rule's
    // doing on both families.
  });

  it('refuses when the closing sentence merely NAMES a candidate — the accepted cost', () => {
    // This has now asserted a refusal, then a resolution, and a refusal again, and the reason it
    // moved twice is worth keeping. A function-word list was tried, so that a bare noun phrase
    // counted as a dangling subject and a clause did not; it recovered these two correct ratings
    // and it was defeated by every dangling name written with a determiner
    // ("Hydrocortisone Injection vial 100mg is the last of them." renders a swapped pair). The
    // distinction is grammatical and nothing here parses, so the tail is read regardless of
    // shape and this answer pays for it.
    //
    // Not zero-cost: 13 of 98 ratings across the corpus, stated in full on the sibling test
    // below and in the README. The alternative was a swapped Major/Moderate
    // pair. A blank is safe, which is the premise the whole module rests on.
    const answer =
      'Clarithromycin interacts with active order Solu-Medrol 125mg/5ml [350], and with active order Pulmicort 90mcg [351]. Prednisone would be the safer choice.';
    expect([...resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350, 351])]).toEqual([]);
  });

  it('refuses a CLOSED rotation, whose leftover is claimed at the wrong index', () => {
    // The class the tail rule missed on its first outing, and the worst measured on this branch:
    // across 26,766 resolving answers of this family EVERY one carried a wrong rating. A
    // rotation closed by a lead-in naming the last partner claims every candidate, so testing
    // "named in the tail and claimed by NOBODY" fell silent — the leftover is claimed, at the
    // wrong index. The test is now claimed-by-an-EARLIER-citation.
    //
    // It differs from a refusal by one character: delete the full stop and the forward reading is
    // no longer zeroed, so rule 1 objects. The sibling below uses a chart citation instead.
    const answer =
      'Hydrocortisone Injection vial 100mg is the lesser worry, but the greater one is [350].\nSolu-Medrol 125mg/5ml [354]\nHydrocortisone Injection vial 100mg';
    expect([...resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350, 354])]).toEqual([]);
  });

  it('refuses it when a chart citation empties the window instead of a full stop', () => {
    const answer =
      'Hydrocortisone Injection vial 100mg is the lesser worry, but the greater one is [350], per her active orders [17]\nSolu-Medrol 125mg/5ml [354]\nHydrocortisone Injection vial 100mg';
    expect([...resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350, 354])]).toEqual([]);
  });

  it('refuses a closed rotation whose dangling name is followed by a citation', () => {
    // The tail used to begin after the ANSWER's last marker, so ANY citation after the dangling
    // name emptied it and this rule went silent. That is not a contrivance: two live answers end
    // with a chart citation after the finding marker, so the rule was DORMANT on a large share of
    // real answers. Swept: 35,010 resolving answers of this family, 35,010 carrying a wrong
    // rating. The tail is now per-set and starts after the set's own last first-occurrence
    // marker instead of stopping at the answer's last one.
    const head =
      'Hydrocortisone Injection vial 100mg is the lesser worry, but the greater one is [350].\nSolu-Medrol 125mg/5ml [354]\nHydrocortisone Injection vial 100mg';
    for (const suffix of [' [14]', ' [17].', ', an active order [14]', ' — see [350] above']) {
      expect([...resolveFindingSeverities(head + suffix, REFERENCES, SAFETY_WARNINGS, [350, 354])]).toEqual([]);
    }
  });

  it('refuses a closed rotation whose dangling name sits in an exclusion clause', () => {
    // `stripExclusions` was being applied to the tail as well as to the claim, which deleted the
    // leftover subject before this rule could see it — a seven-word escape hatch on the rule, in
    // a file whose own README said it "does not care what the closing text says about that drug".
    const head =
      'Hydrocortisone Injection vial 100mg is the lesser worry, but the greater one is [350].\nSolu-Medrol 125mg/5ml [354]\n';
    for (const tail of [
      'Hydrocortisone Injection vial 100mg aside, that is the list.',
      'Apart from Hydrocortisone Injection vial 100mg, that is the list.',
      'Unlike Hydrocortisone Injection vial 100mg, these matter.',
      'Except Hydrocortisone Injection vial 100mg, that is all.',
    ]) {
      expect([...resolveFindingSeverities(head + tail, REFERENCES, SAFETY_WARNINGS, [350, 354])]).toEqual([]);
    }
  });

  it('refuses a closed rotation whose dangling name is written as a sentence', () => {
    // The hole a function-word list left, and why the tail is now read regardless of grammar.
    // Five phrasings of the same dangling subject were measured rendering the swapped pair,
    // differing from the bare form only by a determiner or a verb.
    const head =
      'Hydrocortisone Injection vial 100mg is the lesser worry, but the greater one is [350].\nSolu-Medrol 125mg/5ml [354]\n';
    for (const tail of [
      'Hydrocortisone Injection vial 100mg is the last of them.',
      'Hydrocortisone Injection vial 100mg is also on her list.',
      'And Hydrocortisone Injection vial 100mg.',
      'Then there is Hydrocortisone Injection vial 100mg.',
      'Hydrocortisone Injection vial 100mg for the fifth.',
    ]) {
      expect([...resolveFindingSeverities(head + tail, REFERENCES, SAFETY_WARNINGS, [350, 354])]).toEqual([]);
    }
  });

  it('refuses a five-item closed rotation, where every rating would be wrong', () => {
    const answer = [
      'Of her five interacting orders Hydrocortisone Injection vial 100mg is the mildest and the worst is [350].',
      'Solu-Medrol 125mg/5ml [351]',
      'Pulmicort 90mcg [352]',
      'Prednisone Co 5mg [353]',
      'Dexamethasone Injection vial 8mg [354]',
      'Hydrocortisone Injection vial 100mg',
    ].join('\n');
    expect([...resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350, 351, 352, 353, 354])]).toEqual([]);
  });
});

describe('a clause that names a drug to exclude it is not evidence for it', () => {
  it('recovers the live "Apart from prednisone, …" answer instead of refusing it', () => {
    // Measured on the live server. Prednisone is one of the five candidates sharing
    // (interaction, Clarithromycin), so before the exclusion clause was stripped [364]'s window
    // named both Prednisone and Methylprednisolone, elected neither, and the whole set refused.
    // Four correct ratings were being discarded by a clause that says the opposite of what it
    // was read as.
    const answer =
      'Apart from prednisone, Methylprednisolone [364] Budesonide [365] Dexamethasone [367] Hydrocortisone [368].';
    const refs = [364, 365, 367, 368].map((i) => safetyFindingRef(i));
    const resolved = resolveFindingSeverities(answer, refs, SAFETY_WARNINGS, [364, 365, 367, 368]);
    expect(resolved.get(364)).toBe('Major');
    expect(resolved.get(365)).toBe('Major');
  });

  it('refuses two exclusion lines that scavenge from each other', () => {
    // The other direction, and why stripping is not merely a recovery. Singly such a line
    // already refused, because the forward reading disagreed. TWO of them elect out of each
    // other's preambles and produce a complete, injective, wholly wrong bijection that no
    // contest objects to — a swapped pair. Found by the fuzzer the moment it could write a
    // foreign marker after the subject on a marker-first line.
    const answer = [
      'Apart from Prednisone Co 5mg, the interacting orders are [353] Dexamethasone',
      'Dexamethasone aside, the worry is [352] Prednisone Co 5mg [17]',
      'Consider Pulmicort 90mcg carefully [351]; the exposure rises.',
    ].join('\n');
    const resolved = resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [351, 352, 353]);
    // 352 is Prednisone (Moderate) and 353 Dexamethasone (Moderate) on this chart, so the swap
    // is invisible to a rating comparison — assert the ELECTION is refused, not the ratings.
    expect(resolved.has(352)).toBe(false);
    expect(resolved.has(353)).toBe(false);
  });

  it('strips the trailing "X aside," form as well as the leading one', () => {
    const answer = 'Hydrocortisone aside, the order that matters is Solu-Medrol 125mg/5ml [350].';
    expect(resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350]).get(350)).toBe('Major');
  });
});

describe('a shifted list is refused even when its tell is ambiguous', () => {
  it('refuses a five-item rotation whose dangling last line names two partners', () => {
    // The class cycle 9 left open, and the worst failure this module has produced: not a missing
    // badge but five ratings, each the NEIGHBOURING finding's. The trailing reading resolves the
    // set as a clean rotation — complete and injective — while the forward reading elects the
    // correct finding for four of the five and hits a two-candidate window on the last line,
    // which cost it completeness and barred it from objecting at all.
    const answer = [
      'Budesonide aside, the order that matters most is [352]',
      'Prednisone Co 5mg [353]',
      'Dexamethasone [354]',
      'Hydrocortisone [350]',
      'Methylprednisolone [351]',
      'Budesonide rather than Prednisone Co 5mg',
    ].join('\n');
    const resolved = resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350, 351, 352, 353, 354]);
    expect([...resolved]).toEqual([]);
  });

  it('still resolves the ordinary trailing list, whose forward reading dangles nothing', () => {
    // The positive control, and the reason completeness is measured on NAMED rather than
    // dropped: written trailing, the text after the last marker names no candidate, so the
    // forward reading cannot object and the answer resolves. Removing that requirement refuses
    // this too — a normal list's forward reading is a rotation of it and always disagrees.
    const answer =
      'Clarithromycin interacts with active order Solu-Medrol 125mg/5ml [350], and with active order Pulmicort 90mcg [351], because coadministration raises plasma concentrations.';
    const resolved = resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350, 351]);
    expect(resolved.get(350)).toBe('Major');
    expect(resolved.get(351)).toBe('Major');
  });
});

describe('clauses no earlier test discriminated', () => {
  // Each of these was found by mutating the clause and watching the whole suite stay green.
  // A clause the suite never discriminates is one the next change removes for free.

  it('cuts a lead clause at a full stop when the note carries no dash', () => {
    // `leadClause` splits on ` — ` OR `. `, whichever comes first, and every test until now
    // truncated on the dash — so the second half of that expression had never run. Replacing
    // `detail.indexOf('. ')` with `-1` left the suite green.
    const warnings: AiSafetyWarning[] = [
      { ...interaction('Methylprednisolone', 'Major'), detail: 'Solu-Medrol 125mg/5ml. Prednisone is the safer pick.' },
      { ...interaction('Prednisone', 'Moderate'), detail: 'Prednisone Co 5mg. Methylprednisolone is riskier.' },
    ];
    // Without the full-stop cut, each lead runs on and names BOTH partners, so neither
    // discriminates and the set is refused.
    const resolved = resolveFindingSeverities('Solu-Medrol 125mg/5ml [350].', REFERENCES, warnings, [350]);
    expect(resolved.get(350)).toBe('Major');
  });

  it('ignores a rating that is only whitespace', () => {
    // The candidate filter tests `severity.trim() !== ''` as well as `typeof`. Only the typeof
    // half was covered — a whitespace rating would have resolved to '' and badged an empty chip.
    const warnings: AiSafetyWarning[] = [{ ...interaction('Methylprednisolone', 'Major'), severity: '   ' }];
    expect(resolveFindingSeverities('Solu-Medrol 125mg/5ml [350].', REFERENCES, warnings, [350]).size).toBe(0);
  });

  it('does not let a lead ending in a letter match a name continuing into digits', () => {
    // `isWordish` counts DIGITS as word-ish, and nothing exercised that: without it the lead
    // `Vitamin B` matches inside `Vitamin B12`, which is the class `shortOrderDisplay` was
    // measured against live.
    const warnings: AiSafetyWarning[] = [
      {
        ...interaction('Vitamin B', 'Major'),
        chartOrderBridges: [{ substance: 'Vitamin B', orderDisplay: 'Vitamin B' }],
      },
      { ...interaction('Folic acid', 'Moderate') },
    ];
    const resolved = resolveFindingSeverities('Interacts with Vitamin B12 1000mcg [350].', REFERENCES, warnings, [350]);
    expect(resolved.size).toBe(0);
  });

  it('treats a terminator as a sentence end from either side', () => {
    // SENTENCE_END is a disjunction and each half passed on its own, so neither was pinned.
    // Left half: a terminator NOT preceded by a digit. Right half: one not FOLLOWED by a digit.
    const own = new Set([350]);
    // `s.` — the terminator is preceded by a letter, so only the left alternative can match it.
    expect(
      claimTextByCitation('Reviewed [12] against Prednisone Co 5mg. Solu-Medrol 125mg/5ml [350].', 'trailing', own).get(
        350,
      ),
    ).toBe(' Solu-Medrol 125mg/5ml ');
    // `5.` followed by a space — only the RIGHT alternative matches (lookbehind sees the 5).
    expect(
      claimTextByCitation('Reviewed [12] against Prednisone 5. Solu-Medrol 125mg/5ml [350].', 'trailing', own).get(350),
    ).toBe(' Solu-Medrol 125mg/5ml ');
  });

  it('reads a dose written without a leading zero as a sentence end — a known limit', () => {
    // Recorded rather than fixed. SENTENCE_END excludes a decimal point only where a digit sits
    // on BOTH sides, so `.125mg` still reads as a terminator and truncates the window. The safe
    // direction (a refusal, not a wrong rating), and no live answer has produced the form — but
    // the comment says "not a decimal point inside a dose", which is wider than what it does.
    const claim = claimTextByCitation(
      'Solu-Medrol [12] at .125mg is the one that interacts [350].',
      'trailing',
      new Set([350]),
    ).get(350);
    expect(claim).not.toContain('Solu-Medrol');
  });
});

describe('claimTextByCitation', () => {
  it('begins a claim at its own sentence, not at the foreign marker that preceded it', () => {
    // The widening past a foreign marker (a citation outside this measurement) must not carry
    // the tail of the PREVIOUS sentence in with it. Bounding at the marker did, and a partner
    // named after that marker was then read as a second candidate for this claim — the set was
    // refused for a sentence that names exactly one.
    const answer =
      'Clarithromycin was reviewed [12] against Prednisone Co 5mg. It also interacts with Solu-Medrol 125mg/5ml [350].';
    const own = new Set([350, 351, 352, 353, 354]);
    const claim = claimTextByCitation(answer, 'trailing', own).get(350);
    expect(claim).toBe(' It also interacts with Solu-Medrol 125mg/5ml ');
    expect(claim).not.toContain('Prednisone');
  });

  it('takes the LAST sentence break before the marker, not the first', () => {
    // With several sentences between the bound and the marker, only the one the marker sits in
    // is this claim. Taking the first break would leave two whole sentences in the window.
    const answer = 'One thing [12]. Prednisone Co 5mg was reviewed. It interacts with Solu-Medrol 125mg/5ml [350].';
    const claim = claimTextByCitation(answer, 'trailing', new Set([350])).get(350);
    expect(claim).toBe(' It interacts with Solu-Medrol 125mg/5ml ');
  });

  it('still keeps a claim whole across a decimal point when widening past a foreign marker', () => {
    // The sentence bound and the decimal-point exclusion have to agree: reading `0.125mg` as a
    // break here would start the window inside the dose and cut the subject out again.
    const answer = 'Solu-Medrol [12] at 0.125mg is the order that interacts [350].';
    const claim = claimTextByCitation(answer, 'trailing', new Set([350])).get(350);
    expect(claim).toContain('Solu-Medrol');
  });

  it('gives adjacent markers the claim that precedes the whole run', () => {
    // [177] and [350] cite ONE sentence between them; keyed per marker, [350] would otherwise
    // see a claim text of just a space.
    const claims = claimTextByCitation(ANSWER);
    expect(claims.get(177)).toContain('interacts with active order Methylprednisolone');
    expect(claims.get(350)).toBe(claims.get(177));
    expect(claims.get(351)).toContain('interacts with active order Budesonide');
    expect(claims.get(351)).not.toContain('Methylprednisolone');
  });

  it('does not merge two markers across a line break', () => {
    // The run-merge tolerates a comma or semicolon between adjacent markers, and `\s` would have
    // let a NEWLINE do the same — the second marker would then take the FIRST marker's line,
    // falsifying the confinement rather than supporting it.
    const claims = claimTextByCitation('Clarithromycin interacts with active order Prednisone [350]\n[360] and more');
    expect(claims.get(350)).toContain('Prednisone');
    expect(claims.get(360)).not.toContain('Prednisone');
  });

  it('splits a comma-separated group across its indices', () => {
    const claims = claimTextByCitation('Aspirin and warfarin interact [7, 8].');
    expect(claims.get(7)).toBe('Aspirin and warfarin interact ');
    expect(claims.get(8)).toBe(claims.get(7));
  });

  it('keeps the first claim of an index cited more than once', () => {
    // Measured live: the model repeats a finding's marker inside its own statement, so blanking
    // such an index discarded the only evidence there was for it. The first occurrence is the
    // one the renderer badges, so it is the one whose text must justify the badge.
    const claims = claimTextByCitation('First claim [5]. Second, unrelated claim [5].');
    expect(claims.get(5)).toBe('First claim ');
  });
});

describe('resolveFindingSeverities', () => {
  it('resolves each unstated rating from the claim its marker is attached to', () => {
    // The measured failure this exists for: five interaction findings in one clause, two of
    // them Major, and the answer states no rating for any of them.
    const resolved = resolveFindingSeverities(ANSWER, REFERENCES, SAFETY_WARNINGS, UNSTATED);
    expect(Object.fromEntries(resolved)).toEqual({
      350: 'Major',
      351: 'Major',
      352: 'Moderate',
      353: 'Moderate',
      354: 'Moderate',
    });
  });

  it('pairs each rating with its own finding, not merely the right multiset of ratings', () => {
    // The fixture above cannot catch a permutation among same-rated neighbours: swapping 350
    // and 351 (both Major) leaves its assertion green. Distinct ratings make any mis-mapping
    // visible, which is what stops "the ratings are all present" from passing for "each
    // rating is beside the finding it belongs to".
    const distinct: AiSafetyWarning[] = [
      interaction('Methylprednisolone', 'Major'),
      interaction('Budesonide', 'Minor'),
      interaction('Prednisone', 'Moderate'),
      interaction('Dexamethasone', 'Unknown'),
      interaction('Hydrocortisone', 'Contraindicated'),
    ];
    const resolved = resolveFindingSeverities(ANSWER, REFERENCES, distinct, UNSTATED);
    expect(Object.fromEntries(resolved)).toEqual({
      350: 'Major',
      351: 'Minor',
      352: 'Moderate',
      353: 'Unknown',
      354: 'Contraindicated',
    });
  });

  it('refuses a candidate whose detail is empty rather than letting it match everything', () => {
    // leadClause('') is '', and every string contains '' — so a rating-carrying warning with no
    // detail would otherwise match vacuously and win any tie it was part of. An operator's own
    // dataset can rate a rule while leaving its note empty, so this is a reachable shape.
    const warnings: AiSafetyWarning[] = [
      { type: 'interaction', drug: 'Clarithromycin', detail: '', severity: 'Major' },
      interaction('Budesonide', 'Moderate'),
    ];
    const resolved = resolveFindingSeverities('Some claim with no marker text [351].', REFERENCES, warnings, [351]);
    expect(resolved.size).toBe(0);
  });

  it('ignores a bridge that names the finding’s own drug, which cannot discriminate', () => {
    // Candidates are selected on the finding's (type, drug), so every candidate is about that
    // drug and every claim naming the finding names it too. Measured before this guard: one
    // chip bridging its own subject drug took four of five ratings and reported them all as its
    // own Major — a wrong rating shown confidently, in the dangerous direction.
    const warnings: AiSafetyWarning[] = [
      {
        ...interaction('Cortisone', 'Minor'),
        chartOrderBridges: [{ substance: 'Clarithromycin', orderDisplay: 'Biaxin 500mg' }],
      },
      interaction('Hydrocortisone', 'Major'),
    ];
    const refs: AiReference[] = [safetyFindingRef(351)];
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Hydrocortisone [351].',
      refs,
      warnings,
      [351],
    );
    expect(resolved.get(351)).toBe('Major');
  });

  it('does not match a bridge inside a longer drug name', () => {
    // "Cortisone" occurs inside "Hydrocortisone". A bare substring test resolved the sentence
    // about the second to the chip bridged to the first, while the anchored prose tier got the
    // same case right — so the bridge tier must be anchored too.
    const warnings: AiSafetyWarning[] = [
      {
        ...interaction('Cortisone', 'Minor'),
        chartOrderBridges: [{ substance: 'Cortisone', orderDisplay: 'Cortone 25mg' }],
      },
      interaction('Hydrocortisone', 'Major'),
    ];
    const refs: AiReference[] = [safetyFindingRef(351)];
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Hydrocortisone [351].',
      refs,
      warnings,
      [351],
    );
    expect(resolved.get(351)).toBe('Major');
  });

  it('does not match a bridge against half of a hyphenated brand', () => {
    // The hyphen half of the boundary class: dropping `-` from it left the whole suite green,
    // and this repo's own fixture vocabulary contains the hazard — a chip bridged to `Medrol`
    // must not take the rating of a claim naming `Solu-Medrol 125mg/5ml`.
    const warnings: AiSafetyWarning[] = [
      { ...interaction('Medrol', 'Minor'), chartOrderBridges: [{ substance: 'Medrol', orderDisplay: 'Medrol 4mg' }] },
      interaction('Methylprednisolone', 'Major', 'Solu-Medrol 125mg/5ml'),
    ];
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Solu-Medrol 125mg/5ml [351].',
      [safetyFindingRef(351)],
      warnings,
      [351],
    );
    expect(resolved.get(351)).toBe('Major');
  });

  it('does not match a bridge against half of a combination product', () => {
    const warnings: AiSafetyWarning[] = [
      {
        ...interaction('Aspirin', 'Minor'),
        chartOrderBridges: [{ substance: 'Aspirin', orderDisplay: 'Aspirin 75mg' }],
      },
      interaction('Aspirin/Dipyridamole', 'Major'),
    ];
    const refs: AiReference[] = [safetyFindingRef(351)];
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Aspirin/Dipyridamole [351].',
      refs,
      warnings,
      [351],
    );
    expect(resolved.get(351)).toBe('Major');
  });

  it('refuses where the bridge and the prose each name a different candidate', () => {
    // Two tiers disagreeing is the strongest available evidence that the sentence identifies no
    // one candidate, so tier order must not be allowed to pick a winner.
    const warnings: AiSafetyWarning[] = [
      {
        ...interaction('Budesonide', 'Minor'),
        chartOrderBridges: [{ substance: 'Budesonide', orderDisplay: 'Pulmicort 90mcg' }],
      },
      interaction('Prednisone', 'Major'),
    ];
    const refs: AiReference[] = [safetyFindingRef(351)];
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Prednisone, taken with Pulmicort 90mcg [351].',
      refs,
      warnings,
      [351],
    );
    expect(resolved.size).toBe(0);
  });

  it('refuses a lead the note truncated down to the shared drug name', () => {
    // Truncation is not automatically fail-safe: a note breaking early can shorten the lead to
    // the subject drug, which every claim about the finding names — a false SINGLE match
    // wherever the siblings' longer leads fail.
    const warnings: AiSafetyWarning[] = [
      {
        type: 'interaction',
        drug: 'Clarithromycin',
        detail: 'Clarithromycin — Major. Avoid with strong CYP3A4 substrates.',
        severity: 'Major',
        chartOrderBridges: [],
      },
      interaction('Hydrocortisone', 'Moderate'),
    ];
    const refs: AiReference[] = [safetyFindingRef(354)];
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Cortef 100mg [354].',
      refs,
      warnings,
      [354],
    );
    expect(resolved.size).toBe(0);
  });

  it('resolves a bare list that quotes none of the module’s phrasing', () => {
    // Live: "list every interaction, one short line each, name the order only". Only two of the
    // five findings carry a chart-order bridge, so before the partner tier this resolved two of
    // five and the list rendered half-badged.
    const resolved = resolveFindingSeverities(ANSWER_BARE_LIST, REFERENCES, SAFETY_WARNINGS, UNSTATED);
    expect(Object.fromEntries(resolved)).toEqual({
      350: 'Major',
      351: 'Major',
      352: 'Moderate',
      353: 'Moderate',
      354: 'Moderate',
    });
  });

  it('withdraws a candidate set it could only partly resolve', () => {
    // The backend requires a shared-(type, drug) set to be rendered together or not at all: a
    // bare item beside a badged one reads as "no rating exists", not "we declined", so a
    // clinician infers a ranking the module never stated.
    const answer = 'Clarithromycin interacts with active order Methylprednisolone [350], and there are others [352].';
    const resolved = resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350, 352]);
    expect(resolved.size).toBe(0);
  });

  it('treats a comma between adjacent markers as one attachment point', () => {
    // Live: "…possible cross-reactivity [356], [357]." The second marker used to get a claim
    // text of ", " and could never resolve.
    const claims = claimTextByCitation('Clarithromycin interacts with active order Prednisone [350], [352].');
    expect(claims.get(352)).toBe(claims.get(350));
    expect(claims.get(352)).toContain('Prednisone');
  });

  it('refuses a candidate an ambiguous group positively excluded', () => {
    // An ambiguous group must narrow the field rather than be discarded — the refusal is
    // symmetric in the groups, since their order decides nothing.
    const warnings: AiSafetyWarning[] = [
      {
        ...interaction('Budesonide', 'Major'),
        chartOrderBridges: [{ substance: 'Budesonide', orderDisplay: 'Inhaler' }],
      },
      {
        ...interaction('Prednisone', 'Minor'),
        chartOrderBridges: [{ substance: 'Prednisone', orderDisplay: 'Inhaler' }],
      },
      interaction('Hydrocortisone', 'Unknown'),
    ];
    const refs: AiReference[] = [safetyFindingRef(351)];
    // "Inhaler" matches both bridged candidates (ambiguous); the prose tier singles out the
    // third, which the bridge tier's matches do not include.
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Hydrocortisone via the Inhaler [351].',
      refs,
      warnings,
      [351],
    );
    expect(resolved.size).toBe(0);
  });

  it('withdraws only the candidate set it could not fully resolve', () => {
    // Per-SET isolation, not per-answer: mutating the sweep to clear everything left the whole
    // suite green, because no fixture had ever put two candidate sets in one response.
    const refs: AiReference[] = [
      ...[350, 352].map((index) => safetyFindingRef(index, 'interaction', 'Clarithromycin')),
      ...[360, 361].map((index) => safetyFindingRef(index, 'interaction', 'Ibuprofen')),
    ];
    const warnings: AiSafetyWarning[] = [
      interaction('Methylprednisolone', 'Major'),
      interaction('Prednisone', 'Moderate'),
      interaction('Warfarin', 'Major', undefined, 'Ibuprofen'),
      interaction('Aspirin', 'Minor', undefined, 'Ibuprofen'),
    ];
    // The Clarithromycin set is fully identified; the Ibuprofen set has one member the answer
    // does not single out, so that set alone is withdrawn.
    const answer =
      'Clarithromycin interacts with active order Methylprednisolone [350], ' +
      'Clarithromycin interacts with active order Prednisone [352], ' +
      'Ibuprofen interacts with active order Warfarin [360], and there are others [361].';
    const resolved = resolveFindingSeverities(answer, refs, warnings, [350, 352, 360, 361]);
    expect(Object.fromEntries(resolved)).toEqual({ 350: 'Major', 352: 'Moderate' });
  });

  it('is unaffected by an index the measurement lists twice', () => {
    // The list is deduped upstream, but the backend's own javadoc calls that "belt and braces
    // rather than load-bearing" — so this must not depend on it. An earlier sweep counted
    // occurrences against distinct indices and withdrew the whole set on a repeat.
    const once = resolveFindingSeverities(ANSWER_BY_SUBSTANCE, REFERENCES, SAFETY_WARNINGS, UNSTATED);
    const twice = resolveFindingSeverities(ANSWER_BY_SUBSTANCE, REFERENCES, SAFETY_WARNINGS, [...UNSTATED, 350]);
    expect(Object.fromEntries(twice)).toEqual(Object.fromEntries(once));
    expect(twice.get(350)).toBe('Major');
  });

  it('finds a lead that occurs first inside a longer word and again as a whole term', () => {
    // The whole-term scan must RETRY past a substring hit: replacing it with a single indexOf
    // plus one boundary check left the suite green. Both Cortisone and Hydrocortisone are live
    // orders on this chart, so a claim naming both is reachable — and it must refuse, which is
    // only possible if the second occurrence is found.
    const warnings: AiSafetyWarning[] = [
      {
        ...interaction('Cortisone', 'Minor'),
        chartOrderBridges: [{ substance: 'Cortisone', orderDisplay: 'Cortone 25mg' }],
      },
      interaction('Hydrocortisone', 'Major'),
    ];
    const refs: AiReference[] = [safetyFindingRef(351)];
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Hydrocortisone and with Cortisone [351].',
      refs,
      warnings,
      [351],
    );
    expect(resolved.size).toBe(0);
  });

  it('survives a malformed warning rather than taking the panel down', () => {
    // These run inside a render memo with no error boundary above them, so a throw here costs
    // the answer, its citations and its safety chips. `severity` was guarded and its siblings
    // were not — one guarded member of a family is not a guarded family.
    const refs: AiReference[] = [safetyFindingRef(351)];
    const malformed = [
      { ...interaction('Budesonide', 'Major'), detail: null as unknown as string },
      { ...interaction('Prednisone', 'Major'), chartOrderBridges: 'nope' as unknown as [] },
      { ...interaction('Dexamethasone', 'Major'), severity: 7 as unknown as string },
    ];
    for (const bad of malformed) {
      expect(() =>
        resolveFindingSeverities(
          'Clarithromycin interacts with active order Hydrocortisone [351].',
          refs,
          [bad, interaction('Hydrocortisone', 'Moderate')],
          [351],
        ),
      ).not.toThrow();
    }
  });

  it('keeps a set’s ratings when one of its indices is never cited in the prose', () => {
    // Measured live: the model wrote "[37]" where reference 367 was published. An index whose
    // marker is absent has no claim to be identified from and renders nothing either way, so
    // counting it as a failed set member threw away every correct rating beside it.
    const withUncited = [...UNSTATED, 999];
    const refs: AiReference[] = [...REFERENCES, safetyFindingRef(999)];
    const resolved = resolveFindingSeverities(ANSWER_BY_SUBSTANCE, refs, SAFETY_WARNINGS, withUncited);
    // `has`, explicitly: vitest's `toEqual` IGNORES keys whose value is `undefined`, so the
    // assertion below could not see an uncited index arriving as `999: undefined` — which is
    // exactly what the `severity !== undefined` guard at the render gate exists to prevent.
    expect(resolved.has(999)).toBe(false);
    expect(Object.fromEntries(resolved)).toStrictEqual({
      350: 'Major',
      351: 'Major',
      352: 'Moderate',
      353: 'Moderate',
      354: 'Moderate',
    });
  });

  it('refuses a run that would elect one finding for several citations of its set', () => {
    // Live, and cache-sticky once emitted: the model put every marker on one line —
    // "Solu-Medrol 125mg/5ml [350] [177] [179] [352] [353] [354]" — so the run-merge handed all
    // of them that one claim, four indices elected the Methylprednisolone finding, and three
    // Moderate ratings rendered as Major. Two citations of one set cannot both be one finding.
    const answer = 'Solu-Medrol 125mg/5ml [350] [177] [179] [352] [353] [354]';
    const resolved = resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, UNSTATED);
    expect(resolved.size).toBe(0);
  });

  it('ignores a lead every candidate in the set carries', () => {
    // Live: asked for chart names only, the answer led with the subject order, and every finding
    // bridged that same order — so all seven matched it, the one decisive lead was swamped, and
    // six correct ratings were discarded. A lead the whole set shares is not evidence about any
    // one member, which is what `discriminatingLeads` says but cannot see: it compares a lead
    // against the finding's drug NAME, and this shared lead was that drug's order display.
    const shared = [{ substance: 'Ibuprofen', orderDisplay: 'Advil 400mg' }];
    const warnings: AiSafetyWarning[] = [
      {
        ...interaction('Methylprednisolone', 'Moderate', undefined, 'Ibuprofen'),
        chartOrderBridges: [...shared, { substance: 'Methylprednisolone', orderDisplay: 'Solu-Medrol 125mg/5ml' }],
      },
      { ...interaction('Prednisone', 'Minor', undefined, 'Ibuprofen'), chartOrderBridges: [...shared] },
    ];
    const refs: AiReference[] = [safetyFindingRef(358, 'interaction', 'Ibuprofen')];
    const resolved = resolveFindingSeverities(
      'Advil 400mg interacts with the following medications: 1. Solu-Medrol 125mg/5ml [358]',
      refs,
      warnings,
      [358],
    );
    expect(resolved.get(358)).toBe('Moderate');
  });

  it('refuses a set whose only rated finding is cited more than once', () => {
    // One rated warning, two citations: attributing it to both is wrong and there is no way to
    // tell which it belongs to, so the single-candidate shortcut must not badge both.
    const refs: AiReference[] = [safetyFindingRef(350), safetyFindingRef(351)];
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Methylprednisolone [350] [351].',
      refs,
      [SAFETY_WARNINGS[0], interaction('Methylprednisolone', 'Major', 'Solu-Medrol 125mg/5ml')],
      [350, 351],
    );
    expect(resolved.size).toBe(0);
  });

  it('counts an uncited index toward injectivity even though it renders nothing', () => {
    // An uncited index still CONSUMES a candidate. Excluding it from the check entirely let one
    // rated finding be elected by two citations while only the cited one showed a badge — which
    // is a guess, since either citation could be that finding.
    const refs: AiReference[] = [safetyFindingRef(350), safetyFindingRef(351)];
    const warnings = [SAFETY_WARNINGS[0], interaction('Methylprednisolone', 'Major', 'Solu-Medrol 125mg/5ml')];
    // 350 is cited, 351 is not — the shape the live `[37]`-for-`367` mistype produces.
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Methylprednisolone [350].',
      refs,
      warnings,
      [350, 351],
    );
    expect(resolved.size).toBe(0);
  });

  it('refuses a table that puts the citation before its subject', () => {
    // Live and uncached: asked to tabulate, the model emitted a markdown table with the citation
    // in the FIRST column. Unconfined, each marker took the PREVIOUS row's text and the whole
    // map rotated by one — Methylprednisolone (Major) rendered Moderate, Prednisone (Moderate)
    // rendered Major. The complete-and-injective sweep cannot catch a rotation: it is a
    // bijection, so it is both complete and injective.
    const answer =
      'Her Hydrocortisone Injection vial 100mg order is listed last below.\n' +
      '| Citation | Interacting Substance | Chart Order Name |\n' +
      '| [350] | Methylprednisolone | Solu-Medrol 125mg/5ml |\n' +
      '| [351] | Budesonide | Pulmicort 90mcg |\n' +
      '| [352] | Prednisone | Prednisone Co 5mg |\n' +
      '| [353] | Dexamethasone | Dexamethasone Injection vial 8mg |\n' +
      '| [354] | Hydrocortisone | Hydrocortisone Injection vial 100mg |';
    const resolved = resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, UNSTATED);
    expect(resolved.size).toBe(0);
  });

  it('resolves an order the answer abbreviates after the module’s own phrase', () => {
    // Live: "Clarithromycin interacts with active order Solu-Medrol [350]" — the bridge carries
    // the full display "Solu-Medrol 125mg/5ml", the partner is named nowhere, and the lead
    // clause names the substance. Both MAJOR findings refused while a Moderate one beside them
    // resolved, so the reader saw a rating on the finding the answer called least concerning
    // and none on the two graver ones.
    const answer =
      'Clarithromycin interacts with active order Solu-Medrol [350].\n' +
      'Clarithromycin interacts with active order Pulmicort [351].\n' +
      'Clarithromycin interacts with active order Prednisone [352].\n' +
      'Clarithromycin interacts with active order Dexamethasone [353].\n' +
      'Clarithromycin interacts with active order Hydrocortisone [354].';
    const resolved = resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, UNSTATED);
    expect(Object.fromEntries(resolved)).toEqual({
      350: 'Major',
      351: 'Major',
      352: 'Moderate',
      353: 'Moderate',
      354: 'Moderate',
    });
  });

  it('survives references arriving in the wrong shape', () => {
    // The last member of the guarded family. Not reachable from this backend, but the panel has
    // no error boundary above it and the cost of the inconsistency is the whole answer blanking.
    expect(() =>
      resolveFindingSeverities(ANSWER_BY_SUBSTANCE, undefined as unknown as AiReference[], SAFETY_WARNINGS, UNSTATED),
    ).not.toThrow();
  });

  it('refuses a single line whose markers LEAD their subjects', () => {
    // Live, cached, and rendered wrong before this: asked for one line beginning "Apart from
    // Prednisone, the interacting orders are", the model put each marker BEFORE its drug. The
    // preamble names a real partner, so the first marker elected it, the whole list shifted by
    // one, and it landed as a clean bijection — complete and injective, because a rotation is
    // both. The Major Methylprednisolone interaction rendered Moderate.
    //
    // Line confinement cannot see this: it is all one line. What does is that the LEADING
    // reading identifies the set just as completely, and elects different findings.
    const answer =
      'Apart from Prednisone, the interacting orders are [350] Methylprednisolone, ' +
      '[351] Budesonide, [353] Dexamethasone, [354] Hydrocortisone';
    const resolved = resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350, 351, 353, 354]);
    expect(resolved.size).toBe(0);
  });

  it('still resolves a line whose markers TRAIL their subjects', () => {
    // The mirror case, and the reason the fix is keyed on disagreement rather than on the
    // forward reading merely working: here the forward reading leaves the last marker with
    // nothing after it, so it never identifies the set and the trailing reading stands.
    const resolved = resolveFindingSeverities(ANSWER_BY_SUBSTANCE, REFERENCES, SAFETY_WARNINGS, UNSTATED);
    expect(Object.fromEntries(resolved)).toEqual({
      350: 'Major',
      351: 'Major',
      352: 'Moderate',
      353: 'Moderate',
      354: 'Moderate',
    });
  });

  it('does not truncate an order name at a digit that is part of the name', () => {
    // `Vitamin B12 1000mcg` must shorten to `Vitamin B12`, not `Vitamin`. Truncating at the
    // first token CONTAINING a digit produced a generic prefix that matched a sentence about a
    // different order entirely — and every later guard missed it, because the prefix is not the
    // finding's own drug, is not shared by all candidates, and matched only one group.
    const warnings: AiSafetyWarning[] = [
      {
        ...interaction('Cyanocobalamin', 'Major'),
        chartOrderBridges: [{ substance: 'Cyanocobalamin', orderDisplay: 'Vitamin B12 1000mcg' }],
      },
      {
        ...interaction('Warfarin', 'Moderate'),
        chartOrderBridges: [{ substance: 'Warfarin', orderDisplay: 'Coumadin 5mg' }],
      },
    ];
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Vitamin D 50000iu [351].',
      [safetyFindingRef(351)],
      warnings,
      [351],
    );
    expect(resolved.size).toBe(0);
  });

  it('still shortens an order name at its dose', () => {
    // The positive control for the rule above: the abbreviation case must keep working.
    const warnings: AiSafetyWarning[] = [
      {
        ...interaction('Cyanocobalamin', 'Major'),
        chartOrderBridges: [{ substance: 'Cyanocobalamin', orderDisplay: 'Vitamin B12 1000mcg' }],
      },
      {
        ...interaction('Warfarin', 'Moderate'),
        chartOrderBridges: [{ substance: 'Warfarin', orderDisplay: 'Coumadin 5mg' }],
      },
    ];
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Vitamin B12 [351].',
      [safetyFindingRef(351)],
      warnings,
      [351],
    );
    expect(resolved.get(351)).toBe('Major');
  });

  it('terminates on an empty lead rather than scanning forever', () => {
    // `indexOf('')` returns the search position for every position, so the whole-term scan would
    // never advance. The upstream filter removes empty leads, but the failure mode here is a
    // frozen render thread, so `namesLead` refuses one outright too. A hang, not a wrong answer,
    // is what an unguarded version costs — which is why this asserts completion at all.
    expect(namesLead('a claim naming nothing', '')).toBe(false);
  });

  it('refuses a claim naming a bridged candidate and an unbridged one', () => {
    // Live: "…should not be started with Hydrocortisone, which belongs to the same steroid class
    // as Methylprednisolone: … [376]". The Hydrocortisone finding is Moderate; it rendered
    // Major. A bridge's substance sits in the bridges group as well as in partner, so the
    // bridged candidate was visible to two groups and the unbridged one to a single group — the
    // bridges group was a decisive singleton and the group that could see BOTH was ambiguous,
    // which the old check waved through because it included the winner.
    const answer =
      'Clarithromycin should not be started with Hydrocortisone, which belongs to the same ' +
      'steroid class as Methylprednisolone [354].';
    const resolved = resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [354]);
    expect(resolved.size).toBe(0);
  });

  it('refuses a prose list whose closing sentence names one of its own candidates', () => {
    // Live, and withheld before this: in a list where each sentence opens with the module's own
    // phrase and closes with its marker, the LEADING claim of marker N is sentence N+1 — a
    // complete claim about the next candidate. The forward reading was then a clean shift-by-one
    // bijection that disagreed with the correct trailing one, so the whole set was contested and
    // four correct ratings were discarded. Whether an answer came out fully badged or fully
    // blank turned on whether the model wrote one more sentence after its last citation.
    const answer =
      'Clarithromycin interacts with active order Methylprednisolone [350]. ' +
      'Clarithromycin interacts with active order Budesonide [351]. ' +
      'Clarithromycin interacts with active order Prednisone [352]. ' +
      'Clarithromycin interacts with active order Dexamethasone [353]. ' +
      'Clarithromycin interacts with active order Hydrocortisone [354]. ' +
      // The trailing sentence NAMES a candidate. That used to be tolerated — first because the
      // forward-reading contest was the only rule looking, then because a function-word list
      // read it as prose — and both readings of it were defeated by a dangling subject written
      // the same way. The tail rule now objects regardless of the sentence's shape.
      'Methylprednisolone is also known to interact with several of her other active orders.';
    // Five correct ratings are discarded here, and that is the cost recorded beside the rule:
    // this exact shape is absent from all 46 captured live answers (the corpus is byte-identical
    // with the rule as written), while the shape it protects against renders a swapped
    // Major/Moderate pair. Delete the closing sentence and all five resolve.
    expect([...resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, UNSTATED)]).toEqual([]);
    const withoutTail = answer.slice(0, answer.indexOf('Methylprednisolone is also'));
    expect(resolveFindingSeverities(withoutTail, REFERENCES, SAFETY_WARNINGS, UNSTATED).size).toBe(5);
  });

  it('refuses a multi-line answer with one marker written before its drug', () => {
    // The rotation guard was structurally OFF here. Trailing claims are line-confined, so in any
    // multi-line answer a trailing marker sits at end-of-line and its LEADING claim is empty —
    // a line-confined forward window is empty, which is why the contest reads the unconfined one.
    // A single marker-before-drug line among trailing ones was then read backwards, uncontested,
    // and the set still passed completeness and injectivity.
    //
    // Live: the Major Methylprednisolone finding badged Moderate, scavenging Hydrocortisone's
    // rating from the lead-in clause, beside a correctly-badged Major.
    const answer =
      'Hydrocortisone aside, the order that matters most is [350] Solu-Medrol 125mg/5ml, where\n' +
      'CYP450 3A4 inhibition raises exposure sharply.\n' +
      'Pulmicort 90mcg is affected by the same mechanism [351].\n' +
      'Prednisone is affected by the same mechanism [352].';
    const resolved = resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350, 351, 352]);
    expect(resolved.size).toBe(0);
  });

  it('refuses the same shape written the other way round', () => {
    // Same mechanism, opposite direction — the fuzzer hit this class in both.
    const answer =
      'Unlike methylprednisolone, [354] hydrocortisone carries a lesser risk.\n' +
      'Pulmicort 90mcg is affected by the same mechanism [351].';
    const resolved = resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [354, 351]);
    expect(resolved.size).toBe(0);
  });

  it('still resolves a multi-line answer whose markers all trail their drugs', () => {
    // The control: the new rule must not fire where the forward reading names nothing outside
    // what the trailing reading already claims. This is the ordinary shape.
    const answer =
      'Clarithromycin interacts with active order Methylprednisolone [350].\n' +
      'Clarithromycin interacts with active order Budesonide [351].\n' +
      'Clarithromycin interacts with active order Prednisone [352].\n' +
      'Clarithromycin interacts with active order Dexamethasone [353].\n' +
      'Clarithromycin interacts with active order Hydrocortisone [354].';
    const resolved = resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, UNSTATED);
    expect(Object.fromEntries(resolved)).toEqual({
      350: 'Major',
      351: 'Major',
      352: 'Moderate',
      353: 'Moderate',
      354: 'Moderate',
    });
  });

  it('refuses where shift-consistency is the ONLY rule that can object', () => {
    // This shape exists because nothing else in the repo reached it. Disabling the
    // shift-consistency rule below left the whole suite green and a 200,000-seed sweep green,
    // while the rule was still load-bearing: it is the only objection on this answer, and
    // without it a MAJOR interaction renders Moderate beside its own citation.
    //
    // What makes it sole-decisive is a foreign marker AFTER the subject on a marker-first line.
    // `[18]` shortens the unconfined BACKWARD window, so the block rule falls silent; and the
    // terminator after `[352]` zeroes the forward claim there, so the forward reading loses
    // named-completeness and the disagreement rule is barred. Trailing is left alone with
    // `Hydrocortisone` scavenged out of the lead-in clause.
    const answer =
      '[17] Hydrocortisone aside, the worry is [350] Solu-Medrol 125mg/5ml [18]\nPrednisone is affected by the same mechanism [352].';
    // Truth is {350: Major, 352: Moderate}; with the rule disabled this renders
    // {350: Moderate, 352: Moderate}.
    expect([...resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350, 352])]).toEqual([]);
  });

  it('refuses an ambiguous line where shift-consistency is the ONLY objection', () => {
    // The rule this test exists for was discriminated by NOTHING until this shape was added:
    // disabling it left the whole suite green and the live corpus unchanged at 98 ratings, and
    // the three tests NAMED for it had stopped exercising it — `stripExclusions` now removes
    // their "Hydrocortisone aside," lead-ins, so those answers refuse at the soundness gate
    // instead. A rule whose only coverage is redundant is one refactor from deletion.
    //
    // Here the layout really is ambiguous: `[350]` sits between "Solu-Medrol 125mg/5ml" and
    // "Hydrocortisone", the latter followed by a chart citation of its own, so nothing in the
    // prose settles which of the two the marker was offered for. Refusing is correct — and it is
    // rule 2 that does it. Rules 1 and 4 are both silent: the foreign `[17]` becomes [352]'s
    // block bound, and the full stop zeroes [352]'s forward claim.
    const answer = 'Solu-Medrol 125mg/5ml [350] Hydrocortisone [17]. Prednisone Co 5mg [352].';
    expect([...resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350, 352])]).toEqual([]);
  });

  it('refuses a swap the shift-consistency rule cannot see', () => {
    // The two contest rules are not redundant. Shift-consistency asks whether the forward
    // reading names a finding the trailing reading claims for nobody — so a true 2-cycle SWAP,
    // where both readings elect the same two findings in opposite order, is invisible to it. The
    // disagreement rule is what catches that, and this is the shape that keeps it honest.
    const answer = 'Methylprednisolone [350] Budesonide [351] Methylprednisolone.';
    const resolved = resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350, 351]);
    expect(resolved.size).toBe(0);
  });

  it('is not truncated by a citation outside this measurement', () => {
    // Live in 4 of a 62-answer capture (a larger population than THE CORPUS's 46, and taken
    // earlier): a chart-order citation lands between a finding's subject
    // and the finding's own marker, cutting the subject out of the window and leaving only a
    // contrast partner, which is then elected. The block reading cannot help — on one line its
    // window is the same one. Without the foreign marker the same sentence correctly refuses,
    // so the marker converts a refusal into a wrong rating.
    const withForeign = 'Solu-Medrol 125mg/5ml [17] carries more risk than Prednisone does [350].';
    const withoutForeign = 'Solu-Medrol 125mg/5ml carries more risk than Prednisone does [350].';
    expect(resolveFindingSeverities(withForeign, REFERENCES, SAFETY_WARNINGS, [350]).size).toBe(0);
    expect(resolveFindingSeverities(withoutForeign, REFERENCES, SAFETY_WARNINGS, [350]).size).toBe(0);
  });

  it('still lets a foreign citation bound the window across a sentence break', () => {
    // The distinction that keeps the widening from over-reaching, and it is drawn from a live
    // answer: "… [16]. Additionally, it interacts with Prednisone Co 5mg [352]" is a NEW
    // sentence, so the foreign marker still bounds; the defect above is a fragment.
    const answer =
      'Clarithromycin interacts with active order Methylprednisolone [16]. ' +
      'Additionally, it interacts with active order Prednisone [352].';
    expect([...resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [352])]).toEqual([]);
  });

  it('does not read a decimal point in a dose as a sentence break', () => {
    // `Digoxin Elixir 0.125mg` reading as a sentence end restores the very truncation the
    // widening prevents — measured, 183 mis-attributions survived until this was excluded.
    // The dose must sit BETWEEN the foreign marker and the finding marker — that is the span the
    // sentence test reads. An earlier version of this test put it before the foreign marker,
    // where nothing looks at it, and so discriminated nothing.
    const answer = 'Solu-Medrol [17] at 0.125mg carries more risk than Prednisone does [350].';
    expect(resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [350]).size).toBe(0);
  });

  it('contests a forward window that NAMES two candidates without electing one', () => {
    // electCandidate returns null both for "named nobody" and "named two", so keying the forward
    // contest on an ELECTION silenced it in the second case. One extra clause naming a second
    // candidate flipped a correct refusal into a wrong rating.
    const answer =
      'Hydrocortisone aside, the order that matters most is [353]\n' +
      'Dexamethasone is the one to watch. Unlike Methylprednisolone, the others carry less risk.';
    expect(resolveFindingSeverities(answer, REFERENCES, SAFETY_WARNINGS, [353]).size).toBe(0);
  });

  it('survives a warning whose type or drug is not a string', () => {
    // Optional chaining guards null, not TYPE, and these sit one line below the guard that
    // exists for exactly this.
    const malformed = [
      { ...interaction('Budesonide', 'Major'), type: 123 as unknown as string },
      { ...interaction('Prednisone', 'Major'), drug: {} as unknown as string },
    ];
    for (const bad of malformed) {
      expect(() =>
        resolveFindingSeverities('A claim [351].', REFERENCES, [bad, interaction('Hydrocortisone', 'Minor')], [351]),
      ).not.toThrow();
    }
  });

  it('survives a reference whose uuid is not a string', () => {
    const refs: AiReference[] = [{ ...safetyFindingRef(350), resourceUuid: null as unknown as string }];
    expect(() => resolveFindingSeverities('A claim [350].', refs, SAFETY_WARNINGS, [350])).not.toThrow();
  });

  it('survives an answer that is not a string, and a non-string rating word', () => {
    expect(resolveFindingSeverities(undefined as unknown as string, REFERENCES, SAFETY_WARNINGS, UNSTATED).size).toBe(
      0,
    );
    expect(severityTone(null as unknown as string)).toBe('unrated');
  });

  it('refuses where the badged sentence names two candidates', () => {
    // The one-candidate requirement is what keeps a resolved rating honest: where the sentence
    // the badge will be drawn against reproduces two candidates' own statements, nothing is
    // singled out and no rating renders.
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Prednisone and Clarithromycin interacts with active order Dexamethasone [350].',
      REFERENCES,
      SAFETY_WARNINGS,
      [350],
    );
    expect(resolved.size).toBe(0);
  });

  it('resolves an answer that names the chart’s order display instead of the substance', () => {
    // The vocabulary the answer uses is not the vocabulary the chip uses: `detail` says
    // "Methylprednisolone", the answer says "Solu-Medrol 125mg/5ml". Both spellings are observed
    // live in the same position, and `chartOrderBridges` is what reconciles them — so this is
    // the case the typed field exists for, and the case detail-parsing alone cannot serve.
    const resolved = resolveFindingSeverities(ANSWER_BY_ORDER_DISPLAY, REFERENCES, SAFETY_WARNINGS, UNSTATED);
    expect(Object.fromEntries(resolved)).toEqual({
      350: 'Major',
      351: 'Major',
      352: 'Moderate',
      353: 'Moderate',
      354: 'Moderate',
    });
  });

  it('resolves from the bridge where the prose names no candidate', () => {
    // Named for what it actually exercises: here the prose groups match nothing and the bridge
    // matches one, so the bridge is the only evidence there is. It is NOT a precedence test —
    // `electCandidate` is order-free, and the disagreement case is covered separately below.
    const warnings: AiSafetyWarning[] = [
      interaction('Methylprednisolone', 'Major', 'Solu-Medrol 125mg/5ml'),
      interaction('Budesonide', 'Minor', 'Pulmicort 90mcg'),
    ];
    const resolved = resolveFindingSeverities(
      'Clarithromycin interacts with active order Pulmicort 90mcg [351].',
      REFERENCES,
      warnings,
      [351],
    );
    expect(resolved.get(351)).toBe('Minor');
  });

  it('renders no rating for a finding the answer already rates', () => {
    // The backend check asks of the WHOLE answer, so an answer stating its ratings anywhere is
    // absent from the list — and must not have them repeated beside the sentence.
    expect(resolveFindingSeverities(ANSWER, REFERENCES, SAFETY_WARNINGS, []).size).toBe(0);
    expect(resolveFindingSeverities(ANSWER, REFERENCES, SAFETY_WARNINGS, null).size).toBe(0);
  });

  it('resolves a lone candidate without needing the prose at all', () => {
    const resolved = resolveFindingSeverities(
      'Ibuprofen interacts with warfarin [40].',
      [safetyFindingRef(40, 'interaction', 'Ibuprofen')],
      [{ type: 'interaction', drug: 'Ibuprofen', detail: 'Reworded entirely by the module.', severity: 'Minor' }],
      [40],
    );
    expect(resolved.get(40)).toBe('Minor');
  });

  it('refuses to guess when the prose singles out no candidate', () => {
    // Two same-drug findings and an answer that reproduces neither one's wording. Attributing
    // "Major" to the wrong sentence is worse for a clinician than attributing nothing, so this
    // resolves to nothing rather than picking the first.
    const resolved = resolveFindingSeverities(
      'Clarithromycin has two interactions worth noting [350] [351].',
      REFERENCES,
      SAFETY_WARNINGS,
      [350, 351],
    );
    expect(resolved.size).toBe(0);
  });

  it('refuses to guess when the claim matches more than one candidate', () => {
    const warnings: AiSafetyWarning[] = [
      { type: 'interaction', drug: 'Clarithromycin', detail: 'Interaction — Major. …', severity: 'Major' },
      { type: 'interaction', drug: 'Clarithromycin', detail: 'Interaction — Minor. …', severity: 'Minor' },
    ];
    const resolved = resolveFindingSeverities('There is an Interaction [350].', REFERENCES, warnings, [350]);
    expect(resolved.size).toBe(0);
  });

  it('skips a finding whose warning carries no rating', () => {
    // An ATC-class or cross-reactivity join has no rule to rate, so there is nothing to show.
    const resolved = resolveFindingSeverities(ANSWER, REFERENCES, SAFETY_WARNINGS, [349]);
    expect(resolved.size).toBe(0);
  });

  it('skips an index with no reference, and a uuid that is not <type>:<drug>', () => {
    expect(resolveFindingSeverities(ANSWER, REFERENCES, SAFETY_WARNINGS, [9999]).size).toBe(0);
    const refs: AiReference[] = [
      { index: 1, resourceType: 'safety_finding', resourceUuid: 'no-colon-here', date: '', group: 'reference' },
    ];
    expect(
      resolveFindingSeverities(
        'A claim [1].',
        refs,
        [{ type: 'interaction', drug: 'x', detail: 'y', severity: 'Major' }],
        [1],
      ).size,
    ).toBe(0);
  });

  it('matches type and drug case-insensitively', () => {
    const refs: AiReference[] = [safetyFindingRef(1, 'INTERACTION', 'clarithromycin')];
    const resolved = resolveFindingSeverities(
      'A claim [1].',
      refs,
      [{ type: 'Interaction', drug: 'Clarithromycin', detail: 'A finding.', severity: 'Major' }],
      [1],
    );
    expect(resolved.get(1)).toBe('Major');
  });

  it('preserves an unrecognised rating verbatim rather than normalising it', () => {
    const refs: AiReference[] = [safetyFindingRef(1, 'interaction', 'Ibuprofen')];
    const resolved = resolveFindingSeverities(
      'A claim [1].',
      refs,
      [{ type: 'interaction', drug: 'Ibuprofen', detail: 'A finding.', severity: '  Contraindicated  ' }],
      [1],
    );
    expect(resolved.get(1)).toBe('Contraindicated');
  });
});

describe('referenceKind', () => {
  it('names each reference type the predicate admits', () => {
    for (const resourceType of REFERENCE_RESOURCE_TYPES) {
      expect(referenceKind({ index: 1, resourceType, resourceUuid: 'x', date: '' })).toBe(resourceType);
    }
  });

  it('reports a reference-group type it does not know as "other" rather than guessing one', () => {
    // isReferenceData admits any reference-group citation, so labelling the leftovers
    // "Drug reference" would tell a clinician the chip came from a drug's reference entry.
    expect(
      referenceKind({ index: 1, resourceType: 'some_future_type', resourceUuid: 'x', date: '', group: 'reference' }),
    ).toBe('other');
  });
});

describe('citationGroupPattern', () => {
  it('hands out a fresh matcher each time', () => {
    // The factory's whole reason. No behavioural test can see it: `matchAll` clones per spec and
    // the renderer's `exec` loop runs to completion, so a shared instance passes everything —
    // measured. The hazard is a caller that stops early and parks `lastIndex` mid-string, so the
    // property is asserted directly.
    const first = citationGroupPattern();
    const second = citationGroupPattern();
    expect(first).not.toBe(second);
    first.lastIndex = 7;
    expect(second.lastIndex).toBe(0);
  });
});

describe('parseCitationIndices', () => {
  it('splits a marker group’s index list however it is spaced', () => {
    expect(parseCitationIndices('7')).toEqual([7]);
    expect(parseCitationIndices('7, 8')).toEqual([7, 8]);
    expect(parseCitationIndices('7,8')).toEqual([7, 8]);
  });
});
