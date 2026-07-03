import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Pragmatic, non-type-checked flat config: catches real bugs while leaving
// stylistic/`any` choices to the team. Tighten rules over time.
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'eslint.config.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
);
