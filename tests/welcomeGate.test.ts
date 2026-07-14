import { describe, expect, it } from 'vitest';
import { shouldShowWelcomeModal } from '../src/ui/welcomeGate';

const FIRST_RUN = { seenWelcomeModal: false, enabled: true };

describe('shouldShowWelcomeModal', () => {
  it('opens on a genuine first run', () => {
    expect(shouldShowWelcomeModal(FIRST_RUN, null)).toBe(true);
  });

  it('stays closed once the user has seen it (D-008)', () => {
    expect(shouldShowWelcomeModal({ seenWelcomeModal: true, enabled: true }, null)).toBe(false);
  });

  it('stays closed while the plugin is disabled', () => {
    expect(shouldShowWelcomeModal({ seenWelcomeModal: false, enabled: false }, null)).toBe(false);
  });

  // B-06 (welcome modal on unreadable settings). An unreadable data.json makes the
  // plugin run on DEFAULT_SETTINGS, where seenWelcomeModal is false - so the gate
  // saw a first run and greeted a long-time user, whose settings were merely
  // damaged, as a fresh install. That contradicts the Notice telling them the file
  // could not be read, and it nudges them toward starting over, which overwrites
  // the recoverable file: the exact loss B-01 exists to prevent. Observed live
  // during A6 validation on 2026-07-13.
  it.each([['unreadable'], ['future-schema']] as const)(
    'B-06: stays closed in read-only mode (%s), even though defaults say first-run',
    (reason) => {
      expect(shouldShowWelcomeModal(FIRST_RUN, reason)).toBe(false);
    },
  );

  // The read-only clause must not be reachable around: a genuinely-first-run vault
  // that is ALSO read-only still gets no modal, because it could not persist the
  // choice (persist() is a no-op) and seenWelcomeModal could not be written, so the
  // modal would return on every launch until the file is repaired.
  it('B-06: read-only outranks every other condition', () => {
    expect(shouldShowWelcomeModal({ seenWelcomeModal: false, enabled: true }, 'unreadable')).toBe(
      false,
    );
  });
});
