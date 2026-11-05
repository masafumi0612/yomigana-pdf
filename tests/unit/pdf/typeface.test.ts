import { describe, expect, it } from 'vitest';

import { isSerifFont } from '@/pdf/typeface';

describe('isSerifFont', () => {
  it('styles の family が serif のとき、明朝にする', () => {
    expect(isSerifFont({ fontFamily: 'serif' }, undefined)).toBe(true);
  });

  it('styles の family が sans-serif のとき、ゴシックにする', () => {
    expect(isSerifFont({ fontFamily: 'sans-serif' }, undefined)).toBe(false);
  });

  it('styles の family が monospace のとき、ゴシックにする', () => {
    expect(isSerifFont({ fontFamily: 'monospace' }, undefined)).toBe(false);
  });

  it('フォントの名前に Mincho や Serif があるとき、family が sans-serif でも明朝にする', () => {
    expect(isSerifFont({ fontFamily: 'sans-serif' }, 'ABCDEF+NotoSerifJP-Regular')).toBe(true);
    expect(isSerifFont({ fontFamily: 'sans-serif' }, 'MS-Mincho')).toBe(true);
    expect(isSerifFont(undefined, 'ヒラギノ明朝 ProN')).toBe(true);
  });

  it('フォントの名前に Gothic や Sans があるとき、family が serif でもゴシックにする', () => {
    expect(isSerifFont({ fontFamily: 'serif' }, 'ABCDEF+NotoSansJP-Bold')).toBe(false);
    expect(isSerifFont({ fontFamily: 'serif' }, 'MS-PGothic')).toBe(false);
    expect(isSerifFont({ fontFamily: 'serif' }, 'ヒラギノ角ゴ-ゴシック')).toBe(false);
  });

  it('名前に「sans-serif」とあるとき、serif の文字を含んでいてもゴシックにする', () => {
    expect(isSerifFont({ fontFamily: 'serif' }, 'Foo-Sans-Serif')).toBe(false);
  });

  it('名前も styles もないとき、ゴシックにする', () => {
    expect(isSerifFont(undefined, undefined)).toBe(false);
    expect(isSerifFont({}, 'XYZ')).toBe(false);
  });
});
