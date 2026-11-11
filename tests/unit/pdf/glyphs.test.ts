import { describe, expect, it } from 'vitest';

import { horizontalSlots, normalizeGlyph, toRuns, verticalSlots } from '@/pdf/glyphs';

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

describe('toRuns の重ねて描いた片', () => {
  /**
   * ランの字をつなぐ。
   * @param items 片
   * @returns 字をつないだ文字列（ランの順）
   */
  function textOf(items: Parameters<typeof contentOf>[0]): string {
    return toRuns(contentOf(items))
      .map((run) => run.text)
      .join('');
  }

  it('同じ片が同じ場所に2つあるとき、1つだけ残す', () => {
    const item = horizontalItem('整数', 100, 500);
    expect(textOf([item, { ...item }])).toBe('整数');
  });

  it('片の一部だけが同じ場所にもう1つあるとき、一部の片を除く（一部の片が先でも）', () => {
    const whole = horizontalItem('再編後の学区', 100, 500);
    const part = { ...horizontalItem('編後', 110, 500), width: 21 };
    expect(textOf([part, whole])).toBe('再編後の学区');
    expect(textOf([whole, part])).toBe('再編後の学区');
  });

  it('縦書きの片の一部が同じ場所にもう1つあるとき、一部の片を除く', () => {
    const whole = verticalItem('教科書', 100, 500);
    const part = verticalItem('科書', 100, 490);
    expect(textOf([whole, part])).toBe('教科書');
  });

  it('同じ字でも、別の行・別の場所・大きさの違う片のときは、除かない', () => {
    const whole = horizontalItem('整数と整数', 100, 500);
    expect(textOf([whole, horizontalItem('整数', 100, 480)])).toBe('整数と整数整数');
    expect(textOf([whole, horizontalItem('整数', 200, 500)])).toBe('整数と整数整数');
    expect(textOf([whole, horizontalItem('整数', 100, 500, 7)])).toBe('整数と整数整数');
  });

  it('同じ場所でも、字が違う片のときは、除かない', () => {
    expect(textOf([horizontalItem('整数', 100, 500), horizontalItem('小数', 100, 500)])).toBe(
      '整数小数',
    );
  });
});

describe('horizontalSlots', () => {
  it('全角の字だけのとき、等分する', () => {
    expect(horizontalSlots(['あ', 'い'], 24, 10)).toEqual([
      [0, 12],
      [12, 24],
    ]);
  });

  it('半角の字と空白があるとき、半角は半字ぶん、全角は1字ぶん取り、空白が残りを分けあう', () => {
    expect(horizontalSlots(['1', '.', ' ', 'ア', 'イ'], 35, 10)).toEqual([
      [0, 5],
      [5, 10],
      [10, 15],
      [15, 25],
      [25, 35],
    ]);
  });

  it('空白がなく半角の字が混じるとき、見積もりの幅の比で分ける', () => {
    expect(horizontalSlots(['A', 'あ'], 12, 10)).toEqual([
      [0, 4],
      [4, 12],
    ]);
  });

  it('字が見積もりより詰まっていて残りがないとき、空白は場所を取らない', () => {
    expect(horizontalSlots(['A', ' ', 'あ'], 12, 10)).toEqual([
      [0, 4],
      [4, 4],
      [4, 12],
    ]);
  });
});

describe('toRuns の横書きの片の字の幅', () => {
  it('半角の数字が混じる片のとき、後ろの字も本当の位置に近くなる', () => {
    const item = { ...horizontalItem('令和8年', 100, 500), width: 35 };
    const [run] = toRuns(contentOf([item]));
    expect(run?.glyphs[3]?.rect.x1).toBeCloseTo(125);
    expect(run?.glyphs[3]?.rect.x2).toBeCloseTo(135);
  });
});

describe('toRuns の文字の対応表のないフォント', () => {
  const garbled = { fontName: 'garbled' };

  it('字の番号がそのまま文字になったフォントのとき、そのフォントの片を除く（短い片や、本物の漢字になった片も）', () => {
    const runs = toRuns(
      contentOf([
        horizontalItem('本文の字です', 100, 500),
        { ...horizontalItem('䝅䝇䝔䝮䜢', 100, 480), ...garbled },
        { ...horizontalItem('足', 100, 460), ...garbled },
      ]),
    );
    expect(runs.map((run) => run.text)).toEqual(['本文の字です']);
  });

  it('まず出ない字が少しだけ混じるとき、除かない', () => {
    const runs = toRuns(contentOf([horizontalItem('㐂という字のある長い文章です', 100, 500)]));
    expect(runs.map((run) => run.text)).toEqual(['㐂という字のある長い文章です']);
  });

  it('部首の字で書かれたフォントのとき、除かない', () => {
    const runs = toRuns(contentOf([horizontalItem('⽇本⼈', 100, 500)]));
    expect(runs.map((run) => run.text)).toEqual(['⽇本⼈']);
  });
});
