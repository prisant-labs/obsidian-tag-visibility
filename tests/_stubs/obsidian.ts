/**
 * Minimal stub of the `obsidian` module for unit tests.
 *
 * Grows on demand. Anything the production code imports from `obsidian` must
 * have at least a no-op export here so import resolution succeeds. Test files
 * construct the App/Plugin/View instances they need with whatever shape they
 * need - this stub only provides the constructors and types.
 */

// --- Metadata ---

export interface CachedMetadata {
  tags?: Array<{ tag: string }>;
  frontmatter?: { tags?: string | string[] };
}

export function getAllTags(cache: CachedMetadata | null): string[] | null {
  if (!cache) return null;
  const out: string[] = [];
  for (const t of cache.tags ?? []) out.push(t.tag);
  const fm = cache.frontmatter?.tags;
  if (typeof fm === 'string') out.push(`#${fm}`);
  else if (Array.isArray(fm)) for (const t of fm) out.push(`#${t}`);
  return out;
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/');
}

// --- Files ---

export class TFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  constructor(path: string) {
    this.path = path;
    const parts = path.split('/');
    this.name = parts[parts.length - 1];
    const dot = this.name.lastIndexOf('.');
    this.basename = dot >= 0 ? this.name.slice(0, dot) : this.name;
    this.extension = dot >= 0 ? this.name.slice(dot + 1) : '';
  }
}

// --- Events base class ---

export class Events {
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  on(event: string, cb: (...args: unknown[]) => void): EventRef {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
    return { event, cb } as EventRef;
  }

  off(event: string, cb: (...args: unknown[]) => void): void {
    const list = this.listeners.get(event);
    if (!list) return;
    this.listeners.set(
      event,
      list.filter((x) => x !== cb),
    );
  }

  trigger(event: string, ...args: unknown[]): void {
    const list = this.listeners.get(event) ?? [];
    for (const cb of [...list]) cb(...args);
  }
}

export interface EventRef {
  event: string;
  cb: (...args: unknown[]) => void;
}

// --- Plugin ---

export class Plugin {
  data: unknown = null;
  manifest: { id: string; dir?: string } = { id: 'tag-visibility' };
  registeredEvents: EventRef[] = [];
  registeredCleanups: Array<() => void> = [];

  async loadData(): Promise<unknown> {
    return this.data;
  }
  async saveData(data: unknown): Promise<void> {
    this.data = data;
  }
  registerEvent(ref: EventRef): void {
    this.registeredEvents.push(ref);
  }
  register(cleanup: () => void): void {
    this.registeredCleanups.push(cleanup);
  }
}

// --- Notice ---

export class Notice {
  message: string;
  constructor(message: string) {
    this.message = message;
  }
}

// --- View / Leaf / Workspace ---

export class View {
  containerEl: HTMLElement;
  constructor(containerEl?: HTMLElement) {
    this.containerEl = containerEl ?? (typeof document !== 'undefined' ? document.createElement('div') : ({} as HTMLElement));
  }
}

export class WorkspaceLeaf {
  view: View;
  isDeferred = false;
  constructor(view?: View) {
    this.view = view ?? new View();
  }
  loadIfDeferred(): void {
    this.isDeferred = false;
  }
  async setViewState(_state: { type: string }): Promise<void> {
    // no-op
  }
}

// --- Menu / icons ---
// No-op stubs so modules importing them (e.g. rowMenu) resolve in tests. The
// menu's DOM behavior is a manual-test concern; unit tests exercise the pure
// decision functions (which items to build) instead.

export function setIcon(_el: HTMLElement, _icon: string): void {
  // no-op
}

export class MenuItem {
  setTitle(_title: string): this {
    return this;
  }
  setIcon(_icon: string): this {
    return this;
  }
  onClick(_cb: (evt?: unknown) => unknown): this {
    return this;
  }
}

export class Menu {
  addItem(cb: (item: MenuItem) => void): this {
    cb(new MenuItem());
    return this;
  }
  addSeparator(): this {
    return this;
  }
  showAtMouseEvent(_evt: MouseEvent): void {
    // no-op
  }
}
