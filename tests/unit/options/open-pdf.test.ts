import { describe, expect, it } from 'vitest';

import { hostPatternOf, namedBlobUrl, parseWebPdfUrl, readerUrlFor } from '@/options/open-pdf';
import { fileNameFromUrl, readInitialHash, readViewerParams } from '@/viewer/source';

const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const READER_URL = `${EXTENSION_ORIGIN}/viewer.html`;

describe('parseWebPdfUrl', () => {
  it('https の URL のとき、その URL になる', () => {
    const parsed = parseWebPdfUrl('https://example.com/a.pdf');
    expect(parsed.ok && parsed.value.href).toBe('https://example.com/a.pdf');
  });

  it('前後に空白があるとき、除いて読む', () => {
    const parsed = parseWebPdfUrl('  http://example.com/a.pdf\n');
    expect(parsed.ok && parsed.value.href).toBe('http://example.com/a.pdf');
  });

  it('空白だけのとき、空になる', () => {
    expect(parseWebPdfUrl('   ')).toEqual({ ok: false, error: 'empty' });
  });

  it('URL として読めないとき、開けない', () => {
    expect(parseWebPdfUrl('example.com/a.pdf')).toEqual({ ok: false, error: 'invalid' });
  });

  it('file の URL のとき、開けない', () => {
    expect(parseWebPdfUrl('file:///C:/a.pdf')).toEqual({ ok: false, error: 'invalid' });
  });

  it('javascript: の URL のとき、開けない', () => {
    expect(parseWebPdfUrl('javascript:alert(1)')).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('hostPatternOf', () => {
  it('ポートがあるとき、ポートを除いたサイトの指定になる', () => {
    expect(hostPatternOf(new URL('http://127.0.0.1:8080/a.pdf?x=1'))).toBe('http://127.0.0.1/*');
  });

  it('https のとき、https のサイトの指定になる', () => {
    expect(hostPatternOf(new URL('https://www.example.com/docs/a.pdf'))).toBe(
      'https://www.example.com/*',
    );
  });
});

describe('readerUrlFor', () => {
  it('Web の PDF のとき、リーダーが同じ URL を読み取れる', () => {
    const pdfUrl = 'https://example.com/a b.pdf?x=1&y=2#page=3';
    const search = new URL(readerUrlFor(READER_URL, pdfUrl)).search;
    expect(readViewerParams(search, EXTENSION_ORIGIN)).toEqual({
      ok: true,
      value: { pdfUrl: 'https://example.com/a%20b.pdf?x=1&y=2#page=3', hasCredentials: false },
    });
  });

  it('選んだファイルのとき、リーダーが blob: の URL を読み取れる', () => {
    const blobUrl = namedBlobUrl(`blob:${EXTENSION_ORIGIN}/0f8c-41`, 'お知らせ #1.pdf');
    const search = new URL(readerUrlFor(READER_URL, blobUrl)).search;
    expect(readViewerParams(search, EXTENSION_ORIGIN)).toEqual({
      ok: true,
      value: { pdfUrl: blobUrl, hasCredentials: false },
    });
  });
});

describe('namedBlobUrl', () => {
  it('付けたファイル名を、リーダーがバーに出す名前として読める', () => {
    const blobUrl = namedBlobUrl(`blob:${EXTENSION_ORIGIN}/0f8c-41`, 'お知らせ #1.pdf');
    expect(fileNameFromUrl(blobUrl)).toBe('お知らせ #1.pdf');
  });

  it('付けたファイル名を、リーダーがページの指定として読まない', () => {
    const blobUrl = namedBlobUrl(`blob:${EXTENSION_ORIGIN}/0f8c-41`, 'page=2.pdf');
    expect(readInitialHash(blobUrl, false, '')).toBe('');
  });
});
