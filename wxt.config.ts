import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { defineConfig } from 'wxt';

import { DICTIONARY_DIR } from './src/config';

/** @patdx/kuromoji のフォルダ（IPADIC の辞書（gzip）とライセンスの文が入っている） */
const KUROMOJI_DIR = join(import.meta.dirname, 'node_modules', '@patdx', 'kuromoji');

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
    // 辞書を offscreen document の中の Worker で1回だけ読み込むため
    permissions: ['offscreen'],
  },
  hooks: {
    // 辞書はリポジトリに入れず、ビルドのたびに node_modules から写す。
    // 辞書を配るときは、著作権表示とライセンスの文も一緒に配る
    'build:publicAssets': (_wxt, files) => {
      const dictionaryDir = join(KUROMOJI_DIR, 'dict');
      for (const name of readdirSync(dictionaryDir)) {
        files.push({
          absoluteSrc: join(dictionaryDir, name),
          relativeDest: `${DICTIONARY_DIR}/${name}`,
        });
      }
      files.push(
        {
          absoluteSrc: join(import.meta.dirname, 'THIRD_PARTY_NOTICES.md'),
          relativeDest: 'THIRD_PARTY_NOTICES.md',
        },
        { absoluteSrc: join(import.meta.dirname, 'LICENSE'), relativeDest: 'LICENSE' },
        {
          absoluteSrc: join(KUROMOJI_DIR, 'LICENSE-2.0.txt'),
          relativeDest: 'licenses/Apache-2.0.txt',
        },
      );
    },
  },
});
