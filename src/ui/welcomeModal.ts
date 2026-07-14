/**
 * First-run welcome modal (D-008).
 *
 * Fires once on first enable when settings.seenWelcomeModal is false. Structure:
 *   - Header: state-aware ("Tag Visibility is now enabled" + "Choose how to start")
 *   - Safety promises strip (left-aligned check rows, no centered chunks)
 *   - Two preset cards with toggles (default presets, can be untoggled before start)
 *   - Detected integrations as per-plugin cards with state pills + bullets
 *   - Footer: "Start hiding tags" (primary) + "Start in preview mode" (secondary)
 *
 * Plugin integration detection: v0.1 ships a hardcoded card set; full detection
 * via app.plugins.enabledPlugins is B004 (v0.2). For v0.1 we DO detect known
 * integrations as a courtesy so the cards reflect reality where cheap.
 */
import { App, Modal } from 'obsidian';
import TagCuratorPlugin from '../main';
import { makeActivatable, setSwitchState } from '../util/a11y';

type Choice = 'curating' | 'preview';

interface IntegrationDescriptor {
  id: string;
  name: string;
  bullets: string[];
}

const INTEGRATIONS: IntegrationDescriptor[] = [
  {
    id: 'tag-wrangler',
    name: 'Tag Wrangler',
    bullets: [
      'Per-row "Rename with Tag Wrangler" opens Tag Wrangler\'s own rename dialog for that tag, so renames stay safe. Tag Visibility never renames a tag itself.',
    ],
  },
  {
    id: 'notebook-navigator',
    name: 'Notebook Navigator',
    bullets: [
      'Hidden and flagged tags are decorated in the Notebook Navigator tag tree when a compatible version (>= 2.0.0) is installed.',
    ],
  },
  // Only integrations that actually DO something are listed. A first-run modal is
  // the worst place to advertise unshipped work: it makes a promise to a user who
  // has been running the plugin for ten seconds. Add a descriptor here when the
  // integration ships, not when it is planned.
];

export class WelcomeModal extends Modal {
  constructor(
    app: App,
    private plugin: TagCuratorPlugin,
    private onChoice: (choice: Choice) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('tag-curator-welcome-modal');
    this.titleEl.detach(); // we render our own header
    const c = this.contentEl;
    c.empty();

    // Header: lead with the plugin name + a featured how-it-works intro.
    const head = c.createDiv({ cls: 'tcw-head' });
    head.createEl('h3', { cls: 'tcw-title', text: 'Tag Visibility' });
    head.createDiv({ cls: 'tcw-status', text: 'Now enabled' });
    const intro = head.createDiv({ cls: 'tcw-intro' });
    intro.appendText('Tag Visibility ');
    intro.createEl('strong', { text: 'hides or flags' });
    intro.appendText(
      ' noisy tags from view using presets and your own rules. It is display-only, so your notes are never changed and turning it off restores every tag.',
    );

    // Safety promises (no heading; they sit directly under the intro).
    const promises = c.createDiv({ cls: 'tcw-promises' });
    this.renderPromise(promises, 'Display-only.', 'It never edits your notes.');
    this.renderPromise(promises, 'File-safe.', 'No content is written to markdown.');
    this.renderPromise(promises, 'Fully reversible.', 'Disable Tag Visibility and everything returns.');

    // Default presets (with live toggles). Caption sits directly under the heading.
    c.createDiv({ cls: 'tcw-section-label', text: 'Two presets, on by default' });
    const presetCaption = c.createDiv({ cls: 'tcw-section-caption' });
    presetCaption.setText(
      'These two are suggested and enabled by default - toggle either off to skip it, or change both later in Settings > Presets.',
    );
    this.renderPresetCard(
      c,
      'hide-hex-codes',
      'Hide hex color codes',
      'Filters tags like #ffaa00 left over from CSS in web clippings.',
    );
    this.renderPresetCard(
      c,
      'hide-url-anchors',
      'Hide URL anchor fragments',
      'Filters tags like #section-3 or #top from URL fragments in clippings.',
    );

    // Integrations
    c.createDiv({ cls: 'tcw-section-label', text: 'Integrations we detected' });
    for (const integ of INTEGRATIONS) {
      this.renderIntegrationCard(c, integ);
    }

    // Footer
    const foot = c.createDiv({ cls: 'tcw-foot' });
    const explainer = foot.createDiv({ cls: 'tcw-foot-explainer' });
    explainer.createEl('strong', { text: 'Preview mode ' });
    explainer.appendText(
      'flags matched tags so you can see what would be hidden, without anything actually disappearing. Recommended for the first 24 hours.',
    );
    const previewBtn = foot.createEl('button', {
      cls: 'tcw-btn',
      text: 'Start in preview mode',
    });
    previewBtn.addEventListener('click', () => this.finish('preview'));
    const startBtn = foot.createEl('button', {
      cls: 'tcw-btn tcw-btn-accent',
      text: 'Start hiding tags',
    });
    startBtn.addEventListener('click', () => this.finish('curating'));
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderPromise(parent: HTMLElement, lead: string, rest: string): void {
    const row = parent.createDiv({ cls: 'tcw-promise-row' });
    row.createSpan({ cls: 'tcw-promise-check', text: '✓' });
    const body = row.createDiv();
    body.createEl('strong', { text: lead });
    body.appendText(' ' + rest);
  }

  private renderPresetCard(
    parent: HTMLElement,
    presetId: string,
    name: string,
    desc: string,
  ): void {
    const card = parent.createDiv({ cls: 'tcw-preset' });
    const enabled = this.plugin.settingsManager
      .get()
      .enabledPresets.includes(presetId);
    const toggleWrap = card.createDiv({ cls: 'tcw-toggle' });
    toggleWrap.toggleClass('on', enabled);
    setSwitchState(toggleWrap, enabled);
    makeActivatable(
      toggleWrap,
      () => {
        const isOn = toggleWrap.hasClass('on');
        toggleWrap.toggleClass('on', !isOn);
        setSwitchState(toggleWrap, !isOn);
        void this.plugin.settingsManager.setPresetEnabled(presetId, !isOn);
      },
      { role: 'switch', ariaLabel: `Enable ${name}` },
    );
    const body = card.createDiv({ cls: 'tcw-preset-body' });
    body.createDiv({ cls: 'tcw-preset-name', text: name });
    body.createDiv({ cls: 'tcw-preset-desc', text: desc });
  }

  private renderIntegrationCard(
    parent: HTMLElement,
    integ: IntegrationDescriptor,
  ): void {
    const state = this.detectPluginState(integ.id);
    const card = parent.createDiv({ cls: 'tcw-integ tcw-integ-collapsed' });
    if (state === 'missing') card.addClass('tcw-integ-muted');
    const head = card.createDiv({ cls: 'tcw-integ-head' });
    head.createDiv({ cls: 'tcw-integ-name', text: integ.name });
    const pill = head.createSpan({ cls: 'tcw-integ-pill' });
    if (state === 'enabled') {
      pill.addClass('tcw-integ-pill-enabled');
      pill.setText('Enabled');
    } else if (state === 'installed') {
      pill.addClass('tcw-integ-pill-installed');
      pill.setText('Installed');
    } else {
      pill.addClass('tcw-integ-pill-missing');
      pill.setText('Not installed');
    }
    const chev = head.createSpan({ cls: 'tcw-integ-chev', text: '›' });
    const list = card.createEl('ul', { cls: 'tcw-integ-bullets' });
    for (const bullet of integ.bullets) {
      list.createEl('li', { text: bullet });
    }
    // Collapsed by default; activate the header to expand the bullet detail.
    head.setAttribute('aria-expanded', 'false');
    makeActivatable(head, () => {
      const open = card.hasClass('tcw-integ-open');
      card.toggleClass('tcw-integ-open', !open);
      card.toggleClass('tcw-integ-collapsed', open);
      chev.setText(open ? '›' : '⌄');
      head.setAttribute('aria-expanded', open ? 'false' : 'true');
    });
  }

  private detectPluginState(pluginId: string): 'enabled' | 'installed' | 'missing' {
    // app.plugins is not in the official Obsidian types; access defensively.
    const plugins = (this.app as unknown as {
      plugins?: {
        enabledPlugins?: Set<string>;
        manifests?: Record<string, unknown>;
      };
    }).plugins;
    if (!plugins) return 'missing';
    if (plugins.enabledPlugins?.has(pluginId)) return 'enabled';
    if (plugins.manifests && pluginId in plugins.manifests) return 'installed';
    return 'missing';
  }

  private async finish(choice: Choice): Promise<void> {
    await this.plugin.settingsManager.setSeenWelcomeModal(true);
    if (choice === 'preview') {
      await this.plugin.settingsManager.setPreviewMode(true);
    }
    this.onChoice(choice);
    this.close();
  }
}
