import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { IpadicFeatures, Tokenizer } from 'kuromoji';
import { builder } from 'kuromoji';
import { beforeAll, describe, expect, it } from 'vitest';

import { clearRecentErrors, getRecentErrors } from '@/log';
import {
  createGzipLoader,
  type FetchFile,
  loadTokenizer,
  type WordTokenizer,
} from '@/text/dictionary';
import { toTokens } from '@/text/tokens';

/** @patdx/kuromoji の辞書（gzip）のフォルダ */
const PATDX_DICT_DIR = fileURLToPath(
  new URL('../../../node_modules/@patdx/kuromoji/dict/', import.meta.url),
);
/** 辞書を置いた所に見立てる URL */
const BASE_URL = new URL('chrome-extension://test/dict/');
/** 辞書を2つ読み込み終えるまでの時間の上限（ミリ秒）。手元ではそれぞれ1秒ほど */
const LOAD_TIMEOUT_MS = 60_000;
/** 同じ語と読みになるかを比べる文 */
const SENTENCES = [
  '今日は雨が降っているので、図書館で本を三冊借りました。',
  '株式会社の社長が、来年の計画を発表する。',
  '一本の鉛筆と、二十三枚の紙を用意してください。',
  '彼女は大人になってから、ピアノを習い始めた。',
  '令和6年11月3日、東京都千代田区で会議を開く。',
];

/**
 * 辞書のファイルを、入れた @patdx/kuromoji の中から読む（fetch の代わり）。
 * @param url 辞書のファイルの URL
 * @returns ファイルの中身
 */
const fetchFromPackage: FetchFile = async (url) =>
  new Response(await readFile(join(PATDX_DICT_DIR, basename(url.pathname))));

/**
 * kuromoji 0.1.2 の辞書を、入れた kuromoji の中から読む。
 * @returns kuromoji 0.1.2 の解析器
 */
async function loadOriginal(): Promise<Tokenizer<IpadicFeatures>> {
  const dicPath = join(
    dirname(createRequire(import.meta.url).resolve('kuromoji/package.json')),
    'dict',
  );
  return new Promise((resolve, reject) => {
    // 型では error がいつもあることになっているが、うまく読めたときは null が来る
    builder({ dicPath }).build((error: Error | null, tokenizer) => {
      if (error === null) resolve(tokenizer);
      else reject(error);
    });
  });
}

describe('loadTokenizer', () => {
  let patdx: WordTokenizer;
  let original: Tokenizer<IpadicFeatures>;

  beforeAll(async () => {
    const loaded = await loadTokenizer(createGzipLoader(BASE_URL, fetchFromPackage));
    if (!loaded.ok) {
      throw new Error('辞書を読み込めませんでした');
    }
    patdx = loaded.value;
    original = await loadOriginal();
  }, LOAD_TIMEOUT_MS);

  it('同梱の gzip の辞書を読めたとき、文を語に分けられる', () => {
    expect(patdx.tokenize('学校').map((word) => word.reading)).toEqual(['ガッコウ']);
  });

  it.each(SENTENCES)('@patdx/kuromoji と kuromoji 0.1.2 で、語と読みが同じになる：%s', (text) => {
    expect(toTokens(patdx.tokenize(text))).toEqual(toTokens(original.tokenize(text)));
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
