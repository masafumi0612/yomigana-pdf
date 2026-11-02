// リポジトリに入れたテスト用 PDF を pdf.js（pdfjs-dist、Node）で確かめる。
// 文字が取り出せるか、縦書きが縦書きとして書かれているか、もとからあるルビが見つかるか、
// 画像だけの PDF に文字がないか、使うフォントが決めたとおりか、など。
//   node scripts/test-pdfs/check.ts [フォルダ]      （ないときは test-pdfs/out。word/ の中も見る）
//   VERBOSE=1 を付けると、組み直した段落の文を出す
// 1つでも合わなければ終了コード 1。フォントも Chromium も要らない（Linux の CI でも動く）。
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

import { EXPECTATIONS } from './expectations.ts';
import type { Paragraph, TextItemLike } from './text-layout.ts';
import { layoutPage, paragraphs } from './text-layout.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const DIR = resolve(process.argv[2] ?? join(ROOT, 'test-pdfs', 'out'));
// 比べる用の Chromium の印刷は、リポジトリに入れないので確かめない
const SKIPPED_DIRS = new Set(['chrome-print']);
// 部首・縦書き用の形・互換漢字の符号（Chromium の印刷で漢字がこうなることがある）。
// 字そのものを書くと、エディタの正規化（NFC）で互換漢字がふつうの漢字に変わるので、符号で書く
const RADICALS = /[\u2E80-\u2FDF\uFE10-\uFE19\uF900-\uFAFF]/u;
const SUBSET_PREFIX = /^[A-Z]{6}\+/;
const ROTATION_EPSILON = 0.01;

/** 1つの PDF を読んで分かったこと */
interface PdfFacts {
  pages: number;
  items: number;
  ttb: number;
  rotated: number;
  radicals: string;
  images: number;
  verticalFonts: number;
  paragraphs: Paragraph[];
  rubyMarked: Set<string>;
  notMarked: Set<string>;
  fonts: string[];
}

/** フォルダの中の PDF（word/ などの下のフォルダも見る） */
function listPdfs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => {
      if (e.isDirectory()) return SKIPPED_DIRS.has(e.name) ? [] : listPdfs(join(dir, e.name));
      return e.name.endsWith('.pdf') ? [join(dir, e.name)] : [];
    })
    .sort();
}

/** pdf.js が読み込んだフォントの名前（部分集合の頭の6文字を除く）。分からなければ undefined */
function fontName(font: unknown): string | undefined {
  if (typeof font !== 'object' || font === null || !('name' in font)) return undefined;
  return typeof font.name === 'string' ? font.name.replace(SUBSET_PREFIX, '') : undefined;
}

/** 1つの PDF を pdf.js で読む */
async function readPdf(bytes: Uint8Array): Promise<PdfFacts> {
  // pdf.js は渡した配列を手放す（detach）ので、写しを渡す
  // fontExtraProperties：フォントの名前を読めるようにする
  const task = getDocument({
    data: bytes.slice(),
    useSystemFonts: false,
    fontExtraProperties: true,
  });
  const doc = await task.promise;
  const facts: PdfFacts = {
    pages: doc.numPages,
    items: 0,
    ttb: 0,
    rotated: 0,
    radicals: '',
    images: 0,
    verticalFonts: 0,
    paragraphs: [],
    rubyMarked: new Set(),
    notMarked: new Set(),
    fonts: [],
  };
  const verticalFonts = new Set<string>();
  const fonts = new Set<string>();
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const ops = await page.getOperatorList();
    ops.fnArray.forEach((f, i) => {
      if (f === OPS.paintImageXObject || f === OPS.paintInlineImageXObject) facts.images++;
      if (f !== OPS.setFont) return;
      const args: unknown = ops.argsArray[i];
      const loadedName: unknown = Array.isArray(args) ? args[0] : undefined;
      if (typeof loadedName !== 'string') return;
      fonts.add(fontName(page.commonObjs.get(loadedName)) ?? `(名前のないフォント ${loadedName})`);
    });
    for (const [key, style] of Object.entries(content.styles)) {
      if (style.vertical) verticalFonts.add(key);
    }
    const texts = content.items.filter((it): it is TextItem => 'str' in it && !!it.str.trim());
    const items: TextItemLike[] = texts.map((it) => ({
      str: it.str,
      dir: it.dir,
      transform: it.transform as number[],
      width: it.width,
      height: it.height,
    }));
    facts.items += items.length;
    facts.ttb += items.filter((it) => it.dir === 'ttb').length;
    facts.rotated += items.filter(
      (it) => it.dir !== 'ttb' && Math.abs(it.transform[1] ?? 0) > ROTATION_EPSILON,
    ).length;
    facts.radicals += items
      .map((it) =>
        Array.from(it.str)
          .filter((c) => RADICALS.test(c))
          .join(''),
      )
      .join('');
    for (const p of paragraphs(layoutPage(items).lines)) {
      facts.paragraphs.push(p);
      for (const g of p.glyphs) (g.hasRuby ? facts.rubyMarked : facts.notMarked).add(g.norm);
    }
  }
  facts.verticalFonts = verticalFonts.size;
  facts.fonts = [...fonts].sort();
  await task.destroy();
  return facts;
}

const textOf = (ps: Paragraph[]): string =>
  ps.map((p) => p.glyphs.map((g) => g.norm).join('')).join('\n');
const missingIn = (text: string, words: string[] | undefined): string[] =>
  (words ?? []).filter((w) => !text.includes(w.normalize('NFKC')));

/** 決めたことと合わないところを挙げる */
function problemsOf(name: string, facts: PdfFacts): string[] {
  const exp = EXPECTATIONS[name];
  if (!exp) return ['決めたこと（expectations.ts）がない'];
  const problems: string[] = [];
  const fontsWanted = [...exp.fonts].sort();
  if (fontsWanted.join() !== facts.fonts.join()) {
    problems.push(
      `フォントが違う：${facts.fonts.join(', ') || '(なし)'}（決めたのは ${fontsWanted.join(', ') || '(なし)'}）`,
    );
  }
  if (exp.noText) {
    if (facts.items) problems.push(`文字がある（${String(facts.items)} 個）`);
    if (!facts.images) problems.push('画像がない');
    return problems;
  }
  if (!facts.items) problems.push('文字が取り出せない');
  const all = textOf(facts.paragraphs);
  const vertical = textOf(facts.paragraphs.filter((p) => p.vertical));
  const horizontal = textOf(facts.paragraphs.filter((p) => !p.vertical));
  const missing = [
    ...missingIn(all, exp.words),
    ...missingIn(vertical, exp.verticalWords).map((w) => `${w}（縦）`),
    ...missingIn(horizontal, exp.horizontalWords).map((w) => `${w}（横）`),
  ];
  if (missing.length) problems.push(`見つからない言葉：${missing.join(' ')}`);
  if (exp.vertical && (!facts.ttb || !facts.verticalFonts)) {
    problems.push(
      `縦書きがない（ttb ${String(facts.ttb)} 個、縦書きのフォント ${String(facts.verticalFonts)} 個）`,
    );
  }
  if (!exp.vertical && (facts.ttb || facts.verticalFonts)) {
    problems.push(
      `縦書きがあってはいけない（ttb ${String(facts.ttb)} 個、縦書きのフォント ${String(facts.verticalFonts)} 個）`,
    );
  }
  if (exp.horizontal && facts.items - facts.ttb === 0) problems.push('横書きがない');
  if (exp.rotated && !facts.rotated) problems.push('横倒しの字がない');
  if (!exp.rotated && facts.rotated)
    problems.push(`横倒しの字があってはいけない（${String(facts.rotated)} 個）`);
  if (facts.radicals) problems.push(`部首などの符号が文字に混じっている：${facts.radicals}`);
  const notDetected = Array.from(exp.rubyOn ?? '').filter((c) => !facts.rubyMarked.has(c));
  if (notDetected.length)
    problems.push(`もとからあるルビが見つからない字：${notDetected.join('')}`);
  const wronglyMarked = Array.from(exp.noRubyOn ?? '').filter(
    (c) => facts.rubyMarked.has(c) && !facts.notMarked.has(c),
  );
  if (wronglyMarked.length)
    problems.push(`ルビがないのに、あると見なした字：${wronglyMarked.join('')}`);
  return problems;
}

let failed = 0;
const seen = new Set<string>();
for (const path of listPdfs(DIR)) {
  const name = relative(DIR, path)
    .replaceAll('\\', '/')
    .replace(/\.pdf$/, '');
  seen.add(name);
  const bytes = new Uint8Array(readFileSync(path));
  const facts = await readPdf(bytes);
  const problems = problemsOf(name, facts);
  if (problems.length) failed++;
  console.log(
    `${problems.length ? 'NG' : 'OK'}  ${name}.pdf: ${String(facts.pages)} ページ、文字のかたまり ${String(facts.items)} 個（ttb ${String(facts.ttb)}、横倒し ${String(facts.rotated)}）、縦書きのフォント ${String(facts.verticalFonts)} 個、画像 ${String(facts.images)} 個`,
  );
  console.log(`      フォント：${facts.fonts.join(', ') || '(なし)'}`);
  for (const p of problems) console.log(`      - ${p}`);
  if (process.env.VERBOSE) {
    for (const p of facts.paragraphs) {
      console.log(`      ${p.vertical ? '縦' : '横'}| ${p.glyphs.map((g) => g.norm).join('')}`);
    }
  }
}
for (const name of Object.keys(EXPECTATIONS).filter((n) => !seen.has(n))) {
  failed++;
  console.log(`NG  ${name}.pdf: ファイルがない`);
}
process.exitCode = failed ? 1 : 0;
