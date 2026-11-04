import { describe, expect, it } from 'vitest';

import { createFailedPages, isImageOnlyDocument } from '@/viewer/special-cases';

describe('isImageOnlyDocument', () => {
  it('描いたページがまだないとき、画像だけとは言わない', () => {
    expect(isImageOnlyDocument(new Map())).toBe(false);
  });

  it('描いたページのどれにも文がないとき、画像だけと言う', () => {
    expect(
      isImageOnlyDocument(
        new Map([
          [1, false],
          [2, false],
        ]),
      ),
    ).toBe(true);
  });

  it('文のあるページが1つでもあるとき、画像だけとは言わない', () => {
    expect(
      isImageOnlyDocument(
        new Map([
          [1, false],
          [2, true],
        ]),
      ),
    ).toBe(false);
  });
});

describe('createFailedPages', () => {
  it('出せなかったページを足したとき、ページ番号の順に挙がる', () => {
    const failed = createFailedPages<string>();
    failed.add(3, 'c');
    failed.add(1, 'a');

    expect(failed.size).toBe(2);
    expect(failed.list()).toEqual([
      [1, 'a'],
      [3, 'c'],
    ]);
  });

  it('出せたページを消したとき、残りだけが挙がる', () => {
    const failed = createFailedPages<string>();
    failed.add(1, 'a');
    failed.add(2, 'b');
    failed.remove(1);

    expect(failed.list()).toEqual([[2, 'b']]);
  });

  it('全部消したとき、空になる', () => {
    const failed = createFailedPages<string>();
    failed.add(1, 'a');
    failed.clear();

    expect(failed.size).toBe(0);
  });
});
