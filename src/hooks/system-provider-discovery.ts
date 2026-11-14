import { useEffect, useSyncExternalStore } from 'react';
import { fetchProviders } from '../api/chartsearchai';
import { chatSessionStore } from '../store/chat-session.store';
import { PROFILE_DISCOVERY_RETRY_MS } from './hub-profile-discovery';

export interface SystemProviderSnapshot {
  status: 'loading' | 'ready' | 'unavailable' | 'error';
  providerId: string | null;
  label: string | null;
  unavailableReason: string | null;
}

const INITIAL_SNAPSHOT: SystemProviderSnapshot = {
  status: 'loading',
  providerId: null,
  label: null,
  unavailableReason: null,
};

let inFlight: { controller: AbortController; promise: Promise<void> } | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let consumers = 0;
let snapshot: SystemProviderSnapshot = INITIAL_SNAPSHOT;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

function setSnapshot(next: SystemProviderSnapshot): void {
  snapshot = next;
  notify();
}

function clearRetry(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleRetry(): void {
  if (consumers === 0 || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    refreshSystemProvider();
  }, PROFILE_DISCOVERY_RETRY_MS);
}

/** Abort any in-flight `/providers` read and reset shared discovery state. */
export function stopSystemProviderDiscovery(): void {
  clearRetry();
  inFlight?.controller.abort();
  inFlight = null;
  snapshot = INITIAL_SNAPSHOT;
}

/**
 * Read `/providers` to discover the deployment's single active clinical-answer provider, cache its
 * declared capabilities in {@link chatSessionStore}, and publish its readiness for Chat and Omnibar.
 */
export function refreshSystemProvider(): Promise<void> {
  if (inFlight) return inFlight.promise;
  clearRetry();
  const controller = new AbortController();
  const promise = fetchProviders(controller)
    .then((result) => {
      if (controller.signal.aborted) return;
      const providers = Array.isArray(result?.providers) ? result.providers : [];
      const active = providers.find((provider) => provider.id === result?.defaultProvider) ?? providers[0] ?? null;
      const providerId = active?.id ?? result?.defaultProvider ?? null;
      const ready = Boolean(active?.enabled && active?.ready);

      const storeState = chatSessionStore.getState();
      chatSessionStore.setState({
        providerCapabilities: Object.fromEntries(
          providers.map((provider) => [provider.id, Array.isArray(provider.capabilities) ? provider.capabilities : []]),
        ),
        ...(providerId && storeState.selectedProviderId !== providerId ? { selectedProviderId: providerId } : {}),
      });

      setSnapshot({
        status: ready ? 'ready' : 'unavailable',
        providerId,
        label: active?.label ?? providerId,
        unavailableReason: ready ? null : (active?.unavailableReason ?? null),
      });

      if (!ready && (!active || active.enabled)) {
        scheduleRetry();
      }
    })
    .catch((error) => {
      if (controller.signal.aborted || error?.name === 'AbortError') return;
      setSnapshot({
        status: 'error',
        providerId: chatSessionStore.getState().selectedProviderId,
        label: null,
        unavailableReason: null,
      });
      scheduleRetry();
    })
    .finally(() => {
      if (inFlight?.controller === controller) {
        inFlight = null;
      }
    });
  inFlight = { controller, promise };
  return promise;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): SystemProviderSnapshot {
  return snapshot;
}

/**
 * Subscribe to the deployment's single active system provider. Triggers discovery on first mount
 * across Chat and Query Results consumers and stops background retries when the last unmounts.
 */
export function useSystemProviderDiscovery(): SystemProviderSnapshot {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    consumers += 1;
    refreshSystemProvider();
    return () => {
      consumers -= 1;
      if (consumers === 0) {
        stopSystemProviderDiscovery();
      }
    };
  }, []);

  return current;
}
