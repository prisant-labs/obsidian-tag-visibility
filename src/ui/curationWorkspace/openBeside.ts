import type { Workspace, WorkspaceLeaf } from 'obsidian';

export interface OpenBesideDeps {
  workspace: Pick<Workspace, 'getLeavesOfType' | 'getLeftLeaf' | 'createLeafBySplit' | 'revealLeaf'>;
  isMobile: boolean;
  curationViewType: string;
  /** Open (or reveal) the Curation Workspace pane full-width. */
  openPane: () => Promise<void>;
  notify: (message: string) => void;
}

/**
 * Open (or reveal) the Curation Workspace beside the native tag pane so editing
 * a rule and watching the tag pane react is one continuous glance (D-013).
 *
 * On mobile there is no side-by-side split layout, so the pane opens full-width
 * rather than leaving a useless squeezed sliver beside it (MOB-008).
 *
 * Desktop strategy:
 * 1. Locate or create the native tag pane (`tag` view type).
 * 2. If a Curation Workspace leaf already exists, reveal it.
 * 3. Otherwise split the tag-pane leaf so the workspace docks beside it.
 * 4. Fallback: if no tag-pane leaf is available, open the pane full-width.
 */
export async function openBesideTagPane(deps: OpenBesideDeps): Promise<void> {
  const { workspace, isMobile, curationViewType, openPane, notify } = deps;

  // Mobile has no split panes; open the pane full-width (MOB-008).
  if (isMobile) {
    await openPane();
    return;
  }

  // Step 1: ensure the native tag pane exists.
  let tagLeaves = workspace.getLeavesOfType('tag');
  let tagLeaf: WorkspaceLeaf | null = tagLeaves[0] ?? null;
  if (!tagLeaf) {
    tagLeaf = workspace.getLeftLeaf(false);
    if (tagLeaf) {
      await tagLeaf.setViewState({ type: 'tag', active: true });
      await workspace.revealLeaf(tagLeaf);
      tagLeaves = workspace.getLeavesOfType('tag');
      tagLeaf = tagLeaves[0] ?? tagLeaf;
    }
  }

  // Step 2: reuse an existing workspace leaf if one is already open.
  const existing = workspace.getLeavesOfType(curationViewType);
  if (existing.length > 0) {
    await workspace.revealLeaf(existing[0]);
    return;
  }

  // Step 3: create a split leaf next to the tag pane.
  if (tagLeaf) {
    const splitLeaf = workspace.createLeafBySplit(tagLeaf, 'vertical', false);
    await splitLeaf.setViewState({ type: curationViewType, active: true });
    await workspace.revealLeaf(splitLeaf);
    return;
  }

  // Fallback: no tag pane and no split available.
  notify('Tag Visibility: could not open beside the tag pane - opening in sidebar instead.');
  await openPane();
}
