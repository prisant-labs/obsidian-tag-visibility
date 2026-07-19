import { Plugin } from 'obsidian';
import {
  DEFAULT_SETTINGS,
  Rule,
  SCHEMA_VERSION,
  TableColumnPrefs,
  TableSurface,
  TagCuratorSettings,
  TagOverride,
} from '../types';

// Per-surface column defaults (item 3): the pane opens lean (tag/count/visibility
// only), the settings tab shows every column.
const PANE_DEFAULT_COLS: TableColumnPrefs = { lastSeen: false, source: false, rule: false };
const SETTINGS_DEFAULT_COLS: TableColumnPrefs = { lastSeen: true, source: true, rule: true };

/** Fallback default for a surface that has no stored prefs yet. */
function defaultColsFor(surface: TableSurface): TableColumnPrefs {
  return surface === 'pane' ? { ...PANE_DEFAULT_COLS } : { ...SETTINGS_DEFAULT_COLS };
}

/**
 * True when v is a plain object: the only shape a valid data.json can parse to.
 * An array or a bare primitive is present-but-not-settings and must take the
 * non-destructive unreadable path, not the first-run path (B-01).
 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** True when v is a flat {lastSeen, source, rule} column-prefs object. */
function isColumnPrefs(v: unknown): v is TableColumnPrefs {
  return (
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    typeof (v as TableColumnPrefs).lastSeen === 'boolean'
  );
}

/**
 * Normalize any stored tableColumns value to the per-surface shape. A flat v7
 * value predates per-surface prefs, so it is honored for the settings tab (where
 * it was set) and the pane takes its lean default; a malformed/missing value
 * falls back to each surface's default.
 */
function normalizeTableColumns(value: unknown): Record<TableSurface, TableColumnPrefs> {
  if (isColumnPrefs(value)) {
    return { pane: { ...PANE_DEFAULT_COLS }, settings: { ...value } };
  }
  const v = (value ?? {}) as { pane?: unknown; settings?: unknown };
  return {
    pane: isColumnPrefs(v.pane) ? { ...v.pane } : { ...PANE_DEFAULT_COLS },
    settings: isColumnPrefs(v.settings) ? { ...v.settings } : { ...SETTINGS_DEFAULT_COLS },
  };
}

type LegacyV0Settings = Partial<TagCuratorSettings> & {
  rules?: Rule[];
  enabledRules?: string[];
  tagMetadata?: unknown;
  // Pre-v2 name for previewMode. Carried so the v1 -> v2 migration can map it.
  dryRun?: boolean;
};

// Keys that only existed in the v0 (pre-schema) data.json shape. migrate()
// consumes them for a genuine v0 file and strips them from its result so they
// are never persisted; load() rewrites a file that still carries one, healing
// files an earlier build persisted with the keys aboard (DA-01).
const LEGACY_V0_KEYS = ['rules', 'enabledRules', 'dryRun', 'tagMetadata'] as const;

/**
 * Reason the settings manager is in read-only mode this session.
 *
 *   'future-schema' - data.json was written by a newer plugin version; persisting
 *                     the older shape would downgrade schemaVersion (P2-08, B-03).
 *   'unreadable'    - data.json exists but could not be parsed; persisting would
 *                     overwrite a recoverable file with defaults (B-01).
 *
 * Re-evaluated to null on every load()/reload() so repairing the file restores
 * normal persistence.
 */
export type ReadOnlyReason = 'future-schema' | 'unreadable';

export class SettingsManager {
  private plugin: Plugin;
  private settings: TagCuratorSettings = { ...DEFAULT_SETTINGS };
  private listeners: Array<() => void> = [];
  // Health state: non-null when the plugin is in read-only degraded mode.
  // Re-evaluated (reset to null) on every load()/reload() so that repairing
  // the file and reloading restores normal persistence (B-01 AC-6).
  private readOnlyReason: ReadOnlyReason | null = null;
  // Session-lived set of reasons for which the user has already been notified.
  // Never cleared by load(), so repeated reloads in the same state do not
  // re-show the Notice (B-03 AC-1). A new or different reason notifies once.
  private notifiedReasons = new Set<ReadOnlyReason>();
  // The schemaVersion read from disk this load (before migration). Used to detect
  // the one-time upgrade across the v10 boundary, where reviewed state moved into
  // durable settings - see shouldLiftLegacyReviewed. Re-evaluated every load.
  private incomingVersion = SCHEMA_VERSION;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  async load(): Promise<void> {
    // Reset health state on each load so repairing the file and reloading
    // restores normal persistence (B-01 AC-6).
    this.readOnlyReason = null;

    // loadData outcomes:
    //   null         -> file absent (genuine first run): migrate + persist (AC-5).
    //   plain object -> parse it; if future schema, enter read-only mode (P2-08).
    //   anything else -> present but not readable as settings: never write to disk
    //                   this session so we cannot clobber a recoverable file with
    //                   defaults (B-01).
    //
    // "anything else" is undefined (Obsidian 1.12.7 resolves undefined on a
    // JSON.parse failure and null on ENOENT), plus any value that parses but is
    // not a plain object. An array would otherwise read schemaVersion 0 and get
    // defaults persisted over it - the same harm through a different door - and a
    // bare primitive would throw from the `in` check below.
    //
    // Obsidian documents no contract for loadData on a corrupt file, so the
    // try/catch treats a rejected promise identically to undefined in case the
    // observed behavior changes (B-01 spec).
    let rawData: unknown;
    try {
      rawData = await this.plugin.loadData();
    } catch {
      rawData = undefined;
    }

    if (rawData !== null && !isPlainObject(rawData)) {
      // B-01: file present but unreadable. Run on in-memory defaults and
      // never write to disk, preserving the recoverable file.
      this.readOnlyReason = 'unreadable';
      this.settings = { ...DEFAULT_SETTINGS };
      this.incomingVersion = SCHEMA_VERSION;
      console.warn(
        '[tag-visibility] data.json could not be read. Running on defaults; ' +
          'changes will NOT be saved until the file is restored or removed.',
      );
      return;
    }

    const raw = ((rawData ?? {}) as LegacyV0Settings);
    const incomingVersion = raw.schemaVersion ?? 0;
    this.incomingVersion = incomingVersion;

    if (incomingVersion > SCHEMA_VERSION) {
      // Newer plugin wrote this vault. Run read-only so no write downgrades it;
      // warn once so a confused user/dev knows why settings will not save.
      this.readOnlyReason = 'future-schema';
      this.settings = this.migrate(raw);
      console.warn(
        `[tag-visibility] data.json is schema v${incomingVersion}, newer than this ` +
          `plugin (v${SCHEMA_VERSION}). Running read-only; setting changes will not be ` +
          `saved until the plugin is updated.`,
      );
      return;
    }

    this.settings = this.migrate(raw);
    // Persist when migrating UP, and also when the file still carries legacy
    // v0 keys: migrate() strips them, so one rewrite heals a file an earlier
    // build persisted with the keys aboard (DA-01). A current-version, clean
    // file needs no rewrite.
    const hasLegacyKeys = LEGACY_V0_KEYS.some((k) => k in raw);
    if (incomingVersion < SCHEMA_VERSION || hasLegacyKeys) {
      await this.persist();
    }
  }

  private migrate(raw: LegacyV0Settings): TagCuratorSettings {
    const inferred = raw.schemaVersion ?? 0;
    const nested = (raw as { settings?: Partial<TagCuratorSettings> }).settings;
    const base: Partial<TagCuratorSettings> = nested ?? raw;
    const merged: TagCuratorSettings = {
      ...DEFAULT_SETTINGS,
      ...base,
      // Never lower the recorded version: a future file keeps its own version in
      // memory so an accidental write could not silently downgrade it (persist()
      // also blocks writes for future files; this is belt and suspenders).
      schemaVersion: Math.max(inferred, SCHEMA_VERSION),
      // Honor the legacy v0 `rules` key ONLY for a genuine pre-v1 file. An
      // already-migrated file can still carry the stale key (earlier builds
      // persisted it); re-honoring it there would overwrite the user's current
      // customRules with the frozen v0 array on every load (DA-01).
      customRules:
        inferred < 1 && Array.isArray(raw.rules)
          ? raw.rules
          : Array.isArray(base.customRules)
            ? base.customRules
            : [],
    };
    if (inferred < 1) {
      const enabledIds = new Set(raw.enabledRules ?? []);
      merged.customRules = merged.customRules.map((r) => ({
        ...r,
        enabled: r.enabled ?? enabledIds.has(r.id),
      }));
    }
    if (inferred < 2) {
      // Renamed dryRun -> previewMode. Carry the old value forward verbatim.
      if (typeof raw.dryRun === 'boolean') {
        merged.previewMode = raw.dryRun;
      }
    }
    if (inferred < 3) {
      // Added seenWelcomeModal (D-008). Existing installs (BRAT testers) see the
      // modal once on next load - intentional, so they get the new contract framing.
      if (typeof merged.seenWelcomeModal !== 'boolean') {
        merged.seenWelcomeModal = false;
      }
    }
    if (inferred < 4) {
      // Added per-tag overrides (D-015). Default to an empty map; existing
      // installs have no pinned tags until the user creates them.
      if (!merged.overrides || typeof merged.overrides !== 'object' || Array.isArray(merged.overrides)) {
        merged.overrides = {};
      }
    }
    if (inferred < 5) {
      // Added per-scope enable + the one-time NN-too-old notice (Phase 5B). The
      // spread above already fills these from DEFAULT_SETTINGS when absent; this
      // guard only repairs a present-but-malformed value (e.g. an array written by
      // a hand-edited data.json), defaulting the four v1.0 scopes ON.
      if (
        !merged.scopeEnabled ||
        typeof merged.scopeEnabled !== 'object' ||
        Array.isArray(merged.scopeEnabled)
      ) {
        merged.scopeEnabled = { ...DEFAULT_SETTINGS.scopeEnabled };
      }
      if (typeof merged.seenNnTooOldNotice !== 'boolean') {
        merged.seenNnTooOldNotice = false;
      }
    }
    if (inferred < 6) {
      if (typeof merged.paneEnabled !== 'boolean') {
        merged.paneEnabled = true;
      }
    }
    if (inferred < 7) {
      // v7 first added persisted tag-table column prefs (a flat shape). The v8
      // step below normalizes it, so here we only ensure the field exists.
      if (
        !merged.tableColumns ||
        typeof merged.tableColumns !== 'object' ||
        Array.isArray(merged.tableColumns)
      ) {
        merged.tableColumns = normalizeTableColumns(undefined);
      }
    }
    if (inferred < 8) {
      // v8: column prefs are kept per surface (item 8a). Normalize the stored
      // value to the per-surface shape.
      merged.tableColumns = normalizeTableColumns(merged.tableColumns);
    }
    if (inferred < 9) {
      // v9: the pane now opens lean (item 3). Reset the pane's (one-release-old)
      // column prefs to the lean default on upgrade so existing testers get it;
      // the settings surface keeps its own columns.
      const tc = normalizeTableColumns(merged.tableColumns);
      merged.tableColumns = { pane: { ...PANE_DEFAULT_COLS }, settings: tc.settings };
    }
    if (inferred < 10) {
      // v10: reviewed state moved from the discardable tags.json sidecar to durable
      // settings (P2-09). The spread fills reviewedTags from DEFAULT when absent;
      // this guard repairs a malformed value. The one-time lift of existing sidecar
      // flags into this map happens in TagMetaManager.load() (it owns tags.json).
      if (
        !merged.reviewedTags ||
        typeof merged.reviewedTags !== 'object' ||
        Array.isArray(merged.reviewedTags)
      ) {
        merged.reviewedTags = {};
      }
    }
    // The `...base` spread above copies any legacy v0 keys into the result;
    // strip them so they never persist. A persisted `rules` key is what made
    // the once-ungated re-read destructive in the first place (DA-01).
    const scrubbed = merged as unknown as Record<string, unknown>;
    for (const key of LEGACY_V0_KEYS) delete scrubbed[key];
    return merged;
  }

  private async persist(notify = true): Promise<void> {
    // Skip the disk write when in read-only mode:
    //   'future-schema': persisting the older shape would downgrade schemaVersion
    //                    and corrupt fields a newer version reshaped.
    //   'unreadable':    persisting would overwrite a recoverable file with defaults.
    // Listeners STILL fire so the in-memory change reaches the observers/status bar
    // for this session; without this a toggle in read-only mode would mutate state
    // but never repaint, appearing dead.
    if (this.readOnlyReason === null) {
      await this.plugin.saveData(this.settings);
    }
    if (notify) this.notifyListeners();
  }

  private notifyListeners(): void {
    for (const cb of this.listeners) cb();
  }

  /** The current read-only health state, or null when persistence is normal. */
  getReadOnlyReason(): ReadOnlyReason | null {
    return this.readOnlyReason;
  }

  /**
   * Returns the current read-only reason the FIRST time it is called for that
   * reason, then null for that reason on subsequent calls (B-03 AC-1 session
   * gate). The gate is session-lived and never cleared by load(), so repeated
   * reloads in the same state do not re-show the Notice. A load that transitions
   * to a new or different reason will inform the user once for that new reason.
   */
  consumeReadOnlyNotice(): ReadOnlyReason | null {
    if (this.readOnlyReason === null) return null;
    if (this.notifiedReasons.has(this.readOnlyReason)) return null;
    this.notifiedReasons.add(this.readOnlyReason);
    return this.readOnlyReason;
  }

  get(): TagCuratorSettings {
    return this.settings;
  }

  async update(partial: Partial<TagCuratorSettings>): Promise<void> {
    this.settings = { ...this.settings, ...partial };
    await this.persist();
  }

  async setPresetEnabled(presetId: string, enabled: boolean): Promise<void> {
    const set = new Set(this.settings.enabledPresets);
    if (enabled) set.add(presetId);
    else set.delete(presetId);
    this.settings.enabledPresets = Array.from(set);
    await this.persist();
  }

  async addCustomRule(rule: Rule): Promise<void> {
    this.settings.customRules = [...this.settings.customRules, rule];
    await this.persist();
  }

  async updateCustomRule(ruleId: string, partial: Partial<Rule>): Promise<void> {
    this.settings.customRules = this.settings.customRules.map((r) =>
      r.id === ruleId ? { ...r, ...partial } : r,
    );
    await this.persist();
  }

  async deleteCustomRule(ruleId: string): Promise<void> {
    this.settings.customRules = this.settings.customRules.filter(
      (r) => r.id !== ruleId,
    );
    await this.persist();
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.settings.enabled = enabled;
    await this.persist();
  }

  async setPreviewMode(previewMode: boolean): Promise<void> {
    this.settings.previewMode = previewMode;
    await this.persist();
  }

  async setSeenWelcomeModal(seen: boolean): Promise<void> {
    this.settings.seenWelcomeModal = seen;
    await this.persist();
  }

  async setSeenNnTooOldNotice(seen: boolean): Promise<void> {
    this.settings.seenNnTooOldNotice = seen;
    await this.persist();
  }

  async setPaneEnabled(paneEnabled: boolean): Promise<void> {
    this.settings.paneEnabled = paneEnabled;
    await this.persist();
  }

  /** Column visibility prefs for one table surface (pane or settings). */
  getTableColumns(surface: TableSurface): TableColumnPrefs {
    return this.settings.tableColumns[surface] ?? defaultColsFor(surface);
  }

  /**
   * Persist the column visibility prefs for ONE surface (item 8a), leaving the
   * other surface's prefs untouched. The single onChange fan-out repaints the
   * affected table; the unaffected surface re-reads its own (unchanged) slot.
   */
  async setTableColumns(surface: TableSurface, columns: TableColumnPrefs): Promise<void> {
    this.settings.tableColumns = {
      ...this.settings.tableColumns,
      [surface]: { ...columns },
    };
    await this.persist();
  }

  /**
   * Whether a given scope is globally live (Phase 5B). Reads the per-scope
   * enable map; a scope absent from the map is treated as enabled, so callers
   * (and Phases 6-8) get a safe default-on for any scope not yet listed. This is
   * the global on/off switch for a surface (the only scope control; rules
   * themselves are global and apply to every enabled surface).
   */
  isScopeEnabled(scope: string): boolean {
    const flag = this.settings.scopeEnabled?.[scope];
    return flag !== false;
  }

  async setScopeEnabled(scope: string, enabled: boolean): Promise<void> {
    this.settings.scopeEnabled = { ...this.settings.scopeEnabled, [scope]: enabled };
    await this.persist();
  }

  /**
   * Pin a tag to always-show / always-hide (D-015), or clear the pin when value
   * is null. Tag keys carry no leading '#'. Resolved ahead of rules by the
   * engine; see RuleEngine.resolveVisibility.
   */
  async setOverride(tag: string, value: TagOverride | null): Promise<void> {
    const next = { ...this.settings.overrides };
    if (value === null) delete next[tag];
    else next[tag] = value;
    this.settings.overrides = next;
    await this.persist();
  }

  /** Whether the user has marked this tag reviewed (P2-09). Tag keys carry no '#'. */
  isReviewed(tag: string): boolean {
    return this.settings.reviewedTags[tag] === true;
  }

  /** The durable reviewed-tags map (lives in data.json, not the tags.json sidecar). */
  getReviewedTags(): Record<string, true> {
    return this.settings.reviewedTags;
  }

  /**
   * Mark or unmark a batch of tags reviewed and persist durably. Persists WITHOUT
   * notifying settings listeners: reviewed is not a rule/scope change, so it must
   * not trigger the heavy observer re-decoration fan-out. The tag table repaints
   * off TagMetaManager's own 'changed' event instead. Tag keys carry no '#'.
   */
  async setReviewedTags(tags: string[], value: boolean): Promise<void> {
    const next = { ...this.settings.reviewedTags };
    for (const tag of tags) {
      if (value) next[tag] = true;
      else delete next[tag];
    }
    this.settings.reviewedTags = next;
    await this.persist(false);
  }

  /**
   * Whether this load migrated the vault up across the v10 boundary, where reviewed
   * state moved from the tags.json sidecar into durable settings (P2-09).
   * TagMetaManager lifts a v1 sidecar's inline reviewed flags only when this is
   * true, so a v1 sidecar that reappears later (sync, backup restore) on an
   * already-migrated vault cannot re-lift and clobber intentional un-reviews.
   */
  shouldLiftLegacyReviewed(): boolean {
    return this.incomingVersion < 10;
  }

  onChange(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => {
      const idx = this.listeners.indexOf(cb);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  /**
   * Re-read data.json after it changed underneath us (sync delivered a file, the
   * user hand-edited it, a backup was restored) and tell every consumer (B-02).
   *
   * load() deliberately does not notify: it runs during onload, before any surface
   * has subscribed, and the initial state reaches surfaces by construction.
   * reload() must, because by then surfaces are live and holding pre-reload state.
   *
   * The state banner is the case that proves it. onExternalSettingsChange
   * re-detects a corrupt or newer-schema data.json and raises the transient Notice,
   * but the banner learns the health state only through onChange - so without this
   * fan-out the PERSISTENT read-only indicator never appears. That is exactly the
   * multi-device sync scenario the indicator exists for (B-03 AC-3): a foreign
   * data.json lands mid-session, the toast fades or is missed, and the user is left
   * with no standing signal that their settings will not save.
   */
  async reload(): Promise<void> {
    await this.load();
    this.notifyListeners();
  }
}
