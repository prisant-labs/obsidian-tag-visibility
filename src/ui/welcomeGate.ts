import type { ReadOnlyReason } from '../storage/settings';

/** The only settings the welcome-modal decision depends on. */
export interface WelcomeGateSettings {
  seenWelcomeModal: boolean;
  enabled: boolean;
}

/**
 * Whether the first-run welcome modal should open (D-008, B-06).
 *
 * Pure so the policy is testable; main.ts has no test harness.
 *
 * The read-only clause is the non-obvious one (B-06). An unreadable data.json
 * makes the plugin run on DEFAULT_SETTINGS, where `seenWelcomeModal` is false, so
 * a long-time user whose settings file is damaged would be greeted as a first-run
 * install. That contradicts the Notice telling them their settings could not be
 * read, and it nudges them toward the one action that destroys the still-
 * recoverable file: starting over. The modal could not persist a choice in that
 * state anyway (persist() is a no-op), and `seenWelcomeModal` cannot be written,
 * so it would reappear on every launch until the file is fixed.
 */
export function shouldShowWelcomeModal(
  settings: WelcomeGateSettings,
  readOnlyReason: ReadOnlyReason | null,
): boolean {
  if (readOnlyReason !== null) return false;
  if (settings.seenWelcomeModal) return false;
  if (!settings.enabled) return false;
  return true;
}
