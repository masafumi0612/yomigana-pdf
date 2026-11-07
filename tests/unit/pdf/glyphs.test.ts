import { describe, expect, it } from 'vitest';

import { normalizeGlyph, toRuns, verticalSlots } from '@/pdf/glyphs';

import { contentOf, horizontalItem, SIZE, unmarkedColumn, verticalItem } from './make-items';

describe('normalizeGlyph', () => {
  it('全角の英数字のとき、NFKC の形になる', () => {
    expect(normalizeGlyph('Ａ')).toBe('A');
  });

  it('NFKC で2字以上になる字のとき、もとの字のままになる', () => {
    expect(normalizeGlyph('㍻')).toBe('㍻');
  });
});

describe('toRuns', () => {
  it('横書きの片のとき、1字ずつ左から箱が並ぶ', () => {
    const [run] = toRuns(contentOf([horizontalItem('今日', 100, 500)]));
    expect(run?.direction).toBe('horizontal');
    expect(run?.glyphs.map((glyph) => glyph.rect)).toEqual([
      { x1: 100, x2: 110, y1: 498.8, y2: 508.8 },
      { x1: 110, x2: 120, y1: 498.8, y2: 508.8 },
    ]);
  });

  it('縦書きの印のある片のとき、列の中心から上から1字ずつ箱が並ぶ', () => {
    const [run] = toRuns(contentOf([verticalItem('今日', 100, 500)]));
    expect(run?.direction).toBe('vertical');
    expect(run?.glyphs.map((glyph) => glyph.rect)).toEqual([
      { x1: 95, x2: 105, y1: 490, y2: 500 },
      { x1: 95, x2: 105, y1: 480, y2: 490 },
    ]);
  });

  it('縦書きのフォントの片のとき、dir が ttb でなくても縦書きになる', () => {
    const item = { ...horizontalItem('今日', 100, 500), fontName: 'vertical' };
    const [run] = toRuns(contentOf([item]));
    expect(run?.direction).toBe('vertical');
    expect(run?.glyphs[0]?.evidence).toBe('mark');
  });

  it('空白を含む片のとき、空白は位置を数えるだけで字にならない', () => {
    const [run] = toRuns(contentOf([horizontalItem('今 日', 100, 500)]));
    expect(run?.text).toBe('今日');
    expect(run?.glyphs[1]?.rect.x1).toBe(120);
  });

  it('空白だけの片・印・回した横書きの片のとき、捨てる', () => {
    const rotated = {
      ...horizontalItem('横倒し', 100, 300),
      transform: [0, SIZE, -SIZE, 0, 100, 300],
    };
    const content = contentOf([horizontalItem(' 　', 100, 500), rotated]);
    const runs = toRuns({ ...content, items: [{ type: 'beginMarkedContent' }, ...content.items] });
    expect(runs).toEqual([]);
  });

  it('判定に使う形として、1字ずつ NFKC の形を持つ', () => {
    const [run] = toRuns(contentOf([horizontalItem('１㍻', 100, 500)]));
    expect(run?.glyphs.map((glyph) => glyph.norm)).toEqual(['1', '㍻']);
  });

  it('1字ずつの片が真下へ続くとき、縦書きの1つのランになる', () => {
    const runs = toRuns(contentOf(unmarkedColumn('今日は', 100, 500)));
    expect(runs.map((run) => [run.direction, run.text])).toEqual([['vertical', '今日は']]);
    expect(runs[0]?.glyphs.every((glyph) => glyph.evidence === 'chain')).toBe(true);
  });

  it('1字だけの片が1つだけのとき、向きの手がかりのない横書きのランになる', () => {
    const [run] = toRuns(contentOf([horizontalItem('今', 100, 500)]));
    expect(run?.direction).toBe('horizontal');
    expect(run?.glyphs[0]?.evidence).toBe('lone');
  });

  it('1字ずつの片が横に並ぶとき、縦書きにならない', () => {
    const items = [horizontalItem('今', 100, 500), horizontalItem('日', 110, 500)];
    expect(toRuns(contentOf(items)).map((run) => run.direction)).toEqual([
      'horizontal',
      'horizontal',
    ]);
  });

  it('真下へ続く並びの x がずれたとき、そこで並びが切れる', () => {
    const items = [...unmarkedColumn('今日', 200, 500), ...unmarkedColumn('明日', 170, 500)];
    expect(toRuns(contentOf(items)).map((run) => run.text)).toEqual(['今日', '明日']);
  });

  it('真下へ続く並びのあいだに2字以上の片があるとき、そこで並びが切れる', () => {
    const items = [
      ...unmarkedColumn('今日', 200, 500),
      horizontalItem('見出し', 300, 700),
      ...unmarkedColumn('明日', 200, 480),
    ];
    expect(toRuns(contentOf(items)).map((run) => [run.direction, run.text])).toEqual([
      ['vertical', '今日'],
      ['horizontal', '見出し'],
      ['vertical', '明日'],
    ]);
  });

  it('大きさの違う1字ずつの片が続くとき、縦書きの並びにならない', () => {
    const items = [horizontalItem('図', 200, 500), horizontalItem('ず', 202, 490, SIZE / 2)];
    expect(toRuns(contentOf(items)).map((run) => run.direction)).toEqual([
      'horizontal',
      'horizontal',
    ]);
  });
});

describe('verticalSlots', () => {
  it('空白のない片のとき、字で等分する', () => {
    expect(verticalSlots(['今', '日'], 24, 10)).toEqual([
      [0, 12],
      [12, 24],
    ]);
  });

  it('pdf.js が入れた半角の空白があるとき、字は1字ぶんずつ取り、空白が残りを分けあう', () => {
    // 字 4 つで 40、残りの 6 を空白 3 つで 2 ずつ分けあう
    expect(verticalSlots(['あ', ' ', 'い', 'う', ' ', 'え', ' '], 46, 10)).toEqual([
      [0, 10],
      [10, 12],
      [12, 22],
      [22, 32],
      [32, 34],
      [34, 44],
      [44, 46],
    ]);
  });

  it('全角の空白は、1字ぶんの場所を取る', () => {
    expect(verticalSlots(['あ', '　', 'い', ' '], 32, 10)).toEqual([
      [0, 10],
      [10, 20],
      [20, 30],
      [30, 32],
    ]);
  });

  it('字が大きさより詰まっていて残りがないとき、空白は場所を取らず、字で等分する', () => {
    expect(verticalSlots(['あ', ' ', 'い'], 16, 10)).toEqual([
      [0, 8],
      [8, 8],
      [8, 16],
    ]);
  });
});

describe('toRuns の縦書きの片の字間', () => {
  it('字間の空き方が不ぞろいで空白が入った片のとき、空白の後ろの字も本当の位置に置く', () => {
    // 字は 10 ずつ。「あい」の間だけ 6 空き、pdf.js が空白を1つ入れた片（長さは 36）
    const item = { ...verticalItem('あ いう', 100, 500), height: 36 };
    const [run] = toRuns(contentOf([item]));
    expect(run?.glyphs.map((glyph) => [glyph.ch, glyph.rect.y2, glyph.rect.y1])).toEqual([
      ['あ', 500, 490],
      ['い', 484, 474],
      ['う', 474, 464],
    ]);
  });
});
