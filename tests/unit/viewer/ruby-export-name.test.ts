import { describe, expect, it } from 'vitest';

import { pageListText, rubyPdfName, type RubyPdfNameText } from '@/viewer/ruby-export-name';

/** 名前の文言（拡張の文言と同じ形） */
const TEXT: RubyPdfNameText = {
  withName: (name) => `${name}（ルビ付き）`,
  fallback: 'ルビ付き',
};

describe('rubyPdfName', () => {
  it('もとの名前が .pdf で終わるとき、拡張子を除いた名前に（ルビ付き）を足す', () => {
    expect(rubyPdfName('お知らせ.pdf', TEXT)).toEqual({
      title: 'お知らせ（ルビ付き）',
      fileName: 'お知らせ（ルビ付き）.pdf',
    });
  });

  it('拡張子が大文字の .PDF のとき、拡張子を除く', () => {
    expect(rubyPdfName('REPORT.PDF', TEXT).fileName).toBe('REPORT（ルビ付き）.pdf');
  });

  it('拡張子がないとき、名前のまま（ルビ付き）を足す', () => {
    expect(rubyPdfName('download', TEXT).fileName).toBe('download（ルビ付き）.pdf');
  });

  it('.pdf でない拡張子のとき、拡張子を残す', () => {
    expect(rubyPdfName('view.php', TEXT).fileName).toBe('view.php（ルビ付き）.pdf');
  });

  it('名前の途中の点は残す', () => {
    expect(rubyPdfName('2026.11.07 学級だより.pdf', TEXT).fileName).toBe(
      '2026.11.07 学級だより（ルビ付き）.pdf',
    );
  });

  it('ファイル名に使えない字があるとき、「_」に置きかえる', () => {
    expect(rubyPdfName('a/b\\c:d*e?f"g<h>i|j.pdf', TEXT).fileName).toBe(
      'a_b_c_d_e_f_g_h_i_j（ルビ付き）.pdf',
    );
  });

  it('制御文字があるとき、「_」に置きかえる', () => {
    expect(rubyPdfName('a\tb\u0000c.pdf', TEXT).fileName).toBe('a_b_c（ルビ付き）.pdf');
  });

  it('頭と後ろに空白や点があるとき、落とす', () => {
    expect(rubyPdfName('  .資料. .pdf', TEXT).fileName).toBe('資料（ルビ付き）.pdf');
  });

  it('もとの名前がないとき、「ルビ付き.pdf」になる', () => {
    expect(rubyPdfName(undefined, TEXT)).toEqual({ title: 'ルビ付き', fileName: 'ルビ付き.pdf' });
  });

  it('拡張子だけの名前のとき、「ルビ付き.pdf」になる', () => {
    expect(rubyPdfName('.pdf', TEXT).fileName).toBe('ルビ付き.pdf');
  });

  it('空白だけの名前のとき、「ルビ付き.pdf」になる', () => {
    expect(rubyPdfName('   ', TEXT).fileName).toBe('ルビ付き.pdf');
  });

  it('長い名前のとき、もとの名前を 100 字で切りつめる', () => {
    expect(rubyPdfName(`${'あ'.repeat(150)}.pdf`, TEXT).title).toBe(
      `${'あ'.repeat(100)}（ルビ付き）`,
    );
  });

  it('長い名前を切りつめるとき、サロゲートペアの字を途中で切らない', () => {
    expect(rubyPdfName(`${'𠮷'.repeat(120)}.pdf`, TEXT).title).toBe(
      `${'𠮷'.repeat(100)}（ルビ付き）`,
    );
  });
});

describe('pageListText', () => {
  it('ページが少ないとき、すべてを「・」でつなぐ', () => {
    expect(pageListText([2, 5, 9])).toEqual({ list: '2・5・9', isTruncated: false });
  });

  it('ページが 10 を超えるとき、初めの 10 ページだけ並べる', () => {
    expect(pageListText([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toEqual({
      list: '1・2・3・4・5・6・7・8・9・10',
      isTruncated: true,
    });
  });
});
