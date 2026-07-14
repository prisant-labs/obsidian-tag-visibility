import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Flat config (ESLint 9+). Ported 1:1 from the legacy .eslintrc.cjs:
// same parser, same recommended presets, same three custom rules, same ignores.
export default tseslint.config(
  // A config with only `ignores` is the flat-config replacement for ignorePatterns.
  // node_modules is ignored by default, so it no longer needs listing.
  {
    ignores: ['main.js', 'docs/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Both shipped source AND the test suite are gated: the suite is itself a
    // release gate, so it deserves the same hygiene bar (DA-18 removed the
    // legacy per-file exemptions; nothing may be exempted from lint again
    // without a written reason here).
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
);
