// v10: reviewed state moved out of the discardable tags.json sidecar into durable
// settings (reviewedTags) so it survives a sidecar rebuild/loss (P2-09).
export const SCHEMA_VERSION = 10;

export type Mode = 'default' | 'allow-only' | 'inbox';

export type Action = 'hide' | 'show-only' | 'flag' | 'group' | 'delegate-color';

export type Scope =
  | 'tag-pane'
  | 'graph'
  | 'local-graph'
  | 'autocomplete'
  | 'properties'
  | 'search-facets'
  | 'quick-switcher'
  | 'backlinks'
  | 'hover-preview'
  | 'bases'
  | 'notebook-navigator'
  | 'tag-wrangler-menu';

export type MatchType = 'regex' | 'frequency' | 'list';
export type FrequencyOperator = '<' | '<=' | '>' | '>=' | '=';

export interface MatchCriteria {
  type: MatchType;
  pattern?: string;
  operator?: FrequencyOperator;
  value?: number;
  list?: string[];
}

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  match: MatchCriteria;
  action: Action;
  notes?: string;
  builtin?: boolean;
}

export type TagSource = 'frontmatter' | 'inline';

/**
 * Per-tag visibility override (D-015). A tag pinned to 'show' is always visible
 * (the spec's safety net, beats every rule); a tag pinned to 'hide' is always
 * hidden without authoring a rule (beats every rule except an always-show on the
 * same tag, which cannot co-occur since the store holds one value per tag).
 */
export type TagOverride = 'show' | 'hide';

/**
 * Which optional data columns the tag table shows (2-5). Tag, Count, and
 * Visible are always shown; these three are user-toggleable via the column
 * selector and persisted so the choice sticks across remounts.
 */
export interface TableColumnPrefs {
  lastSeen: boolean;
  source: boolean;
  rule: boolean;
}

/**
 * The two surfaces that host the tag table. Column visibility is kept
 * independently per surface (a narrow docked pane and the wide All tags
 * settings tab want different column sets - item 8a).
 */
export type TableSurface = 'pane' | 'settings';

export interface TagMeta {
  tag: string;
  firstSeen: number;
  lastSeen: number;
  count: number;
  sources: TagSource[];
  description?: string;
  aliases?: string[];
  reviewed?: boolean;
}

export interface TagCuratorSettings {
  schemaVersion: number;
  enabled: boolean;
  mode: Mode;
  enabledPresets: string[];
  customRules: Rule[];
  // Per-tag visibility overrides (D-015), keyed by tag (no leading #). Resolved
  // ahead of rules: 'show' beats every rule, 'hide' beats every rule except an
  // always-show on the same tag. Schema v4 added this; v3->v4 defaults it to {}.
  overrides: Record<string, TagOverride>;
  // Per-scope global enable, keyed by Scope (e.g. 'tag-pane', 'notebook-navigator').
  // This is the "is this surface live at all" global switch and the only scope
  // control (rules themselves are global, applying to every enabled surface). A
  // scope absent from the map is treated as enabled (see isScopeEnabled): the four
  // v1.0 scopes default true. Schema v5 added this; v4->v5 defaults it. Phases 6-8
  // reuse this field for properties / autocomplete / the Settings Scopes section.
  scopeEnabled: Record<string, boolean>;
  previewMode: boolean;
  sidecarDebounceMs: number;
  // First-run welcome modal (D-008). False on a fresh install, true once dismissed.
  // Schema v3 added this; migration from v2 defaults it to false (so existing BRAT
  // testers see the modal once on next load - intentional).
  seenWelcomeModal: boolean;
  // One-time "Notebook Navigator is too old for the NN scope" notice (Phase 5B).
  // False until the notice has been shown once; flipped true and persisted so the
  // user is not nagged on every load when NN is below MIN_API_VERSION.
  seenNnTooOldNotice: boolean;
  // Whether the dockable Tag Visibility pane is available (on by default). Curation
  // always lives in the All tags settings tab; this only governs the sidebar
  // leaf, its ribbon icon, and the open-pane commands. Schema v6 added this.
  paneEnabled: boolean;
  // Which optional tag-table columns are visible (2-5), kept independently per
  // surface (item 8a). Schema v7 added a flat shape; v8 reshaped it per surface.
  tableColumns: Record<TableSurface, TableColumnPrefs>;
  // Tags the user has marked reviewed, keyed by tag (no leading '#'). This is
  // user-owned, non-derivable state, so it lives here in durable settings, NOT in
  // the rebuildable tags.json sidecar. Schema v10 added this; the v9->v10 step
  // defaults it and TagMetaManager lifts any legacy sidecar flags once (P2-09).
  reviewedTags: Record<string, true>;
}

export const DEFAULT_SETTINGS: TagCuratorSettings = {
  schemaVersion: SCHEMA_VERSION,
  enabled: true,
  mode: 'default',
  enabledPresets: ['hide-hex-codes', 'hide-url-anchors'],
  customRules: [],
  overrides: {},
  // The four v1.0 scopes ship enabled. Unlisted scopes are treated as enabled by
  // isScopeEnabled, so adding a scope here is only needed to ship it OFF by default.
  scopeEnabled: {
    'tag-pane': true,
    'notebook-navigator': true,
    properties: true,
    autocomplete: true,
  },
  previewMode: false,
  seenWelcomeModal: false,
  seenNnTooOldNotice: false,
  paneEnabled: true,
  // The narrow docked pane opens lean - tag / count / visibility only (item 3) -
  // while the wide All tags settings tab shows every column.
  tableColumns: {
    pane: { lastSeen: false, source: false, rule: false },
    settings: { lastSeen: true, source: true, rule: true },
  },
  reviewedTags: {},
  sidecarDebounceMs: 5000,
};

export interface RulePreset {
  id: string;
  name: string;
  description: string;
  rule: Rule;
}

export interface MatchResult {
  matched: boolean;
  ruleId: string;
  ruleName: string;
}

export interface AttributedMatch {
  ruleId: string;
  ruleName: string;
  action: Action;
  priority: number;
  builtin: boolean;
  reason: string;
  // Set only when this match comes from a per-tag override (D-015) rather than a
  // rule. Lets RuleEngine.resolveVisibility return the existing RuleAttribution
  // shape (so TagListModel and ObserverBase consume one type) while flagging that
  // the effective reason is an always-show / always-hide override, not a rule.
  overrideReason?: 'always-show' | 'always-hide';
}

export interface RuleAttribution {
  tag: string;
  effective: AttributedMatch | null;
  allMatches: AttributedMatch[];
}
