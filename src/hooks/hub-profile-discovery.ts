import { useEffect } from 'react';
import { useConfig, useStore } from '@openmrs/esm-framework';
import { fetchProfiles, type HubProfileMetadata } from '../api/chartsearchai';
import { type ChartSearchAiConfig } from '../config-schema';
import { chatSessionStore, type ChatSessionState } from '../store/chat-session.store';

/** How long discovery waits before reading `/models` again after a failed read. */
export const PROFILE_DISCOVERY_RETRY_MS = 15_000;

let inFlight: { controller: AbortController; promise: Promise<void> } | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let consumers = 0;
let lastPreserveExplicit = true;

function clearRetry() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

/** While discovery is in use, read `/models` again after {@link PROFILE_DISCOVERY_RETRY_MS}. */
function scheduleRetry(): void {
  if (consumers === 0 || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    refreshHubProfiles();
  }, PROFILE_DISCOVERY_RETRY_MS);
}

/** Abort any discovery request and pending retry; a later refresh starts afresh. */
export function stopHubProfileDiscovery(): void {
  clearRetry();
  inFlight?.controller.abort();
  inFlight = null;
}

/**
 * Which profile a chat request may use, from the Hub's own list. An available selection stays.
 * An explicit pick the Hub no longer offers stays selected and is reported as
 * `selection-unavailable`, so the user is asked to choose again rather than silently switched,
 * unless the picker is hidden: then the user cannot choose, and the Hub default takes over. When no
 * profile is available at all the pick stays and the status is `unavailable`, an outage.
 */
function resolveSelection(
  profiles: HubProfileMetadata[],
  preserveExplicit: boolean,
): Pick<ChatSessionState, 'selectedProfileId' | 'profileDiscoveryStatus'> {
  const { selectedProfileId, profileExplicitlySelected } = chatSessionStore.getState();
  const available = profiles.filter((profile) => profile.available);
  if (selectedProfileId && available.some((profile) => profile.id === selectedProfileId)) {
    return { selectedProfileId, profileDiscoveryStatus: 'ready' };
  }
  if (preserveExplicit && profileExplicitlySelected && selectedProfileId) {
    // With nothing available the Hub is down, not the pick gone: report it as an outage, which the
    // panel re-reads `/models` for, and keep the pick for when the Hub recovers.
    return {
      selectedProfileId,
      profileDiscoveryStatus: available.length > 0 ? 'selection-unavailable' : 'unavailable',
    };
  }
  const fallback = available.find((profile) => profile.default);
  return fallback
    ? { selectedProfileId: fallback.id, profileDiscoveryStatus: 'ready' }
    : { selectedProfileId: null, profileDiscoveryStatus: 'unavailable' };
}

/**
 * Read the Hub's product profiles through `/models` and record which one a chat request may use.
 * Concurrent calls share one request. The current list and status stay in place while a refresh
 * is in flight, including an earlier failure's `unavailable` during a retry. A failed read reports
 * the Hub as unreachable and, while discovery is in use, retries after
 * {@link PROFILE_DISCOVERY_RETRY_MS}.
 *
 * @param preserveExplicit keep an explicit pick the Hub no longer offers (the picker is shown)
 */
export function refreshHubProfiles(preserveExplicit: boolean = lastPreserveExplicit): Promise<void> {
  lastPreserveExplicit = preserveExplicit;
  if (inFlight) return inFlight.promise;
  clearRetry();
  const controller = new AbortController();
  const promise = fetchProfiles(controller)
    .then((result) => {
      if (controller.signal.aborted) return;
      const profiles = (Array.isArray(result?.data) ? result.data : []).filter(
        (profile) => profile.visibility === 'product',
      );
      const selection = resolveSelection(profiles, lastPreserveExplicit);
      chatSessionStore.setState({ hubProfiles: profiles, ...selection });
      // A read that found no profile available is an outage too: read again until one is.
      if (selection.profileDiscoveryStatus === 'unavailable') scheduleRetry();
    })
    .catch((error) => {
      if (controller.signal.aborted || error?.name === 'AbortError') return;
      chatSessionStore.setState({ hubProfiles: null, profileDiscoveryStatus: 'unavailable' });
      scheduleRetry();
    })
    .finally(() => {
      if (inFlight?.controller === controller) inFlight = null;
    });
  inFlight = { controller, promise };
  return promise;
}

/** Record the user's explicit pick from the profiles the Hub currently advertises as available. */
export function selectHubProfile(profileId: string): void {
  chatSessionStore.setState({
    selectedProfileId: profileId,
    profileExplicitlySelected: true,
    profileDiscoveryStatus: 'ready',
  });
}

/**
 * Keep Hub profile discovery running while the Hub is the selected provider. Both the profile
 * picker and the conversation hook use this, so whether a question may be sent never depends on
 * the picker being mounted. Switching to another provider, or the last user unmounting, stops
 * discovery and its retries.
 */
export function useHubProfileDiscovery(): void {
  const { showModelPicker } = useConfig<ChartSearchAiConfig>();
  const { selectedProviderId } = useStore(chatSessionStore);
  const isHub = selectedProviderId === 'hub';
  const preserveExplicit = showModelPicker !== false;

  useEffect(() => {
    if (!isHub) return;
    consumers += 1;
    refreshHubProfiles(preserveExplicit);
    return () => {
      consumers -= 1;
      if (consumers === 0 || chatSessionStore.getState().selectedProviderId !== 'hub') {
        stopHubProfileDiscovery();
      }
    };
  }, [isHub, preserveExplicit]);
}
