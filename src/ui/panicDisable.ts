// Tag Visibility owns four decoration namespaces: the core tag pane
// (tag-curator-*), the Notebook Navigator tag tree (tc-nn-*), the Properties
// panel tag pills (tc-prop-*), and the editor tag-autocomplete suggestions
// (tc-ac-*). Panic disable must sweep all of them, so a stale scope cannot leave
// hidden rows behind after the user hits the panic command (Phase 5B, Phase 6,
// Phase 7).
const CLASSES = [
  'tag-curator-hidden',
  'tag-curator-flagged',
  'tag-curator-marked',
  'tc-nn-hidden',
  'tc-nn-flagged',
  'tc-nn-marked',
  'tc-prop-hidden',
  'tc-prop-flagged',
  'tc-prop-marked',
  'tc-ac-hidden',
  'tc-ac-flagged',
  'tc-ac-marked',
];
const ATTRS = [
  'data-tag-curator-rule',
  'data-tc-nn-rule',
  'data-tc-prop-rule',
  'data-tc-ac-rule',
];

export function panicCleanup(doc: Document): void {
  for (const cls of CLASSES) {
    const nodes = doc.querySelectorAll<HTMLElement>(`.${cls}`);
    for (const node of Array.from(nodes)) {
      node.classList.remove(cls);
      node.removeAttribute('aria-hidden');
    }
  }
  for (const attr of ATTRS) {
    const attributed = doc.querySelectorAll<HTMLElement>(`[${attr}]`);
    for (const node of Array.from(attributed)) {
      node.removeAttribute(attr);
      node.removeAttribute('aria-hidden');
    }
  }
}
