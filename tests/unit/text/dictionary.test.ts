import { beforeAll, describe, expect, it } from 'vitest';

import { clearRecentErrors, getRecentErrors } from '@/log';
import {
  createGzipLoader,
  type FetchFile,
  loadTokenizer,
  type WordTokenizer,
} from '@/text/dictionary';

import { DICT_BASE_URL as BASE_URL, fetchFromPackage } from '../../helpers/node-dictionary';

/** 辞書を読み込み終えるまでの時間の上限（ミリ秒）。手元では1秒ほど */
const LOAD_TIMEOUT_MS = 60_000;

describe('loadTokenizer', () => {
  let tokenizer: WordTokenizer;

  beforeAll(async () => {
    const loaded = await loadTokenizer(createGzipLoader(BASE_URL, fetchFromPackage));
    if (!loaded.ok) {
      throw new Error('辞書を読み込めませんでした');
    }
    tokenizer = loaded.value;
  }, LOAD_TIMEOUT_MS);

  it('同梱の gzip の辞書を読めたとき、文を語に分けられる', () => {
    expect(tokenizer.tokenize('学校').map((word) => word.reading)).toEqual(['ガッコウ']);
  });
});

describe('loadTokenizer の失敗', () => {
  it('辞書のファイルが見つからないとき、dictionary-unavailable になり、エラーを残す', async () => {
    clearRecentErrors();
    const notFound: FetchFile = () => Promise.resolve(new Response(undefined, { status: 404 }));
    const loaded = await loadTokenizer(createGzipLoader(BASE_URL, notFound));
    expect([loaded, getRecentErrors().length]).toEqual([
      { ok: false, error: 'dictionary-unavailable' },
      1,
    ]);
  });

  it('辞書のファイルの中身がないとき、dictionary-unavailable になる', async () => {
    const empty: FetchFile = () => Promise.resolve(new Response(undefined, { status: 200 }));
    const loaded = await loadTokenizer(createGzipLoader(BASE_URL, empty));
    expect(loaded).toEqual({ ok: false, error: 'dictionary-unavailable' });
  });
});
