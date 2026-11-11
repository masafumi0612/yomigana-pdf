import { describe, expect, it } from 'vitest';

import { applyMatrix, invertMatrix } from '@/viewer/transform';
import {
  fromUpright,
  fromUprightMatrix,
  noteTextRotation,
  textPage,
  toUpright,
  uprightContent,
  uprightFrame,
  uprightMatrix,
} from '@/viewer/upright';

const VIEW = [0, 0, 600, 800];
/** 字の大きさ */
const SIZE = 10;

/**
 * 片を1つ持つ、getTextContent() の結果を作る。
 * @param transform 片の変換
 * @returns getTextContent() の結果
 */
function contentOf(transform: readonly number[]): Parameters<typeof uprightContent>[0] {
  return {
    items: [{ str: '今日', dir: 'ltr', transform, width: 20, height: SIZE, fontName: 'f' }],
    styles: {},
  };
}

describe('uprightMatrix', () => {
  it('回転のないページのとき、変換はない', () => {
    expect(uprightMatrix({ rotate: 0, view: VIEW })).toBeUndefined();
    expect(fromUprightMatrix({ rotate: 360, view: VIEW })).toBeUndefined();
  });

  it.each([
    // 表示の左下に来る PDF の角と、表示の右上に来る PDF の角
    [90, { x: 600, y: 0 }, { x: 0, y: 800 }],
    [180, { x: 600, y: 800 }, { x: 0, y: 0 }],
    [270, { x: 0, y: 800 }, { x: 600, y: 0 }],
  ])('%d 度のページのとき、表示の左下と右上の角に写る', (rotate, bottomLeft, topRight) => {
    const page = { rotate, view: VIEW };
    const matrix = uprightMatrix(page);
    const frame = uprightFrame(page);
    expect(matrix).toBeDefined();
    if (matrix === undefined) return;
    expect(applyMatrix(matrix, bottomLeft)).toEqual({ x: 0, y: 0 });
    expect(applyMatrix(matrix, topRight)).toEqual({ x: frame.pageWidth, y: frame.pageHeight });
  });

  it('ページの箱の原点が 0 でないとき、表示の座標は 0 から始まる', () => {
    const matrix = uprightMatrix({ rotate: 90, view: [10, 20, 610, 820] });
    expect(matrix).toBeDefined();
    if (matrix === undefined) return;
    expect(applyMatrix(matrix, { x: 610, y: 20 })).toEqual({ x: 0, y: 0 });
  });

  it('逆の変換をかけると、もとの点に戻る', () => {
    const page = { rotate: 270, view: VIEW };
    const matrix = uprightMatrix(page);
    const back = fromUprightMatrix(page);
    expect(matrix).toBeDefined();
    expect(back).toBeDefined();
    if (matrix === undefined || back === undefined) return;
    expect(applyMatrix(back, applyMatrix(matrix, { x: 12, y: 34 }))).toEqual({ x: 12, y: 34 });
  });
});

describe('uprightFrame', () => {
  it('回転のないページのとき、ページの箱のまま', () => {
    expect(uprightFrame({ rotate: 0, view: [10, 20, 610, 820] })).toEqual({
      pageX: 10,
      pageY: 20,
      pageWidth: 600,
      pageHeight: 800,
    });
  });

  it('90 度のページのとき、幅と高さが入れ替わる', () => {
    expect(uprightFrame({ rotate: 90, view: VIEW })).toEqual({
      pageX: 0,
      pageY: 0,
      pageWidth: 800,
      pageHeight: 600,
    });
  });

  it('180 度のページのとき、幅と高さは変わらない', () => {
    expect(uprightFrame({ rotate: 180, view: VIEW })).toEqual({
      pageX: 0,
      pageY: 0,
      pageWidth: 600,
      pageHeight: 800,
    });
  });
});

describe('uprightContent', () => {
  it('回転のないページのとき、同じものを返す', () => {
    const content = contentOf([SIZE, 0, 0, SIZE, 100, 200]);
    expect(uprightContent(content, { rotate: 0, view: VIEW })).toBe(content);
  });

  it('90 度のページで横倒しに入った片のとき、回っていない片になる', () => {
    const content = contentOf([0, SIZE, -SIZE, 0, 100, 200]);
    const [item] = uprightContent(content, { rotate: 90, view: VIEW }).items;
    expect(item !== undefined && 'str' in item ? item.transform : undefined).toEqual([
      SIZE,
      0,
      0,
      SIZE,
      200,
      500,
    ]);
  });
});

describe('textPage', () => {
  it('字が横倒しに入っているページのとき、ページの回転を使う', () => {
    const page = { rotate: 90, view: VIEW };
    noteTextRotation(page, contentOf([0, SIZE, -SIZE, 0, 100, 200]));
    expect(textPage(page).rotate).toBe(90);
  });

  it('字がまっすぐ入っているページのとき、回転がないものとして扱う', () => {
    const page = { rotate: 90, view: VIEW };
    noteTextRotation(page, contentOf([SIZE, 0, 0, SIZE, 100, 200]));
    expect(textPage(page).rotate).toBe(0);
  });

  it('字をまだ見ていないページのとき、回転がないものとして扱う', () => {
    expect(textPage({ rotate: 90, view: VIEW }).rotate).toBe(0);
  });
});

describe('fromUpright と toUpright', () => {
  const canvas = [2, 0, 0, -2, 0, 1600] as const;

  it('回転のないページのとき、同じ変換を返す', () => {
    const page = { rotate: 0, view: VIEW };
    expect(fromUpright(canvas, page)).toBe(canvas);
    expect(toUpright(canvas, page)).toBe(canvas);
  });

  it('表示の座標から PDF を通って画面に写す変換と、その逆が打ち消しあう', () => {
    const page = { rotate: 90, view: VIEW };
    const toScreen = fromUpright(canvas, page);
    const inverse = invertMatrix(canvas);
    expect(inverse).toBeDefined();
    if (inverse === undefined) return;
    const toPageCoords = toUpright(inverse, page);
    expect(applyMatrix(toPageCoords, applyMatrix(toScreen, { x: 30, y: 40 }))).toEqual({
      x: 30,
      y: 40,
    });
  });
});
