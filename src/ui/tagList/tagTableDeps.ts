import { App } from 'obsidian';
import TagCuratorPlugin from '../../main';
import { resolveActiveRules } from '../../engine/presets';
import { TableSurface } from '../../types';
import { TagListModel, TagListDataSource } from './tagListModel';
import { TagActions, TagActionsHost } from './tagActions';
import { TagListDiagnosticsHost } from '../curationWorkspace/tagTableHost';

export interface TagTableDeps {
  model: TagListModel;
  actions: TagActions;
  host: TagListDiagnosticsHost;
}

/**
 * Build the headless trio that drives a TagTable, for ANY host surface (the
 * dockable leaf or the All tags settings tab). `requestRefresh` is the
 * surface's own repaint callback; `surface` selects which independent column
 * prefs slot this table reads and writes (item 8a).
 */
export function makeTagTableDeps(
  plugin: TagCuratorPlugin,
  app: App,
  requestRefresh: () => void,
  surface: TableSurface,
): TagTableDeps {
  const dataSource: TagListDataSource = {
    getSettings: () => plugin.settingsManager.get(),
    getMeta: () => plugin.tagMetaManager.all(),
  };
  const model = new TagListModel(dataSource);

  const isPluginEnabled = (id: string): boolean => {
    const plugins = (app as unknown as {
      plugins?: { enabledPlugins?: Set<string> };
    }).plugins;
    return Boolean(plugins?.enabledPlugins?.has(id));
  };

  const actionsHost: TagActionsHost = {
    isPluginEnabled,
    executeCommand: (id) => {
      const commands = (app as unknown as {
        commands?: { executeCommandById?: (id: string) => boolean };
      }).commands;
      return Boolean(commands?.executeCommandById?.(id));
    },
    setOverride: (tag, value) => plugin.settingsManager.setOverride(tag, value),
    setReviewedBulk: (tags, value) => plugin.tagMetaManager.setReviewedBulk(tags, value),
  };
  const actions = new TagActions(actionsHost);

  const host: TagListDiagnosticsHost = {
    getSettings: () => plugin.settingsManager.get(),
    getMeta: () => plugin.tagMetaManager.all(),
    getActiveRules: () => resolveActiveRules(plugin.settingsManager.get()),
    isPluginEnabled,
    requestRefresh,
    searchTag: (tag) => {
      const search = (app as unknown as {
        internalPlugins?: {
          getPluginById?: (id: string) => { instance?: { openGlobalSearch?: (q: string) => void } } | null;
        };
      }).internalPlugins?.getPluginById?.('global-search')?.instance;
      search?.openGlobalSearch?.(`tag:#${tag}`);
    },
    getColumns: () => plugin.settingsManager.getTableColumns(surface),
    setColumns: (cols) => {
      void plugin.settingsManager.setTableColumns(surface, cols);
    },
  };

  return { model, actions, host };
}
