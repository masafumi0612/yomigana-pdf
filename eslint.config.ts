import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import jsdoc from 'eslint-plugin-jsdoc';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// この設定ファイルは TypeScript で書き、Node 24 が読み込むときに型を取り除いて動かす
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
      jsdoc,
      'simple-import-sort': simpleImportSort,
      unicorn,
    },
    rules: {
      // 外から使う関数・型には TSDoc が要る。中だけで使うものは、説明を書くときだけ TSDoc で書く
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            ArrowFunctionExpression: true,
            FunctionExpression: true,
            ClassDeclaration: true,
          },
          contexts: ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration'],
        },
      ],
      // TSDoc に書いた引数の名前が、本当の引数と合っているか
      'jsdoc/check-param-names': 'error',
      // 型は TypeScript に書くので、TSDoc の {型} は書かない
      'jsdoc/no-types': 'error',

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
        {
          selector: ['typeProperty', 'objectLiteralMethod'],
          modifiers: ['requiresQuotes'],
          format: null,
        },
        { selector: 'import', format: null },
      ],
    },
  },
  {
    // JS のファイルは型を使った検査をしない
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // 道具の設定ファイルは Node で動く。道具の決まりで default export が要り、
    // 設定の形が null を求めることもある（naming-convention の format: null など）
    files: ['*.config.{ts,mts,js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-exports': 'off',
      'unicorn/no-null': 'off',
    },
  },
  {
    // 開発用のスクリプトは Node で動き、結果を画面に出す
    files: ['scripts/**', 'data/**'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },
  {
    // ログはこのファイルを通すので、ここだけは console を使う
    files: ['src/log.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // WXT の入口は default export が決まり
    files: ['src/entrypoints/**'],
    rules: { 'no-restricted-exports': 'off' },
  },
  // 整形は Prettier に任せる（ぶつかる決まりを切る）。いちばん最後に置く
  prettier,
);
