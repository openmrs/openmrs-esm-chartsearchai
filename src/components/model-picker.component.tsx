import React, { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MenuButton, MenuItemDivider, MenuItemRadioGroup } from '@carbon/react';
import { useConfig, useStore } from '@openmrs/esm-framework';
import { type ChartSearchAiConfig } from '../config-schema';
import { type HubProfileMetadata } from '../api/chartsearchai';
import { selectHubProfile, useHubProfileDiscovery } from '../hooks/hub-profile-discovery';
import { chatSessionStore } from '../store/chat-session.store';
import { useMenuTriggerName } from './menu-trigger-name';
import styles from './model-picker.scss';

interface ProfileSection {
  key: string;
  label: string;
  profiles: HubProfileMetadata[];
}

/**
 * Product-profile picker backed entirely by med-agent-hub metadata. It lists only the profiles the
 * Hub currently advertises as available; discovery and the decision whether a question may be sent
 * live in {@link useHubProfileDiscovery}, which the conversation hook also runs.
 */
const ModelPicker: React.FC = () => {
  const { t } = useTranslation();
  const { showModelPicker } = useConfig<ChartSearchAiConfig>();
  const { selectedProfileId, selectedProviderId, hubProfiles, profileDiscoveryStatus } = useStore(chatSessionStore);
  const triggerRef = useRef<HTMLDivElement>(null);
  useHubProfileDiscovery();

  const availableProfiles = useMemo(() => (hubProfiles ?? []).filter((profile) => profile.available), [hubProfiles]);
  const selectedProfile = useMemo(
    () => (hubProfiles ?? []).find((profile) => profile.id === selectedProfileId) ?? null,
    [hubProfiles, selectedProfileId],
  );
  const effectiveProfile = profileDiscoveryStatus === 'ready' && selectedProfile?.available ? selectedProfile : null;

  const sections = useMemo<ProfileSection[]>(() => {
    const definitions = [
      { key: 'single', label: t('singleProfiles', 'Single profiles') },
      { key: 'team', label: t('teamProfiles', 'Team profiles') },
    ];
    const known = definitions
      .map(({ key, label }) => ({
        key,
        label,
        profiles: availableProfiles.filter((profile) => profile.topology === key),
      }))
      .filter((section) => section.profiles.length > 0);
    const other = availableProfiles.filter((profile) => !definitions.some(({ key }) => key === profile.topology));
    return other.length > 0
      ? [...known, { key: 'other', label: t('otherProfiles', 'Other profiles'), profiles: other }]
      : known;
  }, [availableProfiles, t]);

  const unavailableSelectionLabel =
    profileDiscoveryStatus === 'selection-unavailable'
      ? `${selectedProfile?.label ?? selectedProfileId} (${t('unavailable', 'unavailable')})`
      : null;
  const triggerLabel =
    effectiveProfile?.label ?? unavailableSelectionLabel ?? t('chooseAiProfile', 'Choose AI profile');
  useMenuTriggerName(triggerRef, `${t('aiProfile', 'AI profile')}: ${triggerLabel}`);

  if (showModelPicker === false || selectedProviderId !== 'hub' || profileDiscoveryStatus === 'loading') {
    return null;
  }

  if (!hubProfiles || availableProfiles.length === 0) {
    return (
      <div className={styles.root} role="status">
        {t('profilesUnavailable', 'AI profiles unavailable')}
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.triggerRow}>
        <MenuButton
          ref={triggerRef}
          data-testid="chartsearchai-profile-picker"
          label={triggerLabel}
          kind="ghost"
          size="sm"
          menuAlignment="top-end"
        >
          {sections.map((section, index) => (
            <React.Fragment key={section.key}>
              {index > 0 ? <MenuItemDivider /> : null}
              {/* A visible heading only: the radio group below carries the same label for assistive technology. */}
              <li role="presentation" aria-hidden="true" className={styles.sectionHeader}>
                {section.label}
              </li>
              <MenuItemRadioGroup
                label={section.label}
                items={section.profiles.map((profile) => profile.id)}
                itemToString={(item) => {
                  const profile = section.profiles.find((candidate) => candidate.id === item);
                  if (!profile) return String(item ?? '');
                  return profile.default ? `${profile.label} ${t('defaultTag', '(default)')}` : profile.label;
                }}
                selectedItem={
                  section.profiles.some((profile) => profile.id === effectiveProfile?.id) ? effectiveProfile?.id : ''
                }
                onChange={(profileId) => selectHubProfile(profileId as string)}
              />
            </React.Fragment>
          ))}
        </MenuButton>
      </div>
    </div>
  );
};

export default ModelPicker;
