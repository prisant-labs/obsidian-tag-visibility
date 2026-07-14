import { Rule, RulePreset, TagCuratorSettings } from '../types';

export const PRESETS: RulePreset[] = [
  {
    id: 'hide-hex-codes',
    name: 'Hide hex color codes',
    description: 'Hide tags that look like hex color codes (e.g. FFAA00, abcdef).',
    rule: {
      id: 'hide-hex-codes',
      name: 'Hide hex color codes',
      enabled: true,
      priority: 100,
      builtin: true,
      match: { type: 'regex', pattern: '^[0-9A-Fa-f]{3,8}$' },
      action: 'hide',      notes: 'Catches CSS hex codes from web clippings, especially via MarkDownload.',
    },
  },
  {
    id: 'hide-url-anchors',
    name: 'Hide URL anchor fragments',
    description: 'Hide tags that look like URL fragments (e.g. section-3, top, content).',
    rule: {
      id: 'hide-url-anchors',
      name: 'Hide URL anchor fragments',
      enabled: true,
      priority: 95,
      builtin: true,
      match: {
        type: 'regex',
        pattern: '^(top|bottom|navigation|content|main|header|footer|sidebar|toc)$|^[a-z]+-[0-9]+$',
      },
      action: 'hide',      notes: 'Common URL fragment patterns from web clippings.',
    },
  },
  {
    id: 'hide-single-char',
    name: 'Hide single-character tags',
    description: 'Hide tags of one ASCII letter (e.g. #a, #x).',
    rule: {
      id: 'hide-single-char',
      name: 'Hide single-character tags',
      enabled: false,
      priority: 90,
      builtin: true,
      match: { type: 'regex', pattern: '^[A-Za-z]$' },
      action: 'hide',      notes: 'Likely typos or single-character shortcuts.',
    },
  },
  {
    id: 'hide-numeric',
    name: 'Hide purely numeric tags',
    description: 'Hide tags that contain only digits (edge case; Obsidian usually strips these).',
    rule: {
      id: 'hide-numeric',
      name: 'Hide purely numeric tags',
      enabled: false,
      priority: 85,
      builtin: true,
      match: { type: 'regex', pattern: '^[0-9]+$' },
      action: 'hide',      notes: 'Catchall for numeric tags.',
    },
  },
  {
    id: 'hide-orphans',
    name: 'Hide orphan tags (count <= 1)',
    description: 'Hide tags that appear in one or fewer notes.',
    rule: {
      id: 'hide-orphans',
      name: 'Hide orphan tags (count <= 1)',
      enabled: false,
      priority: 80,
      builtin: true,
      match: { type: 'frequency', operator: '<=', value: 1 },
      action: 'hide',      notes: 'Tags appearing only once are likely typos or experiments.',
    },
  },
];

export function getPresetById(id: string): RulePreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

export function resolveActiveRules(settings: TagCuratorSettings): Rule[] {
  const presetRules: Rule[] = settings.enabledPresets
    .map((id) => getPresetById(id)?.rule)
    .filter((r): r is Rule => Boolean(r))
    .map((r) => ({ ...r, enabled: true }));
  const customRules = settings.customRules.filter((r) => r.enabled);
  return [...presetRules, ...customRules].sort((a, b) => b.priority - a.priority);
}
