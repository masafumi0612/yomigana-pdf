import { describe, expect, it } from 'vitest';

import { fileNameFromUrl, isPdfFile, readViewerParams } from '@/viewer/source';

const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

describe('readViewerParams', () => {
  it('file の引数がないとき、開く URL はない', () => {
    expect(readViewerParams('', EXTENSION_ORIGIN)).toEqual({
      ok: true,
      value: { pdfUrl: undefined },
    });
  });

  it('file の引数が空のとき、開く URL はない', () => {
    expect(readViewerParams('?file=', EXTENSION_ORIGIN)).toEqual({
      ok: true,
      value: { pdfUrl: undefined },
    });
  });

  it('https の URL のとき、符号を戻した URL になる', () => {
    const search = `?file=${encodeURIComponent('https://example.com/a b.pdf?x=1')}`;
    expect(readViewerParams(search, EXTENSION_ORIGIN)).toEqual({
      ok: true,
      value: { pdfUrl: 'https://example.com/a%20b.pdf?x=1' },
    });
  });

  it('file の URL のとき、開いてよい', () => {
    expect(readViewerParams('?file=file:///C:/a.pdf', EXTENSION_ORIGIN)).toEqual({
      ok: true,
      value: { pdfUrl: 'file:///C:/a.pdf' },
    });
  });

  it('この拡張の中の URL のとき、開いてよい', () => {
    expect(readViewerParams(`?file=${EXTENSION_ORIGIN}/a.pdf`, EXTENSION_ORIGIN)).toEqual({
      ok: true,
      value: { pdfUrl: `${EXTENSION_ORIGIN}/a.pdf` },
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
