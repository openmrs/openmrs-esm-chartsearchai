import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MenuButton, MenuItem, MenuItemDivider, MenuItemRadioGroup } from '@carbon/react';
import { useConfig, useStore } from '@openmrs/esm-framework';
import { type ChartSearchAiConfig } from '../config-schema';
import { fetchEndpoints, type EndpointListResponse, type EndpointSection } from '../api/chartsearchai';
import { chatSessionStore } from '../store/chat-session.store';
import styles from './model-picker.scss';

/**
 * Curated picker contents — the published validation arms only, in two plain-language groups.
 * Models are matched by id (env-agnostic) against whatever endpoint /endpoints reports serving
 * them, so this works locally and on the cloud regardless of the registered endpoint URLs.
 * Anything not listed (team-internal component models like qwen/medgemma/gemma-31b, quant
 * variants, the LM Studio MLX line) is intentionally hidden from the chat picker.
 */
const CURATED_GROUPS: Array<{ label: string; items: Array<{ id: string; label: string }> }> = [
  {
    label: 'AI Team',
    items: [
      { id: 'med-agent-team-high-validated', label: 'High (validated)' },
      { id: 'med-agent-team-med-validated', label: 'Med (validated)' },
      { id: 'med-agent-team-low-validated-12b', label: 'Low (validated)' },
      { id: 'med-agent-team-parity', label: 'Parity' },
    ],
  },
  {
    label: 'Single models',
    items: [
      { id: 'gemma-e2b', label: 'Gemma 2B' },
      { id: 'gemma-e4b', label: 'Gemma 4B' },
      { id: 'gemma-4-12b', label: 'Gemma 12B' },
      { id: 'gemma-26b', label: 'Gemma 26B' },
      { id: 'medgemma-1.5-4b', label: 'MedGemma 1.5 (4B)' },
      { id: 'medgemma-27b', label: 'MedGemma 27B' },
      { id: 'qwen2.5-14b', label: 'Qwen 2.5 14B' },
      { id: 'qwen2.5-32b', label: 'Qwen 2.5 32B' },
    ],
  },
];

interface ModelPickerProps {
  /** Called when the selection changes — lets the parent react if needed. */
  onSwitched?: (modelName: string) => void;
}

/**
 * Inline endpoint+model picker for the chat panel footer. Renders one section
 * per configured endpoint (e.g. LM Studio, Med Agent Hub), each listing the
 * models that endpoint serves. Selecting a model under a section switches
 * chartsearchai to that endpoint AND model in one step (the backend writes both
 * the endpointUrl + modelName global properties).
 * Inline model picker for the chat panel footer. A Carbon MenuButton whose menu
 * is a MenuItemRadioGroup — single-select radio semantics with a group header.
 * Carbon renders the menu in a portal on document.body and clamps it to the
 * viewport, so it is never clipped by the chat panel's overflow regardless of
 * panel height.
 * Inline endpoint+model picker for the chat panel footer. A Carbon MenuButton
 * whose menu has one MenuItemRadioGroup per configured endpoint (LM Studio, Med
 * Agent Hub, ...). Selecting a model picks the backend for THIS browser session
 * only: it is sent as a per-request override on each chat post and does NOT mutate
 * chartsearchai's config-controlled global default (which is shown with a faded
 * "(default)" tag). Carbon portals the menu to document.body so it is never clipped
 * by the panel's overflow.
 *
 * Hides itself when: config.showModelPicker is false; the /endpoints fetch fails;
 * or there are fewer than 2 selectable models across all reachable endpoints.
 */
const ModelPicker: React.FC<ModelPickerProps> = ({ onSwitched }) => {
  const { t } = useTranslation();
  const { showModelPicker } = useConfig<ChartSearchAiConfig>();
  const [data, setData] = useState<EndpointListResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  // The per-session selection (sent as the per-request override). null = use the
  // config-controlled global default. Consume the whole store state (matching the
  // chat hook) rather than a selector — the selection re-renders this in place.
  const { selectedBackend } = useStore(chatSessionStore);

  // Load on mount + whenever the popover opens — picks up out-of-band changes
  // (operator ran chartsearch-configure, another endpoint came up, etc.).
  const load = useCallback((signal?: AbortSignal) => {
  // Load once on mount. The chat panel unmounts/remounts this component each
  // time it opens, so an out-of-band change (operator ran chartsearch-configure,
  // Load once on mount. The chat panel unmounts/remounts this component each time
  // it opens, so an out-of-band change (operator ran chartsearch-configure,
  // another endpoint came up) is picked up the next time the panel is opened.
  useEffect(() => {
    const ctrl = new AbortController();
    if (signal) {
      signal.addEventListener('abort', () => ctrl.abort());
    }
    fetchEndpoints(ctrl)
      .then((d) => {
        setData(d);
    fetchAvailableModels(ctrl)
      .then((data) => {
        setSnapshot(data);
    fetchEndpoints(ctrl)
      .then((d) => {
        setData(d);
        setLoadError(null);
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setLoadError(err?.message ?? 'Failed to load endpoints');
        setData(null);
      });
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    const ctrl = load();
    return () => ctrl.abort();
  }, [load]);
  // The config-controlled global default (immutable here — gets the "(default)" tag).
  const defaultBackend = data?.current;
  // What the chat will actually use: the per-session selection, else the default.
  // Memoised so it's referentially stable across renders (it feeds the `sections`
  // useMemo deps); the whole-store subscription re-renders this on every store change.
  const effective = useMemo(
    () =>
      selectedBackend ??
      (defaultBackend && defaultBackend.endpointUrl && defaultBackend.modelName
        ? { endpointUrl: defaultBackend.endpointUrl, modelName: defaultBackend.modelName }
        : null),
    [selectedBackend, defaultBackend],
  );

  useEffect(() => {
    if (!isOpen) return;
    const ctrl = load();
    return () => ctrl.abort();
  }, [isOpen, load]);

  // Outside-click closes the popover.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const current = data?.current;
  const current = data?.current;
  // Selecting a model writes the per-session selection — it does NOT call the
  // global-switch endpoint, so the config default is never mutated.
  const handleSelect = useCallback(
    async (url: string, modelId: string) => {
      if (pending) return;
      if (current && current.endpointUrl === url && current.modelName === modelId) {
        setIsOpen(false);
        return;
      }
      setPending(`${url}::${modelId}`);
    async (url: string, modelId: string) => {
      if (pending) return;
      if (current && current.endpointUrl === url && current.modelName === modelId) return;
      setPending(`${url}::${modelId}`);
      setSwitchError(null);
      // Optimistic flip — reflects the new selection immediately.
      setData((prev) => (prev ? { ...prev, current: { endpointUrl: url, modelName: modelId } } : prev));
      // Optimistic flip — trigger label reflects the new selection immediately.
      setData((prev) => (prev ? { ...prev, current: { endpointUrl: url, modelName: modelId } } : prev));
      try {
        const result = await setEndpointModel(url, modelId);
        setData((prev) =>
          prev ? { ...prev, current: { endpointUrl: result.endpointUrl, modelName: result.current } } : prev,
        );
        // Pre-load on select: when the target model isn't loaded yet and the
        // backend probed an LM Studio v1 provider, ask LM Studio to load it
        // BEFORE flipping the GP — the user pays the load latency at pick-time
        // (with a visible spinner) rather than on first chat turn.
        const targetEntry = snapshot.entries?.find((e) => e.id === modelName);
        const isLmStudio = snapshot.provider === 'lm-studio';
        if (isLmStudio && targetEntry && targetEntry.loaded === false) {
          await loadModel(modelName);
        }
        const result = await setCurrentModel(modelName);
        setSnapshot((prev) => (prev ? { ...prev, current: result.current } : prev));
        const result = await setEndpointModel(url, modelId);
        setData((prev) =>
          prev ? { ...prev, current: { endpointUrl: result.endpointUrl, modelName: result.current } } : prev,
        );
        onSwitched?.(result.current);
      } catch (err) {
        // Roll back the optimistic flip.
        setData((prev) => (prev ? { ...prev, current } : prev));
        // Surface the backend's real reason (it lives on responseBody.error).
        const { message, isResourceError } = extractApiError(err);
        const display = isResourceError
          ? t(
              'modelResourceError',
              'Not enough memory to load "{{model}}". Unload a model in LM Studio (or pick one already loaded), then try again.',
              { model: modelId },
            )
          : message || t('modelSwitchFailed', 'Failed to switch model');
        setSwitchError(display);
      } finally {
        setPending(null);
      }
    (url: string, modelId: string) => {
      chatSessionStore.setState({ selectedBackend: { endpointUrl: url, modelName: modelId } });
      onSwitched?.(modelId);
    },
    [onSwitched],
  );

  // Hide conditions — cheapest first.
  // Build a unified entry list so the same render handles both legacy
  // (available: string[]) and enriched (entries with loaded state, displayName)
  // backend response shapes. Memoised so the radio group's items/itemToString
  // stay referentially stable between renders.
  const { itemIds, itemToString, groupLabel } = useMemo(() => {
    const isLmStudio = snapshot?.provider === 'lm-studio';
    const entries: ModelEntry[] =
      snapshot?.entries && snapshot.entries.length > 0
        ? snapshot.entries
        : (snapshot?.available ?? []).map((id) => ({ id, displayName: id, type: 'llm', loaded: false }));
    const byId = new Map(entries.map((e) => [e.id, e]));
    return {
      itemIds: entries.map((e) => e.id),
      // MenuItem renders its label as plain text, so the "(not loaded)" affix is
      // folded into the string rather than carried as a styled node. Carbon types
      // the radio group's item as `unknown` (the generic is erased by forwardRef),
      // so the param is widened and narrowed back to the id string here.
      itemToString: (item: unknown) => {
        const id = item as string;
        const e = byId.get(id);
        if (!e) return id;
        return isLmStudio && e.loaded === false ? `${e.displayName} ${t('notLoaded', '(not loaded)')}` : e.displayName;
      },
      groupLabel: isLmStudio ? t('lmStudioGroup', 'LM Studio') : t('models', 'Models'),
    };
  }, [snapshot, t]);
  // One radio group per reachable endpoint. Memoised so the groups' items /
  // itemToString stay referentially stable between renders.
  // One radio group per CURATED category (AI Team / Single models), listing only the
  // validation-arm models — located by id across whatever endpoints /endpoints reports, so
  // unlisted team-internal/quant/LM-Studio models never appear. Memoised for referential
  // stability across renders.
  const sections = useMemo(() => {
    const endpoints = (data?.endpoints ?? []).filter((ep) => ep.reachable);
    const locate = (id: string): EndpointSection | undefined =>
      endpoints.find((ep) => ep.models.some((m) => m.id === id));
    return CURATED_GROUPS.map((group) => {
      const found = group.items
        .map((it) => ({ it, ep: locate(it.id) }))
        .filter((x): x is { it: { id: string; label: string }; ep: EndpointSection } => Boolean(x.ep));
      if (found.length === 0) {
        return null;
      }
      const urlById = new Map(found.map((x) => [x.it.id, x.ep.url]));
      const labelById = new Map(found.map((x) => [x.it.id, x.it.label]));
      // Only the effective selection's group carries a checked radio.
      const selectedItem =
        effective &&
        found.some((x) => x.ep.url === effective.endpointUrl && x.it.id === effective.modelName)
          ? effective.modelName
          : '';
      return {
        label: group.label,
        itemIds: found.map((x) => x.it.id),
        urlById,
        selectedItem,
        itemToString: (item: unknown) => {
          const id = item as string;
          let label = labelById.get(id) ?? id;
          // Faded tag on the config-controlled global default.
          if (defaultBackend && defaultBackend.endpointUrl === urlById.get(id) && defaultBackend.modelName === id) {
            label = `${label} ${t('defaultTag', '(default)')}`;
          }
          return label;
        },
      };
    }).filter((s): s is NonNullable<typeof s> => s !== null);
  }, [data, effective, defaultBackend, t]);

  // Hide conditions — cheapest first.
  if (showModelPicker === false) {
    return null;
  }
  if (loadError) {
    return null;
  }
  if (!data) {
  if (!data) {
    // Initial load — render nothing rather than a layout-shifting spinner.
    return null;
  }
  const endpoints = data.endpoints ?? [];
  const totalModels = endpoints.reduce((n, e) => n + (e.reachable ? e.models.length : 0), 0);
  if (totalModels < 2) {
  const totalModels = sections.reduce((n, s) => n + s.itemIds.length, 0);
  if (totalModels < 2) {
    return null;
  }

  // Trigger label: "<endpoint> · <model>" for the effective selection.
  let triggerLabel = t('noModel', 'No model');
  if (current) {
    const sec = endpoints.find((e) => e.url === current.endpointUrl);
    const mod = sec?.models.find((m) => m.id === current.modelName);
    if (sec && mod) {
      triggerLabel = `${sec.label} · ${mod.displayName}`;
    } else if (current.modelName) {
      triggerLabel = current.modelName;
    }
  }
  const current = snapshot.current ?? '';
  // Trigger label: "<endpoint> · <model>" for the current selection.
  let triggerLabel = t('noModel', 'No model');
  if (current) {
    const ep = (data.endpoints ?? []).find((e) => e.url === current.endpointUrl);
    const m = ep?.models.find((x) => x.id === current.modelName);
    if (ep && m) {
      triggerLabel = `${ep.label} · ${m.displayName}`;
    } else if (current.modelName) {
      triggerLabel = current.modelName;
    }
  if (effective) {
    const group = CURATED_GROUPS.find((g) => g.items.some((it) => it.id === effective.modelName));
    const item = group?.items.find((it) => it.id === effective.modelName);
    triggerLabel = group && item ? `${group.label} · ${item.label}` : effective.modelName;
  }
  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={t('selectModel', 'Select model')}
        title={t('selectModel', 'Select model')}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className={styles.triggerLabel}>{triggerLabel}</span>
        {pending ? <InlineLoading className={styles.triggerLoading} description="" /> : <ChevronDown size={16} />}
      </button>
      {isOpen && (
        <ul className={styles.menu} role="listbox" aria-label={t('selectModel', 'Select model')}>
          {endpoints.map((ep) => {
            // "(not loaded)" is only meaningful where the backend probes load
            // state (LM Studio). Generic endpoints (the agent team) don't have it.
            const showLoaded = ep.provider === 'lm-studio';
            return (
              <React.Fragment key={ep.url}>
                <li className={styles.groupHeader} role="presentation">
                  {ep.label}
                  {!ep.reachable ? ` ${t('endpointUnreachable', '(unreachable)')}` : null}
                </li>
                {ep.reachable
                  ? ep.models.map((m) => {
                      const selected =
                        !!current && current.endpointUrl === ep.url && current.modelName === m.id;
                      const notLoadedAffix =
                        showLoaded && m.loaded === false ? t('notLoaded', '(not loaded)') : null;
                      return (
                        <li key={`${ep.url}::${m.id}`} role="option" aria-selected={selected}>
                          <button
                            type="button"
                            className={`${styles.menuItem} ${selected ? styles.menuItemSelected : ''}`}
                            onClick={() => handleSelect(ep.url, m.id)}
                            disabled={!!pending}
                            aria-label={notLoadedAffix ? `${m.displayName} ${notLoadedAffix}` : m.displayName}
                          >
                            <span className={styles.menuItemMain}>
                              <span className={styles.menuItemLabel}>{m.displayName}</span>
                              {notLoadedAffix ? <span className={styles.menuItemAffix}>{notLoadedAffix}</span> : null}
                            </span>
                            {selected ? <Checkmark size={16} /> : null}
                          </button>
                        </li>
                      );
                    })
                  : null}
              </React.Fragment>
            );
          })}
        </ul>
      )}
    <div className={styles.root}>
      <div className={styles.triggerRow}>
        <MenuButton label={triggerLabel} kind="ghost" size="sm" menuAlignment="top-end">
          {sections.map((s, i) => (
            <React.Fragment key={s.label}>
              {i > 0 ? <MenuItemDivider /> : null}
              {/* Carbon group labels are aria-only; a disabled MenuItem gives a
                  VISIBLE section header above the endpoint's models. */}
              <MenuItem label={s.label} disabled className={styles.sectionHeader} />
              <MenuItemRadioGroup
                label={s.label}
                items={s.itemIds}
                itemToString={s.itemToString}
                selectedItem={s.selectedItem}
                onChange={(id) => handleSelect(s.urlById.get(id as string) ?? '', id as string)}
              />
            </React.Fragment>
          ))}
        </MenuButton>
      </div>
    </div>
  );
};

export default ModelPicker;
