// kuromoji（@patdx/kuromoji）の辞書を、拡張に同梱した gzip のファイルから読み込む。外からは何も読み込まない
import { type LoaderConfig, TokenizerBuilder } from '@patdx/kuromoji';

import { createLogger } from '@/log';
import type { Result } from '@/result';

import type { IpadicWord } from './tokens';

/** 文を語に分けるもの（kuromoji の解析器のうち、使うところ） */
export interface WordTokenizer {
  /**
   * 文を語に分ける。
   * @param text 文
   * @returns 語の並び。書き方をつなぐと text になる
   */
  tokenize(text: string): readonly IpadicWord[];
}

/** 辞書のファイルを取る関数（テストで差しかえるため、fetch と同じ形） */
export type FetchFile = (url: URL) => Promise<Response>;

const log = createLogger('dictionary');

/**
 * 辞書の gzip のファイルを取って、ほどいて渡す読み込み方を作る。
 * @param baseUrl 辞書のファイルを置いた所（/ で終える。例：chrome-extension://…/dict/）
 * @param fetchFile ファイルを取る関数
 * @returns kuromoji に渡す読み込み方
 */
export function createGzipLoader(baseUrl: URL, fetchFile: FetchFile = fetch): LoaderConfig {
  return {
    async loadArrayBuffer(name) {
      const response = await fetchFile(new URL(name, baseUrl));
      if (!response.ok || response.body === null) {
        throw new Error(`辞書のファイルを取れません：${name}（${String(response.status)}）`);
      }
      const unzipped = response.body.pipeThrough(new DecompressionStream('gzip'));
      return new Response(unzipped).arrayBuffer();
    },
  };
}

/**
 * 辞書を読み込んで、解析器を作る。
 * @param loader 辞書の読み込み方
 * @returns 解析器。辞書を読めなかったときは dictionary-unavailable
 */
export async function loadTokenizer(
  loader: LoaderConfig,
): Promise<Result<WordTokenizer, 'dictionary-unavailable'>> {
  try {
    const tokenizer = await new TokenizerBuilder({ loader }).build();
    return { ok: true, value: tokenizer };
  } catch (error) {
    log.error('辞書を読み込めませんでした', error);
    return { ok: false, error: 'dictionary-unavailable' };
  }
}
