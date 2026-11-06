import { describe, expect, it } from 'vitest';

import { annotate, type AnnotateOptions, type RubyWord } from '@/text/annotate';
import type { Token } from '@/text/types';

const ALL: AnnotateOptions = { level: 'all', userDictionary: new Map() };

/**
 * ルビのもとになった語を作る。
 * @param surface 書き方
 * @param reading 語全体の読み
 * @param isUserFixed 利用者が直した読みか
 * @returns ルビのもとになった語
 */
function word(surface: string, reading: string, isUserFixed = false): RubyWord {
  return { surface, reading, isUserFixed };
}

/**
 * テスト用の語を作る。
 * @param surface 書き方
 * @param reading 読み（片仮名）
 * @returns 語
 */
function token(surface: string, reading: string): Token {
  return { surface, reading, pos: '名詞', posDetails: ['一般', '', ''] };
}

/**
 * 決まった語の並びを返す解析の代わりを作る。
 * @param tokens 返す語の並び
 * @returns 解析の代わり
 */
function fixed(...tokens: Token[]): () => Token[] {
  return () => tokens;
}

describe('annotate', () => {
  it('段階が all のとき、漢字の1字ごとにルビを付ける所を出す', () => {
    const school = word('学校', 'がっこう');
    expect(annotate('学校', fixed(token('学校', 'ガッコウ')), ALL)).toEqual([
      { start: 0, end: 1, ruby: 'がっ', isAlways: false, word: school },
      { start: 1, end: 2, ruby: 'こう', isAlways: false, word: school },
    ]);
  });

  it('段階までに習う字のとき、ルビを付ける所を出さない', () => {
    const options: AnnotateOptions = { level: 'g1', userDictionary: new Map() };
    expect(annotate('学校', fixed(token('学校', 'ガッコウ')), options)).toEqual([]);
  });

  it('付表の語のとき、語全体に、いつも付けるルビを出す', () => {
    const options: AnnotateOptions = { level: 'joyo', userDictionary: new Map() };
    expect(annotate('今日', fixed(token('今日', 'キョウ')), options)).toEqual([
      { start: 0, end: 2, ruby: 'きょう', isAlways: true, word: word('今日', 'きょう') },
    ]);
  });

  it('正規化で字がまとまったとき、位置をもとの文の位置にする', () => {
    // ｶﾞ（2字）は ガ（1字）にまとまる
    const tokenize = fixed(token('ガ', 'ガ'), token('学校', 'ガッコウ'));
    const school = word('学校', 'がっこう');
    expect(annotate('ｶﾞ学校', tokenize, ALL)).toEqual([
      { start: 2, end: 3, ruby: 'がっ', isAlways: false, word: school },
      { start: 3, end: 4, ruby: 'こう', isAlways: false, word: school },
    ]);
  });

  it('1字が何字にも広がったとき、もとの1字に、語全体の読みを付ける', () => {
    // ㍿ は 株式会社 に広がる。習っていない 株 があるので、ルビは4字分の読みにする
    const options: AnnotateOptions = { level: 'g5', userDictionary: new Map() };
    const tokenize = fixed(token('株式会社', 'カブシキガイシャ'), token('へ', 'ヘ'));
    expect(annotate('㍿へ', tokenize, options)).toEqual([
      {
        start: 0,
        end: 1,
        ruby: 'かぶしきがいしゃ',
        isAlways: false,
        word: word('株式会社', 'かぶしきがいしゃ'),
      },
    ]);
  });

  it('1字が何字にも広がり、どの字も習っているとき、ルビを付ける所を出さない', () => {
    const options: AnnotateOptions = { level: 'g6', userDictionary: new Map() };
    const tokenize = fixed(token('株式会社', 'カブシキガイシャ'));
    expect(annotate('㍿', tokenize, options)).toEqual([]);
  });

  it('利用者の辞書に語があるとき、その読みを使う', () => {
    const options: AnnotateOptions = { level: 'all', userDictionary: new Map([['林', 'はやし']]) };
    expect(annotate('林', fixed(token('林', 'リン')), options)).toEqual([
      { start: 0, end: 1, ruby: 'はやし', isAlways: false, word: word('林', 'はやし', true) },
    ]);
  });

  it('習っていない字だけにルビを付けるとき、その字のルビにも語全体の書き方と読みを付ける', () => {
    const options: AnnotateOptions = { level: 'g2', userDictionary: new Map() };
    expect(annotate('図鑑', fixed(token('図鑑', 'ズカン')), options)).toEqual([
      { start: 1, end: 2, ruby: 'かん', isAlways: false, word: word('図鑑', 'ずかん') },
    ]);
  });

  it('利用者の辞書がいくつかの語をつないだ書き方のとき、その書き方を語にする', () => {
    const options: AnnotateOptions = {
      level: 'all',
      userDictionary: new Map([['小鳥遊', 'たかなし']]),
    };
    const tokenize = fixed(token('小鳥', 'コトリ'), token('遊', 'ユウ'));
    expect(annotate('小鳥遊', tokenize, options)).toEqual([
      {
        start: 0,
        end: 3,
        ruby: 'たかなし',
        isAlways: true,
        word: word('小鳥遊', 'たかなし', true),
      },
    ]);
  });

  it('解析には、正規化した文を渡す', () => {
    const received: string[] = [];
    annotate(
      '⽇',
      (normalized) => {
        received.push(normalized);
        return [token(normalized, 'ヒ')];
      },
      ALL,
    );
    expect(received).toEqual(['日']);
  });
});
