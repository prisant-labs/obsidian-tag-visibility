import { describe, expect, it } from 'vitest';
import { App } from 'obsidian';
import {
  detectNotebookNavigator,
  meetsMinVersion,
  subscribeReapply,
  MIN_API_VERSION,
} from '../src/integrations/notebookNavigator';
import { NotebookNavigatorApi } from '../src/integrations/notebookNavigatorApi';

function fakeApi(
  version: string,
  overrides: Partial<NotebookNavigatorApi> = {},
): NotebookNavigatorApi {
  return {
    getVersion: () => version,
    isStorageReady: () => true,
    whenReady: () => Promise.resolve(),
    on: () => {},
    off: () => {},
    metadata: { setTagMeta: () => {}, getTagMeta: () => undefined },
    menus: { registerTagMenu: () => {} },
    ...overrides,
  };
}

function appWith(nnPlugin: unknown): App {
  const plugins = nnPlugin === undefined ? {} : { 'notebook-navigator': nnPlugin };
  return { plugins: { plugins } } as unknown as App;
}

describe('detectNotebookNavigator', () => {
  it('returns absent when NN is not enabled', () => {
    const h = detectNotebookNavigator(appWith(undefined));
    expect(h.status).toBe('absent');
    expect(h.api).toBeNull();
  });

  it('returns too-old when NN is present but exposes no API', () => {
    const h = detectNotebookNavigator(appWith({}));
    expect(h.status).toBe('too-old');
    expect(h.api).toBeNull();
  });

  it('returns too-old when the API version is below the minimum', () => {
    const h = detectNotebookNavigator(appWith({ api: fakeApi('1.9.0') }));
    expect(h.status).toBe('too-old');
    expect(h.apiVersion).toBe('1.9.0');
    expect(h.api).toBeNull();
  });

  it('returns ready with the API when NN meets the minimum version', () => {
    const api = fakeApi(MIN_API_VERSION);
    const h = detectNotebookNavigator(appWith({ api }));
    expect(h.status).toBe('ready');
    expect(h.api).toBe(api);
    expect(h.apiVersion).toBe(MIN_API_VERSION);
  });

  it('returns ready for a newer NN', () => {
    const h = detectNotebookNavigator(appWith({ api: fakeApi('3.1.4') }));
    expect(h.status).toBe('ready');
  });
});

describe('meetsMinVersion', () => {
  it('is true for equal and higher versions, false for lower', () => {
    expect(meetsMinVersion('2.0.0', '2.0.0')).toBe(true);
    expect(meetsMinVersion('2.0.1', '2.0.0')).toBe(true);
    expect(meetsMinVersion('3.0.0', '2.0.0')).toBe(true);
    expect(meetsMinVersion('1.9.9', '2.0.0')).toBe(false);
    expect(meetsMinVersion('2.0.0', '2.1.0')).toBe(false);
  });
});

describe('subscribeReapply', () => {
  it('registers on the NN reapply events and unsubscribes them', () => {
    const onCalls: string[] = [];
    const offCalls: string[] = [];
    const api = fakeApi('2.0.0', {
      on: (ev) => onCalls.push(ev),
      off: (ev) => offCalls.push(ev),
    });
    const unsub = subscribeReapply(api, () => {});
    expect(onCalls).toEqual(['storage-ready', 'tag-changed']);
    unsub();
    expect(offCalls).toEqual(['storage-ready', 'tag-changed']);
  });

  it('degrades to a no-op when the API lacks on/off, instead of throwing (DA-16)', () => {
    const api = fakeApi('2.0.0', {
      on: undefined as unknown as NotebookNavigatorApi['on'],
    });
    let unsub: () => void = () => {};
    expect(() => {
      unsub = subscribeReapply(api, () => {});
    }).not.toThrow();
    expect(() => unsub()).not.toThrow();
  });
});
