/**
 * Per-row override menu and "why is this affected?" diagnostics (Phase 3B-1,
 * Step 4).
 *
 * The override actions (Always show / Always hide / Clear override) route
 * through TagActions.setVisibility, which writes a per-tag override (D-015) that
 * the rule engine resolves ahead of rules. The diagnostics consume
 * RuleEngine.resolveVisibility / getRuleAttribution only - no new engine logic
 * here, we just render the attribution chain the engine already computes.
 *
 * DOM behaviors (the obsidian Menu, the popover) are exercised in the Phase 11
 * manual TESTING matrix, not unit tests: the obsidian stub does not implement
 * Menu or a full DOM, so forcing a brittle DOM test would test the stub, not
 * the plugin.
 */
import { Menu, setIcon } from 'obsidian';
import { RuleEngine } from '../../engine/ruleEngine';
import { TagOverride } from '../../types';
import { TagActions, VisibilityIntent } from '../tagList/tagActions';
import { TagListDiagnosticsHost } from './tagTableHost';

export interface OverrideMenuSpec {
  title: string;
  icon: string;
  intent: VisibilityIntent;
}

/**
 * Which override actions to offer for a tag, in menu order. Pure so the choice is
 * unit-testable without Obsidian's Menu (see the module note above). "Always
 * show" / "Always hide" are always available; "Clear override" only makes sense
 * when an override actually exists for THIS tag, so it is omitted otherwise (#1b).
 */
export function overrideMenuSpecs(
  tag: string,
  overrides: Record<string, TagOverride>,
): OverrideMenuSpec[] {
  const specs: OverrideMenuSpec[] = [
    { title: 'Always show', icon: 'eye', intent: 'show' },
    { title: 'Always hide', icon: 'eye-off', intent: 'hide' },
  ];
  // Object.hasOwn: a tag named like an Object.prototype member must not read an
  // inherited function as a fake override (DA-08).
  if (Object.hasOwn(overrides, tag)) {
    specs.push({ title: 'Clear override', icon: 'rotate-ccw', intent: 'clear' });
  }
  return specs;
}

/**
 * Open the per-row override menu at the click position. Each override action
 * awaits the write and then refreshes; the settings onChange triggered by the
 * write also refreshes, but awaiting first keeps the UI honest if a write ever
 * slows down.
 */
export function openRowMenu(
  evt: MouseEvent,
  tag: string,
  actions: TagActions,
  host: TagListDiagnosticsHost,
): void {
  const menu = new Menu();

  const overrideItem = (
    title: string,
    icon: string,
    intent: VisibilityIntent,
  ): void => {
    menu.addItem((item) =>
      item
        .setTitle(title)
        .setIcon(icon)
        .onClick(async () => {
          await actions.setVisibility([tag], intent);
          host.requestRefresh();
        }),
    );
  };

  for (const spec of overrideMenuSpecs(tag, host.getSettings().overrides)) {
    overrideItem(spec.title, spec.icon, spec.intent);
  }

  // Tag Wrangler delegation (D-016, optional): only offered when Tag Wrangler
  // is enabled. Reuses the tested TagActions.sendToTagWrangler dispatch (which
  // executes 'tag-wrangler:rename-tag'); no rename logic lives here. When Tag
  // Wrangler is absent the item is simply not shown.
  if (host.isPluginEnabled('tag-wrangler')) {
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle('Rename with Tag Wrangler')
        .setIcon('pencil')
        .onClick(() => {
          actions.sendToTagWrangler([tag]);
        }),
    );
  }

  menu.addSeparator();
  const isReviewed = Boolean(host.getMeta().get(tag)?.reviewed);
  menu.addItem((item) =>
    item
      .setTitle(isReviewed ? 'Mark unreviewed' : 'Mark reviewed')
      .setIcon(isReviewed ? 'rotate-ccw' : 'check')
      .onClick(async () => {
        await actions.markReviewed([tag], !isReviewed);
        host.requestRefresh();
      }),
  );

  menu.addSeparator();
  menu.addItem((item) =>
    item
      .setTitle('Why is this affected?')
      .setIcon('help-circle')
      .onClick(() => showWhyAffected(evt, tag, host)),
  );

  menu.showAtMouseEvent(evt);
}

/**
 * Build the human explanation lines for a tag from the engine attribution.
 * Pure (no DOM) so the wording is easy to reason about and reuse.
 *
 * - An always-show / always-hide override is the sole, supreme reason.
 * - Otherwise the effective rule leads, with its human reason, and any further
 *   matching rules follow as the rest of the chain.
 * - No effective match means nothing is hiding the tag.
 */
export function whyAffectedLines(
  tag: string,
  host: TagListDiagnosticsHost,
): { heading: string; detail: string[] } {
  const meta = host.getMeta().get(tag);
  const attribution = RuleEngine.resolveVisibility(
    tag,
    meta,
    host.getActiveRules(),
    host.getSettings().overrides,
  );
  const eff = attribution.effective;

  if (!eff) {
    return {
      heading: 'Shown',
      detail: ['No rule or override affects this tag. It is shown everywhere.'],
    };
  }
  if (eff.overrideReason === 'always-show') {
    return {
      heading: 'Always shown by you',
      detail: [
        'You pinned this tag to always show. This safety-net override beats every rule.',
      ],
    };
  }
  if (eff.overrideReason === 'always-hide') {
    return {
      heading: 'Always hidden by you',
      detail: ['You pinned this tag to always hide. This override beats every rule.'],
    };
  }

  const detail: string[] = [`${eff.ruleName}: ${eff.reason} (the effective rule).`];
  const rest = attribution.allMatches.slice(1);
  if (rest.length > 0) {
    detail.push('Also matched by:');
    for (const m of rest) detail.push(`- ${m.ruleName}: ${m.reason}`);
  }
  return { heading: `Affected by ${eff.ruleName}`, detail };
}

/**
 * Render a small dismissible popover near the click point with the
 * why-affected explanation. Clicking anywhere outside (or pressing Escape)
 * closes it.
 */
function showWhyAffected(
  evt: MouseEvent,
  tag: string,
  host: TagListDiagnosticsHost,
): void {
  const { heading, detail } = whyAffectedLines(tag, host);

  const pop = document.body.createDiv({ cls: 'tct-why-pop' });
  const head = pop.createDiv({ cls: 'tct-why-head' });
  const headIcon = head.createSpan({ cls: 'tct-why-head-ic' });
  setIcon(headIcon, 'info');
  head.createSpan({ text: heading });
  const body = pop.createDiv({ cls: 'tct-why-body' });
  for (const line of detail) body.createDiv({ cls: 'tct-why-line', text: line });

  // Position near the click, then nudge back on-screen if it would overflow.
  // position:fixed lives in .tct-why-pop; only the coordinates are dynamic.
  pop.style.left = `${evt.clientX}px`;
  pop.style.top = `${evt.clientY + 8}px`;
  const rect = pop.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    pop.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
  }
  if (rect.bottom > window.innerHeight) {
    pop.style.top = `${Math.max(8, evt.clientY - rect.height - 8)}px`;
  }

  // Single idempotent teardown. A closed flag plus the deferred-wire timer id
  // mean listeners are never added after teardown (a rapid re-render could
  // remove the popover within the same tick) and never double-removed. blur and
  // resize also dismiss it, so the fixed-position popover cannot linger detached
  // after a layout change.
  let closed = false;
  let wireTimer = 0;
  const close = (): void => {
    if (closed) return;
    closed = true;
    window.clearTimeout(wireTimer);
    pop.remove();
    document.removeEventListener('mousedown', onDocMouseDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('blur', close);
    window.removeEventListener('resize', close);
  };
  const onDocMouseDown = (e: MouseEvent): void => {
    if (!pop.contains(e.target as Node)) close();
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  // Defer wiring the outside-click listener so the click that opened the menu
  // does not immediately close the popover.
  wireTimer = window.setTimeout(() => {
    if (closed) return;
    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
  }, 0);
}
