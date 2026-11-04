import React, { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, InlineLoading } from '@carbon/react';
import { formatDate } from '@openmrs/esm-framework';
import { isServerUnreachable } from '../omnibar-contract/server-unreachable';
import { type OmnibarViewProps, type OmnibarViewState } from '../omnibar-contract/types';
import { useChartSearchOffer } from './chartsearch-offer';
import {
  type ChartSearchReference,
  type ChartSearchStatements,
  maxAnswerCharacters,
  parseJson,
  parseReferences,
  parseStatements,
  type SseEvent,
  streamChartSearch,
} from './chartsearch-stream';
import styles from './chartsearch-answer.scss';

/**
 * ChartSearch, on the Query results page. For a question-like query the user just submitted (Enter in
 * the bar, its "see all results" line, or an earlier query on the page), it sends the question, with
 * the chart's patient, to ChartSearch's streaming endpoint, and the answer streams into the page. The
 * bar's hint says Enter will ask ChartSearch, so Enter is the request. A page reloaded, reached with
 * back or forward, or opened from a link sends nothing until the clinician presses Ask. Typing alone
 * never sends anything, and the answer is never stored.
 *
 * Ported from the omnibar, which had it as a prototype. It keeps its own state rather than using
 * `useChartSearchAi`, so an answer here never enters the chat's transcript or blocks it. It draws
 * ChartSearch's statements about the answer as the module's README asks: citations as unverified
 * until verdicts arrive, reference material apart from chart evidence, safety findings whole, and each
 * caveat as a caveat, never as a verdict.
 */

type Phase = 'ready' | 'asking' | 'answering' | 'answered' | 'final' | Failure;
type Failure = 'failed' | 'unavailable' | 'signedOut';

interface AnswerState {
  phase: Phase;
  text: string;
  references: Array<ChartSearchReference>;
  /** From `done`, then `grounded`. Drawn only once the stream has ended, when they're final. */
  statements: ChartSearchStatements | null;
  disclaimer: string | null;
}

type Action = { type: 'ask' } | { type: 'event'; event: SseEvent } | { type: 'end' } | { type: 'fail'; phase: Failure };

const initialState: AnswerState = { phase: 'ready', text: '', references: [], statements: null, disclaimer: null };

const cap = (text: string) => (text.length > maxAnswerCharacters ? text.slice(0, maxAnswerCharacters) : text);

function reducer(state: AnswerState, action: Action): AnswerState {
  switch (action.type) {
    case 'ask':
      return { ...initialState, phase: 'asking' };
    case 'fail':
      return { ...state, phase: action.phase };
    case 'end':
      // A stream that ends before `done` didn't finish its answer.
      return state.phase === 'answered' ? { ...state, phase: 'final' } : { ...state, phase: 'failed' };
    case 'event': {
      if (state.phase === 'final' || isFailure(state.phase)) {
        return state;
      }
      const { event, data } = action.event;
      switch (event) {
        case 'thinking':
        case 'preliminary':
          // Reasoning and previews aren't the answer and aren't drawn; they say work has started.
          return state.phase === 'asking' ? { ...state, phase: 'answering' } : state;
        case 'token':
          return {
            ...state,
            phase: state.phase === 'answered' ? 'answered' : 'answering',
            text: cap(state.text + data),
          };
        case 'references': {
          const references = parseReferences(parseJson(data)?.references);
          return references ? { ...state, references } : state;
        }
        case 'done': {
          const payload = parseJson(data);
          if (!payload) {
            return { ...state, phase: 'failed' };
          }
          return {
            ...state,
            phase: 'answered',
            text: typeof payload.answer === 'string' ? cap(payload.answer) : state.text,
            references: parseReferences(payload.references) ?? state.references,
            statements: parseStatements(payload),
            disclaimer:
              typeof payload.disclaimer === 'string'
                ? Array.from(payload.disclaimer).slice(0, maxDisclaimerCharacters).join('')
                : null,
          };
        }
        case 'grounded': {
          // Sent after `done` when ChartSearch verifies citations later: it replaces the references and
          // the statements `done` couldn't make yet. It comes on the same stream, before it ends, so it
          // always finds the answer here; the page shows verdicts only once the stream has ended, so a
          // stream that ends early leaves citations marked unverified, never wrongly verified.
          const payload = parseJson(data);
          if (!payload || state.phase !== 'answered') {
            return state;
          }
          return {
            ...state,
            references: parseReferences(payload.references) ?? state.references,
            statements: parseStatements(payload),
          };
        }
        case 'error':
          // Never ChartSearch's own words: the page says only that it failed.
          return { ...state, phase: 'failed' };
        default:
          return state;
      }
    }
  }
}

const isFailure = (phase: Phase): phase is Failure =>
  phase === 'failed' || phase === 'unavailable' || phase === 'signedOut';
const maxDisclaimerCharacters = 1_000;

/** How a failed request is told: the server out of reach, the session ended, or anything else. */
function failureOf(error: unknown): Failure {
  if (isServerUnreachable(error)) return 'unavailable';
  // A raw fetch doesn't send the user to the login page as openmrsFetch would, so the page says why.
  return (error as { response?: { status?: number } })?.response?.status === 401 ? 'signedOut' : 'failed';
}

const humanize = (value: string) => {
  const words = value.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toLocaleUpperCase() + words.slice(1) : value;
};

const formatDay = (date: string | null) => {
  if (!date) return null;
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00` : date);
  return Number.isNaN(parsed.getTime()) ? null : formatDate(parsed, { time: false });
};

const ChartSearchAnswerView: React.FC<OmnibarViewProps> = ({
  query,
  context,
  reportState,
  submitted,
  hints,
  signal,
}) => {
  const { t } = useTranslation();
  const patientUuid = context.scope === 'patient' ? context.patientUuid : undefined;
  const question = query.trim();
  // Mounted under /ask, or for a plain query. Under /ask any text is a question.
  const offered = useChartSearchOffer(question, patientUuid, hints, context.command?.id === 'ask');

  const [state, dispatch] = useReducer(reducer, initialState);
  const controller = useRef<AbortController | null>(null);
  const asked = useRef(false);
  // Leaving stops the answer. A remount, which React's development checks do on purpose, may then ask
  // again, rather than leave the section waiting on a request it stopped.
  useEffect(
    () => () => {
      controller.current?.abort();
      asked.current = false;
    },
    [],
  );

  // The host aborts its signal once it has moved past this mount, which stops the answer as leaving does.
  useEffect(() => {
    if (!signal) return;
    const stop = () => controller.current?.abort();
    signal.addEventListener('abort', stop);
    return () => signal.removeEventListener('abort', stop);
  }, [signal]);

  const ask = useCallback(() => {
    if (!offered || !patientUuid || signal?.aborted) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    dispatch({ type: 'ask' });
    streamChartSearch(patientUuid, question, (event) => dispatch({ type: 'event', event }), current.signal).then(
      () => current.signal.aborted || dispatch({ type: 'end' }),
      (error) => current.signal.aborted || dispatch({ type: 'fail', phase: failureOf(error) }),
    );
  }, [offered, patientUuid, question, signal]);

  // A query the user just submitted is asked at once: Enter was the request. A page reloaded, reached
  // with back or forward, or opened from a link asks only when the clinician presses the button, so
  // nothing sends the question again on its own. Each query is a new mount, so this runs once.
  // An answer no longer offered, say the section switched off, is stopped rather than read to the end
  // unseen.
  useEffect(() => {
    if (!offered) {
      controller.current?.abort();
    }
  }, [offered]);

  useEffect(() => {
    if (submitted && offered && !asked.current) {
      asked.current = true;
      ask();
    }
  }, [submitted, offered, ask]);

  const viewState: OmnibarViewState = !offered ? 'empty' : 'ready';
  useEffect(() => {
    reportState(viewState);
  }, [reportState, viewState]);

  const headingId = `ask-chartsearch-${patientUuid}`;
  const statements = state.phase === 'final' ? state.statements : null;
  const caveats = useMemo(() => {
    const byIndex = new Map<number, Array<string>>();
    const add = (indexes: Array<number> | null | undefined, caveat: string) =>
      indexes?.forEach((index) => byIndex.set(index, [...(byIndex.get(index) ?? []), caveat]));
    add(
      statements?.unfaithfullyRenderedCitations,
      t('caveatUnfaithful', 'The answer’s wording of this citation isn’t the record’s wording.'),
    );
    add(
      statements?.misattributedOrderCitations,
      t('caveatMisattributed', 'This citation can’t be the active order the answer names.'),
    );
    add(
      statements?.unstatedFindingSeverities,
      t('caveatUnstatedSeverity', 'The answer doesn’t state this finding’s rating.'),
    );
    return byIndex;
  }, [statements, t]);

  if (!offered) {
    return null;
  }

  const final = state.phase === 'final';
  const unsourced = final && state.references.length === 0;
  const streaming = state.phase === 'asking' || state.phase === 'answering' || state.phase === 'answered';
  const chartRefs = state.references.filter((ref) => ref.group === 'chart');
  const referenceRefs = state.references.filter((ref) => ref.group === 'reference');
  const otherRefs = state.references.filter((ref) => ref.group !== 'chart' && ref.group !== 'reference');

  const verdictOf = (ref: ChartSearchReference) => {
    if (!final) return t('citationUnverified', 'Unverified');
    if (ref.grounded === true) return t('citationSupported', 'Checked against the record');
    if (ref.grounded === false) return t('citationNotSupported', 'The record may not support this statement');
    if (ref.attachedByTheModule) return t('citationAttached', 'Added by ChartSearch from a safety finding');
    return t('citationNotChecked', 'Not checked');
  };

  const citation = (ref: ChartSearchReference, chart: boolean) => {
    const date = formatDay(ref.date);
    const notes = caveats.get(ref.index) ?? [];
    return (
      <li key={`${ref.group}:${ref.index}`} className={styles.citation}>
        <span className={styles.citationIndex}>[{ref.index}]</span>
        <span className={styles.citationText}>
          <span dir="auto">{humanize(ref.resourceType)}</span>
          {date && <span className={styles.citationDate}>{date}</span>}
          {chart ? (
            <span className={ref.grounded === false && final ? styles.verdictWarn : styles.verdict}>
              {verdictOf(ref)}
            </span>
          ) : null}
          {ref.source && (
            <span className={styles.citationMeta} dir="auto">
              {t('citationSource', 'Source: {{source}}', { source: ref.source, interpolation: { escapeValue: false } })}
            </span>
          )}
          {ref.withheldInteractions > 0 && (
            <span className={styles.citationMeta}>
              {t('citationSubset', 'Shows some of this entry’s interaction partners')}
            </span>
          )}
          {notes.map((note) => (
            <span key={note} className={styles.caveat}>
              {note}
            </span>
          ))}
        </span>
      </li>
    );
  };

  return (
    <div className={styles.card}>
      <h3 id={headingId} className={styles.heading}>
        {t('chartSearchHeading', 'ChartSearch')}
      </h3>
      <p className={styles.question} dir="auto">
        {question}
      </p>

      {state.phase === 'ready' && (
        <>
          <p className={styles.note}>
            {t(
              'askChartSearchAgainNote',
              'ChartSearch answers from this chart using AI. It isn’t asked again when this page is reopened.',
            )}
          </p>
          <Button kind="primary" size="md" onClick={ask}>
            {t('askChartSearchButton', 'Ask ChartSearch')}
          </Button>
        </>
      )}

      {isFailure(state.phase) && (
        <>
          <p className={styles.note} role="status">
            {state.phase === 'unavailable'
              ? t('providerUnavailable', 'Unavailable right now')
              : state.phase === 'signedOut'
                ? t('chartSearchSignedOut', 'Your session has ended. Log in again, then ask again.')
                : t('chartSearchFailed', 'ChartSearch couldn’t answer this question.')}
          </p>
          <Button kind="tertiary" size="sm" onClick={ask}>
            {t('tryAgain', 'Try again')}
          </Button>
        </>
      )}

      {state.phase !== 'ready' && !isFailure(state.phase) && (
        <section className={styles.answer} aria-live="polite" aria-busy={streaming}>
          {!state.text && streaming && <InlineLoading description={t('thinking', 'Working on an answer')} />}
          {unsourced ? (
            <p className={styles.note}>
              {t('unsourcedAnswer', 'This answer is hidden because it didn’t cite any records.')}
            </p>
          ) : (
            state.text && (
              <p className={styles.answerText} dir="auto">
                {state.text}
              </p>
            )
          )}
          {state.text && streaming && state.phase === 'answered' && (
            <InlineLoading description={t('checkingAnswer', 'Checking the answer')} />
          )}

          {!unsourced && statements && <Statements statements={statements} headingId={headingId} />}

          {!unsourced && state.references.length > 0 && (
            <div className={styles.citations}>
              {chartRefs.length > 0 && (
                <>
                  <h4 className={styles.subheading} id={`${headingId}-chart`}>
                    {t('citedRecords', 'Records cited')}
                  </h4>
                  <ul aria-labelledby={`${headingId}-chart`}>{chartRefs.map((ref) => citation(ref, true))}</ul>
                </>
              )}
              {referenceRefs.length > 0 && (
                <>
                  <h4 className={styles.subheading} id={`${headingId}-reference`}>
                    {t('citedReference', 'Reference material, not this patient’s record')}
                  </h4>
                  <ul aria-labelledby={`${headingId}-reference`}>{referenceRefs.map((ref) => citation(ref, false))}</ul>
                </>
              )}
              {otherRefs.length > 0 && (
                <>
                  <h4 className={styles.subheading} id={`${headingId}-other`}>
                    {t('citedOther', 'Other sources')}
                  </h4>
                  <ul aria-labelledby={`${headingId}-other`}>{otherRefs.map((ref) => citation(ref, false))}</ul>
                </>
              )}
            </div>
          )}

          {(final || state.phase === 'answered') && (
            <p className={styles.disclaimer} dir="auto">
              {state.disclaimer || t('aiDisclaimer', 'This answer is AI-generated and may not be accurate.')}
            </p>
          )}
        </section>
      )}
    </div>
  );
};

/** ChartSearch's statements about the answer: its drug-safety findings and the limits of its checks. */
const Statements: React.FC<{ statements: ChartSearchStatements; headingId: string }> = ({ statements, headingId }) => {
  const { t } = useTranslation();
  const typeLabel = (type: string) => {
    switch (type) {
      case 'overdose':
        return t('safetyOverdose', 'Dose');
      case 'interaction':
        return t('safetyInteraction', 'Interaction');
      case 'contraindication':
        return t('safetyContraindication', 'Contraindication');
      default:
        return type ? humanize(type) : t('safetyFinding', 'Safety finding');
    }
  };
  const { safetyWarnings, interactionPairs, activeOrderClaims, unresolvedDrugClass, conditionRuleCoverage } =
    statements;
  const lines: Array<string> = [];
  if (interactionPairs && interactionPairs.found > interactionPairs.reported) {
    lines.push(
      t('interactionPairsShown', '{{reported}} of {{found}} interaction pairs are shown.', {
        reported: interactionPairs.reported,
        found: interactionPairs.found,
        interpolation: { escapeValue: false },
      }),
    );
  }
  if (activeOrderClaims && activeOrderClaims.stated > 0 && activeOrderClaims.uncited > 0) {
    lines.push(
      t('activeOrderClaimsUncited', '{{uncited}} of {{stated}} statements about active orders cite no chart record.', {
        uncited: activeOrderClaims.uncited,
        stated: activeOrderClaims.stated,
        interpolation: { escapeValue: false },
      }),
    );
  }
  if (unresolvedDrugClass) {
    lines.push(
      t(
        'unresolvedDrugClass',
        'The question names a drug class, “{{drugClass}}”. Reference entries are listed by individual drug, so the class wasn’t matched to any of them. Ask about a specific drug by name.',
        { drugClass: unresolvedDrugClass, interpolation: { escapeValue: false } },
      ),
    );
  }
  if (conditionRuleCoverage === 'absent') {
    lines.push(
      t(
        'conditionRulesAbsent',
        'The patient’s recorded conditions weren’t screened against contraindication rules: the loaded drug reference has none.',
      ),
    );
  }
  if (!safetyWarnings.length && !lines.length) {
    return null;
  }
  return (
    <div className={styles.safety}>
      {safetyWarnings.length > 0 && (
        <>
          <h4 className={styles.subheading} id={`${headingId}-safety`}>
            {t('safetyFindings', 'Safety findings')}
          </h4>
          <ul aria-labelledby={`${headingId}-safety`}>
            {safetyWarnings.map((warning, index) => (
              <li key={index} className={styles.warning}>
                <span className={styles.warningType}>
                  {typeLabel(warning.type)}
                  {warning.severity && (
                    <span className={styles.severity} dir="auto">
                      {warning.severity}
                    </span>
                  )}
                </span>
                <span className={styles.warningDetail} dir="auto">
                  {warning.detail}
                </span>
                {warning.chartOrderBridges.map((bridge, bridgeIndex) => (
                  <span key={bridgeIndex} className={styles.citationMeta} dir="auto">
                    {t('resolvedFromOrder', '{{substance}} was resolved from the order “{{order}}”', {
                      substance: bridge.substance,
                      order: bridge.orderDisplay,
                      interpolation: { escapeValue: false },
                    })}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
      {lines.map((line) => (
        <p key={line} className={styles.note} dir="auto">
          {line}
        </p>
      ))}
    </div>
  );
};

export default ChartSearchAnswerView;
