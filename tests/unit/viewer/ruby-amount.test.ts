import { describe, expect, it } from 'vitest';

import { rubyAmountLabel } from '@/viewer/ruby-amount';

import { localeMessage } from '../../helpers/locale-message';

describe('rubyAmountLabel', () => {
  it('段階が 3年までのとき、バーの文字は「ルビ：3年までの漢字には付けない」になる', () => {
    expect(rubyAmountLabel('g3', localeMessage).text).toBe('ルビ：3年までの漢字には付けない');
  });

  it('段階がすべての漢字に付けるとき、バーの文字は「ルビ：すべての漢字に付ける」になる', () => {
    expect(rubyAmountLabel('all', localeMessage).text).toBe('ルビ：すべての漢字に付ける');
  });

  it('段階が常用漢字のとき、バーの文字は「ルビ：常用漢字には付けない」になる', () => {
    expect(rubyAmountLabel('joyo', localeMessage).text).toBe('ルビ：常用漢字には付けない');
  });

  it('読み上げの名前は、見えている文字に、設定を開くことを足したものになる', () => {
    expect(rubyAmountLabel('m1', localeMessage).name).toBe(
      'ルビ：中1までの漢字には付けない（ルビの設定を開く）',
    );
  });
});
