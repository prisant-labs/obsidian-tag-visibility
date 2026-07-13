/**
 * Persistent state banner (D-007).
 *
 * Renders above every Tag Visibility surface whenever the plugin is in a non-default
 * state. Four variants:
 *   - "preview"       (amber)   - Preview mode is on; matched tags are flagged, not hidden.
 *   - "off"           (muted)   - Tag Visibility is off; no tags are being curated.
 *   - "future-schema" (amber)   - data.json was written by a newer plugin; read-only (B-03).
 *   - "unreadable"    (red)     - data.json could not be read; running on defaults (B-01).
 *
 * preview and off carry an inline action so resolving the state is one click.
 * Read-only variants carry no action (remedy is external: update plugin / restore file).
 * Subscribes to settings changes and updates itself; the host surface only has
 * to construct one and call `destroy()` on unload.
 */
import TagCuratorPlugin from '../main';
import type { ReadOnlyReason } from '../storage/settings';

type Variant = 'preview' | 'off' | ReadOnlyReason;

export class StateBanner {
  private root: HTMLElement;
  private unsubscribe: () => void;

  constructor(parent: HTMLElement, private plugin: TagCuratorPlugin) {
    this.root = parent.createDiv({ cls: 'tag-curator-state-banner' });
    this.render();
    // Re-render on any settings change. Cheap because render() short-circuits
    // when the active state is unchanged.
    const handler = (): void => this.render();
    const off = this.plugin.settingsManager.onChange(handler);
    this.unsubscribe = () => {
      // Release the settings listener (the tab constructs a new banner on every
      // display(), so leaking here accumulates for the session - DA-09), and
      // null the root so a render scheduled before destroy() no-ops.
      off();
      this.root = null as unknown as HTMLElement;
    };
  }

  private render(): void {
    if (!this.root) return;
    const s = this.plugin.settingsManager.get();
    // Read-only states take priority over the normal enabled/preview states.
    const readOnly = this.plugin.settingsManager.getReadOnlyReason();
    let variant: Variant | null = null;
    if (readOnly) variant = readOnly;
    else if (!s.enabled) variant = 'off';
    else if (s.previewMode) variant = 'preview';

    this.root.empty();
    if (variant === null) {
      this.root.addClass('tc-hidden');
      this.root.removeAttribute('data-variant');
      return;
    }
    this.root.removeClass('tc-hidden');
    this.root.dataset.variant = variant;

    const icon = this.root.createDiv({ cls: 'sb-ic', text: '!' });
    void icon;
    const msg = this.root.createDiv({ cls: 'sb-msg' });

    if (variant === 'preview') {
      msg.createEl('strong', { text: 'Preview mode is on. ' });
      msg.appendText(
        'Matched tags are flagged in place, not hidden, so you can see exactly what a rule would affect before committing.',
      );
      const action = this.root.createEl('button', { cls: 'sb-action' });
      action.setText('Turn off preview');
      action.addEventListener('click', () => {
        void this.plugin.settingsManager.setPreviewMode(false);
      });
    } else if (variant === 'off') {
      msg.createEl('strong', { text: 'Tag Visibility is off. ' });
      msg.appendText(
        'No tags are being hidden or flagged. Re-enable to apply your rules again. Nothing in your notes is ever changed.',
      );
      const action = this.root.createEl('button', { cls: 'sb-action' });
      action.setText('Turn on');
      action.addEventListener('click', () => {
        void this.plugin.settingsManager.setEnabled(true);
      });
    } else if (variant === 'future-schema') {
      // B-03 AC-3: persistent read-only indicator while future-schema state holds.
      msg.createEl('strong', { text: 'Settings are read-only. ' });
      msg.appendText(
        'data.json was written by a newer version of the plugin. Changes will not be saved until this device updates the plugin.',
      );
    } else if (variant === 'unreadable') {
      // B-01 AC-3 (via B-03 AC-3): persistent read-only indicator for unreadable file.
      msg.createEl('strong', { text: 'Settings could not be read. ' });
      msg.appendText(
        'data.json is unreadable. The plugin is running on defaults; changes will not be saved until the file is restored or removed.',
      );
    }
  }

  destroy(): void {
    this.unsubscribe();
    this.root?.remove();
  }
}
