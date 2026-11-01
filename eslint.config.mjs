import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// eslint-disable-next-line no-restricted-exports -- ESLint の設定ファイルは default export が決まり
export default defineConfig(
  globalIgnores(['.output/', '.wxt/', 'coverage/', 'node_modules/']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.browser,
    },
    plugins: {
      'simple-import-sort': simpleImportSort,
      unicorn,
    },
    rules: {
      // import の並べ方と、型だけの import
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',

      // export は名前付きだけ（default export を禁止）
      'no-restricted-exports': [
        'error',
        {
          restrictDefaultExports: {
            direct: true,
            named: true,
            defaultFrom: true,
            namedFrom: true,
            namespaceFrom: true,
          },
        },
      ],

      // 型の書き方：データの形は interface、enum と null は使わない
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message: "enum は使わず、文字列の組み合わせ（'a' | 'b'）を使う",
        },
      ],
      'unicorn/no-null': 'error',

      // ログは src/log.ts を通す
      'no-console': 'error',

      // 名前の付け方
      'unicorn/filename-case': ['error', { case: 'kebabCase' }],
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'variable', modifiers: ['const'], format: ['camelCase', 'UPPER_CASE'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        // Preact の部品（関数）は PascalCase で書く
        { selector: 'function', format: ['camelCase', 'PascalCase'] },
        {
          selector: 'variable',
          modifiers: ['const'],
          types: ['function'],
          format: ['camelCase', 'PascalCase'],
        },
        {
          selector: 'variable',
          types: ['boolean'],
          format: ['PascalCase'],
          prefix: ['is', 'has'],
        },
        // 外の決まりで形が決まる名前（文言のキー、HTTP のヘッダなど）は確かめない
        { selector: 'objectLiteralProperty', format: null },
        { selector: 'typeProperty', modifiers: ['requiresQuotes'], format: null },
        { selector: 'import', format: null },
      ],
    },
  },
  {
    // 設定ファイルなどの JS は型を使った検査をしない
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
    // 道具の設定の形が null を求めることがある（naming-convention の format: null など）
    rules: { 'unicorn/no-null': 'off' },
  },
  {
    // WXT の入口は default export が決まり
    files: ['src/entrypoints/**'],
    rules: { 'no-restricted-exports': 'off' },
  },
  // 整形は Prettier に任せる（ぶつかる決まりを切る）。いちばん最後に置く
  prettier,
);
