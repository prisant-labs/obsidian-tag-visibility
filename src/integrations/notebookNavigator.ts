import { App } from 'obsidian';
import { NnEventName, NotebookNavigatorApi } from './notebookNavigatorApi';

/** Minimum NN public-API version Tag Visibility supports (decision 2, 2026-05-29). */
export const MIN_API_VERSION = '2.0.0';

const NN_PLUGIN_ID = 'notebook-navigator';

/** NN events that change the tag tree and require re-decoration. */
const REAPPLY_EVENTS: NnEventName[] = ['storage-ready', 'tag-changed'];

export type NnStatus = 'absent' | 'too-old' | 'ready';

export interface NnHandle {
  status: NnStatus;
  /** Non-null only when status is 'ready'. */
  api: NotebookNavigatorApi | null;
  apiVersion: string | null;
}

interface PluginInstance {
  api?: NotebookNavigatorApi;
}
interface PluginsRegistry {
  plugins?: Record<string, PluginInstance | undefined>;
}

/**
 * Detect Notebook Navigator and decide whether Tag Visibility's NN scope can run.
 *   - absent: NN is not enabled. Silent no-op.
 *   - too-old: NN is enabled but its API is missing or below MIN_API_VERSION.
 *     The caller shows a one-time notice and skips the entire scope.
 *   - ready: NN is enabled and new enough. Both hide and flag seams may run.
 */
export function detectNotebookNavigator(app: App): NnHandle {
  const registry = (app as unknown as { plugins?: PluginsRegistry }).plugins;
  const plugin = registry?.plugins?.[NN_PLUGIN_ID];
  if (!plugin) {
    return { status: 'absent', api: null, apiVersion: null };
  }
  const api = plugin.api ?? null;
  const apiVersion = api?.getVersion?.() ?? null;
  if (!api || !apiVersion || !meetsMinVersion(apiVersion, MIN_API_VERSION)) {
    return { status: 'too-old', api: null, apiVersion };
  }
  return { status: 'ready', api, apiVersion };
}

/** True when `version` is >= `min` by semantic major.minor.patch comparison. */
export function meetsMinVersion(version: string, min: string): boolean {
  const v = parseVersion(version);
  const m = parseVersion(min);
  for (let i = 0; i < 3; i++) {
    if (v[i] > m[i]) return true;
    if (v[i] < m[i]) return false;
  }
  return true;
}

function parseVersion(v: string): [number, number, number] {
  const parts = v.split('.').map((p) => parseInt(p, 10));
  return [
    Number.isFinite(parts[0]) ? parts[0] : 0,
    Number.isFinite(parts[1]) ? parts[1] : 0,
    Number.isFinite(parts[2]) ? parts[2] : 0,
  ];
}

/**
 * Subscribe a re-decorate callback to the NN events that change the tag tree.
 * Returns an unsubscribe function. Phase 3 uses this so the hide decorator is
 * reapplied after NN re-renders (the tree is virtualized).
 */
export function subscribeReapply(
  api: NotebookNavigatorApi,
  cb: () => void,
): () => void {
  // Feature-detect the event seam: a future NN that passes the version gate but
  // reshapes on/off must degrade to "no live re-decoration", never a TypeError
  // at subscribe or unsubscribe time (DA-16).
  if (typeof api.on !== 'function' || typeof api.off !== 'function') {
    return () => {};
  }
  for (const ev of REAPPLY_EVENTS) api.on(ev, cb);
  return () => {
    for (const ev of REAPPLY_EVENTS) api.off(ev, cb);
  };
}
