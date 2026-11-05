import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

// リポジトリに入れたテスト用 PDF を確かめる（npm run test-pdfs:check）。単体テストとは別に動かす
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    include: ['scripts/test-pdfs/check.test.ts'],
    testTimeout: 60_000,
  },
});
