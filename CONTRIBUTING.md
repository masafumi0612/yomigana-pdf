# 開発の決まり

よみがなPDF のコードを書くときの決まりです。人も AI も、この決まりに合わせて書きます。

## 1. 準備

1. Node は `.nvmrc` の版（24 系）を使います。合わない版では `npm ci` が止まります
2. `npm ci` で依存を入れます。Git フック（整形・Lint・コミットメッセージの確認）も入ります
3. git worktree で作業するときは、worktree ごとに `npm ci` します

## 2. よく使うコマンド

| コマンド                  | すること                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `npm run check`           | 整形・Lint・型・網羅率つきの単体テスト・ビルドをまとめて確かめる（PR を出す前に必ず） |
| `npm run test:e2e`        | ビルドした拡張を Chromium に入れて E2E を動かす                                       |
| `npm run test-pdfs:check` | リポジトリに入れたテスト用 PDF を確かめる                                             |
| `npm run licenses:check`  | 拡張に入る部品のライセンスを確かめる                                                  |
| `npm run accuracy:local`  | 手元の PDF で読みの精度を測る（環境変数 `YOMIGANA_LOCAL_PDF_DIR` があるときだけ）     |
| `npm run icons:build`     | 拡張のアイコンの PNG を SVG から作り直す（下の「10. アイコン」）                      |

## 3. ブランチとコミット

1. 1つの PR に1つのブランチ。名前は `feat/…`・`fix/…`・`test/…`・`docs/…`・`ci/…` など
2. コミットメッセージは Conventional Commits の形で、説明は日本語です。`種類(部品): 〜を追加`
   - 部品（scope）は `viewer`・`ruby`・`text`・`pdf`・`settings`・`options`・`ci`・`deps`・`docs` のどれか。リポジトリ全体の作業は付けない
   - 説明は「〜を追加」「〜を修正」の形で終え、「〜する」「〜した」で終えない（commitlint で確かめる）
3. マージはマージコミットだけ。`main` に入れるには CI の `check` が通り、`main` に追いついている必要があります

## 4. 書き方

1. **整形**：Prettier（シングルクォート、セミコロンあり、末尾のカンマあり、1行100字、空白2つ、LF、UTF-8）
2. **import**：`simple-import-sort` の順。型だけのときは `import type`。`src/` の中は別名 `@/…`（例：`@/text/split`）
3. **名前**：ファイルは小文字＋ハイフン、型は PascalCase、変数・関数は camelCase、本当の定数は UPPER_SNAKE、真偽値は `is`・`has` で始める
4. **export**：名前付きの export だけ。`export default` は使わない（WXT の入口など、決まりで必要なところは例外）。まとめ直しの `index.ts` は作らない
5. **型**：データの形は `interface`。`enum` は使わず文字列の組み合わせ。`any`・`!`（null でないと言い切る）は使わない。値がないことは `undefined`（`null` は使わない）
6. **コメント**：外から使う関数・型には日本語の TSDoc（`@param`・`@returns`）を必ず書く（ESLint で確かめる）。中のコメントは「なぜ」だけ。TODO には Issue の番号を付ける（`// TODO(#12): …`）
7. **意味のある数**：名前を付けて、使うファイルの上にまとめる。拡張全体で使うものだけ `src/config.ts`
8. **失敗の扱い**：予想できる失敗は戻り値で返す（`src/result.ts` の `Result`）。予想外の失敗だけ throw
9. **ログ**：`src/log.ts` の `createLogger` を通す。`console` は使わない。PDF の本文や URL はログに入れない
10. **非同期**：`async`/`await` にそろえる。待たずに放っておく呼び出しはしない（画面のイベントから呼ぶときは `.catch` でログに残す）。部品どうしのメッセージには待つ時間の上限を付ける
11. **画面**：色・大きさ・間隔は CSS 変数にまとめる。文言は `public/_locales/ja/messages.json` に置き、キーは `画面_場所_役目`（例：`viewer_bar_zoomIn`）。キーボードだけで操作でき、文字の色は WCAG 2.2 AA（4.5:1 以上）
12. **呼び名**：コード・テスト・期待値・PR の説明には、公開していない資料でしか通じない呼び名（社内の案の名前や段階の番号など）を書かず、ふつうの言葉で書く

## 5. テスト

1. 単体テストは `tests/unit/` の下に、`src/` と同じ構成で置く。E2E は `tests/e2e/`
2. テストの名前は日本語で「〜のとき、〜になる」。1つのテストで1つのことだけ確かめる
3. 期待値の表は `tests/fixtures/*.tsv`。読みの間違いを直したら、その例を1行足す
4. `src/text/` は網羅率（命令・行・関数 100%、分岐 85% 以上）を CI で確かめる。ほかは測るだけだが、なるべく高く
5. テスト・期待値・網羅率の線・Lint の決まりを弱めて通さない

## 6. 依存

1. 版はちょうどに固定する（`.npmrc` の `save-exact`）。更新は Dependabot の PR で入れる
2. 拡張に入る部品は、ライセンス（MIT・Apache-2.0・BSD・ISC・OFL・CC BY など）と脆弱性（high 以上で失敗）を CI で確かめる
3. 辞書・データを同梱するときは、著作権表示を `THIRD_PARTY_NOTICES.md` に足し、拡張にも同梱する

## 7. PR

1. `.github/pull_request_template.md` に合わせて、何を・なぜ・どう確かめたかを書く
2. 変更は 400 行くらいまで（テスト（`tests/` の下）・データの JSON・テスト用 PDF・`package-lock.json` は数えない）。大きくなるときは、順に入れられるよう PR を分ける
3. `--no-verify` でフックを飛ばさない。強制プッシュしない

## 8. 入れてはいけないもの

1. 秘密の情報（鍵・トークンなど）
2. 自分で作っていない PDF や、転載が許されていない文。リポジトリのテスト用 PDF は、自作の文章と OFL のフォントだけで作る（`test-pdfs/README.md`）

## 9. リリースの手順

1. `package.json` の `version` を上げる PR を出して、マージする
2. `main` の最新で、`v` を付けたタグ（例：`v0.1.0`。`package.json` の版と同じ）を打って push する
   - `git switch main && git pull && git tag v0.1.0 && git push origin v0.1.0`
3. GitHub Actions の「リリース」が、確認をして zip を作り、下書きのリリースに付ける。タグと版が合わないときは失敗する
4. 下書きのリリースで、変更の一覧と zip の中身を確かめてから公開する
5. ストアへの提出は自動にしていない。公開した zip を取り出して、Chrome ウェブストアの管理画面から手でアップロードする

## 10. アイコン

1. 元の絵は `src/assets/icon/` の SVG。128px・48px は `icon.svg`、32px は `icon-32.svg`（ルビを省く）、16px は `icon-16.svg`（字を線と四角にする）
2. 字はフォントを使わず、SVG の path で描く（パソコンに入っているフォントの字形は、ライセンスがわからないので写さない）
3. SVG を直したら `npm run icons:build` で `public/icon/16.png`・`32.png`・`48.png`・`128.png` を作り直し、PNG もコミットする。WXT がこの PNG を manifest の `icons` に入れ、ツールバーの絵（`action.default_icon`）は `wxt.config.ts` で同じ PNG を指す
4. Chrome ウェブストアの決まりでは、128px のアイコンは絵を 96×96 ほどにし、周りの 16px ずつは透明にする
