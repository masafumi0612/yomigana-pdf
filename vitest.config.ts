import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  // 別名 @/ や、拡張の API のにせもの（fake-browser）を WXT の設定から用意する
  plugins: [WxtVitest()],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // 網羅率の決まりは、読みの処理だけに掛ける。ほかは測るだけ
      include: ['src/**/*.{ts,tsx}'],
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
