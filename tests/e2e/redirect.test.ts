import { readFile } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { expect, redirectTest as test, setAutoRedirect, TEST_PDF_DIR } from './fixtures';

/** どの返し方でも返す PDF */
const PDF_FILE = 'horizontal-print.pdf';

/** ページを指して開くテストに使う、2ページの PDF */
const TWO_PAGES_FILE = 'vertical-story.pdf';

/** PDF の返し方（パスと、応答のヘッダ） */
const PDF_ROUTES: Record<string, Record<string, string>> = {
  '/a.pdf': { 'content-type': 'application/pdf' },
  '/no-extension': { 'content-type': 'application/pdf; charset=binary' },
  '/wrong-type.pdf': { 'content-type': 'application/octet-stream' },
  '/octet-no-extension': { 'content-type': 'application/octet-stream' },
  '/inline.pdf': {
    'content-type': 'application/pdf',
    'content-disposition': 'attachment; filename="x.pdf"',
  },
  '/file?x=download': {
    'content-type': 'application/pdf',
    'content-disposition': 'attachment; filename="x.pdf"',
  },
  '/login.pdf': { 'content-type': 'application/pdf' },
  '/two-pages.pdf': { 'content-type': 'application/pdf' },
};

const PAGE_HTML = `<!doctype html><meta charset="utf-8"><title>page</title>
<a id="link" href="/a.pdf">PDF</a>
<form id="form" method="post" action="/a.pdf"><button>post</button></form>
<iframe id="frame" src="/inline.pdf"></iframe>`;

let server: Server;
let origin: string;
let pdfData: Buffer;
let twoPagesData: Buffer;

/**
 * ログインの印（Cookie）があるか調べる。
 * @param headers 要求のヘッダ
 * @returns あれば true
 */
function hasSession(headers: IncomingHttpHeaders): boolean {
  return headers.cookie?.includes('session=ok') === true;
}

test.beforeAll(async () => {
  pdfData = await readFile(join(TEST_PDF_DIR, PDF_FILE));
  twoPagesData = await readFile(join(TEST_PDF_DIR, TWO_PAGES_FILE));
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/page.html') {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'set-cookie': 'session=ok; Path=/',
      });
      response.end(PAGE_HTML);
      return;
    }
    const headers = PDF_ROUTES[url.pathname + url.search];
    if (headers === undefined || (url.pathname === '/login.pdf' && !hasSession(request.headers))) {
      response.writeHead(url.pathname === '/login.pdf' ? 403 : 404).end();
      return;
    }
    response.writeHead(200, headers);
    response.end(url.pathname === '/two-pages.pdf' ? twoPagesData : pdfData);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/**
 * リーダーの URL の頭の正規表現を作る。
 * @param extensionId 拡張の ID
 * @returns リーダーに移った URL に合う正規表現
 */
function viewerUrlPattern(extensionId: string): RegExp {
  return new RegExp(`^chrome-extension://${extensionId}/viewer\\.html\\?DNR:`, 'u');
}

test.describe('リーダーに移る', () => {
  for (const path of ['/a.pdf', '/no-extension', '/wrong-type.pdf', '/inline.pdf']) {
    test(`${path} をページ全体で開いたとき、リーダーに移り、PDF が出る`, async ({
      page,
      extensionId,
    }) => {
      await page.goto(origin + path);

      await expect(page).toHaveURL(viewerUrlPattern(extensionId));
      expect(page.url().endsWith(`?DNR:${origin}${path}`)).toBe(true);
      await expect(page.locator('#page-total')).toHaveText('/ 1');
    });
  }

  test('ページの中のリンクを押したとき、リーダーに移る', async ({ page, extensionId }) => {
    await page.goto(`${origin}/page.html`);

    await page.locator('#link').click();

    await expect(page).toHaveURL(viewerUrlPattern(extensionId));
  });

  test('ログインが要る PDF のとき、Cookie を付けて取り直して出る', async ({
    page,
    extensionId,
  }) => {
    await page.goto(`${origin}/page.html`);
    await page.goto(`${origin}/login.pdf`);

    await expect(page).toHaveURL(viewerUrlPattern(extensionId));
    await expect(page.locator('#page-total')).toHaveText('/ 1');
  });
});

test.describe('リーダーに移らない', () => {
  for (const path of ['/octet-no-extension', '/file?x=download']) {
    test(`${path} を開いたとき、移らずダウンロードになる`, async ({ page }) => {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        // ダウンロードが始まると、移動は中断されて失敗になる
        page.goto(origin + path).catch(() => undefined),
      ]);

      expect(download.url()).toBe(origin + path);
    });
  }

  test('HTML のページのとき、移らない', async ({ page }) => {
    await page.goto(`${origin}/page.html`);

    await expect(page).toHaveURL(`${origin}/page.html`);
  });

  test('POST で PDF を開いたとき、移らない', async ({ page }) => {
    await page.goto(`${origin}/page.html`);

    await page.locator('#form button').click();

    await expect(page).toHaveURL(`${origin}/a.pdf`);
  });

  test('枠の中の attachment のとき、枠はリーダーにならない', async ({ page }) => {
    await page.goto(`${origin}/page.html`);
    // 枠の中の移動が済むまで、少し待つ
    await page.waitForLoadState('load');

    expect(page.frames().map((frame) => frame.url())).not.toContainEqual(
      expect.stringContaining('viewer.html'),
    );
  });

  test('親スイッチをオフにしたとき、PDF をリーダーに移さない', async ({ context, page }) => {
    const worker = context.serviceWorkers()[0];
    if (worker === undefined) {
      throw new Error('service worker がない');
    }
    await setAutoRedirect(worker, false);

    await page.goto(`${origin}/page.html`);
    await page.locator('#link').click();

    await expect(page).toHaveURL(`${origin}/a.pdf`);
  });
});

test.describe('URL の # から後ろ', () => {
  test('# から後ろがあるとき、リーダーの URL に残る', async ({ page }) => {
    await page.goto(`${origin}/a.pdf#page=3&zoom=150`);

    await expect(page).toHaveURL(/viewer\.html\?DNR:.*#page=3&zoom=150$/u);
  });

  test('#page= と #zoom= があるとき、そのページ・倍率で開く', async ({ page }) => {
    await page.goto(`${origin}/two-pages.pdf#page=2&zoom=150`);

    await expect(page.locator('#page-input')).toHaveValue('2');
    await expect(page.locator('#zoom-level')).toHaveText('150%');
  });

  test('file の引数で開くとき、PDF の URL の # から後ろでページを決める', async ({
    page,
    extensionId,
  }) => {
    const target = encodeURIComponent(`${origin}/two-pages.pdf#page=2`);

    await page.goto(`chrome-extension://${extensionId}/viewer.html?file=${target}`);

    await expect(page.locator('#page-input')).toHaveValue('2');
  });
});

test('Chrome の標準の表示で開くを押したとき、リーダーに戻されずに標準の表示のままになる', async ({
  page,
  extensionId,
}) => {
  await page.goto(`${origin}/a.pdf`);
  await expect(page).toHaveURL(viewerUrlPattern(extensionId));

  await page.getByRole('button', { name: /Chrome の標準の表示で開く/u }).click();

  await expect(page).toHaveURL(`${origin}/a.pdf`);
  // 移し直しが遅れて来ないことを確かめるため、少し待ってからもう一度見る
  await page.waitForTimeout(1000);
  expect(page.url()).toBe(`${origin}/a.pdf`);
});
