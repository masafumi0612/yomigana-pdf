// 拡張のアイコン public/icon/16.png・32.png・48.png・128.png を、src/assets/icon/ の SVG から作る。
//   npm run icons:build
// Playwright の Chromium で SVG を開き、背景を透明にして撮る（できた PNG をコミットする）。
// 小さいサイズは形を変えた SVG を使う：32px はルビを省いたもの、16px は字を線と四角にしたもの。
// WXT は public/icon/<大きさ>.png を見つけて manifest の icons に入れる
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { chromium } from 'playwright';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src', 'assets', 'icon');
const OUT = join(ROOT, 'public', 'icon');

/** 作る PNG の大きさと、元にする SVG */
const ICONS = [
  { size: 16, svg: 'icon-16.svg' },
  { size: 32, svg: 'icon-32.svg' },
  { size: 48, svg: 'icon.svg' },
  { size: 128, svg: 'icon.svg' },
] as const;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const { size, svg } of ICONS) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const source = await readFile(join(SRC, svg));
    const url = `data:image/svg+xml;base64,${source.toString('base64')}`;
    await page.setContent(
      `<body style="margin:0"><img src="${url}" width="${String(size)}" height="${String(size)}" style="display:block"></body>`,
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
