/**
 * Settings tab (D-008, D-007, D-009, D-011, D-010).
 *
 * Top-tab layout. The Tag list tab (D-011) hosts the same component as the
 * sidebar leaf; the Custom rules tab hosts the card-view RuleEditor (D-010).
 *
 * The persistent state banner (D-007) sits above whichever panel is active.
 */
import { App, EventRef, Notice, PluginSettingTab, Setting, setTooltip } from 'obsidian';
import TagCuratorPlugin from '../main';
import { PRESETS, resolveActiveRules } from '../engine/presets';
import { RuleEditor } from './ruleEditor';
import { StateBanner } from './stateBanner';
import { Mode } from '../types';
import { detectNotebookNavigator, MIN_API_VERSION } from '../integrations/notebookNavigator';
import { TagTable } from './curationWorkspace/tagTable';
import { TagListModel } from './tagList/tagListModel';
import { makeTagTableDeps } from './tagList/tagTableDeps';
import { makeActivatable, setSwitchState } from '../util/a11y';
import { compileSafeRegex } from '../util/safeRegex';

type TabId = 'general' | 'curate' | 'scopes' | 'presets' | 'custom' | 'advanced' | 'help';

interface TabDescriptor {
  id: TabId;
  label: string;
  badge?: string;
  badgeKind?: 'count' | 'soon';
  deferred?: boolean;
  render: (panel: HTMLElement) => void;
}

export class TagCuratorSettingTab extends PluginSettingTab {
  plugin: TagCuratorPlugin;
  private activeTab: TabId = 'general';
  private banner: StateBanner | null = null;
  private tabBar: HTMLElement | null = null;
  private panelHost: HTMLElement | null = null;
  private curateTable: TagTable | null = null;
  private curateModel: TagListModel | null = null;
  private curateOffSettings: (() => void) | null = null;
  private curateMetaRef: EventRef | null = null;
  // General tab live-refresh (UI-002): an external settings change (e.g. the
  // state banner's "Turn off preview" / "Turn on" action) must repaint the
  // General panel's toggles and stat cards, not just the banner itself.
  private generalOffSettings: (() => void) | null = null;
  // General tab live-refresh on tag-metadata changes (UI-003): the startup
  // scan (and "Rescan vault tags") complete asynchronously AFTER onload, and
  // fire tagMetaManager's own 'changed' event, not a settings change. Without
  // this, a General panel rendered before that scan finishes (e.g. right
  // after a full app reload) shows "Total tags / Hidden now / Orphans: 0"
  // forever - nothing else ever repaints it. Mirrors curateMetaRef, which the
  // All-tags tab already had.
  private generalMetaRef: EventRef | null = null;
  // Tab-bar badge live-refresh (UI-005): the Presets/Custom rules badges show
  // ENABLED count, which changes on every toggle - unlike the old fixed
  // totals, a stale badge here would be immediately visible. Refreshing just
  // these two text nodes (instead of a full display()) keeps it instantaneous
  // without disrupting whatever panel/scroll position/expanded state the user
  // is currently in - toggling a preset while ON the Presets tab must not
  // reset its own "More details" expansions.
  private presetsBadgeEl: HTMLElement | null = null;
  private customBadgeEl: HTMLElement | null = null;
  private tabBadgeOffSettings: (() => void) | null = null;
  private ruleEditor: RuleEditor | null = null;
  // The rule id the All tags table is filtered to (null = all tags). Driven
  // by the "Filter by rule" selector and by a Presets deep-link (3-1).
  private curateRuleFilter: string | null = null;
  // Set by a Presets "N tags affected" click just before switching tabs;
  // consumed once on the next renderCurate so the table opens pre-filtered.
  private pendingRuleFilter: string | null = null;

  constructor(app: App, plugin: TagCuratorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('tag-curator-settings');

    // Tear down curate table + its subscriptions and the rule editor before
    // rebuilding DOM (avoids leaked listeners and scroll listeners).
    this.teardownCurate();
    this.teardownGeneral();
    this.tabBadgeOffSettings?.();
    this.tabBadgeOffSettings = null;
    this.ruleEditor?.destroy();
    this.ruleEditor = null;

    // Persistent state banner above everything (D-007).
    if (this.banner) {
      this.banner.destroy();
      this.banner = null;
    }
    this.banner = new StateBanner(containerEl, this.plugin);

    // Tab bar.
    this.tabBar = containerEl.createDiv({ cls: 'tag-curator-top-tabs' });
    this.panelHost = containerEl.createDiv({
      cls: 'tag-curator-panel-host',
    });

    const tabs = this.buildTabDescriptors();
    for (const tab of tabs) {
      const tabEl = this.tabBar.createDiv({ cls: 'tcst-tab' });
      const isActive = tab.id === this.activeTab;
      if (isActive) tabEl.addClass('active');
      // A button group, not an ARIA tablist: a partial tab pattern (no roving
      // tabindex, arrow-key nav, or tabpanel wiring) would be worse than honest
      // buttons. aria-pressed marks the active tab.
      tabEl.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      tabEl.createSpan({ text: tab.label });
      if (tab.badge) {
        const badge = tabEl.createSpan({ cls: 'tcst-badge', text: tab.badge });
        if (tab.badgeKind === 'soon') badge.addClass('tcst-badge-soon');
        if (tab.id === 'presets') this.presetsBadgeEl = badge;
        if (tab.id === 'custom') this.customBadgeEl = badge;
      }
      makeActivatable(tabEl, () => {
        this.activeTab = tab.id;
        this.display();
      });
    }
    // UI-005: keep the enabled-count badges live regardless of which tab is
    // open - a preset toggled from the Presets tab, or a rule from Custom
    // rules (via RuleEditor, which owns its own subscription), both persist
    // through the same settingsManager and fire the same onChange.
    this.tabBadgeOffSettings = this.plugin.settingsManager.onChange(() => {
      this.presetsBadgeEl?.setText(String(this.enabledPresetCount()));
      this.customBadgeEl?.setText(String(this.enabledCustomRuleCount()));
    });

    const active = tabs.find((t) => t.id === this.activeTab) ?? tabs[0];
    const panel = this.panelHost.createDiv({ cls: 'tcst-panel' });
    active.render(panel);
  }

  hide(): void {
    this.teardownCurate();
    this.teardownGeneral();
    this.tabBadgeOffSettings?.();
    this.tabBadgeOffSettings = null;
    this.presetsBadgeEl = null;
    this.customBadgeEl = null;
    this.ruleEditor?.destroy();
    this.ruleEditor = null;
    if (this.banner) {
      this.banner.destroy();
      this.banner = null;
    }
  }

  private teardownCurate(): void {
    this.curateOffSettings?.();
    this.curateOffSettings = null;
    if (this.curateMetaRef) {
      this.plugin.tagMetaManager.offref(this.curateMetaRef);
      this.curateMetaRef = null;
    }
    this.curateTable?.destroy();
    this.curateTable = null;
    this.curateModel = null;
  }

  private teardownGeneral(): void {
    this.generalOffSettings?.();
    this.generalOffSettings = null;
    if (this.generalMetaRef) {
      this.plugin.tagMetaManager.offref(this.generalMetaRef);
      this.generalMetaRef = null;
    }
  }

  // -----------------------------------------------------------------
  // Tab descriptors
  // -----------------------------------------------------------------

  /**
   * Count of built-in presets currently toggled on (UI-005: the badge shows
   * ENABLED count, not the fixed total). Filters against the live PRESETS
   * list rather than trusting `enabledPresets.length` directly, so a stale id
   * left over from a removed preset can never inflate the count.
   */
  private enabledPresetCount(): number {
    const enabled = new Set(this.plugin.settingsManager.get().enabledPresets);
    return PRESETS.filter((p) => enabled.has(p.id)).length;
  }

  /** Count of custom rules currently toggled on (UI-005). */
  private enabledCustomRuleCount(): number {
    return this.plugin.settingsManager.get().customRules.filter((r) => r.enabled).length;
  }

  private buildTabDescriptors(): TabDescriptor[] {
    return [
      { id: 'general', label: 'General', render: (p) => this.renderGeneral(p) },
      { id: 'curate', label: 'All tags', render: (p) => this.renderCurate(p) },
      {
        id: 'scopes',
        label: 'Scopes & integrations',
        render: (p) => this.renderScopes(p),
      },
      {
        id: 'presets',
        label: 'Presets',
        badge: String(this.enabledPresetCount()),
        badgeKind: 'count',
        render: (p) => this.renderPresetsTab(p),
      },
      {
        id: 'custom',
        label: 'Custom rules',
        badge: String(this.enabledCustomRuleCount()),
        badgeKind: 'count',
        render: (p) => this.renderCustomRules(p),
      },
      { id: 'advanced', label: 'Advanced', render: (p) => this.renderAdvanced(p) },
      { id: 'help', label: 'Help', render: (p) => this.renderHelp(p) },
    ];
  }

  // -----------------------------------------------------------------
  // General
  // -----------------------------------------------------------------

  private renderGeneral(panel: HTMLElement): void {
    // Self-teardown before (re)mounting, mirroring renderCurate's own guard
    // (defensive against a re-entrant call while a prior subscription is live).
    this.teardownGeneral();
    const s = this.plugin.settingsManager.get();
    const meta = this.plugin.tagMetaManager.all();
    // The curation-state cards reflect what is actually in effect: when the
    // master switch is off, nothing is curated, so they read 0 (matching the
    // status bar's "off"). Total tags / Orphans stay - those are vault facts,
    // not curation state (1-3).
    const ruleCount = s.enabled ? resolveActiveRules(s).length : 0;
    const hiddenCount = s.enabled ? this.plugin.curatedCount() : 0;
    let orphanCount = 0;
    for (const m of meta.values()) {
      if (m.count <= 1) orphanCount += 1;
    }

    // Stats header on top (1-1).
    const stats = panel.createDiv({ cls: 'tcst-stats' });
    this.renderStatCard(
      stats,
      'Total tags',
      meta.size,
      undefined,
      'Every distinct tag found in your vault, whether shown or hidden.',
    );
    // In preview mode the curated set is flagged in place, not hidden, so the
    // card labels itself honestly rather than always saying "Hidden now".
    this.renderStatCard(
      stats,
      s.enabled && s.previewMode ? 'Flagged now' : 'Hidden now',
      hiddenCount,
      'accent',
      s.enabled && s.previewMode
        ? 'Tags a rule would hide if preview mode were off - flagged in place so you can check before committing.'
        : 'Tags currently hidden by an active rule or override, across every enabled surface.',
    );
    this.renderStatCard(
      stats,
      'Active rules',
      ruleCount,
      undefined,
      'Enabled presets and custom rules currently being applied, combined.',
    );
    this.renderStatCard(
      stats,
      'Orphans',
      orphanCount,
      undefined,
      'Tags that appear in only one note - often typos or one-offs worth reviewing.',
    );

    // Master switch first, then the opt-in pane beneath it (1-1).
    new Setting(panel)
      .setName('Enable Tag Visibility')
      .setDesc(
        'Master switch. When off, every tag shows normally and no DOM is touched.',
      )
      .addToggle((t) =>
        t.setValue(s.enabled).onChange(async (v) => {
          await this.plugin.settingsManager.setEnabled(v);
          // Re-render so the stat cards reflect the new on/off state at once.
          this.display();
        }),
      );

    new Setting(panel)
      .setName('Enable Tag Visibility pane')
      .setDesc(
        'Also surface the tag list as a dockable sidebar pane you can keep open beside the native tag pane. The list always lives in the All tags tab; this adds the docked option.',
      )
      .addToggle((t) =>
        t.setValue(s.paneEnabled).onChange(async (v) => {
          await this.plugin.settingsManager.setPaneEnabled(v);
          this.plugin.applyPaneEnabled();
        }),
      );

    new Setting(panel)
      .setName('Preview mode')
      .setDesc(
        "Instead of hiding matched tags, flag them so you can see exactly what a rule would hide before committing.",
      )
      .addToggle((t) =>
        t.setValue(s.previewMode).onChange(async (v) => {
          await this.plugin.settingsManager.setPreviewMode(v);
          // Refresh so the "Hidden now" / "Flagged now" card relabels live.
          this.display();
        }),
      );

    new Setting(panel).setName('If something looks wrong').setHeading();
    new Setting(panel)
      .setName('Run panic disable')
      .setDesc(
        'One-shot hard reset: instantly un-hides every tag across all surfaces and sweeps the document even if a scope is wedged, then turns the plugin off. Goes further than the master toggle, which only flips the switch. Fully reversible: nothing in your notes is touched. Leaves a "Tag Visibility is off" banner until you re-enable.',
      )
      .addButton((b) =>
        b
          .setButtonText('Run panic disable')
          .setWarning()
          .onClick(() => this.runPanicDisable()),
      );

    // Live-refresh on external settings changes (UI-002): a direct toggle
    // click already re-renders itself explicitly, but a change triggered from
    // outside this panel - the state banner's "Turn off preview" / "Turn on"
    // action, another tab, a command - would otherwise leave these toggles and
    // stat cards showing stale values even though the underlying state (and
    // the banner itself, which subscribes independently) is correct.
    this.generalOffSettings = this.plugin.settingsManager.onChange(() => this.display());
    // Live-refresh on tag-metadata changes (UI-003): the startup scan (and
    // "Rescan vault tags") complete asynchronously and fire tagMetaManager's
    // own 'changed' event, not a settings change - without this subscription
    // a panel rendered before that scan finishes is stuck reading an empty
    // metadata map forever.
    this.generalMetaRef = this.plugin.tagMetaManager.on('changed', () => this.display());
  }

  private renderStatCard(
    parent: HTMLElement,
    label: string,
    value: number | string,
    accent?: 'accent',
    tooltip?: string,
  ): void {
    const card = parent.createDiv({ cls: 'tcst-stat-card' });
    card.createDiv({ cls: 'tcst-stat-label', text: label });
    const v = card.createDiv({ cls: 'tcst-stat-value' });
    if (accent) v.addClass('tcst-stat-accent');
    v.setText(typeof value === 'number' ? value.toLocaleString() : value);
    // UI-004: hover explanation for what the card counts. Obsidian's own
    // tooltip primitive (positioned, themed, dismisses correctly) rather than
    // a bare `title` attribute.
    if (tooltip) setTooltip(card, tooltip);
  }

  private runPanicDisable(): void {
    // Call the SAME hard-reset the command uses (full observer disable + DOM
    // sweep), not a weaker local duplicate (1-2). It flips enabled off, so the
    // re-render shows the "off" banner and zeroed curation stats.
    this.plugin.panicDisable();
    this.display();
  }

  // -----------------------------------------------------------------
  // All tags - always-Manage grid
  // -----------------------------------------------------------------

  private renderCurate(panel: HTMLElement): void {
    // Dispose any previous table and its subscriptions before (re)mounting.
    this.teardownCurate();

    // A Presets "N tags affected" click (3-1) deep-links here with a pending
    // rule id; consume it once so the table opens pre-filtered to that preset.
    if (this.pendingRuleFilter !== null) {
      this.curateRuleFilter = this.pendingRuleFilter;
      this.pendingRuleFilter = null;
    }

    const activeRules = resolveActiveRules(this.plugin.settingsManager.get());
    // Drop a filter that points at a rule no longer active (e.g. its preset was
    // toggled off) so the table never shows a confusing empty result.
    if (
      this.curateRuleFilter &&
      !activeRules.some((r) => r.id === this.curateRuleFilter)
    ) {
      this.curateRuleFilter = null;
    }

    const host = panel.createDiv({ cls: 'tcst-curate-host' });
    const deps = makeTagTableDeps(
      this.plugin,
      this.app,
      () => this.curateTable?.refresh(),
      'settings',
    );
    this.curateModel = deps.model;
    deps.model.setRuleFilter(this.curateRuleFilter);
    // The "Filter by rule" control now lives in the table's own toolbar (item 9),
    // unifying it with search + chips. It lists the active rule set (enabled
    // presets + custom rules) the engine applies; this is what the Presets
    // deep-link needed.
    this.curateTable = new TagTable(host, deps.model, deps.actions, deps.host, {
      initialMode: 'manage',
      surface: 'settings',
      ruleFilter: {
        options: activeRules.map((r) => ({ id: r.id, name: r.name })),
        current: this.curateRuleFilter,
        onChange: (id) => {
          this.curateRuleFilter = id;
          this.curateModel?.setRuleFilter(id);
          this.curateTable?.refresh();
        },
      },
    });
    // Subscribe to shared state so the table live-updates from external changes
    // (e.g. a rule toggle in the workspace, a metadata rescan) - F-1.
    const refreshCurate = (): void => { this.curateTable?.refresh(); };
    this.curateOffSettings = this.plugin.settingsManager.onChange(refreshCurate);
    this.curateMetaRef = this.plugin.tagMetaManager.on('changed', refreshCurate);
  }

  // -----------------------------------------------------------------
  // Scopes (D-014) - per-scope kill-switch toggles
  // -----------------------------------------------------------------

  private renderScopes(panel: HTMLElement): void {
    panel.createEl('p', {
      cls: 'tcst-section-sub',
      text:
        'A scope is a place your tags appear. Tag Visibility can hide or flag tags in each one, independently and reversibly - toggling a scope takes effect immediately, no restart.',
    });

    new Setting(panel).setName('Obsidian surfaces').setHeading();

    new Setting(panel)
      .setName('Tag pane')
      .setDesc("Hide and flag matched tags in Obsidian's native tag pane.")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settingsManager.isScopeEnabled('tag-pane'))
          .onChange(async (v) => {
            await this.plugin.settingsManager.setScopeEnabled('tag-pane', v);
          }),
      );

    new Setting(panel)
      .setName('Properties panel')
      .setDesc('Hide and flag frontmatter tags shown in the Properties panel.')
      .addToggle((t) =>
        t
          .setValue(this.plugin.settingsManager.isScopeEnabled('properties'))
          .onChange(async (v) => {
            await this.plugin.settingsManager.setScopeEnabled('properties', v);
          }),
      );

    new Setting(panel)
      .setName('Autocomplete')
      .setDesc('Hide matched tags from the editor tag suggestion list.')
      .addToggle((t) =>
        t
          .setValue(this.plugin.settingsManager.isScopeEnabled('autocomplete'))
          .onChange(async (v) => {
            await this.plugin.settingsManager.setScopeEnabled('autocomplete', v);
          }),
      );

    new Setting(panel).setName('Plugin integrations').setHeading();

    // Notebook Navigator - a plugin surface Tag Visibility can control; gated on detection.
    const nnHandle = detectNotebookNavigator(this.app);
    const nnDisabled = nnHandle.status !== 'ready';
    let nnDesc = 'Dim and strike through hidden tags (and accent flagged ones) in the Notebook Navigator tag tree (runtime-interop only).';
    if (nnHandle.status !== 'ready' && nnHandle.status !== 'absent') {
      nnDesc += ' Requires Notebook Navigator ' + MIN_API_VERSION + ' or newer.';
    }
    const nn = new Setting(panel)
      .setName('Notebook Navigator')
      .setDesc(nnDesc)
      .addToggle((t) => {
        t
          .setValue(this.plugin.settingsManager.isScopeEnabled('notebook-navigator'))
          .setDisabled(nnDisabled)
          .onChange(async (v) => {
            await this.plugin.settingsManager.setScopeEnabled('notebook-navigator', v);
          });
      });
    if (nnHandle.status === 'ready') {
      this.statusPill(nn, 'active', 'Active');
    } else if (nnHandle.status === 'absent') {
      this.statusPill(nn, 'muted', 'Not installed');
      this.actionLink(nn, 'Install', () => this.openPluginSettings('community-plugins'));
    } else {
      this.statusPill(nn, 'warn', 'Update needed');
      this.actionLink(nn, 'Update plugin', () =>
        this.openPluginSettings('community-plugins'),
      );
    }

    // Optional capability integrations (no scope toggle; detected at runtime).
    this.renderCapabilityIntegration(
      panel,
      'tag-wrangler',
      'Tag Wrangler',
      'Delegate tag renaming; "Send to Tag Wrangler" appears in the panel when it is enabled.',
    );
    this.renderCapabilityIntegration(
      panel,
      'obsidian-style-settings',
      'Style Settings',
      'Restyle the flag color, background, and bold weight from a GUI. Built-in defaults apply otherwise.',
    );
  }

  // -----------------------------------------------------------------
  // Integration status helpers (status pill + action link)
  // -----------------------------------------------------------------

  private renderCapabilityIntegration(
    panel: HTMLElement,
    pluginId: string,
    name: string,
    desc: string,
  ): void {
    const state = this.pluginState(pluginId);
    const s = new Setting(panel).setName(name).setDesc(desc);
    if (state === 'enabled') {
      this.statusPill(s, 'active', 'Active');
      this.actionLink(s, 'Open settings', () => this.openPluginSettings(pluginId));
    } else if (state === 'installed') {
      this.statusPill(s, 'warn', 'Disabled');
      this.actionLink(s, 'Enable', () => this.openPluginSettings('community-plugins'));
    } else {
      this.statusPill(s, 'muted', 'Not installed');
      this.actionLink(s, 'Install', () => this.openPluginSettings('community-plugins'));
    }
  }

  private pluginState(pluginId: string): 'enabled' | 'installed' | 'missing' {
    const plugins = (
      this.app as unknown as {
        plugins?: {
          enabledPlugins?: Set<string>;
          manifests?: Record<string, unknown>;
        };
      }
    ).plugins;
    if (!plugins) return 'missing';
    if (plugins.enabledPlugins?.has(pluginId)) return 'enabled';
    if (plugins.manifests && pluginId in plugins.manifests) return 'installed';
    return 'missing';
  }

  private statusPill(
    setting: Setting,
    kind: 'active' | 'warn' | 'muted',
    text: string,
  ): void {
    const pill = setting.nameEl.createSpan({ cls: 'tc-pill', text });
    pill.addClass(
      kind === 'active'
        ? 'tc-pill-active'
        : kind === 'warn'
          ? 'tc-pill-warn'
          : 'tc-pill-muted',
    );
  }

  private actionLink(setting: Setting, label: string, onClick: () => void): void {
    const link = setting.nameEl.createEl('a', {
      cls: 'tc-action-link',
      text: label,
    });
    makeActivatable(link, (e) => {
      e.preventDefault();
      onClick();
    });
  }

  private openPluginSettings(tabId: string): void {
    const setting = (
      this.app as unknown as {
        setting?: { open?: () => void; openTabById?: (id: string) => void };
      }
    ).setting;
    setting?.open?.();
    setting?.openTabById?.(tabId);
  }

  // -----------------------------------------------------------------
  // Presets tab
  // -----------------------------------------------------------------

  private renderPresetsTab(panel: HTMLElement): void {
    new Setting(panel).setName('Presets').setHeading();
    this.renderPresets(panel);
  }

  // -----------------------------------------------------------------
  // Presets (with affected counts + More details expander)
  // -----------------------------------------------------------------

  private renderPresets(panel: HTMLElement): void {
    panel.createEl('p', {
      cls: 'tcst-section-sub',
      text:
        'Built-in presets are toggleable but not editable - to change one, copy it into a custom rule.',
    });

    const enabled = new Set(this.plugin.settingsManager.get().enabledPresets);

    for (const preset of PRESETS) {
      const card = panel.createDiv({ cls: 'tcst-preset' });
      const isOn = enabled.has(preset.id);
      const body = card.createDiv({ cls: 'tcst-preset-body' });
      const head = body.createDiv({ cls: 'tcst-preset-head' });
      head.createDiv({ cls: 'tcst-preset-nm', text: preset.name });
      head.createSpan({ cls: 'tcst-pill', text: 'built-in' });
      body.createDiv({ cls: 'tcst-preset-dsc', text: preset.description });

      const affected = this.countAffectedTags(preset.rule.match);
      const meta = body.createDiv({ cls: 'tcst-preset-meta' });
      // The affected-count is a link that opens the panel filtered to this preset.
      const affectedEl = meta.createEl('a', { cls: 'tcst-affected' });
      const navigate = (e: Event): void => {
        e.preventDefault();
        // Only navigate when the preset is active: its rule is then in the
        // engine, so the All tags filter has tags to show. When off, the
        // "would hide N tags" label is informational, not a link (3-1).
        if (!this.plugin.settingsManager.get().enabledPresets.includes(preset.id)) {
          return;
        }
        // Stay inside Settings: jump to the All tags tab pre-filtered to this
        // preset instead of opening the pane behind the Settings window.
        this.pendingRuleFilter = preset.id;
        this.activeTab = 'curate';
        this.display();
      };
      const paintAffected = (on: boolean): void => {
        affectedEl.toggleClass('tcst-affected-zero', !on);
        affectedEl.setText(
          on ? `${affected} tags affected` : `would hide ${affected} tags`,
        );
        // A real button only when the preset is on (focusable); inert
        // informational text when off, so keyboard users get no dead control.
        if (on) {
          affectedEl.setAttribute('role', 'button');
          affectedEl.tabIndex = 0;
        } else {
          affectedEl.removeAttribute('role');
          affectedEl.removeAttribute('tabindex');
        }
      };
      paintAffected(isOn);
      affectedEl.addEventListener('click', navigate);
      affectedEl.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') navigate(e);
      });

      const moreToggle = meta.createSpan({
        cls: 'tcst-more-link',
        text: 'More details',
      });
      moreToggle.setAttribute('aria-expanded', 'false');
      const details = body.createDiv({ cls: 'tcst-preset-details' });
      details.addClass('tc-hidden');
      this.renderPresetDetails(details, preset);
      makeActivatable(moreToggle, () => {
        const open = !details.hasClass('tc-hidden');
        details.toggleClass('tc-hidden', open);
        moreToggle.setText(open ? 'More details' : 'Hide details');
        moreToggle.setAttribute('aria-expanded', open ? 'false' : 'true');
      });

      // Toggle on the left; flipping it updates the affected-count label live.
      const toggle = this.renderInlineToggle(
        card,
        isOn,
        async (next) => {
          await this.plugin.settingsManager.setPresetEnabled(preset.id, next);
          paintAffected(next);
        },
        `Enable preset: ${preset.name}`,
      );
      card.prepend(toggle);
    }
  }

  private renderPresetDetails(
    parent: HTMLElement,
    preset: (typeof PRESETS)[number],
  ): void {
    const dl = parent.createDiv({ cls: 'tcst-preset-dl' });
    const matchType = preset.rule.match.type;
    let matchSummary = `type: ${matchType}`;
    if (matchType === 'regex' && preset.rule.match.pattern) {
      matchSummary = `regex /${preset.rule.match.pattern}/`;
    } else if (matchType === 'frequency') {
      matchSummary = `frequency ${preset.rule.match.operator ?? '='} ${
        preset.rule.match.value ?? 0
      }`;
    }
    dl.createSpan({ cls: 'tcst-dl-label', text: 'Match:' });
    const m = dl.createSpan({ cls: 'tcst-dl-value' });
    m.createEl('code', { text: matchSummary });
    dl.createSpan({ cls: 'tcst-dl-label', text: 'Action:' });
    dl.createSpan({ cls: 'tcst-dl-value', text: preset.rule.action });
    if (preset.rule.notes) {
      dl.createSpan({ cls: 'tcst-dl-label', text: 'Notes:' });
      dl.createSpan({ cls: 'tcst-dl-value', text: preset.rule.notes });
    }
  }

  private countAffectedTags(match: {
    type: string;
    pattern?: string;
    operator?: string;
    value?: number;
    list?: string[];
  }): number {
    let count = 0;
    const meta = this.plugin.tagMetaManager.all();
    if (match.type === 'regex' && match.pattern) {
      try {
        // Route through the safe wrapper, not a raw RegExp: this preview iterates
        // every tag with re.test(), so an unsafe pattern (lookbehind, or nested
        // quantifiers that backtrack catastrophically) would freeze here too.
        const re = compileSafeRegex(match.pattern);
        for (const [tag] of meta) if (re.test(tag)) count += 1;
      } catch {
        /* invalid or unsafe regex - report 0 */
      }
    } else if (match.type === 'frequency') {
      const op = match.operator ?? '=';
      const threshold = match.value ?? 0;
      for (const [, m] of meta) {
        const c = m.count;
        if (
          (op === '=' && c === threshold) ||
          (op === '<' && c < threshold) ||
          (op === '<=' && c <= threshold) ||
          (op === '>' && c > threshold) ||
          (op === '>=' && c >= threshold)
        ) {
          count += 1;
        }
      }
    } else if (match.type === 'list' && match.list) {
      const set = new Set(match.list);
      for (const [tag] of meta) if (set.has(tag)) count += 1;
    }
    return count;
  }

  private renderInlineToggle(
    parent: HTMLElement,
    initial: boolean,
    onChange: (next: boolean) => Promise<void> | void,
    ariaLabel?: string,
  ): HTMLElement {
    const toggle = parent.createDiv({ cls: 'tcst-toggle' });
    toggle.toggleClass('on', initial);
    setSwitchState(toggle, initial);
    makeActivatable(
      toggle,
      () => {
        const next = !toggle.hasClass('on');
        toggle.toggleClass('on', next);
        setSwitchState(toggle, next);
        void onChange(next);
      },
      { role: 'switch', ariaLabel },
    );
    return toggle;
  }

  // -----------------------------------------------------------------
  // Custom rules - card view + right-docked preview (D-010)
  // -----------------------------------------------------------------

  private renderCustomRules(panel: HTMLElement): void {
    // Destroy any prior instance to release its settingsManager subscription
    // before constructing a new one (F-2: prevents leak on tab switch).
    this.ruleEditor?.destroy();
    this.ruleEditor = new RuleEditor(panel, this.plugin);
  }

  // -----------------------------------------------------------------
  // Help (Commands + FAQ + About)
  // -----------------------------------------------------------------

  private renderHelp(panel: HTMLElement): void {
    new Setting(panel).setName('Commands').setHeading();
    panel.createEl('p', {
      cls: 'tcst-section-sub',
      text:
        'All commands appear in Obsidian\'s palette (Cmd/Ctrl+P) prefixed "Tag Visibility:". Bind hotkeys in Obsidian\'s hotkey settings - no defaults shipped.',
    });

    const cmds: Array<[string, string]> = [
      ['Toggle enable', 'Master kill switch on/off.'],
      [
        'Panic disable (remove all DOM effects now)',
        'Remove all DOM effects now & disable.',
      ],
      ['Toggle preview mode', 'Flip Preview mode.'],
      [
        'Open the panel',
        'Open / reveal the panel in the right sidebar. Same as clicking the status bar (which opens it pre-filtered to hidden tags) or the ribbon icon.',
      ],
      [
        'Open beside the tag pane',
        'Open / reveal the panel split next to the native tag pane for live side-by-side editing. Also available from the General settings button.',
      ],
      ['Rescan vault tags', 'Rebuild the tag sidecar across all notes.'],
    ];
    const table = panel.createEl('table', { cls: 'tcst-cmd-table' });
    for (const [name, desc] of cmds) {
      const tr = table.createEl('tr');
      tr.createEl('td', { cls: 'tcst-cmd', text: name });
      tr.createEl('td', { cls: 'tcst-cmd-d', text: desc });
    }

    new Setting(panel).setName('FAQ').setHeading();
    const faqs: Array<[string, string]> = [
      [
        'Does Tag Visibility change my notes?',
        'No. It is display-only - it hides or flags tags in the UI and never edits note content. Disabling or uninstalling it restores every tag.',
      ],
      [
        'Where did a tag go?',
        'A preset, rule, or per-tag override is hiding it. Open the panel and use "why is this hidden?" on its row, or run Panic disable to clear all effects at once.',
      ],
      [
        'Does it work on mobile?',
        'The display scopes are DOM-based and work on mobile; the status bar is desktop-only (Obsidian does not render one on mobile).',
      ],
    ];
    for (const [q, a] of faqs) {
      new Setting(panel).setName(q).setDesc(a);
    }

    new Setting(panel).setName('About').setHeading();
    new Setting(panel)
      .setName('Tag Visibility ' + this.plugin.manifest.version)
      .setDesc('Display-only, file-safe, fully reversible tag visibility.')
      .addButton((b) =>
        b.setButtonText('GitHub').onClick(() => {
          window.open('https://github.com/prisant-labs/obsidian-tag-visibility');
        }),
      )
      .addButton((b) =>
        b.setButtonText('Report an issue').onClick(() => {
          window.open('https://github.com/prisant-labs/obsidian-tag-visibility/issues/new');
        }),
      );
  }

  // -----------------------------------------------------------------
  // Advanced
  // -----------------------------------------------------------------

  private renderAdvanced(panel: HTMLElement): void {
    const s = this.plugin.settingsManager.get();

    new Setting(panel).setName('Index maintenance').setHeading();

    new Setting(panel)
      .setName('Reindex vault tags')
      .setDesc(
        'Re-scan every markdown file and rebuild the tag sidecar (tags.json). Run after restoring a vault from backup, syncing across devices, or if the tag list looks out of date.',
      )
      .addButton((b) =>
        b
          .setButtonText('Reindex now')
          .setCta()
          .onClick(() => this.reindexVault()),
      );

    new Setting(panel)
      .setName('Last full reindex')
      .setDesc('Tag count from the most recent full scan.')
      .addText((t) => {
        t.setValue(`${this.plugin.tagMetaManager.all().size} tags`).setDisabled(
          true,
        );
      });

    new Setting(panel).setName('Performance').setHeading();
    new Setting(panel)
      .setName('Sidecar save debounce (ms)')
      .setDesc('How long to batch tag-index writes. Default 5000.')
      .addText((t) => {
        t.setValue(String(s.sidecarDebounceMs)).onChange(async (v) => {
          const ms = Math.max(500, Math.round(Number(v) || 5000));
          await this.plugin.settingsManager.update({ sidecarDebounceMs: ms });
        });
      });

    new Setting(panel).setName('Mode (advanced)').setHeading();
    new Setting(panel)
      .setName('Mode')
      .setDesc(
        'How Tag Visibility filters tags. Default (hide matched) is the only mode today; allow-only and inbox modes are planned.',
      )
      .addDropdown((d) => {
        // Only Default is implemented. Offering allow-only/inbox here would let a
        // user select a mode the engine does not honor yet, so they are withheld
        // until they ship rather than shown as dead options.
        d.addOption('default', 'Default (hide matched)')
          .setValue('default')
          .onChange(async (v) => {
            await this.plugin.settingsManager.update({ mode: v as Mode });
          });
      });
  }

  private async reindexVault(): Promise<void> {
    new Notice('Tag Visibility: rescanning vault tags...');
    await this.plugin.tagMetaManager.scanAll();
    this.plugin.tagPaneObserver.setMetadata(this.plugin.tagMetaManager.all());
    new Notice('Tag Visibility: rescan complete');
    this.display();
  }

}
