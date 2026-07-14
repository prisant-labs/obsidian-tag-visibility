import { describe, expect, it } from 'vitest';
import { Plugin } from 'obsidian';
import { SettingsManager } from '../src/storage/settings';
import { RuleEngine } from '../src/engine/ruleEngine';
import { resolveActiveRules } from '../src/engine/presets';
import { DEFAULT_SETTINGS, Rule, SCHEMA_VERSION } from '../src/types';

function pluginWith(data: unknown): Plugin {
  const p = new Plugin();
  p.data = data;
  return p;
}

function customRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'r1',
    name: 'r1',
    enabled: true,
    priority: 50,
    match: { type: 'list', list: [] },
    action: 'hide',    ...overrides,
  };
}

describe('SettingsManager.load - fresh install', () => {
  it('uses defaults when stored data is null', async () => {
    const mgr = new SettingsManager(pluginWith(null));
    await mgr.load();
    expect(mgr.get()).toEqual({ ...DEFAULT_SETTINGS, schemaVersion: SCHEMA_VERSION });
  });

  it('carries no per-rule defaultScopes (global scope only)', () => {
    expect(DEFAULT_SETTINGS).not.toHaveProperty('defaultScopes');
  });

  it('uses defaults when stored data is empty object', async () => {
    const mgr = new SettingsManager(pluginWith({}));
    await mgr.load();
    expect(mgr.get().schemaVersion).toBe(SCHEMA_VERSION);
    expect(mgr.get().enabledPresets).toEqual(DEFAULT_SETTINGS.enabledPresets);
  });
});

describe('SettingsManager.load - v0 to v1 migration', () => {
  it('migrates legacy `rules` array into `customRules`', async () => {
    const legacy = {
      // no schemaVersion = v0
      rules: [customRule({ id: 'old', enabled: true })],
    };
    const mgr = new SettingsManager(pluginWith(legacy));
    await mgr.load();
    const s = mgr.get();
    expect(s.schemaVersion).toBe(SCHEMA_VERSION);
    expect(s.customRules.map((r) => r.id)).toEqual(['old']);
  });

  it('migrates legacy `enabledRules` set onto rules without explicit enabled flag', async () => {
    const legacy = {
      rules: [
        { ...customRule({ id: 'a' }), enabled: undefined as unknown as boolean },
        { ...customRule({ id: 'b' }), enabled: undefined as unknown as boolean },
      ],
      enabledRules: ['a'],
    };
    const mgr = new SettingsManager(pluginWith(legacy));
    await mgr.load();
    const s = mgr.get();
    expect(s.customRules.find((r) => r.id === 'a')?.enabled).toBe(true);
    expect(s.customRules.find((r) => r.id === 'b')?.enabled).toBe(false);
  });

  it('persists schemaVersion bump to disk on migration', async () => {
    const plugin = pluginWith({ rules: [] });
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    expect((plugin.data as { schemaVersion?: number }).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('handles already-current data without rewriting unrelated fields', async () => {
    const original = {
      ...DEFAULT_SETTINGS,
      schemaVersion: SCHEMA_VERSION,
      enabled: false,
      enabledPresets: ['hide-hex-codes'],
    };
    const mgr = new SettingsManager(pluginWith(original));
    await mgr.load();
    expect(mgr.get().enabled).toBe(false);
    expect(mgr.get().enabledPresets).toEqual(['hide-hex-codes']);
  });

  it('does not persist (no downgrade) when reading a future-version file', async () => {
    const futureShape = {
      ...DEFAULT_SETTINGS,
      schemaVersion: SCHEMA_VERSION + 1,
      enabled: false,
      enabledPresets: ['hide-hex-codes'],
      // a hypothetical v2-only field the older plugin does not know about
      futureField: { kept: true } as unknown,
    };
    const plugin = pluginWith(futureShape);
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    // The on-disk data should NOT have been rewritten - the future field is intact.
    const onDisk = plugin.data as { futureField?: { kept: boolean }; schemaVersion: number };
    expect(onDisk.futureField).toEqual({ kept: true });
    expect(onDisk.schemaVersion).toBe(SCHEMA_VERSION + 1);
  });
});

describe('SettingsManager - legacy v0 keys cannot resurrect (DA-01)', () => {
  it('round-trip: rule edits made after a v0 migration survive the next load', async () => {
    const plugin = pluginWith({
      // no schemaVersion = v0
      rules: [customRule({ id: 'old', enabled: true })],
    });
    // Load 1: a genuine v0 file migrates and honors `rules` once.
    const first = new SettingsManager(plugin);
    await first.load();
    expect(first.get().customRules.map((r) => r.id)).toEqual(['old']);
    // The user edits: adds a rule, deletes the migrated one.
    await first.addCustomRule(customRule({ id: 'new', enabled: true }));
    await first.deleteCustomRule('old');
    // Load 2 (restart): the edits survive; the frozen v0 array must not return.
    const second = new SettingsManager(plugin);
    await second.load();
    expect(second.get().customRules.map((r) => r.id)).toEqual(['new']);
    expect(second.get().customRules[0]?.enabled).toBe(true);
  });

  it('strips the legacy v0 keys from the persisted file on migration', async () => {
    const plugin = pluginWith({
      rules: [customRule({ id: 'old' })],
      enabledRules: ['old'],
      dryRun: true,
    });
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    const onDisk = plugin.data as Record<string, unknown>;
    expect(onDisk.schemaVersion).toBe(SCHEMA_VERSION);
    expect(onDisk).not.toHaveProperty('rules');
    expect(onDisk).not.toHaveProperty('enabledRules');
    expect(onDisk).not.toHaveProperty('dryRun');
    expect(onDisk).not.toHaveProperty('tagMetadata');
    // The v0 content itself was still honored once on the way through.
    expect(mgr.get().previewMode).toBe(true);
    expect(mgr.get().customRules.map((r) => r.id)).toEqual(['old']);
  });

  it('heals a poisoned current-version file: stale `rules` never beats customRules', async () => {
    // The shape an earlier build persisted: fully migrated, but with the legacy
    // keys still aboard and customRules edited since the original migration.
    const poisoned = {
      ...DEFAULT_SETTINGS,
      schemaVersion: SCHEMA_VERSION,
      customRules: [customRule({ id: 'edited', enabled: true })],
      rules: [customRule({ id: 'stale-v0', enabled: true })],
      enabledRules: ['stale-v0'],
    };
    const plugin = pluginWith(poisoned);
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    // The user's current rules win over the stale v0 array...
    expect(mgr.get().customRules.map((r) => r.id)).toEqual(['edited']);
    // ...and the file is rewritten once, clean of the legacy keys.
    const onDisk = plugin.data as Record<string, unknown>;
    expect(onDisk.schemaVersion).toBe(SCHEMA_VERSION);
    expect(onDisk).not.toHaveProperty('rules');
    expect(onDisk).not.toHaveProperty('enabledRules');
    expect((onDisk.customRules as Rule[]).map((r) => r.id)).toEqual(['edited']);
  });
});

describe('SettingsManager mutations', () => {
  it('update merges partials and persists', async () => {
    const plugin = pluginWith(null);
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    await mgr.update({ enabled: false, previewMode: true });
    expect(mgr.get().enabled).toBe(false);
    expect(mgr.get().previewMode).toBe(true);
    expect((plugin.data as { enabled: boolean }).enabled).toBe(false);
  });

  it('setPresetEnabled adds and removes by id', async () => {
    const mgr = new SettingsManager(pluginWith(null));
    await mgr.load();
    await mgr.setPresetEnabled('hide-orphans', true);
    expect(mgr.get().enabledPresets).toContain('hide-orphans');
    await mgr.setPresetEnabled('hide-orphans', false);
    expect(mgr.get().enabledPresets).not.toContain('hide-orphans');
  });

  it('setPresetEnabled is idempotent', async () => {
    const mgr = new SettingsManager(pluginWith(null));
    await mgr.load();
    await mgr.setPresetEnabled('hide-hex-codes', true);
    await mgr.setPresetEnabled('hide-hex-codes', true);
    const count = mgr
      .get()
      .enabledPresets.filter((id) => id === 'hide-hex-codes').length;
    expect(count).toBe(1);
  });

  it('addCustomRule appends', async () => {
    const mgr = new SettingsManager(pluginWith(null));
    await mgr.load();
    await mgr.addCustomRule(customRule({ id: 'new' }));
    expect(mgr.get().customRules.map((r) => r.id)).toEqual(['new']);
  });

  it('updateCustomRule patches by id and ignores unknowns', async () => {
    const mgr = new SettingsManager(pluginWith(null));
    await mgr.load();
    await mgr.addCustomRule(customRule({ id: 'a', name: 'first' }));
    await mgr.addCustomRule(customRule({ id: 'b', name: 'second' }));
    await mgr.updateCustomRule('a', { name: 'renamed' });
    await mgr.updateCustomRule('ghost', { name: 'oops' });
    expect(mgr.get().customRules.find((r) => r.id === 'a')?.name).toBe('renamed');
    expect(mgr.get().customRules.find((r) => r.id === 'b')?.name).toBe('second');
  });

  it('deleteCustomRule removes by id', async () => {
    const mgr = new SettingsManager(pluginWith(null));
    await mgr.load();
    await mgr.addCustomRule(customRule({ id: 'a' }));
    await mgr.addCustomRule(customRule({ id: 'b' }));
    await mgr.deleteCustomRule('a');
    expect(mgr.get().customRules.map((r) => r.id)).toEqual(['b']);
  });

  it('onChange listeners fire on persist', async () => {
    const mgr = new SettingsManager(pluginWith(null));
    await mgr.load();
    let callCount = 0;
    mgr.onChange(() => {
      callCount += 1;
    });
    await mgr.update({ enabled: false });
    await mgr.setEnabled(true);
    expect(callCount).toBe(2);
  });

  it('onChange returns an unsubscribe function that stops the callback from firing', async () => {
    const mgr = new SettingsManager(pluginWith(null));
    await mgr.load();
    let callCount = 0;
    const off = mgr.onChange(() => {
      callCount += 1;
    });
    await mgr.update({ enabled: false });
    expect(callCount).toBe(1);
    off();
    await mgr.setEnabled(true);
    await mgr.update({ previewMode: true });
    expect(callCount).toBe(1); // no further calls after unsubscribe
  });

  it('reload re-reads persisted data', async () => {
    const plugin = pluginWith(null);
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    plugin.data = { ...DEFAULT_SETTINGS, schemaVersion: SCHEMA_VERSION, previewMode: true };
    await mgr.reload();
    expect(mgr.get().previewMode).toBe(true);
  });
});

describe('SettingsManager.load - v1 to v2 migration', () => {
  it('maps legacy `dryRun` onto `previewMode` when reading v1 data', async () => {
    const v1 = {
      ...DEFAULT_SETTINGS,
      schemaVersion: 1,
      dryRun: true,
    } as unknown;
    delete (v1 as { previewMode?: boolean }).previewMode;
    const plugin = pluginWith(v1);
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    expect(mgr.get().previewMode).toBe(true);
    expect(mgr.get().schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('keeps previewMode false when v1 data did not set dryRun', async () => {
    const v1 = { ...DEFAULT_SETTINGS, schemaVersion: 1 } as unknown;
    delete (v1 as { previewMode?: boolean }).previewMode;
    const plugin = pluginWith(v1);
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    expect(mgr.get().previewMode).toBe(false);
  });

  it('persists the renamed field to disk after migration', async () => {
    const v1 = { ...DEFAULT_SETTINGS, schemaVersion: 1, dryRun: true } as unknown;
    delete (v1 as { previewMode?: boolean }).previewMode;
    const plugin = pluginWith(v1);
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    const onDisk = plugin.data as { previewMode?: boolean; schemaVersion: number };
    expect(onDisk.previewMode).toBe(true);
    expect(onDisk.schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('SettingsManager.load - v2 to v3 migration', () => {
  it('defaults seenWelcomeModal to false when reading v2 data', async () => {
    const v2 = { ...DEFAULT_SETTINGS, schemaVersion: 2 } as unknown;
    delete (v2 as { seenWelcomeModal?: boolean }).seenWelcomeModal;
    const plugin = pluginWith(v2);
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    expect(mgr.get().seenWelcomeModal).toBe(false);
    expect(mgr.get().schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('preserves seenWelcomeModal when already present on v2 data', async () => {
    const v2 = {
      ...DEFAULT_SETTINGS,
      schemaVersion: 2,
      seenWelcomeModal: true,
    } as unknown;
    const plugin = pluginWith(v2);
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    expect(mgr.get().seenWelcomeModal).toBe(true);
  });

  it('persists the v3 schemaVersion + new field to disk', async () => {
    const v2 = { ...DEFAULT_SETTINGS, schemaVersion: 2 } as unknown;
    delete (v2 as { seenWelcomeModal?: boolean }).seenWelcomeModal;
    const plugin = pluginWith(v2);
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    const onDisk = plugin.data as {
      seenWelcomeModal?: boolean;
      schemaVersion: number;
    };
    expect(onDisk.schemaVersion).toBe(SCHEMA_VERSION);
    expect(onDisk.seenWelcomeModal).toBe(false);
  });
});

describe('SettingsManager.setSeenWelcomeModal', () => {
  it('persists the flag', async () => {
    const mgr = new SettingsManager(pluginWith(null));
    await mgr.load();
    expect(mgr.get().seenWelcomeModal).toBe(false);
    await mgr.setSeenWelcomeModal(true);
    expect(mgr.get().seenWelcomeModal).toBe(true);
  });
});

describe('SettingsManager.load - v3 to v4 migration (overrides)', () => {
  it('defaults overrides to {} when reading v3 data', async () => {
    const v3 = { ...DEFAULT_SETTINGS, schemaVersion: 3 } as unknown;
    delete (v3 as { overrides?: unknown }).overrides;
    const mgr = new SettingsManager(pluginWith(v3));
    await mgr.load();
    expect(mgr.get().schemaVersion).toBe(SCHEMA_VERSION);
    expect(mgr.get().overrides).toEqual({});
  });

  it('preserves an existing overrides map unchanged on v4 data', async () => {
    const v4 = {
      ...DEFAULT_SETTINGS,
      schemaVersion: SCHEMA_VERSION,
      overrides: { foo: 'show', bar: 'hide' },
    } as unknown;
    const mgr = new SettingsManager(pluginWith(v4));
    await mgr.load();
    expect(mgr.get().overrides).toEqual({ foo: 'show', bar: 'hide' });
  });

  it('persists the v4 schemaVersion + overrides field to disk', async () => {
    const v3 = { ...DEFAULT_SETTINGS, schemaVersion: 3 } as unknown;
    delete (v3 as { overrides?: unknown }).overrides;
    const plugin = pluginWith(v3);
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    const onDisk = plugin.data as { overrides?: unknown; schemaVersion: number };
    expect(onDisk.schemaVersion).toBe(SCHEMA_VERSION);
    expect(onDisk.overrides).toEqual({});
  });

  it('resets overrides to {} when v3 data has an array instead of an object', async () => {
    const v3 = {
      ...DEFAULT_SETTINGS,
      schemaVersion: 3,
      overrides: [] as unknown,
    };
    const mgr = new SettingsManager(pluginWith(v3));
    await mgr.load();
    expect(mgr.get().overrides).toEqual({});
  });

  it('does not downgrade or persist when reading a future-version file with overrides', async () => {
    const future = {
      ...DEFAULT_SETTINGS,
      schemaVersion: 99,
      overrides: { kept: 'hide' },
      futureField: { kept: true } as unknown,
    };
    const plugin = pluginWith(future);
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    const onDisk = plugin.data as {
      futureField?: { kept: boolean };
      schemaVersion: number;
    };
    expect(onDisk.futureField).toEqual({ kept: true });
    expect(onDisk.schemaVersion).toBe(99);
  });
});

describe('SettingsManager future-schema write guard (P2-08)', () => {
  it('a setter does not downgrade or rewrite a future-version file', async () => {
    const future = {
      ...DEFAULT_SETTINGS,
      schemaVersion: SCHEMA_VERSION + 5,
      enabled: true,
      futureField: { kept: true } as unknown,
    };
    const plugin = pluginWith(future);
    const mgr = new SettingsManager(plugin);
    await mgr.load();

    // The user toggles something while running an OLDER plugin against NEWER data.
    await mgr.setEnabled(false);

    const onDisk = plugin.data as {
      schemaVersion: number;
      enabled: boolean;
      futureField?: { kept: boolean };
    };
    // On-disk file untouched: same future version, future field intact, and the
    // older plugin's downgraded write never landed.
    expect(onDisk.schemaVersion).toBe(SCHEMA_VERSION + 5);
    expect(onDisk.futureField).toEqual({ kept: true });
    expect(onDisk.enabled).toBe(true);
  });

  it('still persists writes normally for a current-version file', async () => {
    const plugin = pluginWith({ ...DEFAULT_SETTINGS, schemaVersion: SCHEMA_VERSION });
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    await mgr.setEnabled(false);
    expect((plugin.data as { enabled: boolean }).enabled).toBe(false);
  });

  it('still notifies listeners on an in-memory change in future-schema mode', async () => {
    const plugin = pluginWith({ ...DEFAULT_SETTINGS, schemaVersion: SCHEMA_VERSION + 5 });
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    let fired = 0;
    mgr.onChange(() => {
      fired += 1;
    });

    await mgr.setEnabled(false);

    // Disk is not written (read-only), but listeners still fire so the in-memory
    // change reaches the observers/status bar for this session instead of the
    // toggle appearing dead.
    expect(fired).toBe(1);
    expect(mgr.get().enabled).toBe(false);
  });
});

describe('SettingsManager reviewed tags (P2-09 durable store)', () => {
  it('defaults reviewedTags to {} on a fresh install', async () => {
    const mgr = new SettingsManager(pluginWith(null));
    await mgr.load();
    expect(mgr.getReviewedTags()).toEqual({});
    expect(mgr.isReviewed('anything')).toBe(false);
  });

  it('setReviewedTags marks tags and persists to data.json', async () => {
    const plugin = pluginWith(null);
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    await mgr.setReviewedTags(['alpha', 'beta'], true);
    expect(mgr.isReviewed('alpha')).toBe(true);
    expect(mgr.isReviewed('beta')).toBe(true);
    expect((plugin.data as { reviewedTags: Record<string, true> }).reviewedTags).toEqual({
      alpha: true,
      beta: true,
    });
  });

  it('setReviewedTags with false removes tags', async () => {
    const mgr = new SettingsManager(pluginWith(null));
    await mgr.load();
    await mgr.setReviewedTags(['alpha', 'beta'], true);
    await mgr.setReviewedTags(['alpha'], false);
    expect(mgr.isReviewed('alpha')).toBe(false);
    expect(mgr.getReviewedTags()).toEqual({ beta: true });
  });

  it('does not trigger the settings onChange fan-out (reviewed is not a rule change)', async () => {
    const mgr = new SettingsManager(pluginWith(null));
    await mgr.load();
    let fired = 0;
    mgr.onChange(() => {
      fired += 1;
    });
    await mgr.setReviewedTags(['alpha'], true);
    expect(fired).toBe(0);
  });

  it('defaults reviewedTags when migrating a v9 file', async () => {
    const v9 = { ...DEFAULT_SETTINGS, schemaVersion: 9 } as Record<string, unknown>;
    delete v9.reviewedTags;
    const mgr = new SettingsManager(pluginWith(v9));
    await mgr.load();
    expect(mgr.get().schemaVersion).toBe(SCHEMA_VERSION);
    expect(mgr.getReviewedTags()).toEqual({});
  });

  it('shouldLiftLegacyReviewed is true only when migrating up across the v10 boundary', async () => {
    const upgrading = new SettingsManager(pluginWith({ ...DEFAULT_SETTINGS, schemaVersion: 9 }));
    await upgrading.load();
    expect(upgrading.shouldLiftLegacyReviewed()).toBe(true);

    const current = new SettingsManager(
      pluginWith({ ...DEFAULT_SETTINGS, schemaVersion: SCHEMA_VERSION }),
    );
    await current.load();
    expect(current.shouldLiftLegacyReviewed()).toBe(false);
  });
});

describe('SettingsManager.load - v4 to v5 migration (per-scope enable + NN notice)', () => {
  // A v4 fixture must NOT carry the v5 fields, so we build it from DEFAULT_SETTINGS
  // and explicitly strip the fields v5 introduces; otherwise the defaults would
  // mask the migration we are exercising.
  function v4Fixture(extra: Record<string, unknown> = {}): unknown {
    const v4 = { ...DEFAULT_SETTINGS, schemaVersion: 4 } as Record<string, unknown>;
    // Strip the v5-introduced fields so the migration is what fills them; then
    // layer any caller-supplied overrides on top (so a test can inject a v4 file
    // that DID already carry, say, an explicit scopeEnabled value).
    delete v4.scopeEnabled;
    delete v4.seenNnTooOldNotice;
    return { ...v4, ...extra };
  }

  it('defaults scopeEnabled with all four v1.0 scopes enabled when absent', async () => {
    const mgr = new SettingsManager(pluginWith(v4Fixture()));
    await mgr.load();
    const s = mgr.get();
    expect(s.schemaVersion).toBe(SCHEMA_VERSION);
    expect(s.scopeEnabled).toEqual({
      'tag-pane': true,
      'notebook-navigator': true,
      properties: true,
      autocomplete: true,
    });
  });

  it('defaults seenNnTooOldNotice to false when absent', async () => {
    const mgr = new SettingsManager(pluginWith(v4Fixture()));
    await mgr.load();
    expect(mgr.get().seenNnTooOldNotice).toBe(false);
  });

  it('preserves an explicit per-scope false (kill switch) across migration', async () => {
    const fixture = v4Fixture({
      scopeEnabled: { 'notebook-navigator': false },
    });
    const mgr = new SettingsManager(pluginWith(fixture));
    await mgr.load();
    // The explicit false is preserved verbatim; the spread merge does not
    // re-add the other scopes, but isScopeEnabled treats unlisted as enabled.
    expect(mgr.get().scopeEnabled['notebook-navigator']).toBe(false);
    expect(mgr.isScopeEnabled('notebook-navigator')).toBe(false);
    expect(mgr.isScopeEnabled('tag-pane')).toBe(true);
  });

  it('repairs a malformed (array) scopeEnabled to the default map', async () => {
    const fixture = v4Fixture({ scopeEnabled: [] as unknown });
    const mgr = new SettingsManager(pluginWith(fixture));
    await mgr.load();
    expect(mgr.get().scopeEnabled).toEqual(DEFAULT_SETTINGS.scopeEnabled);
  });

  it('persists the v5 schemaVersion + new fields to disk', async () => {
    const plugin = pluginWith(v4Fixture());
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    const onDisk = plugin.data as {
      schemaVersion: number;
      scopeEnabled?: Record<string, boolean>;
      seenNnTooOldNotice?: boolean;
    };
    expect(onDisk.schemaVersion).toBe(SCHEMA_VERSION);
    expect(onDisk.scopeEnabled).toEqual(DEFAULT_SETTINGS.scopeEnabled);
    expect(onDisk.seenNnTooOldNotice).toBe(false);
  });
});

describe('SettingsManager.isScopeEnabled / setScopeEnabled', () => {
  it('treats an unlisted scope as enabled (safe default-on)', async () => {
    const mgr = new SettingsManager(pluginWith(null));
    await mgr.load();
    expect(mgr.isScopeEnabled('graph')).toBe(true);
  });

  it('setScopeEnabled toggles a scope off and back on, persisting each time', async () => {
    const plugin = pluginWith(null);
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    await mgr.setScopeEnabled('notebook-navigator', false);
    expect(mgr.isScopeEnabled('notebook-navigator')).toBe(false);
    expect(
      (plugin.data as { scopeEnabled: Record<string, boolean> }).scopeEnabled[
        'notebook-navigator'
      ],
    ).toBe(false);
    await mgr.setScopeEnabled('notebook-navigator', true);
    expect(mgr.isScopeEnabled('notebook-navigator')).toBe(true);
  });

  it('setScopeEnabled does not clobber other scopes', async () => {
    const mgr = new SettingsManager(pluginWith(null));
    await mgr.load();
    await mgr.setScopeEnabled('notebook-navigator', false);
    expect(mgr.isScopeEnabled('tag-pane')).toBe(true);
    expect(mgr.isScopeEnabled('properties')).toBe(true);
  });
});

describe('SettingsManager.setSeenNnTooOldNotice', () => {
  it('persists the one-time notice flag', async () => {
    const plugin = pluginWith(null);
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    expect(mgr.get().seenNnTooOldNotice).toBe(false);
    await mgr.setSeenNnTooOldNotice(true);
    expect(mgr.get().seenNnTooOldNotice).toBe(true);
    expect((plugin.data as { seenNnTooOldNotice: boolean }).seenNnTooOldNotice).toBe(true);
  });
});

describe('SettingsManager.load - v5 to v6 migration (paneEnabled)', () => {
  // A v5 fixture must NOT carry paneEnabled so the migration is what fills it.
  function v5Fixture(extra: Record<string, unknown> = {}): unknown {
    const v5 = { ...DEFAULT_SETTINGS, schemaVersion: 5 } as Record<string, unknown>;
    delete v5.paneEnabled;
    return { ...v5, ...extra };
  }

  it('defaults paneEnabled to true when absent from v5 data', async () => {
    const mgr = new SettingsManager(pluginWith(v5Fixture()));
    await mgr.load();
    expect(mgr.get().schemaVersion).toBe(SCHEMA_VERSION);
    expect(mgr.get().paneEnabled).toBe(true);
  });

  it('preserves an explicit paneEnabled false across migration', async () => {
    const fixture = v5Fixture({ paneEnabled: false });
    const mgr = new SettingsManager(pluginWith(fixture));
    await mgr.load();
    expect(mgr.get().paneEnabled).toBe(false);
  });

  it('persists the v6 schemaVersion + paneEnabled to disk', async () => {
    const plugin = pluginWith(v5Fixture());
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    const onDisk = plugin.data as { schemaVersion: number; paneEnabled?: boolean };
    expect(onDisk.schemaVersion).toBe(SCHEMA_VERSION);
    expect(onDisk.paneEnabled).toBe(true);
  });
});

describe('SettingsManager.setPaneEnabled', () => {
  it('defaults paneEnabled to true on a fresh install', async () => {
    const mgr = new SettingsManager(pluginWith(null));
    await mgr.load();
    expect(mgr.get().paneEnabled).toBe(true);
  });

  it('setPaneEnabled toggles the flag and persists', async () => {
    const plugin = pluginWith(null);
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    expect(mgr.get().paneEnabled).toBe(true);
    await mgr.setPaneEnabled(false);
    expect(mgr.get().paneEnabled).toBe(false);
    expect((plugin.data as { paneEnabled: boolean }).paneEnabled).toBe(false);
    await mgr.setPaneEnabled(true);
    expect(mgr.get().paneEnabled).toBe(true);
  });
});

describe('SettingsManager.load - legacy per-rule scope is inert (P1-02 orphan)', () => {
  // A v10 data.json whose custom rule still carries a per-rule `scopes` field -
  // synced from a build before P1-02, or hand-edited. Per-rule scope was never
  // enforced (resolveVisibility is scope-agnostic), so the stray key must be
  // inert: the rule still resolves and hides globally, and load neither bumps the
  // schema nor throws. Locks the inert-orphan contract the 2026-06-30 adversarial
  // review questioned; this fails if a future change ever makes `scopes` filter
  // rule application.
  it('loads a custom rule with a stray scopes field and still hides globally', async () => {
    const data = {
      schemaVersion: SCHEMA_VERSION,
      enabled: true,
      customRules: [
        {
          id: 'legacy',
          name: 'legacy scoped',
          enabled: true,
          priority: 100,
          match: { type: 'list', list: ['secret'] },
          action: 'hide',
          // Stray subset that, were scope enforced, would exclude the tag pane.
          scopes: ['notebook-navigator'],
        },
      ],
    };
    const mgr = new SettingsManager(pluginWith(data));
    await mgr.load();
    const settings = mgr.get();
    expect(settings.schemaVersion).toBe(SCHEMA_VERSION); // no spurious bump
    const rules = resolveActiveRules(settings);
    const attribution = RuleEngine.resolveVisibility(
      'secret',
      undefined,
      rules,
      settings.overrides,
    );
    // Scope-agnostic: the rule hides 'secret' regardless of its stray scopes.
    expect(RuleEngine.isEffectivelyHidden(attribution.effective)).toBe(true);
  });
});

describe('SettingsManager.load - tableColumns migration (per surface, v9)', () => {
  // The pane opens lean (tag/count/visibility only); the settings tab shows all.
  const LEAN = { lastSeen: false, source: false, rule: false };
  const FULL = { lastSeen: true, source: true, rule: true };

  // A v6 fixture predates tableColumns entirely, so the migration fills it.
  function v6Fixture(extra: Record<string, unknown> = {}): unknown {
    const v6 = { ...DEFAULT_SETTINGS, schemaVersion: 6 } as Record<string, unknown>;
    delete v6.tableColumns;
    return { ...v6, ...extra };
  }

  it('defaults pane lean + settings full when absent (v6 data)', async () => {
    const mgr = new SettingsManager(pluginWith(v6Fixture()));
    await mgr.load();
    expect(mgr.get().schemaVersion).toBe(SCHEMA_VERSION);
    expect(mgr.get().tableColumns).toEqual({ pane: LEAN, settings: FULL });
  });

  it('a flat v7 value goes to settings; the pane gets its lean default', async () => {
    const flat = { lastSeen: false, source: true, rule: false };
    const v7 = { ...DEFAULT_SETTINGS, schemaVersion: 7, tableColumns: flat } as unknown;
    const mgr = new SettingsManager(pluginWith(v7));
    await mgr.load();
    expect(mgr.get().tableColumns).toEqual({ pane: LEAN, settings: flat });
  });

  it('v8 upgrade resets the pane to lean but keeps the settings columns', async () => {
    const settingsCols = { lastSeen: false, source: true, rule: true };
    const v8 = {
      ...DEFAULT_SETTINGS,
      schemaVersion: 8,
      tableColumns: { pane: FULL, settings: settingsCols },
    } as unknown;
    const mgr = new SettingsManager(pluginWith(v8));
    await mgr.load();
    expect(mgr.get().tableColumns).toEqual({ pane: LEAN, settings: settingsCols });
  });

  it('preserves an explicit per-surface map already at the current version', async () => {
    const explicit = { pane: { lastSeen: false, source: true, rule: false }, settings: FULL };
    const cur = {
      ...DEFAULT_SETTINGS,
      schemaVersion: SCHEMA_VERSION,
      tableColumns: explicit,
    } as unknown;
    const mgr = new SettingsManager(pluginWith(cur));
    await mgr.load();
    expect(mgr.get().tableColumns).toEqual(explicit);
  });

  it('repairs a malformed (array) value to per-surface defaults', async () => {
    const v7 = { ...DEFAULT_SETTINGS, schemaVersion: 7, tableColumns: [] as unknown };
    const mgr = new SettingsManager(pluginWith(v7));
    await mgr.load();
    expect(mgr.get().tableColumns).toEqual({ pane: LEAN, settings: FULL });
  });

  it('persists the v9 schemaVersion + per-surface columns to disk', async () => {
    const plugin = pluginWith(v6Fixture());
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    const onDisk = plugin.data as { schemaVersion: number; tableColumns?: unknown };
    expect(onDisk.schemaVersion).toBe(SCHEMA_VERSION);
    expect(onDisk.tableColumns).toEqual({ pane: LEAN, settings: FULL });
  });
});

describe('SettingsManager.get/setTableColumns (per surface)', () => {
  it('defaults pane lean and settings full on a fresh install', async () => {
    const mgr = new SettingsManager(pluginWith(null));
    await mgr.load();
    expect(mgr.getTableColumns('pane')).toEqual({ lastSeen: false, source: false, rule: false });
    expect(mgr.getTableColumns('settings')).toEqual({ lastSeen: true, source: true, rule: true });
  });

  it('sets one surface without touching the other, and persists', async () => {
    const plugin = pluginWith(null);
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    await mgr.setTableColumns('pane', { lastSeen: true, source: false, rule: true });
    expect(mgr.getTableColumns('pane')).toEqual({ lastSeen: true, source: false, rule: true });
    // The settings surface is untouched (still full).
    expect(mgr.getTableColumns('settings')).toEqual({ lastSeen: true, source: true, rule: true });
    expect(
      (plugin.data as { tableColumns: { pane: { lastSeen: boolean } } }).tableColumns.pane.lastSeen,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B-01: Corrupt data.json must never be overwritten with defaults
// ---------------------------------------------------------------------------

describe('SettingsManager - unreadable data.json guard (B-01)', () => {
  // B-01 AC-1: loadData resolving undefined (file present but unreadable) must
  // not call saveData at any point during load.
  it('B-01 AC-1: no saveData call when loadData resolves undefined', async () => {
    const plugin = pluginWith(undefined);
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    expect(plugin.saveCount).toBe(0);
  });

  // B-01 AC-2 / AC-1 companion: plugin still loads and operates on in-memory
  // defaults (getReadOnlyReason returns the reason, settings are accessible).
  it('B-01: loads on defaults and exposes the unreadable reason when data is undefined', async () => {
    const mgr = new SettingsManager(pluginWith(undefined));
    await mgr.load();
    expect(mgr.getReadOnlyReason()).toBe('unreadable');
    // Settings are the defaults (plugin is functional).
    expect(mgr.get().schemaVersion).toBe(SCHEMA_VERSION);
    expect(mgr.get().enabled).toBe(DEFAULT_SETTINGS.enabled);
  });

  // B-01: a data.json that parses but is not a plain object is present-but-not-
  // settings, so it takes the same non-destructive path as an unparseable file.
  // An array would otherwise read schemaVersion 0 and get defaults persisted over
  // it (the B-01 harm through a different door); a bare primitive would throw from
  // the legacy-key `in` check.
  it.each([
    ['an array', [] as unknown],
    ['a number', 42 as unknown],
    ['a string', 'corrupt' as unknown],
    ['a boolean', true as unknown],
  ])('B-01: %s from loadData is treated as unreadable, never overwritten', async (_label, value) => {
    const plugin = pluginWith(value);
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    expect(mgr.getReadOnlyReason()).toBe('unreadable');
    expect(plugin.saveCount).toBe(0);
    expect(plugin.data).toBe(value);
  });

  // B-01 AC-4: a setter in the unreadable state updates in-memory state and
  // notifies listeners, but does NOT call saveData.
  it('B-01 AC-4: setter updates in-memory and fires listeners without writing disk', async () => {
    const plugin = pluginWith(undefined);
    const mgr = new SettingsManager(plugin);
    await mgr.load();

    let listenerCalls = 0;
    mgr.onChange(() => { listenerCalls += 1; });

    // Capture disk state before the setter.
    const diskBefore = plugin.data;
    await mgr.setEnabled(false);

    // In-memory change landed.
    expect(mgr.get().enabled).toBe(false);
    // Listener fired (UI must not appear dead).
    expect(listenerCalls).toBe(1);
    // Disk was NOT written.
    expect(plugin.saveCount).toBe(0);
    expect(plugin.data).toBe(diskBefore);
  });

  // B-01 AC-5: absent data.json (null from loadData = genuine first run) must
  // follow the unchanged migrate-and-persist path.
  it('B-01 AC-5: null from loadData (absent file) still migrates and persists', async () => {
    const plugin = pluginWith(null);
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    // Normal first-run: defaults migrated and written to disk.
    expect(mgr.getReadOnlyReason()).toBeNull();
    expect(plugin.saveCount).toBeGreaterThan(0);
    expect((plugin.data as { schemaVersion: number }).schemaVersion).toBe(SCHEMA_VERSION);
  });

  // B-01 AC-6: repairing data.json and calling reload() must restore normal
  // load + persistence (readOnlyReason returns null, saveData is called).
  it('B-01 AC-6: repairing the file and reloading restores normal persistence', async () => {
    const plugin = pluginWith(undefined);
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    expect(mgr.getReadOnlyReason()).toBe('unreadable');

    // Simulate the user restoring a valid data.json.
    plugin.data = { ...DEFAULT_SETTINGS, schemaVersion: SCHEMA_VERSION };
    await mgr.reload();

    expect(mgr.getReadOnlyReason()).toBeNull();
    // A current-version file with no legacy keys needs no rewrite, but the
    // core contract is that persistence is now unblocked.
    await mgr.setEnabled(false);
    expect(plugin.saveCount).toBeGreaterThan(0);
    expect((plugin.data as { enabled: boolean }).enabled).toBe(false);
  });

  // B-01 defensive: a rejected loadData promise must be treated identically
  // to undefined (present but unreadable). Covers API drift where Obsidian
  // might reject instead of resolving undefined.
  it('B-01 defensive: a rejected loadData is treated as unreadable (no saveData)', async () => {
    const plugin = pluginWith(null);
    plugin.loadError = new Error('disk read error');
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    expect(mgr.getReadOnlyReason()).toBe('unreadable');
    expect(plugin.saveCount).toBe(0);
    expect(mgr.get().schemaVersion).toBe(SCHEMA_VERSION);
  });
});

// ---------------------------------------------------------------------------
// B-02: an external settings change must rehydrate every consumer
// ---------------------------------------------------------------------------

describe('SettingsManager.reload fans out to listeners (B-02)', () => {
  // The listener fan-out used to live only inside persist(), so reload() re-read
  // the file and told nobody. Anything subscribed via onChange - the state banner
  // above every surface, most sharply - kept rendering pre-reload state.
  //
  // Caught live on 2026-07-13: corrupting data.json under a RUNNING Obsidian fired
  // onExternalSettingsChange, which correctly re-detected the unreadable file and
  // raised the transient Notice, but the PERSISTENT read-only banner never
  // appeared. That is precisely the multi-device sync case B-03's indicator exists
  // for: a foreign data.json lands mid-session, the toast is missed or fades, and
  // the user is left with no standing signal at all.
  it('B-02: reload() notifies onChange listeners', async () => {
    const plugin = pluginWith({ schemaVersion: SCHEMA_VERSION, enabled: true });
    const mgr = new SettingsManager(plugin);
    await mgr.load();

    let calls = 0;
    mgr.onChange(() => {
      calls += 1;
    });

    await mgr.reload();
    expect(calls).toBe(1);
  });

  it('B-02: a listener sees the new read-only reason when a reload enters read-only', async () => {
    const plugin = pluginWith({ schemaVersion: SCHEMA_VERSION, enabled: true });
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    expect(mgr.getReadOnlyReason()).toBeNull();

    // What the banner does: re-read the health state whenever it is notified.
    const seen: Array<string | null> = [];
    mgr.onChange(() => seen.push(mgr.getReadOnlyReason()));

    // The file goes unreadable underneath us (sync delivers a torn file).
    plugin.data = undefined;
    await mgr.reload();

    expect(mgr.getReadOnlyReason()).toBe('unreadable');
    // The banner was told, so it can render the persistent indicator (B-03 AC-3).
    expect(seen).toEqual(['unreadable']);
  });

  it('B-02: a listener is notified when a repaired file leaves read-only', async () => {
    const plugin = pluginWith(undefined);
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    expect(mgr.getReadOnlyReason()).toBe('unreadable');

    const seen: Array<string | null> = [];
    mgr.onChange(() => seen.push(mgr.getReadOnlyReason()));

    plugin.data = { schemaVersion: SCHEMA_VERSION, enabled: true };
    await mgr.reload();

    // The banner must be told to CLEAR itself too, not only to appear.
    expect(seen).toEqual([null]);
  });
});

// ---------------------------------------------------------------------------
// B-03: Read-only settings mode is visible to the user
// ---------------------------------------------------------------------------

describe('SettingsManager - consumeReadOnlyNotice session gate (B-03)', () => {
  // B-03 AC-5: consumeReadOnlyNotice returns the reason on first call for that
  // reason, then null on every subsequent call (session gate, no Notice storm).
  it('B-03 AC-5: consumeReadOnlyNotice returns reason once then null under repeated future-schema loads', async () => {
    const futureShape = {
      ...DEFAULT_SETTINGS,
      schemaVersion: SCHEMA_VERSION + 1,
    };
    const plugin = pluginWith(futureShape);
    const mgr = new SettingsManager(plugin);

    // First load.
    await mgr.load();
    expect(mgr.getReadOnlyReason()).toBe('future-schema');

    // First consume: returns the reason.
    expect(mgr.consumeReadOnlyNotice()).toBe('future-schema');
    // Subsequent consume in same session: returns null (B-03 AC-1 no re-nag).
    expect(mgr.consumeReadOnlyNotice()).toBeNull();
    expect(mgr.consumeReadOnlyNotice()).toBeNull();

    // Simulated external reload (same future file still present).
    await mgr.reload();
    expect(mgr.getReadOnlyReason()).toBe('future-schema');
    // Still null: the same reason was already notified this session.
    expect(mgr.consumeReadOnlyNotice()).toBeNull();
  });

  it('B-03: consumeReadOnlyNotice returns null when no read-only state is active', async () => {
    const mgr = new SettingsManager(pluginWith(null));
    await mgr.load();
    expect(mgr.getReadOnlyReason()).toBeNull();
    expect(mgr.consumeReadOnlyNotice()).toBeNull();
  });

  it('B-03: consumeReadOnlyNotice returns reason once for the unreadable state', async () => {
    const plugin = pluginWith(undefined);
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    expect(mgr.consumeReadOnlyNotice()).toBe('unreadable');
    expect(mgr.consumeReadOnlyNotice()).toBeNull();
  });

  it('B-03: getReadOnlyReason returns null after a normal reload following a read-only state', async () => {
    const plugin = pluginWith(undefined);
    const mgr = new SettingsManager(plugin);
    await mgr.load();
    expect(mgr.getReadOnlyReason()).toBe('unreadable');

    // Repair and reload.
    plugin.data = { ...DEFAULT_SETTINGS, schemaVersion: SCHEMA_VERSION };
    await mgr.reload();
    expect(mgr.getReadOnlyReason()).toBeNull();
  });
});
