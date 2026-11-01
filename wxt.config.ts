import { defineConfig } from 'wxt';

// 設定の一覧：https://wxt.dev/api/config.html
export default defineConfig({
  // `@/text/split` のような別名を src/ から引けるようにするため、コードは src/ に置く
  srcDir: 'src',
  manifest: {
    name: '__MSG_manifest_ext_name__',
    description: '__MSG_manifest_ext_description__',
    default_locale: 'ja',
    // PDF の自動切り替えに使う DNR の応答ヘッダの条件が 128 から
    minimum_chrome_version: '128',
  },
});
