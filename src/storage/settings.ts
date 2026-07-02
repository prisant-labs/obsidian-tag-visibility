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

export class SettingsManager {
  private plugin: Plugin;
  private settings: TagCuratorSettings = { ...DEFAULT_SETTINGS };
  private listeners: Array<() => void> = [];
  // True when the loaded data.json carries a schemaVersion newer than this build.
  // While set, persist() is a no-op: writing our older shape back would downgrade
  // schemaVersion and could corrupt fields a newer version reshaped. Re-evaluated
  // on every load()/reload().
  private futureSchema = false;
  // The schemaVersion read from disk this load (before migration). Used to detect
  // the one-time upgrade across the v10 boundary, where reviewed state moved into
  // durable settings - see shouldLiftLegacyReviewed. Re-evaluated every load.
  private incomingVersion = SCHEMA_VERSION;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  async load(): Promise<void> {
    const raw = ((await this.plugin.loadData()) ?? {}) as LegacyV0Settings;
    const incomingVersion = (raw.schemaVersion ?? 0) as number;
    this.incomingVersion = incomingVersion;
    this.futureSchema = incomingVersion > SCHEMA_VERSION;
    this.settings = this.migrate(raw);
    if (this.futureSchema) {
      // Newer plugin wrote this vault. Run read-only so no write downgrades it;
      // warn once so a confused user/dev knows why settings will not save.
      console.warn(
        `[tag-visibility] data.json is schema v${incomingVersion}, newer than this ` +
          `plugin (v${SCHEMA_VERSION}). Running read-only; setting changes will not be ` +
          `saved until the plugin is updated.`,
      );
      return;
    }
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
    const inferred = (raw.schemaVersion ?? 0) as number;
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
    // Skip only the disk write when the on-disk data was written by a newer plugin
    // version: persisting our older shape would downgrade schemaVersion and could
    // corrupt fields a newer version reshaped. Listeners STILL fire so the
    // in-memory change reaches the observers/status bar for this session - else a
    // toggle in read-only mode would mutate state but never repaint, appearing dead.
    if (!this.futureSchema) {
      await this.plugin.saveData(this.settings);
    }
    if (notify) for (const cb of this.listeners) cb();
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

  async reload(): Promise<void> {
    await this.load();
  }
}
