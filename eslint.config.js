// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const eslintConfigPrettier = require('eslint-config-prettier');
const { createTypeScriptImportResolver } = require('eslint-import-resolver-typescript');

module.exports = defineConfig([
  expoConfig,
  eslintConfigPrettier,
  {
    settings: {
      // eslint-config-expo's legacy `import/resolver: { typescript: true }` setting fails to load under this dependency tree; `import/resolver-next` takes precedence over the legacy setting in eslint-plugin-import >= 2.31, so this bypasses the broken loader while keeping tsconfig-path-aware import resolution.
      'import/resolver-next': [createTypeScriptImportResolver()],
    },
    rules: {
      'no-console': 'warn',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', '.expo/**', 'supabase/.temp/**', 'expo-env.d.ts'],
  },
]);
