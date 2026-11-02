# テスト用 PDF

よみがなPDF の動きを試すための PDF です。文はすべてテスト用に書き下ろしたもので、学校名・日付・内容は架空です。

## ファイル

`src/` の HTML から `out/` の PDF を作ります。PDF もリポジトリに入れてあるので、ふだんは作り直す必要はありません。

| PDF                        | 試すこと                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `vertical-story.pdf`       | 縦書きの物語（2ページ）。熟字訓（今日・大人）、難しい字（薔薇・檸檬）、人名、縦中横の数字  |
| `horizontal-print.pdf`     | 横書きのお知らせ（学年だより）。表、箇条書き、日付                                         |
| `existing-ruby.pdf`        | もとからルビのある文。1ページめは縦書き、2ページめは横書き。総ルビ・一部だけ・語の途中だけ |
| `mixed-layout.pdf`         | 新聞のような紙面。縦書きの段が2つ、横書きの見出しと図、横倒しの字                          |
| `mixed-direction.pdf`      | こくごのプリント。横書きの見出し（氏名の欄）、縦書きの題と本文、横書きの表、縦中横の数字   |
| `sample.pdf`               | 見本（縦書きの物語と横書きのレシピ）                                                       |
| `scanned-like.pdf`         | スキャンしたような、画像だけの PDF（文字がない）                                           |
| `word/word-vertical.pdf`   | Word で縦書きの文書を PDF にしたもの。縦書きの印（縦書きのフォント）が付かないことを示す   |
| `word/word-horizontal.pdf` | Word で横書きの文書を PDF にしたもの（比べる用）                                           |

`word/` の `.docx` は、その PDF の元の Word の文書です。

## 確かめる

```sh
npm run test-pdfs:check
```

リポジトリに入っている PDF を pdf.js で読み、決めたとおりかを確かめます（決めたことは `scripts/test-pdfs/expectations.ts`）。

- 文字が取り出せること、決めた言葉が読む順に組み直した文に出てくること
- 縦書きの字が、縦書きとして書かれていること（pdf.js の `dir=ttb` と縦書きのフォント）。縦書きのない PDF には、ないこと
- 縦書きの段落・横書きの行に、それぞれ決めた言葉があること（`mixed-direction.pdf` など）
- 使うフォントが決めたとおりであること
- 部首などの符号（日 → U+2F47 など）が文字に混じっていないこと
- もとからあるルビが見つかること（`existing-ruby.pdf`）
- 画像だけの PDF に文字がないこと

フォントも Chromium も使わないので、Linux の CI でも動きます。`VERBOSE=1` を付けると、組み直した文を出します。

## 作り直す

Windows で、フォントがあるときだけ作り直せます。

```sh
npm run test-pdfs:make                        # 全部
npm run test-pdfs:make -- mixed-direction     # 1つだけ
npm run test-pdfs:make -- --chrome            # 比べる用に Chromium の印刷も out/chrome-print/ に残す
```

- HTML の並べ方は Chromium（Playwright）に任せ、字の位置を読んで、PDF はスクリプトが自分で書きます。横書きは `Identity-H`、縦書きは `Identity-V`（フォントの縦書き用の字形）で書き、`ToUnicode` に本当の文字を入れます。Chromium の印刷（`page.pdf()`）は縦書きを横書きのフォントで書き、一部の漢字を部首の符号にするので、使いません。
- フォントは Noto Serif JP と Noto Sans JP の可変フォント（`NotoSerifJP-VF.ttf`・`NotoSansJP-VF.ttf`）を使います。ふだんは `C:/Windows/Fonts` から読みます。ほかの場所にあるときは `FONT_DIR` で指定します。
- `out/chrome-print/` はリポジトリに入れません。
- 作り直したら `npm run test-pdfs:check` で確かめ、変わった PDF を見比べてからコミットします。

## フォントのライセンス

Noto Serif JP と Noto Sans JP は [SIL Open Font License 1.1](https://openfontlicense.org/) です。フォントのファイルそのものはリポジトリに入れず、PDF に入れた部分集合（使った字だけ）だけを入れています。OFL は、文書にフォントを埋め込んで配ることを認めています。

`word/` の PDF には、Word が埋め込んだフォント（游明朝・Calibri）の部分集合が入っています。

## 入れないもの

教科書・市販の問題集・学校から配られたプリントなど、本物の PDF は、リポジトリに入れません（無断転載にあたるものがあるため）。手元で試すときは `local-only/` に置きます（`.gitignore` で入らないようにしてあります）。
