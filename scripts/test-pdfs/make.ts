// テスト用・見本用の PDF を test-pdfs/src/*.html から作る（自分で書いた文と、SIL OFL のフォントだけ）。
//   node scripts/test-pdfs/make.ts [名前 ...] [--chrome]
//     名前      この HTML だけ作る（例：sample vertical-story）。ないときは全部
//     --chrome  比べる用に Chromium の印刷（page.pdf）も test-pdfs/out/chrome-print/ に残す
//   FONT_DIR=<フォルダ>  NotoSerifJP-VF.ttf と NotoSansJP-VF.ttf のある所（ないときは C:/Windows/Fonts）
//
// page.pdf() をそのまま使わないわけ：Chromium は縦書きを横書きのフォントで1字ずつ印刷し
// （pdf.js から見ると dir=ltr で、縦書きのフォントがない）、一部の漢字を部首の符号にする
// （日 → U+2F47）。本物の組版の PDF は縦書きのフォント（Identity-V）を使うので、それでは
// ビューアの縦書きの処理を試せない。そこで、HTML の並べ方は Chromium に任せ、DOM から字の箱を
// 読んで、PDF は fontkit の部分集合で自分で書く。横書きは Identity-H、縦書きは Identity-V
// （フォントの vert の字形）で書き、ToUnicode には本当の文字を入れる。
// <body data-scan> のページは、画像だけのページ（描いたページの JPEG、文字なし）にする。
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

import { collectLayout } from './collect-layout.ts';
import { graphicsOps, PAGE_HEIGHT_PT, PAGE_WIDTH_PT, textOps } from './page-content.ts';
import { num, pdfText, PdfWriter, ref, writeFonts } from './pdf-writer.ts';
import type { WritingDir } from './subset-font.ts';
import { FONT_FILES, FontSet } from './subset-font.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const SRC = join(ROOT, 'test-pdfs', 'src');
const OUT = join(ROOT, 'test-pdfs', 'out');
const CHROME_OUT = join(OUT, 'chrome-print');
const FONT_DIR = process.env.FONT_DIR ?? 'C:/Windows/Fonts';
// A4 を 96 dpi で開く大きさ（CSS px）
const VIEWPORT = { width: 794, height: 1123 };
// 画像だけのページは 2 倍（192 dpi）で撮る
const SCAN_SCALE = 2;
const SCAN_JPEG_QUALITY = 82;
const DIRS: readonly WritingDir[] = ['H', 'V'];

// JPEG の SOF0〜SOF3 の印と、その中の高さ・幅の位置
const JPEG_SOF_FIRST = 0xc0;
const JPEG_SOF_LAST = 0xc3;
const JPEG_HEIGHT_OFFSET = 5;
const JPEG_WIDTH_OFFSET = 7;
// JPEG の最初の印（SOI）の長さ
const JPEG_SOI_BYTES = 2;

const args = process.argv.slice(2);
const isChromeWanted = args.includes('--chrome');
const only = args.filter((a) => !a.startsWith('--'));
const sources = readdirSync(SRC)
  .filter((f) => f.endsWith('.html') && (!only.length || only.includes(basename(f, '.html'))))
  .sort();

const fontFaceCss = Object.entries(FONT_FILES)
  .map(
    ([family, file]) =>
      `@font-face { font-family: "${family}"; src: url("${pathToFileURL(join(FONT_DIR, file)).href}"); font-weight: 100 900; }`,
  )
  .join('\n');

/** JPEG の幅と高さを読む */
function jpegSize(buf: Buffer): { w: number; h: number } {
  for (let i = JPEG_SOI_BYTES; i + JPEG_WIDTH_OFFSET + 2 <= buf.length;) {
    const marker = buf[i + 1] ?? 0;
    if (marker >= JPEG_SOF_FIRST && marker <= JPEG_SOF_LAST) {
      return {
        h: buf.readUInt16BE(i + JPEG_HEIGHT_OFFSET),
        w: buf.readUInt16BE(i + JPEG_WIDTH_OFFSET),
      };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('JPEG の大きさが見つからない');
}

/** ページの辞書（A4） */
function pageDict(pagesId: number, resources: string, contentId: number): string {
  return `<< /Type /Page /Parent ${ref(pagesId)} /MediaBox [0 0 ${num(PAGE_WIDTH_PT)} ${num(PAGE_HEIGHT_PT)}] /Resources << ${resources} >> /Contents ${ref(contentId)} >>`;
}

mkdirSync(OUT, { recursive: true });
if (isChromeWanted) mkdirSync(CHROME_OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const file of sources) {
    const name = basename(file, '.html');
    const url = pathToFileURL(join(SRC, file)).href;

    // 画像だけのページかどうかで、開くときの倍率を変える
    const probe = await browser.newPage();
    await probe.goto(url);
    const isScan = await probe.evaluate(() => document.body.hasAttribute('data-scan'));
    const title = await probe.title();
    await probe.close();

    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: isScan ? SCAN_SCALE : 1,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => {
      console.error(`${name}: ページのエラー ${e.message}`);
    });
    await page.goto(url);
    await page.addStyleTag({ content: fontFaceCss });
    await page.evaluate(async () => {
      await Promise.all([...document.fonts].map((f) => f.load()));
      await document.fonts.ready;
    });
    const loaded = await page.evaluate(
      (families) => families.map((f) => [f, document.fonts.check(`16px "${f}"`, 'あ')] as const),
      Object.keys(FONT_FILES),
    );
    if (loaded.some(([, ok]) => !ok)) {
      throw new Error(`フォントが読み込めない（FONT_DIR=${FONT_DIR}）：${JSON.stringify(loaded)}`);
    }

    const layout = await page.evaluate(collectLayout);
    const fonts = new FontSet(FONT_DIR);
    const pdf = new PdfWriter();
    const pagesId = pdf.reserve();
    const pageIds: number[] = [];
    const textPages: { pageId: number; ops: string[] }[] = [];
    let glyphCount = 0;
    for (const [i, pg] of layout.entries()) {
      if (pg.overflow) {
        console.warn(
          `${name} ${String(i + 1)}ページ：ページの外にはみ出して切れた字：${pg.overflow}`,
        );
      }
      const pageId = pdf.reserve();
      pageIds.push(pageId);
      if (isScan) {
        await page.evaluate((y) => {
          window.scrollTo(0, y);
        }, pg.top);
        const jpeg = await page.screenshot({
          type: 'jpeg',
          quality: SCAN_JPEG_QUALITY,
          clip: { x: pg.left, y: pg.top, width: pg.width, height: pg.height },
          fullPage: true,
        });
        const { w, h } = jpegSize(jpeg);
        const image = pdf.addRawStream(
          `/Type /XObject /Subtype /Image /Width ${String(w)} /Height ${String(h)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
          jpeg,
        );
        const content = pdf.addStream(
          '',
          `q ${num(PAGE_WIDTH_PT)} 0 0 ${num(PAGE_HEIGHT_PT)} 0 0 cm /Im1 Do Q`,
        );
        pdf.put(pageId, pageDict(pagesId, `/XObject << /Im1 ${ref(image)} >>`, content));
        continue;
      }
      textPages.push({ pageId, ops: [...graphicsOps(pg.graphics), ...textOps(pg.glyphs, fonts)] });
      glyphCount += pg.glyphs.length;
    }

    // ページの辞書にフォントの番号が要るので、ここで番号を取る。中身は writeFonts で入れる
    for (const font of fonts.all()) {
      for (const dir of DIRS) if (font.usedDirs.has(dir)) font.objectIds.set(dir, pdf.reserve());
    }
    const fontResources = fonts
      .all()
      .flatMap((font) =>
        [...font.objectIds].map(([dir, id]) => `/${fonts.resourceName(font, dir)} ${ref(id)}`),
      )
      .join(' ');
    for (const { pageId, ops } of textPages) {
      const content = pdf.addStream('', ops.join('\n'));
      pdf.put(pageId, pageDict(pagesId, `/Font << ${fontResources} >>`, content));
    }
    writeFonts(pdf, fonts);
    pdf.put(
      pagesId,
      `<< /Type /Pages /Kids [${pageIds.map(ref).join(' ')}] /Count ${String(pageIds.length)} >>`,
    );
    const root = pdf.add(`<< /Type /Catalog /Pages ${ref(pagesId)} /Lang (ja-JP) >>`);
    const info = pdf.add(
      `<< /Title ${pdfText(title)} /Creator (yomigana-pdf test-pdfs: ${name}.html) /Producer (scripts/test-pdfs/make.ts) >>`,
    );
    writeFileSync(join(OUT, `${name}.pdf`), pdf.toBuffer(root, info));

    const fontsUsed = fonts
      .all()
      .map((f) => `${f.psName}(${[...f.objectIds.keys()].join('/')})`)
      .join(', ');
    const summary = isScan ? '画像だけ' : `${String(glyphCount)} 字、フォント ${fontsUsed}`;
    console.log(`${name}.pdf: ${String(layout.length)} ページ、${summary}`);

    if (isChromeWanted) {
      await page.emulateMedia({ media: 'print' });
      await page.pdf({
        path: join(CHROME_OUT, `${name}.pdf`),
        preferCSSPageSize: true,
        printBackground: true,
      });
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
