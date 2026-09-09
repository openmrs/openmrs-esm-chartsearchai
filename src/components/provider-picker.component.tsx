import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MenuButton, MenuItem, MenuItemDivider, MenuItemRadioGroup } from '@carbon/react';
import { useStore } from '@openmrs/esm-framework';
import { fetchProviders, type ProviderListResponse } from '../api/chartsearchai';
import { chatSessionStore } from '../store/chat-session.store';
import styles from './provider-picker.scss';

interface ProviderPickerProps {
  /** Called with the newly selected provider id when the user switches provider. */
  onSwitched?: (providerId: string) => void;
}

/**
 * Clinical-answer provider picker (bundled local inference vs. the med-agent-hub
 * relay). A single ready provider needs no picker. An unavailable saved selection
 * stays visible so the user can explicitly choose a replacement. Switching starts
 * a fresh conversation because the backend
 * attributes each conversation to a single provider, and it never silently falls
 * back to another provider.
 */
const ProviderPicker: React.FC<ProviderPickerProps> = ({ onSwitched }) => {
  const { t } = useTranslation();
  const { selectedProviderId } = useStore(chatSessionStore);
  const [data, setData] = useState<ProviderListResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchProviders(controller)
      .then((result) => setData(result))
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          setData(null);
        }
      });
    return () => controller.abort();
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
      chatSessionStore.setState({ selectedProviderId: providerId });
      onSwitched?.(providerId);
    },
    [effectiveProviderId, onSwitched],
  );

  if (!data || (!data.pickerVisible && providerReady)) {
    return null;
  }

  return (
    <div className={styles.root}>
      <div className={styles.triggerRow}>
        <MenuButton
          data-testid="chartsearchai-provider-picker"
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
