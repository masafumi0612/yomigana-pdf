import { describe, expect, it } from 'vitest';

import { fileNameFromUrl, isPdfFile, readInitialHash, readViewerParams } from '@/viewer/source';

const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

describe('readViewerParams', () => {
  it('file の引数がないとき、開く URL はない', () => {
    expect(readViewerParams('', EXTENSION_ORIGIN)).toEqual({
      ok: true,
      value: { pdfUrl: undefined, hasCredentials: false },
    });
  });

  it('file の引数が空のとき、開く URL はない', () => {
    expect(readViewerParams('?file=', EXTENSION_ORIGIN)).toEqual({
      ok: true,
      value: { pdfUrl: undefined, hasCredentials: false },
    });
  });

  it('https の URL のとき、符号を戻した URL になる', () => {
    const search = `?file=${encodeURIComponent('https://example.com/a b.pdf?x=1')}`;
    expect(readViewerParams(search, EXTENSION_ORIGIN)).toEqual({
      ok: true,
      value: { pdfUrl: 'https://example.com/a%20b.pdf?x=1', hasCredentials: false },
    });
  });

  it('file の URL のとき、開いてよい', () => {
    expect(readViewerParams('?file=file:///C:/a.pdf', EXTENSION_ORIGIN)).toEqual({
      ok: true,
      value: { pdfUrl: 'file:///C:/a.pdf', hasCredentials: false },
    });
  });

  it('この拡張の中の URL のとき、開いてよい', () => {
    expect(readViewerParams(`?file=${EXTENSION_ORIGIN}/a.pdf`, EXTENSION_ORIGIN)).toEqual({
      ok: true,
      value: { pdfUrl: `${EXTENSION_ORIGIN}/a.pdf`, hasCredentials: false },
    });
  });

  it('ほかの拡張の URL のとき、開かない', () => {
    expect(readViewerParams('?file=chrome-extension://other/a.pdf', EXTENSION_ORIGIN)).toEqual({
      ok: false,
      error: 'unsupported-protocol',
    });
  });

  it('javascript: の URL のとき、開かない', () => {
    expect(readViewerParams('?file=javascript:alert(1)', EXTENSION_ORIGIN)).toEqual({
      ok: false,
      error: 'unsupported-protocol',
    });
  });

  it('URL として読めないとき、失敗になる', () => {
    expect(readViewerParams('?file=a.pdf', EXTENSION_ORIGIN)).toEqual({
      ok: false,
      error: 'invalid-url',
    });
  });

  it('自動で移されたとき、符号化されていない元の URL をそのまま読み、Cookie を付ける', () => {
    const search = '?DNR:https://example.com/a.pdf?x=1&y=2';
    expect(readViewerParams(search, EXTENSION_ORIGIN)).toEqual({
      ok: true,
      value: { pdfUrl: 'https://example.com/a.pdf?x=1&y=2', hasCredentials: true },
    });
  });

  it('自動で移されたとき、元の URL が file でも読める', () => {
    expect(readViewerParams('?DNR:file:///C:/a.pdf', EXTENSION_ORIGIN)).toEqual({
      ok: true,
      value: { pdfUrl: 'file:///C:/a.pdf', hasCredentials: true },
    });
  });

  it('自動で移されたが元の URL が空のとき、開く URL はない', () => {
    expect(readViewerParams('?DNR:', EXTENSION_ORIGIN)).toEqual({
      ok: true,
      value: { pdfUrl: undefined, hasCredentials: false },
    });
  });

  it('自動で移されたが開いてはいけない URL のとき、開かない', () => {
    expect(readViewerParams('?DNR:javascript:alert(1)', EXTENSION_ORIGIN)).toEqual({
      ok: false,
      error: 'unsupported-protocol',
    });
  });
});

describe('fileNameFromUrl', () => {
  it('パスの最後が名前のとき、% の符号を戻した名前になる', () => {
    expect(
      fileNameFromUrl('https://example.com/docs/%E3%81%8A%E7%9F%A5%E3%82%89%E3%81%9B.pdf'),
    ).toBe('お知らせ.pdf');
  });

  it('パスが / で終わるとき、ホスト名になる', () => {
    expect(fileNameFromUrl('https://example.com/')).toBe('example.com');
  });

  it('ホスト名もないとき、URL そのものになる', () => {
    expect(fileNameFromUrl('file:///')).toBe('file:///');
  });

  it('% の並びが壊れているとき、戻さずにそのままになる', () => {
    expect(fileNameFromUrl('https://example.com/%E3%81.pdf')).toBe('%E3%81.pdf');
  });

  it('URL として読めないとき、渡した文字そのものになる', () => {
    expect(fileNameFromUrl('a.pdf')).toBe('a.pdf');
  });
});

describe('isPdfFile', () => {
  it('種類が PDF のとき、PDF とみなす', () => {
    expect(isPdfFile({ name: 'scan', type: 'application/pdf' })).toBe(true);
  });

  it('種類がなく名前が .PDF で終わるとき、PDF とみなす', () => {
    expect(isPdfFile({ name: 'お知らせ.PDF', type: '' })).toBe(true);
  });

  it('種類も名前も PDF でないとき、PDF とみなさない', () => {
    expect(isPdfFile({ name: 'photo.png', type: 'image/png' })).toBe(false);
  });
});

describe('readInitialHash', () => {
  it('自動で移されたとき、リーダーの URL の # から後ろを返す', () => {
    expect(readInitialHash('https://example.com/a.pdf', true, '#page=3&zoom=150')).toBe(
      'page=3&zoom=150',
    );
  });

  it('file の引数で開くとき、PDF の URL の # から後ろを返す', () => {
    expect(readInitialHash('https://example.com/a.pdf#page=2', false, '#page=9')).toBe('page=2');
  });

  it('# から後ろがないとき、空の文字列になる', () => {
    expect(readInitialHash('https://example.com/a.pdf', true, '')).toBe('');
  });
});
