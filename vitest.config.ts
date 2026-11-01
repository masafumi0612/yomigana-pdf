import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

// eslint-disable-next-line no-restricted-exports -- Vitest の設定ファイルは default export が決まり
export default defineConfig({
  // 別名 @/ や、拡張の API のにせもの（fake-browser）を WXT の設定から用意する
  plugins: [WxtVitest()],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    // M3 で src/text/ を作るまではテストがない
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      // 網羅率の決まりは、読みの処理だけに掛ける。ほかは測るだけ
      include: ['src/**/*.ts'],
      exclude: ['src/entrypoints/**'],
      reporter: ['text', 'html'],
      thresholds: {
        'src/text/**/*.ts': {
          statements: 100,
          lines: 100,
          functions: 100,
          branches: 85,
        },
      },
    },
  },
});
