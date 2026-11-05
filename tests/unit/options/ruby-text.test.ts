import { describe, expect, it } from 'vitest';

import { parseRubyText } from '@/options/ruby-text';

describe('parseRubyText', () => {
  it('ルビの書き方がないとき、文字のまま1つになる', () => {
    expect(parseRubyText('ひらいた。')).toEqual([{ kind: 'text', text: 'ひらいた。' }]);
  });

  it('文の途中にルビがあるとき、前後の文字とルビに分かれる', () => {
    expect(parseRubyText('図｜鑑《かん》を見た。')).toEqual([
      { kind: 'text', text: '図' },
      { kind: 'ruby', base: '鑑', ruby: 'かん' },
      { kind: 'text', text: 'を見た。' },
    ]);
  });

  it('ルビが続くとき、字ごとのルビに分かれる', () => {
    expect(parseRubyText('｜薔《ば》｜薇《ら》')).toEqual([
      { kind: 'ruby', base: '薔', ruby: 'ば' },
      { kind: 'ruby', base: '薇', ruby: 'ら' },
    ]);
  });

  it('2字以上にまとめて付けるとき、語全体に1つのルビになる', () => {
    expect(parseRubyText('｜今日《きょう》')).toEqual([
      { kind: 'ruby', base: '今日', ruby: 'きょう' },
    ]);
  });

  it('空の文字のとき、何もない', () => {
    expect(parseRubyText('')).toEqual([]);
  });
});
