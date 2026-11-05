import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createGzipLoader,
  type FetchFile,
  loadTokenizer,
  type WordTokenizer,
} from '@/text/dictionary';

/** 入れた @patdx/kuromoji の、辞書（gzip）のフォルダ */
const DICT_DIR = fileURLToPath(
  new URL('../../node_modules/@patdx/kuromoji/dict/', import.meta.url),
);
/** 辞書を置いた所に見立てる URL */
export const DICT_BASE_URL = new URL('chrome-extension://test/dict/');

/**
 * 辞書のファイルを、入れた @patdx/kuromoji の中から読む（fetch の代わり）。
 * @param url 辞書のファイルの URL
 * @returns ファイルの中身
 */
export const fetchFromPackage: FetchFile = async (url) =>
  new Response(await readFile(join(DICT_DIR, basename(url.pathname))));

let tokenizerPromise: Promise<WordTokenizer> | undefined;

/**
 * 辞書を入れた @patdx/kuromoji の中から読んで、解析器を作る（1度だけ読み、あとは同じものを使う）。
 * @returns 解析器
 */
export async function loadNodeTokenizer(): Promise<WordTokenizer> {
  tokenizerPromise ??= loadTokenizer(createGzipLoader(DICT_BASE_URL, fetchFromPackage)).then(
    (loaded) => {
      if (!loaded.ok) throw new Error('辞書を読み込めませんでした');
      return loaded.value;
    },
  );
  return tokenizerPromise;
}
