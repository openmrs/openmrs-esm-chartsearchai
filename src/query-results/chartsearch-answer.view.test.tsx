import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultsFromConfigSchema, useConfig } from '@openmrs/esm-framework';
import { type ChartSearchAiConfig, configSchema } from '../config-schema';
import { type OmnibarViewProps, type OmnibarViewState } from '../omnibar-contract/types';
import ChartSearchAnswerView from './chartsearch-answer.view';

vi.mock('@openmrs/esm-framework', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openmrs/esm-framework')>()),
  makeUrl: (path: string) => `/openmrs${path}`,
}));

const defaults = () => getDefaultsFromConfigSchema(configSchema) as ChartSearchAiConfig;

const humprey = '8673ee4f-e2ab-4077-ba55-4980f408773e';
const question = 'when did he start ART?';

const frame = (event: string, data: unknown) =>
  `event: ${event}\n${String(typeof data === 'string' ? data : JSON.stringify(data))
    .split('\n')
    .map((line) => `data: ${line}`)
    .join('\n')}\n\n`;

/** A response whose body is written by the test, a chunk at a time, then ended. */
function streamingResponse(init: { status?: number; contentType?: string } = {}) {
  const encoder = new TextEncoder();
  const queue: Array<Uint8Array | null> = [];
  let wake: () => void = () => {};
  // Like a real fetch, a stopped request's reads fail, so a stopped request reads nothing more.
  let signal: AbortSignal | undefined;
  const next = () =>
    new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
      const take = () => {
        if (signal?.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        const chunk = queue.shift();
        if (chunk === undefined) {
          wake = take;
          return;
        }
        resolve(chunk === null ? { done: true, value: undefined } : { done: false, value: chunk });
      };
      take();
    });
  const response = {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers: new Headers({ 'content-type': init.contentType ?? 'text/event-stream;charset=UTF-8' }),
    body: { getReader: () => ({ read: next, releaseLock: () => {} }) },
  };
  return {
    response,
    /** The fetch to give fetchMock: it ties the response to the request's signal. */
    fetch: (_url: string, init: { signal?: AbortSignal }) => {
      signal = init.signal;
      signal?.addEventListener('abort', () => wake());
      return Promise.resolve(response);
    },
    write: (text: string) => {
      queue.push(encoder.encode(text));
      wake();
    },
    end: () => {
      queue.push(null);
      wake();
    },
  };
}

const done = (overrides: Record<string, unknown> = {}) => ({
  answer: 'ART started on 3 March 2024 [1].',
  disclaimer: 'This response is AI-generated and may not be accurate.',
  references: [{ index: 1, resourceType: 'drug_order', date: '2024-03-03', grounded: null, group: 'chart' }],
  safetyWarnings: [],
  interactionPairs: null,
  unresolvedDrugClass: null,
  unfaithfullyRenderedCitations: [],
  misattributedOrderCitations: [],
  unstatedFindingSeverities: [],
  activeOrderClaims: { stated: 0, uncited: 0 },
  conditionRuleCoverage: 'unloaded',
  ...overrides,
});

const renderView = (query = question, submitted = false, extra: Partial<OmnibarViewProps> = {}) => {
  const states: Array<OmnibarViewState> = [];
  const props: OmnibarViewProps = {
    query,
    context: { scope: 'patient', patientUuid: humprey, locale: 'en' },
    contractVersion: 1,
    reportState: (state) => {
      states.push(state);
    },
    submitted,
    ...extra,
  };
  const view = render(<ChartSearchAnswerView {...props} />);
  return { states, ...view };
};

describe('the Ask ChartSearch view', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.mocked(useConfig).mockReturnValue(defaults());
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks at once about a question the user just submitted, with no Ask button, and only once', async () => {
    const stream = streamingResponse();
    fetchMock.mockResolvedValue(stream.response);
    const { states, rerender } = renderView(question, true);

    expect(await screen.findByRole('heading', { name: 'ChartSearch' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask ChartSearch' })).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ patient: humprey, question });
    await waitFor(() => expect(states.at(-1)).toBe('ready'));

    rerender(
      <ChartSearchAnswerView
        query={question}
        context={{ scope: 'patient', patientUuid: humprey, locale: 'en' }}
        contractVersion={1}
        reportState={() => {}}
        submitted
      />,
    );
    await act(async () => stream.write(frame('done', done())));
    await act(async () => stream.end());
    expect(await screen.findByText('ART started on 3 March 2024 [1].')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('on a page nobody just asked for, such as a reload, sends nothing until Ask is pressed', async () => {
    const { states } = renderView();

    expect(await screen.findByRole('heading', { name: 'ChartSearch' })).toBeInTheDocument();
    expect(screen.getByText(question)).toBeInTheDocument();
    expect(screen.getByText(/isn’t asked again when this page is reopened/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask ChartSearch' })).toBeInTheDocument();
    await waitFor(() => expect(states.at(-1)).toBe('ready'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks once its answer can stream, even under StrictMode’s remount', async () => {
    const stream = streamingResponse();
    fetchMock.mockImplementation(stream.fetch);
    render(
      <React.StrictMode>
        <ChartSearchAnswerView
          query={question}
          context={{ scope: 'patient', patientUuid: humprey, locale: 'en' }}
          contractVersion={1}
          reportState={() => {}}
          submitted
        />
      </React.StrictMode>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => stream.write(frame('done', done())));
    await act(async () => stream.end());
    expect(await screen.findByText('ART started on 3 March 2024 [1].')).toBeInTheDocument();
  });

  it('never asks past the site’s own question limit', async () => {
    vi.mocked(useConfig).mockReturnValue({ ...defaults(), maxQuestionLength: 10 });
    const { states, container } = renderView(question, true);
    await waitFor(() => expect(states.at(-1)).toBe('empty'));
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('with no `submitted` from the host, shows the Ask button and sends nothing', async () => {
    const states: Array<OmnibarViewState> = [];
    const props: OmnibarViewProps = {
      query: question,
      context: { scope: 'patient', patientUuid: humprey, locale: 'en' },
      contractVersion: 1,
      reportState: (state) => {
        states.push(state);
      },
    };
    expect(props).not.toHaveProperty('submitted');
    render(<ChartSearchAnswerView {...props} />);

    expect(await screen.findByRole('button', { name: 'Ask ChartSearch' })).toBeInTheDocument();
    await waitFor(() => expect(states.at(-1)).toBe('ready'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('takes the host’s word on whether the query is a question', async () => {
    const { states: offered, unmount } = renderView('cd4 trend', false, {
      hints: { looksLikeIdentifier: false, looksLikeQuestion: true },
    });
    await waitFor(() => expect(offered.at(-1)).toBe('ready'));
    unmount();

    const { states: notOffered } = renderView(question, true, {
      hints: { looksLikeIdentifier: false, looksLikeQuestion: false },
    });
    await waitFor(() => expect(notOffered.at(-1)).toBe('empty'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('with the section switched off, reports empty and never asks', async () => {
    vi.mocked(useConfig).mockReturnValue({ ...defaults(), queryResultsAnswer: { enabled: false } });
    const { states, container } = renderView(question, true);
    await waitFor(() => expect(states.at(-1)).toBe('empty'));
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never asks about a submitted query that isn’t a question', async () => {
    const { states } = renderView('cd4', true);
    await waitFor(() => expect(states.at(-1)).toBe('empty'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('under /ask, asks about any submitted text, question or not, once', async () => {
    const stream = streamingResponse();
    fetchMock.mockResolvedValue(stream.response);
    const props: OmnibarViewProps = {
      query: 'cd4',
      context: { scope: 'patient', patientUuid: humprey, locale: 'en', command: { id: 'ask' } },
      contractVersion: 1,
      reportState: () => {},
      submitted: true,
    };
    const { rerender } = render(<ChartSearchAnswerView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ patient: humprey, question: 'cd4' });
    rerender(<ChartSearchAnswerView {...props} />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an ID-shaped query under /ask', '100GEJ', true],
    ['text under /ask nobody just asked for', 'cd4', false],
  ])('doesn’t ask about %s', async (_, query, submitted) => {
    const { states } = renderView(query, submitted, {
      context: { scope: 'patient', patientUuid: humprey, locale: 'en', command: { id: 'ask' } },
    });
    await waitFor(() => expect(states.at(-1)).toBe(query === '100GEJ' ? 'empty' : 'ready'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['a query that isn’t a question', () => renderView('cd4')],
    ['a question longer than ChartSearch takes', () => renderView(`what ${'x'.repeat(1000)}?`)],
  ])('isn’t offered for %s', async (_, renderIt) => {
    const { states, container } = renderIt();
    await waitFor(() => expect(states.at(-1)).toBe('empty'));
    expect(container).toBeEmptyDOMElement();
  });

  it('streams the answer into the page, citations unverified until the stream ends', async () => {
    const user = userEvent.setup();
    const stream = streamingResponse();
    fetchMock.mockResolvedValue(stream.response);
    renderView();

    await user.click(await screen.findByRole('button', { name: 'Ask ChartSearch' }));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/openmrs/ws/rest/v1/chartsearchai/search/stream');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(JSON.parse(init.body)).toEqual({ patient: humprey, question });

    await act(async () =>
      stream.write(': keep-alive\n\n' + frame('thinking', 'Looking at orders') + frame('token', 'ART started')),
    );
    expect(await screen.findByText('ART started')).toBeInTheDocument();
    expect(screen.queryByText('Looking at orders')).not.toBeInTheDocument();

    await act(async () => stream.write(frame('done', done())));
    expect(await screen.findByText('ART started on 3 March 2024 [1].')).toBeInTheDocument();
    expect(screen.getByText('Unverified')).toBeInTheDocument();
    expect(screen.getByText('This response is AI-generated and may not be accurate.')).toBeInTheDocument();

    await act(async () => stream.end());
    expect(await screen.findByText('Not checked')).toBeInTheDocument();
    expect(screen.getByText('Drug order')).toBeInTheDocument();
  });

  it('takes the verdicts and statements ChartSearch sends after done', async () => {
    const user = userEvent.setup();
    const stream = streamingResponse();
    fetchMock.mockResolvedValue(stream.response);
    renderView();

    await user.click(await screen.findByRole('button', { name: 'Ask ChartSearch' }));
    await act(async () =>
      stream.write(
        frame('done', done({ unfaithfullyRenderedCitations: null, activeOrderClaims: null })) +
          frame('grounded', {
            references: [{ index: 1, resourceType: 'drug_order', date: '2024-03-03', grounded: false, group: 'chart' }],
            safetyWarnings: [],
            unfaithfullyRenderedCitations: [1],
          }),
      ),
    );
    await act(async () => stream.end());

    expect(await screen.findByText('The record may not support this statement')).toBeInTheDocument();
    expect(screen.getByText('The answer’s wording of this citation isn’t the record’s wording.')).toBeInTheDocument();
  });

  it('draws safety findings whole, reference material apart, and the limits of its checks', async () => {
    const user = userEvent.setup();
    const stream = streamingResponse();
    fetchMock.mockResolvedValue(stream.response);
    renderView('can I give him ibuprofen?');

    await user.click(await screen.findByRole('button', { name: 'Ask ChartSearch' }));
    await act(async () =>
      stream.write(
        frame(
          'done',
          done({
            answer: 'Ibuprofen interacts with active order Warfarin [2].',
            references: [
              {
                index: 1,
                resourceType: 'allergy',
                date: null,
                grounded: null,
                group: 'chart',
                attachedByTheModule: true,
              },
              {
                index: 2,
                resourceType: 'safety_finding',
                date: null,
                grounded: null,
                group: 'reference',
                source: 'DDInter 2.0',
              },
            ],
            safetyWarnings: [
              {
                type: 'interaction',
                drug: 'Ibuprofen',
                detail: 'Ibuprofen interacts with active order Warfarin. Major. Raises bleeding risk.',
                severity: 'Major',
                chartOrderBridges: [{ substance: 'Ibuprofen', orderDisplay: 'Advil 400mg' }],
              },
            ],
            interactionPairs: { found: 18, reported: 10 },
            unresolvedDrugClass: 'NSAID',
            conditionRuleCoverage: 'absent',
            activeOrderClaims: { stated: 4, uncited: 2 },
            unstatedFindingSeverities: [2],
          }),
        ),
      ),
    );
    await act(async () => stream.end());

    const warning = within(await screen.findByRole('list', { name: 'Safety findings' })).getByRole('listitem');
    expect(
      within(warning).getByText('Ibuprofen interacts with active order Warfarin. Major. Raises bleeding risk.'),
    ).toBeInTheDocument();
    expect(within(warning).getByText('Major')).toBeInTheDocument();
    expect(within(warning).getByText('Ibuprofen was resolved from the order “Advil 400mg”')).toBeInTheDocument();
    expect(screen.getByText('10 of 18 interaction pairs are shown.')).toBeInTheDocument();
    expect(screen.getByText('2 of 4 statements about active orders cite no chart record.')).toBeInTheDocument();
    expect(screen.getByText(/names a drug class, “NSAID”/)).toBeInTheDocument();
    expect(screen.getByText(/conditions weren’t screened/)).toBeInTheDocument();
    expect(screen.getByText('Added by ChartSearch from a safety finding')).toBeInTheDocument();
    const reference = screen.getByRole('list', { name: 'Reference material, not this patient’s record' });
    expect(reference).toHaveTextContent('Safety finding');
    expect(reference).toHaveTextContent('Source: DDInter 2.0');
    expect(reference).toHaveTextContent('The answer doesn’t state this finding’s rating.');
    expect(reference).not.toHaveTextContent('Not checked');
  });

  it('hides an answer that cites no records', async () => {
    const user = userEvent.setup();
    const stream = streamingResponse();
    fetchMock.mockResolvedValue(stream.response);
    renderView();

    await user.click(await screen.findByRole('button', { name: 'Ask ChartSearch' }));
    await act(async () => stream.write(frame('done', done({ references: [] }))));
    await act(async () => stream.end());

    expect(await screen.findByText('This answer is hidden because it didn’t cite any records.')).toBeInTheDocument();
    expect(screen.queryByText(/ART started/)).not.toBeInTheDocument();
  });

  it('never shows ChartSearch’s own error text', async () => {
    const user = userEvent.setup();
    const stream = streamingResponse();
    fetchMock.mockResolvedValue(stream.response);
    renderView();

    await user.click(await screen.findByRole('button', { name: 'Ask ChartSearch' }));
    await act(async () => stream.write(frame('error', "This patient's chart is too large to process.")));
    await act(async () => stream.end());

    expect(await screen.findByText('ChartSearch couldn’t answer this question.')).toBeInTheDocument();
    expect(screen.queryByText(/too large/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('treats a stream that ends before done as a failure', async () => {
    const user = userEvent.setup();
    const stream = streamingResponse();
    fetchMock.mockResolvedValue(stream.response);
    renderView();

    await user.click(await screen.findByRole('button', { name: 'Ask ChartSearch' }));
    await act(async () => stream.write(frame('token', 'ART')));
    await act(async () => stream.end());
    expect(await screen.findByText('ChartSearch couldn’t answer this question.')).toBeInTheDocument();
  });

  it.each([
    [503, 'Unavailable right now'],
    [429, 'ChartSearch couldn’t answer this question.'],
    [403, 'ChartSearch couldn’t answer this question.'],
    [401, 'Your session has ended. Log in again, then ask again.'],
  ])('says only what the page says when the server answers %s', async (status, message) => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(streamingResponse({ status }).response);
    renderView();

    await user.click(await screen.findByRole('button', { name: 'Ask ChartSearch' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('refuses a response that isn’t an event stream', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(streamingResponse({ contentType: 'text/html' }).response);
    renderView();

    await user.click(await screen.findByRole('button', { name: 'Ask ChartSearch' }));
    expect(await screen.findByText('ChartSearch couldn’t answer this question.')).toBeInTheDocument();
  });

  it('stops an answer that is no longer offered', async () => {
    const stream = streamingResponse();
    fetchMock.mockImplementation(stream.fetch);
    const { rerender } = renderView(question, true);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const { signal } = fetchMock.mock.calls[0][1];

    vi.mocked(useConfig).mockReturnValue({ ...defaults(), queryResultsAnswer: { enabled: false } });
    rerender(
      <ChartSearchAnswerView
        query={question}
        context={{ scope: 'patient', patientUuid: humprey, locale: 'en' }}
        contractVersion={1}
        reportState={() => {}}
        submitted
      />,
    );
    expect(signal.aborted).toBe(true);
  });

  it('stops reading when the page moves on', async () => {
    const user = userEvent.setup();
    const stream = streamingResponse();
    fetchMock.mockResolvedValue(stream.response);
    const { unmount } = renderView();

    await user.click(await screen.findByRole('button', { name: 'Ask ChartSearch' }));
    const { signal } = fetchMock.mock.calls[0][1];
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it('stops reading when the host aborts its signal, and never asks under a signal already aborted', async () => {
    const user = userEvent.setup();
    const stream = streamingResponse();
    fetchMock.mockImplementation(stream.fetch);
    const host = new AbortController();
    renderView(question, true, { signal: host.signal });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const { signal } = fetchMock.mock.calls[0][1];

    await act(async () => stream.write(frame('token', 'ART started')));
    expect(await screen.findByText('ART started')).toBeInTheDocument();
    await act(async () => host.abort());
    expect(signal.aborted).toBe(true);
    await act(async () => stream.write(frame('token', ' on 3 March')));
    expect(screen.queryByText(/on 3 March/)).not.toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    renderView(question, false, { signal: host.signal });
    await user.click(await screen.findByRole('button', { name: 'Ask ChartSearch' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops an automatic request on unmount even when the host’s signal is still live', async () => {
    const stream = streamingResponse();
    fetchMock.mockImplementation(stream.fetch);
    const host = new AbortController();
    const { unmount } = renderView(question, true, { signal: host.signal });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const { signal } = fetchMock.mock.calls[0][1];

    unmount();
    expect(host.signal.aborted).toBe(false);
    expect(signal.aborted).toBe(true);
  });

  it('logs nothing when ChartSearch fails, whatever the failure', async () => {
    const consoleSpies = (['log', 'info', 'debug', 'warn', 'error'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    try {
      const user = userEvent.setup();
      const stream = streamingResponse();
      fetchMock
        .mockResolvedValueOnce(stream.response)
        .mockResolvedValueOnce(streamingResponse({ status: 500 }).response)
        .mockRejectedValueOnce(new TypeError('Failed to fetch'));
      renderView();

      await user.click(await screen.findByRole('button', { name: 'Ask ChartSearch' }));
      await act(async () => stream.write(frame('error', "This patient's chart is too large to process.")));
      await act(async () => stream.end());
      expect(await screen.findByText('ChartSearch couldn’t answer this question.')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(await screen.findByText('ChartSearch couldn’t answer this question.')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('Unavailable right now')).toBeInTheDocument();

      consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    } finally {
      consoleSpies.forEach((spy) => spy.mockRestore());
    }
  });
});
