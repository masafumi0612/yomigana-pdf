import { describe, expect, it } from 'vitest';

import { orderParagraphs } from '@/pdf/blocks';
import { toRuns } from '@/pdf/glyphs';
import { buildLines } from '@/pdf/lines';
import type { PdfTextItem } from '@/pdf/types';

import {
  contentOf,
  horizontalItem,
  horizontalLines,
  SIZE,
  verticalColumns,
  verticalItem,
} from './make-items';

/** 横書きの行の送り（行間は字の半分） */
const ROW_PITCH = SIZE * 1.5;

/**
 * 片を読む順の段落にし、段落ごとの向きと文にする。
 * @param items 片
 * @returns 段落ごとの向きの頭文字（v・h）と文
 */
function paragraphsOf(items: readonly PdfTextItem[]): string[] {
  return orderParagraphs(buildLines(toRuns(contentOf(items)))).map(
    (lines) =>
      `${lines[0]?.direction[0] ?? ''}:${lines.flatMap((line) => line.glyphs.map((g) => g.ch)).join('')}`,
  );
}

describe('orderParagraphs', () => {
  it('行がないとき、段落もない', () => {
    expect(orderParagraphs([])).toEqual([]);
  });

  it('縦書きの列のとき、右の列から読み、列の終わりで切れた語をつなぐ', () => {
    const items = verticalColumns(
      ['今日は晴れです。明', '日は雨です。', '風が吹く。'],
      300,
      500,
      15,
    );
    expect(paragraphsOf(items)).toEqual(['v:今日は晴れです。明日は雨です。', 'v:風が吹く。']);
  });

  it('横書きの行のとき、上の行から読み、行の終わりで切れた語をつなぐ', () => {
    const items = horizontalLines(
      ['今日は晴れです。明', '日は雨です。', '風が吹く。'],
      100,
      500,
      ROW_PITCH,
    );
    expect(paragraphsOf(items)).toEqual(['h:今日は晴れです。明日は雨です。', 'h:風が吹く。']);
  });

  it('横書きの段組みのとき、左の段を読んでから右の段を読む', () => {
    const items = [
      ...horizontalLines(['右の段の文です。右の', '段の続きです。'], 230, 500, ROW_PITCH),
      ...horizontalLines(['左の段の文です。左の', '段の続きです。'], 100, 500, ROW_PITCH),
    ];
    expect(paragraphsOf(items)).toEqual([
      'h:左の段の文です。左の段の続きです。',
      'h:右の段の文です。右の段の続きです。',
    ]);
  });

  it('縦書きの段のとき、上の段を右から読んでから下の段を読む', () => {
    const items = [
      ...verticalColumns(['下の段の一です。', '下の段の二です。'], 300, 395, 15),
      ...verticalColumns(['上の段の一です。', '上の段の二です。'], 300, 500, 15),
    ];
    expect(paragraphsOf(items)).toEqual([
      'v:上の段の一です。上の段の二です。',
      'v:下の段の一です。下の段の二です。',
    ]);
  });

  it('縦書きの囲みが左右に離れているとき、右の囲みから読む', () => {
    const items = [
      ...verticalColumns(['左の囲み。'], 200, 500, 15),
      ...verticalColumns(['右の囲み。'], 300, 500, 15),
    ];
    expect(paragraphsOf(items)).toEqual(['v:右の囲み。', 'v:左の囲み。']);
  });

  it('図をよけて短く折り返した行のとき、前後の行も短いので段落を続ける', () => {
    const items = horizontalLines(
      ['あいうえおかきくけこ', 'さしすせそ捨', 'てたちつてと', 'なにぬ。'],
      100,
      500,
      ROW_PITCH,
    );
    expect(paragraphsOf(items)).toEqual(['h:あいうえおかきくけこさしすせそ捨てたちつてとなにぬ。']);
  });

  it('文の終わりで終わる行の次の行が字下げしているとき、段落が変わる', () => {
    const items = [
      horizontalItem('これは一つめの段落。', 100, 500),
      horizontalItem('二つめの段落です。', 100 + SIZE, 500 - ROW_PITCH),
    ];
    expect(paragraphsOf(items)).toEqual(['h:これは一つめの段落。', 'h:二つめの段落です。']);
  });

  it('字の大きさが違う行のとき、段落が変わる', () => {
    const items = [
      horizontalItem('まとめ', 100, 518, SIZE * 1.3),
      ...horizontalLines(['本文の一行目です。本', '文の二行目です。'], 100, 500, ROW_PITCH),
    ];
    expect(paragraphsOf(items)).toEqual(['h:まとめ', 'h:本文の一行目です。本文の二行目です。']);
  });

  it('ほかの行間よりずっと広く空いた行のとき、別のかたまりにする', () => {
    const items = [
      horizontalItem('見出しの行', 100, 540),
      ...horizontalLines(['本文の一行目です。本', '文の二行目です。'], 100, 500, ROW_PITCH),
    ];
    expect(paragraphsOf(items)).toEqual(['h:見出しの行', 'h:本文の一行目です。本文の二行目です。']);
  });

  it('どの行も同じくらい広く空いているとき、段落を分ける', () => {
    const items = horizontalLines(['ひとつめ', 'ふたつめ', 'みっつめ'], 100, 500, SIZE * 3.2);
    expect(paragraphsOf(items)).toEqual(['h:ひとつめ', 'h:ふたつめ', 'h:みっつめ']);
  });

  it('左右の細い余白で分かれた行のとき、そこで区切らずに上の行から読む', () => {
    const items = [
      horizontalItem('右上の行です。', 205, 500),
      horizontalItem('左下の行の文章です。', 100, 500 - ROW_PITCH),
    ];
    expect(paragraphsOf(items)).toEqual(['h:右上の行です。左下の行の文章です。']);
  });

  it('横の注の列との溝が1字より狭いとき、両側に行の端がそろっていれば、本文の段を読んでから注の段を読む', () => {
    const items = [
      ...horizontalLines(
        ['あいうえおかきくけこ', 'さしすせそたちつてと', 'なにぬねのはひふへほ'],
        100,
        500,
        ROW_PITCH,
      ),
      ...horizontalLines(
        ['まみむめもやゆよらり', 'るれろわをんアイウエ', 'オカキクケコサシスセ'],
        205,
        500,
        ROW_PITCH,
        7,
      ),
    ];
    expect(paragraphsOf(items)).toEqual([
      'h:あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ',
      'h:まみむめもやゆよらりるれろわをんアイウエオカキクケコサシスセ',
    ]);
  });

  it('表の欄が同じ高さに並び、ほかの行の端も同じ溝にそろうとき、欄ごとに別の段落にする', () => {
    const items = [
      horizontalItem('表の見出しの行です。ここまで', 100, 515),
      horizontalItem('名前', 100, 500),
      horizontalItem('日付', 200, 500),
      horizontalItem('山田', 100, 485),
      horizontalItem('三月', 200, 485),
      horizontalItem('田中', 100, 470),
      horizontalItem('四月', 200, 470),
    ];
    expect(paragraphsOf(items)).toEqual([
      'h:表の見出しの行です。ここまで',
      'h:名前',
      'h:日付',
      'h:山田',
      'h:三月',
      'h:田中',
      'h:四月',
    ]);
  });

  it('1本の行の途中だけに書き込む空欄があるとき、行を分けない', () => {
    const items = [
      horizontalItem('一行目の文です。一行目の文です。', 100, 500),
      horizontalItem('ここに', 100, 485),
      horizontalItem('を書く。', 200, 485),
      horizontalItem('三行目の文です。三行目の文です。', 100, 470),
    ];
    expect(paragraphsOf(items).join('|')).toContain('ここにを書く。');
  });

  it('1本の列の途中に書き込む空欄があるとき、列を分けない', () => {
    const items = [verticalItem('文中の', 300, 500), verticalItem('線部が含む。', 300, 445)];
    expect(paragraphsOf(items)).toEqual(['v:文中の線部が含む。']);
  });

  it('余白で分けられないところに縦書きと横書きが混じるとき、多いほうの向きを先に読む', () => {
    const items = [
      ...verticalColumns(['竹内さんの話です。', '西先生の話です。'], 300, 500, 15),
      horizontalItem('竹内さん', 270, 420),
    ];
    expect(paragraphsOf(items)).toEqual(['v:竹内さんの話です。西先生の話です。', 'h:竹内さん']);
  });
});
