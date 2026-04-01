const HIGHLIGHT_CLASS = 'chartsearchai-highlight';
const HIGHLIGHT_DURATION_MS = 3000;
const OBSERVER_TIMEOUT_MS = 5000;
const NAVIGATION_SETTLE_MS = 300;

let stylesInjected = false;
let activeObserver: MutationObserver | null = null;
let activeTimers: ReturnType<typeof setTimeout>[] = [];

function injectHighlightStyles(): void {
  if (stylesInjected) return;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes chartsearchai-highlight-fade {
      0% { background-color: rgba(255, 213, 79, 0.6); }
      70% { background-color: rgba(255, 213, 79, 0.3); }
      100% { background-color: transparent; }
    }
    .${HIGHLIGHT_CLASS} {
      animation: chartsearchai-highlight-fade ${HIGHLIGHT_DURATION_MS}ms ease-out forwards;
      outline: 2px solid rgba(255, 213, 79, 0.8);
      outline-offset: -2px;
      border-radius: 2px;
    }
  `;
  document.head.appendChild(style);
  stylesInjected = true;
}

function cleanup(): void {
  if (activeObserver) {
    activeObserver.disconnect();
    activeObserver = null;
  }
  for (const id of activeTimers) {
    clearTimeout(id);
  }
  activeTimers = [];

  // Remove highlight from any previously highlighted element
  const prev = document.querySelector(`.${HIGHLIGHT_CLASS}`);
  if (prev) {
    prev.classList.remove(HIGHLIGHT_CLASS);
  }
}

function highlightElement(element: HTMLElement): void {
  // Remove any existing highlight first
  const prev = document.querySelector(`.${HIGHLIGHT_CLASS}`);
  if (prev) {
    prev.classList.remove(HIGHLIGHT_CLASS);
  }

  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  element.classList.add(HIGHLIGHT_CLASS);
  const timerId = setTimeout(() => {
    element.classList.remove(HIGHLIGHT_CLASS);
  }, HIGHLIGHT_DURATION_MS);
  activeTimers.push(timerId);
}

/**
 * Try to find a DOM element matching the reference, scoped to the main
 * chart content area to avoid matching elements in sidebars or headers.
 *
 * Strategy 1: Match by resource ID against Carbon DataTable row IDs.
 * Some widgets use the resource ID as the DataTable row `id`.
 *
 * Strategy 2: Fall back to searching for a table row containing the date string.
 */
function findElement(resourceId: number | string, date: string): HTMLElement | null {
  const contentArea = document.querySelector('.omrs-main-content') ?? document;
  const idStr = String(resourceId);

  // Strategy 1: Find by resource ID in element attributes
  const byId = contentArea.querySelector<HTMLElement>(`tr[id*="${CSS.escape(idStr)}"]`);
  if (byId) return byId;

  const byDataAttr = contentArea.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(idStr)}"]`);
  if (byDataAttr) return byDataAttr;

  // Strategy 2: Find table row containing the date text
  if (date) {
    const rows = contentArea.querySelectorAll<HTMLElement>('tr');
    for (const row of rows) {
      if (row.textContent?.includes(date)) {
        return row;
      }
    }
  }

  return null;
}

/**
 * After navigating to a chart page, attempts to find and highlight the
 * specific data point referenced by the AI citation.
 *
 * Waits for the SPA navigation to settle before searching, then uses a
 * MutationObserver to handle lazy-loaded content.
 */
export function highlightReference(resourceId: number | string, date: string): void {
  injectHighlightStyles();
  cleanup();

  // Wait for the SPA navigation to render the new page before searching.
  // Searching immediately would match elements on the OLD page.
  const settleTimer = setTimeout(() => {
    const element = findElement(resourceId, date);
    if (element) {
      highlightElement(element);
      return;
    }

    // Content may still be loading — watch for DOM changes
    const observer = new MutationObserver(() => {
      const el = findElement(resourceId, date);
      if (el) {
        observer.disconnect();
        activeObserver = null;
        highlightElement(el);
      }
    });

    activeObserver = observer;
    observer.observe(document.body, { childList: true, subtree: true });

    const timeoutTimer = setTimeout(() => {
      observer.disconnect();
      if (activeObserver === observer) {
        activeObserver = null;
      }
    }, OBSERVER_TIMEOUT_MS);
    activeTimers.push(timeoutTimer);
  }, NAVIGATION_SETTLE_MS);
  activeTimers.push(settleTimer);
}
