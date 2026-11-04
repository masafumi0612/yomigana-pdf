import { describe, expect, it, vi } from 'vitest';

import { clearRecentErrors, getRecentErrors } from '@/log';
import type { Result } from '@/result';
import type { AnnotateOptions } from '@/text/annotate';
import type { WordTokenizer } from '@/text/dictionary';
import { createReadingService } from '@/text/reading-service';
import type { IpadicWord } from '@/text/tokens';

const ALL: AnnotateOptions = { level: 'all', userDictionary: new Map() };

/**
 * 文をそのまま1語にし、読みを決まった片仮名にする解析器の代わりを作る。
 * @returns 解析器の代わりと、呼ばれた数を数える tokenize
 */
function fakeTokenizer() {
  const tokenize = vi.fn((text: string): IpadicWord[] => [
    {
      surface_form: text,
      reading: 'ガッコウ',
      pos: '名詞',
      pos_detail_1: '一般',
      pos_detail_2: '*',
      pos_detail_3: '*',
    },
  ]);
  const tokenizer: WordTokenizer = { tokenize };
  return { tokenizer, tokenize };
}

/**
 * うまく読み込める辞書の代わりを作る。
 * @param tokenizer 読み込んだときに返す解析器
 * @returns 辞書を読み込む関数（呼ばれた数を数える）
 */
function loaderOf(tokenizer: WordTokenizer) {
  return vi.fn(() =>
    Promise.resolve<Result<WordTokenizer, 'dictionary-unavailable'>>({
      ok: true,
      value: tokenizer,
    }),
  );
}

describe('createReadingService', () => {
  it('文を渡したとき、文ごとにルビを付ける所を返す', async () => {
    const service = createReadingService(loaderOf(fakeTokenizer().tokenizer));
    expect(await service.read(['学校', '学校'], ALL)).toEqual({
      ok: true,
      value: [
        [
          { start: 0, end: 1, ruby: 'がっ', isAlways: false },
          { start: 1, end: 2, ruby: 'こう', isAlways: false },
        ],
        [
          { start: 0, end: 1, ruby: 'がっ', isAlways: false },
          { start: 1, end: 2, ruby: 'こう', isAlways: false },
        ],
      ],
    });
  });

  it('問い合わせが同時に来たとき、辞書を1回だけ読み込む', async () => {
    const load = loaderOf(fakeTokenizer().tokenizer);
    const service = createReadingService(load);
    await Promise.all([service.read(['学校'], ALL), service.read(['学校'], ALL)]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('同じ文が来たとき、2回目は解析しない', async () => {
    const { tokenizer, tokenize } = fakeTokenizer();
    const service = createReadingService(loaderOf(tokenizer));
    await service.read(['学校'], ALL);
    await service.read(['学校'], ALL);
    expect(tokenize).toHaveBeenCalledTimes(1);
  });

  it('残しておく数を超えたとき、古い文はもう一度解析する', async () => {
    const { tokenizer, tokenize } = fakeTokenizer();
    const service = createReadingService(loaderOf(tokenizer), 1);
    await service.read(['学校', '校', '学校'], ALL);
    expect(tokenize).toHaveBeenCalledTimes(3);
  });

  it('辞書を読めなかったとき、dictionary-unavailable を返し、次の問い合わせで読み直す', async () => {
    const load = vi
      .fn<() => Promise<Result<WordTokenizer, 'dictionary-unavailable'>>>()
      .mockResolvedValueOnce({ ok: false, error: 'dictionary-unavailable' })
      .mockResolvedValueOnce({ ok: true, value: fakeTokenizer().tokenizer });
    const service = createReadingService(load);
    const first = await service.read(['学校'], ALL);
    const second = await service.read(['学校'], ALL);
    expect([first.ok, second.ok, load.mock.calls.length]).toEqual([false, true, 2]);
  });

  it('解析に失敗したとき、analysis-failed を返し、エラーを残す', async () => {
    clearRecentErrors();
    const broken: WordTokenizer = {
      tokenize: () => {
        throw new Error('壊れた');
      },
    };
    const service = createReadingService(loaderOf(broken));
    expect([await service.read(['学校'], ALL), getRecentErrors().length]).toEqual([
      { ok: false, error: 'analysis-failed' },
      1,
    ]);
  });
});
