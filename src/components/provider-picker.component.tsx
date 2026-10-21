import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MenuButton, MenuItem, MenuItemDivider, MenuItemRadioGroup } from '@carbon/react';
import { useStore } from '@openmrs/esm-framework';
import { PROFILE_DISCOVERY_RETRY_MS } from '../hooks/hub-profile-discovery';
import { fetchProviders, type ProviderListResponse } from '../api/chartsearchai';
import { chatSessionStore } from '../store/chat-session.store';
import { useMenuTriggerName } from './menu-trigger-name';
import styles from './provider-picker.scss';

interface ProviderPickerProps {
  /** Request a provider change; the caller commits shared state after opening its conversation. */
  onSelect?: (providerId: string) => void;
  disabled?: boolean;
}

/**
 * Clinical-answer provider picker (bundled local inference vs. the med-agent-hub
 * relay). A single ready provider needs no picker. An unavailable saved selection
 * stays visible so the user can explicitly choose a replacement. The caller starts
 * a fresh conversation through onSelect because the backend attributes each
 * conversation to a single provider and never silently falls back.
 */
const ProviderPicker: React.FC<ProviderPickerProps> = ({ onSelect, disabled = false }) => {
  const { t } = useTranslation();
  const { selectedProviderId } = useStore(chatSessionStore);
  const [data, setData] = useState<ProviderListResponse | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | null = null;
    const discover = () => {
      fetchProviders(controller)
        .then((result) => {
          if (controller.signal.aborted) return;
          setData(result);
          const providers = Array.isArray(result?.providers) ? result.providers : [];
          // Configuration, not a user's state, so it outlives logout like the list itself.
          chatSessionStore.setState({
            providerCapabilities: Object.fromEntries(
              providers.map((provider) => [
                provider.id,
                Array.isArray(provider.capabilities) ? provider.capabilities : [],
              ]),
            ),
          });
          // An enabled provider that is not ready yet can recover; read again so it can be chosen
          // without a remount. A disabled one is configuration and stays as reported.
          if (providers.some((provider) => provider.enabled && !provider.ready)) {
            retry = setTimeout(discover, PROFILE_DISCOVERY_RETRY_MS);
          }
        })
        .catch((error) => {
          if (controller.signal.aborted || error?.name === 'AbortError') return;
          // A failed read hides the picker; read again rather than leave it hidden until a remount.
          setData(null);
          retry = setTimeout(discover, PROFILE_DISCOVERY_RETRY_MS);
        });
    };
    discover();
    return () => {
      controller.abort();
      if (retry) clearTimeout(retry);
    };
  }, []);

  const providers = useMemo(() => (Array.isArray(data?.providers) ? data.providers : []), [data]);
  const availableProviders = useMemo(
    () => providers.filter((provider) => provider.enabled && provider.ready),
    [providers],
  );
  const unavailableProviders = useMemo(
    () => providers.filter((provider) => !(provider.enabled && provider.ready)),
    [providers],
  );

  // Availability never changes the provider bound to an existing conversation.
  const effectiveProviderId = selectedProviderId ?? data?.defaultProvider ?? null;

  const effectiveProvider = useMemo(
    () => providers.find((provider) => provider.id === effectiveProviderId) ?? null,
    [providers, effectiveProviderId],
  );
  const providerReady = Boolean(effectiveProvider?.enabled && effectiveProvider.ready);
  const providerLabel = effectiveProvider?.label ?? effectiveProviderId ?? t('providers', 'Providers');
  const triggerLabel = providerReady ? providerLabel : `${providerLabel} (${t('unavailable', 'unavailable')})`;
  useMenuTriggerName(triggerRef, `${t('aiProvider', 'AI provider')}: ${triggerLabel}`);

  // Make the backend-advertised default explicit in shared state so provider-specific controls
  // know which contract applies. This does not start a new conversation: it records the provider
  // the backend would select anyway.
  useEffect(() => {
    if (effectiveProviderId && selectedProviderId === null) {
      chatSessionStore.setState({ selectedProviderId: effectiveProviderId });
    }
  }, [effectiveProviderId, selectedProviderId]);

  const handleSelect = useCallback(
    (providerId: string) => {
      if (providerId === effectiveProviderId) {
        return;
      }
      if (onSelect) {
        onSelect(providerId);
      } else {
        chatSessionStore.setState({ selectedProviderId: providerId });
      }
    },
    [effectiveProviderId, onSelect],
  );

  if (!data || (!data.pickerVisible && providerReady)) {
    return null;
  }

  return (
    <div className={styles.root}>
      <div className={styles.triggerRow}>
        <MenuButton
          ref={triggerRef}
          data-testid="chartsearchai-provider-picker"
          disabled={disabled}
          label={triggerLabel}
          kind="ghost"
          size="sm"
          menuAlignment="top-end"
        >
          <MenuItemRadioGroup
            label={t('providers', 'Providers')}
            items={availableProviders.map((provider) => provider.id)}
            itemToString={(item) => {
              const provider = availableProviders.find((candidate) => candidate.id === item);
              if (!provider) return String(item ?? '');
              return provider.default ? `${provider.label} ${t('defaultTag', '(default)')}` : provider.label;
            }}
            selectedItem={
              availableProviders.some((provider) => provider.id === effectiveProviderId) ? effectiveProviderId : ''
            }
            onChange={(providerId) => handleSelect(providerId as string)}
          />
          {unavailableProviders.length > 0 ? <MenuItemDivider /> : null}
          {unavailableProviders.map((provider) => (
            <MenuItem key={provider.id} label={`${provider.label} (${t('unavailable', 'unavailable')})`} disabled />
          ))}
        </MenuButton>
      </div>
    </div>
  );
};

export default ProviderPicker;
