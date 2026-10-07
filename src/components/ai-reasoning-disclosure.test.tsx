import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { chatSessionStore } from '../store/chat-session.store';
import AiReasoningDisclosure from './ai-reasoning-disclosure.component';

const TRANSCRIPT = 'Scanning drug orders, then active problems.';
const CAVEAT =
  'The model’s working notes, not the answer. Nothing here was checked against the chart, and it can state things the answer does not.';

/**
 * `toBeVisible` rather than `toBeInTheDocument` throughout: a collapsed `<details>` keeps its
 * content in the DOM, so the weaker matcher passes whether the disclosure is open or shut — which
 * is the only thing these tests are about. jest-dom reads the `open` attribute for exactly this
 * (`isAttributeVisible` in its matchers), and jsdom toggles it on a summary click.
 */
beforeEach(() => {
  chatSessionStore.setState({ reasoningExpanded: undefined });
});

describe('AiReasoningDisclosure', () => {
  it('is open while the reasoning is still streaming', () => {
    // The live text exists to say something is happening during a long CPU-bound reasoning
    // phase, so with no preference expressed it shows itself.
    render(<AiReasoningDisclosure reasoning={TRANSCRIPT} isStreaming />);

    expect(screen.getByText(TRANSCRIPT)).toBeVisible();
  });

  it('is collapsed for a settled answer', () => {
    render(<AiReasoningDisclosure reasoning={TRANSCRIPT} isStreaming={false} />);

    expect(screen.getByText('Model reasoning')).toBeVisible();
    expect(screen.getByText(TRANSCRIPT)).not.toBeVisible();
  });

  it('carries the caveat on the summary, as its tooltip and accessible description', () => {
    // The caveat is the licence for showing scratchpad to a clinician at all. On the summary it is
    // the `title`: what hovering the collapsed row shows, and the summary's accessible description.
    render(<AiReasoningDisclosure reasoning={TRANSCRIPT} isStreaming />);

    expect(screen.getByText('Model reasoning')).toHaveAttribute('title', CAVEAT);
  });

  it('draws no caveat line of its own, even while the reasoning streams', () => {
    // On hover only: the summary's `title` above. A line drawn in the open panel repeated the same
    // sentence under every answer whose reasoning was open, which the owner ruled is noise; what that
    // gives up — a reader who never hovers, on the open streaming panel — is the trade they chose
    // (openmrs-module-chartsearchai#254).
    render(<AiReasoningDisclosure reasoning={TRANSCRIPT} isStreaming />);

    expect(screen.getByText(TRANSCRIPT)).toBeVisible();
    expect(screen.queryByText(CAVEAT)).not.toBeInTheDocument();
  });

  it('collapses itself when the answer starts arriving', () => {
    const { rerender } = render(<AiReasoningDisclosure reasoning={TRANSCRIPT} isStreaming />);
    expect(screen.getByText(TRANSCRIPT)).toBeVisible();

    // The first answer token: `isStreaming` goes false while the transcript stays.
    rerender(<AiReasoningDisclosure reasoning={TRANSCRIPT} isStreaming={false} />);

    expect(screen.getByText(TRANSCRIPT)).not.toBeVisible();
    // Collapsed, NOT unmounted — the row is still there to open.
    expect(screen.getByText('Model reasoning')).toBeVisible();
  });

  it('stays open across that transition for a reader who asked to keep it open', () => {
    chatSessionStore.setState({ reasoningExpanded: true });
    const { rerender } = render(<AiReasoningDisclosure reasoning={TRANSCRIPT} isStreaming />);

    rerender(<AiReasoningDisclosure reasoning={TRANSCRIPT} isStreaming={false} />);

    expect(screen.getByText(TRANSCRIPT)).toBeVisible();
  });

  it('starts shut even while streaming for a reader who closed it', () => {
    // An explicit `false` is not the same as no preference: it closes it in both phases.
    chatSessionStore.setState({ reasoningExpanded: false });
    render(<AiReasoningDisclosure reasoning={TRANSCRIPT} isStreaming />);

    expect(screen.getByText(TRANSCRIPT)).not.toBeVisible();
  });

  it('remembers an expansion for the session', async () => {
    render(<AiReasoningDisclosure reasoning={TRANSCRIPT} isStreaming={false} />);

    await userEvent.setup().click(screen.getByText('Model reasoning'));

    expect(screen.getByText(TRANSCRIPT)).toBeVisible();
    expect(chatSessionStore.getState().reasoningExpanded).toBe(true);
  });

  it('remembers a collapse for the session', async () => {
    render(<AiReasoningDisclosure reasoning={TRANSCRIPT} isStreaming />);

    await userEvent.setup().click(screen.getByText('Model reasoning'));

    expect(screen.getByText(TRANSCRIPT)).not.toBeVisible();
    expect(chatSessionStore.getState().reasoningExpanded).toBe(false);
  });

  it('moves only the disclosure that was clicked', async () => {
    // The preference reaches the other answers as they mount or settle. Reflowing the whole
    // history under the reader's eyes on one click is what this avoids.
    render(
      <>
        <AiReasoningDisclosure reasoning="First answer notes." isStreaming={false} />
        <AiReasoningDisclosure reasoning="Second answer notes." isStreaming={false} />
      </>,
    );

    await userEvent.setup().click(screen.getAllByText('Model reasoning')[0]);

    expect(screen.getByText('First answer notes.')).toBeVisible();
    expect(screen.getByText('Second answer notes.')).not.toBeVisible();
  });

  /**
   * Chrome fires a `toggle` whenever the `open` attribute changes, including when REACT changes
   * it. Mounting this open therefore fires exactly one trusted `toggle` with `open: true` and no
   * reader involved — measured on a real standalone, where treating it as a reader action wrote
   * `reasoningExpanded: true` and the disclosure then stayed open through every answer. jsdom
   * fires no such event, so these two dispatch the echo by hand.
   */
  describe('toggle events that React itself caused', () => {
    it('does not record a mount echo as a reader preference', () => {
      render(<AiReasoningDisclosure reasoning={TRANSCRIPT} isStreaming />);
      const details = screen.getByRole<HTMLDetailsElement>('group');
      expect(details.open).toBe(true);

      // The echo: `open` already agrees with what this render asked for.
      fireEvent(details, new Event('toggle'));

      expect(chatSessionStore.getState().reasoningExpanded).toBeUndefined();
    });

    it('still collapses at the transition after a mount echo', () => {
      const { rerender } = render(<AiReasoningDisclosure reasoning={TRANSCRIPT} isStreaming />);
      fireEvent(screen.getByRole('group'), new Event('toggle'));

      rerender(<AiReasoningDisclosure reasoning={TRANSCRIPT} isStreaming={false} />);

      expect(screen.getByText(TRANSCRIPT)).not.toBeVisible();
    });
  });

  it('keeps the streaming transcript out of the chat history live region', () => {
    // The history is role="log" aria-live="polite", so without this a screen reader narrates
    // every scratchpad chunk ahead of the answer the scratchpad precedes.
    render(<AiReasoningDisclosure reasoning={TRANSCRIPT} isStreaming />);

    // `<details>` exposes the `group` role, which is how the element is reached without
    // querying the container directly.
    expect(screen.getByRole('group')).toHaveAttribute('aria-live', 'off');
  });
});
