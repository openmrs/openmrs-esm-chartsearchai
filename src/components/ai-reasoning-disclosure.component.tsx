import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from '@carbon/react/icons';
import { chatSessionStore } from '../store/chat-session.store';
import styles from './ai-reasoning-disclosure.scss';

interface AiReasoningDisclosureProps {
  /** The accumulated reasoning transcript. The caller renders nothing when it is empty. */
  reasoning: string;
  /**
   * Whether the reasoning is still arriving — true only while the model is reasoning and no
   * answer text exists yet. It decides the DEFAULT open state, not the reader's: see the
   * phase-transition effect below.
   */
  isStreaming: boolean;
}

/**
 * The model's reasoning, offered under the answer it preceded.
 *
 * Collapsed by default once the answer is on screen: this is the model's scratchpad, and a
 * clinician reading an answer should not have to read past unverified working notes to reach it.
 * Open while the reasoning is still streaming, which is what the live text was added for — the
 * reasoning phase is long and CPU-bound on the backend, and a dead spinner says nothing about
 * whether anything is happening.
 *
 * The session preference is read from the store rather than subscribed to, and deliberately: this
 * component consumes it at exactly two moments — mount, and the phase transition — and both want
 * the value as it stands then. A subscription would also re-render every other answer's
 * disclosure when one of them is toggled, which is the reflow the "only this one moves" note on
 * the toggle handler is about. (`useStore` could not deliver it anyway: with a selector it
 * returns `{ ...state }`, so a selected boolean or `undefined` spreads to a truthy `{}`.)
 */
const AiReasoningDisclosure: React.FC<AiReasoningDisclosureProps> = ({ reasoning, isStreaming }) => {
  const { t } = useTranslation();
  // `undefined` is not `false`: it means the reader has expressed no preference, so the phase
  // decides. An explicit `false` keeps it shut in both phases — see the store's field doc.
  const [isOpen, setIsOpen] = useState(() => chatSessionStore.getState().reasoningExpanded ?? isStreaming);

  /**
   * The phase transition, i.e. the first answer token. It COLLAPSES the disclosure rather than
   * unmounting the transcript — which is what this replaced, and why a reader who wanted a second
   * look at the reasoning had nowhere to go. A reader who has expanded one answer's reasoning
   * keeps it open here.
   */
  const wasStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      setIsOpen(chatSessionStore.getState().reasoningExpanded ?? false);
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // `<details>` toggles itself, so the state is read back off the element rather than negated
  // here: a pointer, the keyboard and find-in-page's auto-expansion then all agree with it.
  //
  // Not memoized on [], deliberately: the echo test below has to read the `isOpen` of the render
  // whose attribute the event is reporting, and a handler frozen at mount would always compare
  // against `true`.
  const handleToggle = useCallback(
    (event: React.SyntheticEvent<HTMLDetailsElement>) => {
      const open = event.currentTarget.open;
      // A `<details>` fires `toggle` whenever its `open` attribute changes — INCLUDING when React
      // is the one changing it, at mount and again at the phase transition. Those echoes carry no
      // reader intent, and recording one as a preference is what kept this open after the answer
      // arrived: measured in Chrome, mounting the disclosure fires exactly one trusted `toggle`
      // with `open: true` and no click, which wrote `reasoningExpanded: true` before any reader
      // had touched it. jsdom fires no such event, so the unit tests could not see it.
      //
      // A real activation always moves `open` AWAY from what this render asked for, so that — not
      // `isTrusted`, which is true for both — is the test that separates the two.
      if (open === isOpen) return;
      setIsOpen(open);
      // Sticky for the session, so "once in a while" costs one click rather than one per answer:
      // a reader who opens one answer's reasoning usually wants the next one's too, and one who
      // closes it wants it to stay closed. Only this message's disclosure moves now — the
      // preference reaches the others as they mount or settle, rather than reflowing the history.
      chatSessionStore.setState({ reasoningExpanded: open });
    },
    [isOpen],
  );

  return (
    <details
      className={styles.disclosure}
      open={isOpen}
      onToggle={handleToggle}
      // The chat history is a role="log" aria-live="polite" region, so without this a screen
      // reader narrates every scratchpad chunk ahead of the answer the scratchpad precedes.
      aria-live="off"
    >
      {/* The caveat rides on the summary as a native `title` rather than as a line of its own —
          the same native-title approach the response panel's badges use. Two consequences worth
          knowing: the summary already has naming content, so per HTML-AAM the title becomes its
          accessible DESCRIPTION and screen-reader users are still told; but a title shows on
          hover only, so a touch user and a sighted reader who never hovers see no caveat at all,
          and the panel's own "AI-generated … verify against the records" disclaimer is then the
          only qualifier on screen. */}
      <summary
        className={styles.summary}
        title={t(
          'modelReasoningCaveat',
          'The model’s working notes, not the answer. Nothing here was checked against the chart, and it can state things the answer does not.',
        )}
      >
        <ChevronDown size={16} className={styles.chevron} />
        {t('modelReasoning', 'Model reasoning')}
      </summary>
      {/* Capped and scrollable only once settled. While it streams the growth is what the chat
          history's scroll-to-bottom effect follows, and an inner scrollbox would hide the newest
          text behind a scrollbar nothing moves. */}
      <p className={`${styles.transcript} ${isStreaming ? '' : styles.transcriptCapped}`}>{reasoning}</p>
    </details>
  );
};

export default AiReasoningDisclosure;
