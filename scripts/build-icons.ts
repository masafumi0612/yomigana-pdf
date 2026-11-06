// 拡張のアイコン public/icon/16.png・32.png・48.png・128.png を、src/assets/icon/ の SVG から作る。
//   npm run icons:build
// Playwright の Chromium で SVG を開き、背景を透明にして撮る（できた PNG をコミットする）。
// 小さいサイズは形を変えた SVG を使う：32px はルビを省いたもの、16px は字を線と四角にしたもの。
// 128px は Chrome ウェブストアの決まりに合わせ、絵を真ん中の 96×96 に縮めて周りを透明にする。
// WXT は public/icon/<大きさ>.png を見つけて manifest の icons に入れる
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { chromium } from 'playwright';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src', 'assets', 'icon');
const OUT = join(ROOT, 'public', 'icon');

/** 作る PNG の大きさ・元にする SVG・絵を描く大きさ（PNG より小さいときは周りを透明にする） */
const ICONS = [
  { size: 16, svg: 'icon-16.svg', art: 16 },
  { size: 32, svg: 'icon-32.svg', art: 32 },
  { size: 48, svg: 'icon.svg', art: 48 },
  { size: 128, svg: 'icon.svg', art: 96 },
] as const;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const { size, svg, art } of ICONS) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const source = await readFile(join(SRC, svg));
    const url = `data:image/svg+xml;base64,${source.toString('base64')}`;
    const margin = (size - art) / 2;
    await page.setContent(
      `<body style="margin:0"><img src="${url}" width="${String(art)}" height="${String(art)}" style="display:block;margin:${String(margin)}px"></body>`,
    );
    await page.locator('img').evaluate((img: HTMLImageElement) => img.decode());
    const path = join(OUT, `${String(size)}.png`);
    await page.screenshot({ path, omitBackground: true });
    await page.close();
    console.log(`${svg} → ${path}`);
  }
} finally {
  await browser.close();
}
