/**
 * Obsidian's DOM extensions, for happy-dom.
 *
 * Obsidian augments HTMLElement at runtime (createDiv, empty, addClass, ...).
 * happy-dom does not have them, which is why every component under src/ui/ was
 * untestable and had zero unit coverage: the observers only READ the DOM, so the
 * observer suites never needed these. DA-25 (the tag table under-rendering on an
 * unmeasured container) was the first bug that forced the issue.
 *
 * Import this for its side effect at the top of any happy-dom UI test:
 *   import './_stubs/obsidianDom';
 *
 * Only the extensions src/ui actually uses are implemented. Add more as needed;
 * do not grow this into a full re-implementation of Obsidian.
 */

interface DomElementInfo {
  cls?: string | string[];
  text?: string;
  type?: string;
  attr?: Record<string, string | number | boolean | null>;
  href?: string;
  title?: string;
  placeholder?: string;
  value?: string;
}

function applyInfo(el: HTMLElement, o?: DomElementInfo | string): void {
  if (o === undefined) return;
  if (typeof o === 'string') {
    el.className = o;
    return;
  }
  if (o.cls) {
    const classes = Array.isArray(o.cls) ? o.cls : o.cls.split(/\s+/);
    for (const c of classes) if (c) el.classList.add(c);
  }
  if (o.text !== undefined) el.textContent = o.text;
  if (o.type !== undefined) el.setAttribute('type', o.type);
  if (o.href !== undefined) el.setAttribute('href', o.href);
  if (o.title !== undefined) el.setAttribute('title', o.title);
  if (o.placeholder !== undefined) el.setAttribute('placeholder', o.placeholder);
  if (o.value !== undefined) (el as HTMLInputElement).value = o.value;
  if (o.attr) {
    for (const [k, v] of Object.entries(o.attr)) {
      if (v !== null) el.setAttribute(k, String(v));
    }
  }
}

function define(name: string, fn: (...args: never[]) => unknown): void {
  Object.defineProperty(HTMLElement.prototype, name, {
    configurable: true,
    writable: true,
    value: fn,
  });
}

export function installObsidianDom(): void {
  define('createEl', function (
    this: HTMLElement,
    tag: string,
    o?: DomElementInfo | string,
    cb?: (el: HTMLElement) => void,
  ): HTMLElement {
    const el = this.ownerDocument.createElement(tag);
    applyInfo(el, o);
    this.appendChild(el);
    cb?.(el);
    return el;
  } as never);

  define('createDiv', function (
    this: HTMLElement,
    o?: DomElementInfo | string,
    cb?: (el: HTMLElement) => void,
  ): HTMLElement {
    return (this as unknown as { createEl: typeof HTMLElement.prototype.createEl })
      .createEl('div', o as never, cb as never);
  } as never);

  define('createSpan', function (
    this: HTMLElement,
    o?: DomElementInfo | string,
    cb?: (el: HTMLElement) => void,
  ): HTMLElement {
    return (this as unknown as { createEl: typeof HTMLElement.prototype.createEl })
      .createEl('span', o as never, cb as never);
  } as never);

  define('empty', function (this: HTMLElement): void {
    while (this.firstChild) this.removeChild(this.firstChild);
  } as never);

  define('addClass', function (this: HTMLElement, ...classes: string[]): void {
    for (const c of classes) if (c) this.classList.add(c);
  } as never);

  define('removeClass', function (this: HTMLElement, ...classes: string[]): void {
    for (const c of classes) if (c) this.classList.remove(c);
  } as never);

  define('toggleClass', function (
    this: HTMLElement,
    classes: string | string[],
    value: boolean,
  ): void {
    const list = Array.isArray(classes) ? classes : [classes];
    for (const c of list) if (c) this.classList.toggle(c, value);
  } as never);

  define('hasClass', function (this: HTMLElement, cls: string): boolean {
    return this.classList.contains(cls);
  } as never);

  define('setText', function (this: HTMLElement, text: string): void {
    this.textContent = text;
  } as never);

  define('detach', function (this: HTMLElement): void {
    this.remove();
  } as never);
}

installObsidianDom();
