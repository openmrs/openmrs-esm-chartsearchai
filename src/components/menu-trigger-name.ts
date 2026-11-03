import { type RefObject, useLayoutEffect } from 'react';

/**
 * Carbon's MenuButton names its trigger with the visible label only, and forwards other props to
 * its wrapper rather than to the button. Give the trigger a name that also states what it selects
 * ("AI provider: Bundled (local)"), keeping the visible label inside it.
 */
export function useMenuTriggerName(containerRef: RefObject<HTMLDivElement | null>, name: string): void {
  useLayoutEffect(() => {
    containerRef.current?.querySelector('button')?.setAttribute('aria-label', name);
  });
}
