import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { defineConfig } from 'wxt';

import { DICTIONARY_DIR, SAMPLE_PDF_PATH } from './src/config';

/** @patdx/kuromoji のフォルダ（IPADIC の辞書（gzip）とライセンスの文が入っている） */
const KUROMOJI_DIR = join(import.meta.dirname, 'node_modules', '@patdx', 'kuromoji');
/** 設定の画面の「見本の PDF で試す」で開く PDF。自分で書いた文と OFL のフォントだけで作ったもの（test-pdfs/README.md） */
const SAMPLE_PDF = join(import.meta.dirname, 'test-pdfs', 'out', 'sample.pdf');
/** pdfjs-dist のフォルダ（CMap・標準フォント情報などのデータが入っている） */
const PDFJS_DIR = join(import.meta.dirname, 'node_modules', 'pdfjs-dist');
/**
 * pdf.js が読むデータ。外から読まずに済むよう、ビルドで node_modules から拡張に写す。
 * wasm は、wasm が使えないとき用の JS と、PDF の中のスクリプトを動かす部品（quickjs）を入れない。
 * そのため、manifest の CSP で wasm を認める（content_security_policy）
 */
const PDFJS_ASSET_DIRS = ['cmaps', 'standard_fonts', 'iccs', 'wasm'];
const isPdfjsAssetIncluded = (file: string): boolean =>
  !file.startsWith('quickjs') && !file.endsWith('.js');
/** ツールバーのアイコン。PNG は scripts/build-icons.ts が src/assets/icon/ の SVG から作る */
const ACTION_ICONS = {
  16: 'icon/16.png',
  32: 'icon/32.png',
  48: 'icon/48.png',
  128: 'icon/128.png',
};

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
    // offscreen：辞書を offscreen document の中の Worker で1回だけ読み込むため。
    // declarativeNetRequestWithHostAccess：許可されたサイトの PDF だけをリーダーに移すため。
    // storage：自動で移すスイッチの値を残すため
    permissions: ['offscreen', 'declarativeNetRequestWithHostAccess', 'storage'],
    // すべてのサイトを読む権限は、利用者が自動で移すことを選んだときに後から許可してもらう
    optional_host_permissions: ['<all_urls>'],
    // 他のサイトの PDF の移し先として、ページ全体や枠の中でリーダーを開けるようにする
    web_accessible_resources: [{ resources: ['viewer.html'], matches: ['<all_urls>'] }],
    // pdf.js は、白黒の画像（JBIG2）・JPEG 2000 の画像・色の変換（ICC）を wasm で読む。
    // 拡張の決まりの CSP は wasm を認めないので、wasm だけを足す（ほかは決まりのまま）
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    // 拡張のアイコン。小さな枠（popup）は付けず、押したら設定の画面を開く（background.ts）。
    // icons は WXT が public/icon/<大きさ>.png から入れるが、action の絵は popup がないと
    // 入れてくれないので、ここで同じ PNG を指す
    action: { default_icon: ACTION_ICONS },
  },
  hooks: {
    // 辞書・pdf.js のデータはリポジトリに入れず、ビルドのたびに node_modules から写す。
    // 辞書を配るときは、著作権表示とライセンスの文も一緒に配る
    'build:publicAssets': (_wxt, files) => {
      const dictionaryDir = join(KUROMOJI_DIR, 'dict');
      for (const name of readdirSync(dictionaryDir)) {
        files.push({
          absoluteSrc: join(dictionaryDir, name),
          relativeDest: `${DICTIONARY_DIR}/${name}`,
        });
      }
      for (const dir of PDFJS_ASSET_DIRS) {
        for (const file of readdirSync(join(PDFJS_DIR, dir)).filter(isPdfjsAssetIncluded)) {
          files.push({ absoluteSrc: join(PDFJS_DIR, dir, file), relativeDest: `${dir}/${file}` });
        }
      }
      files.push(
        { absoluteSrc: SAMPLE_PDF, relativeDest: SAMPLE_PDF_PATH },
        {
          absoluteSrc: join(import.meta.dirname, 'THIRD_PARTY_NOTICES.md'),
          relativeDest: 'THIRD_PARTY_NOTICES.md',
        },
        { absoluteSrc: join(import.meta.dirname, 'LICENSE'), relativeDest: 'LICENSE' },
        {
          absoluteSrc: join(KUROMOJI_DIR, 'LICENSE-2.0.txt'),
          relativeDest: 'licenses/Apache-2.0.txt',
        },
        // ルビのフォント（仮名だけの部分集合）の著作権表示とライセンスの文
        {
          absoluteSrc: join(import.meta.dirname, 'src', 'assets', 'fonts', 'OFL.txt'),
          relativeDest: 'licenses/OFL-1.1.txt',
        },
      );
    },
  },
});
