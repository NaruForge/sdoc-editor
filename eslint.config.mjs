import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

const commonRules = {
  ...tseslint.configs.recommended.rules,
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  'no-empty': ['error', { allowEmptyCatch: false }],
  eqeqeq: ['error', 'always', { null: 'ignore' }],
};

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/target/**',
      'tauri-app/src-tauri/**',
      '*.mjs',
    ],
  },
  {
    files: ['src/**/*.ts', 'shared/**/*.ts'],
    ignores: ['shared/editor/**'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: commonRules,
  },
  {
    files: [
      'webview-ui/src/**/*.{ts,tsx}',
      'tauri-app/src/**/*.{ts,tsx}',
      'shared/editor/**/*.{ts,tsx}',
    ],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react-hooks': reactHooks,
    },
    rules: {
      ...commonRules,
      ...reactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'warn',

      // These React Compiler-oriented rules are valuable migration signals but
      // are not correctness gates for this React 18 application yet.
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
    },
  },
  prettier,
];
