// 辞書を1回だけ読み込み、文の読みの問い合わせに答える（offscreen document の中の Worker で動かす）
import { createLogger } from '@/log';
import type { Result } from '@/result';

import { annotate, type AnnotateOptions, type RubySpan } from './annotate';
import type { WordTokenizer } from './dictionary';
import { LruCache } from './lru-cache';
import { toTokens } from './tokens';
import type { Token } from './types';

/**
 * 解析した語を残しておく文の数。同じ文（見出し・ページの下の文など）は何度も出てくるので、
 * 1回だけ解析する。PDF の数ページ分の段落が入り、メモリを使いすぎない数
 */
const TOKEN_CACHE_SIZE = 2000;

/** 読みを出せなかった理由 */
export type ReadingServiceError = 'dictionary-unavailable' | 'analysis-failed';

/** 読みの問い合わせに答えるもの */
export interface ReadingService {
  /**
   * 文ごとに、ルビを付ける所を出す。初めて呼んだときに辞書を読み込む。
   * @param texts 文（段落ごと）
   * @param options ルビの付け方
   * @returns 文ごとのルビを付ける所（texts と同じ順）。辞書を読めない・解析に失敗したときはその理由
   */
  read(
    texts: readonly string[],
    options: AnnotateOptions,
  ): Promise<Result<RubySpan[][], ReadingServiceError>>;
}

const log = createLogger('reading');

/**
 * 読みの問い合わせに答えるものを作る。
 * @param loadTokenizer 辞書を読み込んで解析器を作る。読み込みに失敗したら、次の問い合わせでもう一度呼ぶ
 * @param cacheSize 解析した語を残しておく文の数
 * @returns 読みの問い合わせに答えるもの
 */
export function createReadingService(
  loadTokenizer: () => Promise<Result<WordTokenizer, 'dictionary-unavailable'>>,
  cacheSize: number = TOKEN_CACHE_SIZE,
): ReadingService {
  // 解析した語はメモリだけに残す（PDF の文をディスクに残さない）
  const cache = new LruCache<string, readonly Token[]>(cacheSize);
  let loading: Promise<Result<WordTokenizer, 'dictionary-unavailable'>> | undefined;

  return {
    async read(texts, options) {
      // いくつもの問い合わせが同時に来ても、辞書は1回だけ読み込む
      loading ??= loadTokenizer();
      const loaded = await loading;
      if (!loaded.ok) {
        loading = undefined;
        return loaded;
      }
      const tokenizer = loaded.value;
      const tokenize = (normalized: string): readonly Token[] => {
        const cached = cache.get(normalized);
        if (cached !== undefined) {
          return cached;
        }
        const tokens = toTokens(tokenizer.tokenize(normalized));
        cache.set(normalized, tokens);
        return tokens;
      };
      try {
        return { ok: true, value: texts.map((text) => annotate(text, tokenize, options)) };
      } catch (error) {
        log.error('文を解析できませんでした', error);
        return { ok: false, error: 'analysis-failed' };
      }
    },
  };
}
