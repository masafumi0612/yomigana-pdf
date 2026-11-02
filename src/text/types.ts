// 読みの処理（正規化 → 読みの手直し → 字ごとの分割 → 段階の判定）で受け渡す形。
// 処理の順：kuromoji の Token[] → applyFixups → Word[] → splitReading → SplitResult → judge → RubyPiece[]

import type { KanjiTier } from './kanji-data';

/**
 * 利用者が選ぶ段階。この段階までに習う字にはルビを付けない。
 * `all` はどの字も習っていないものとして、すべての漢字にルビを付ける（最初の値）。
 */
export type Level = 'all' | KanjiTier;

/** kuromoji（IPADIC）が出す1語のうち、読みの処理で使うところ */
export interface Token {
  /** 文の中の書き方（例：一） */
  readonly surface: string;
  /** 読み（片仮名。例：イチ）。辞書にない語は空の文字列 */
  readonly reading: string;
  /** 品詞（例：名詞） */
  readonly pos: string;
  /** 品詞の細かい分け方（IPADIC の pos_detail_1〜3。例：['数', '', '']、['接尾', '助数詞', '']） */
  readonly posDetails: readonly string[];
}

/** 読みがどこから来たか */
export type ReadingSource =
  /** kuromoji の読みのまま */
  | 'kuromoji'
  /** 数＋助数詞の決まりで作り直した（例：一本 → いっぽん） */
  | 'counter'
  /** よく間違える語の表で直した（例：身体 → からだ） */
  | 'table'
  /** 利用者が直した読み・足した言葉（いちばん優先） */
  | 'user';

/** 読みの手直しのあとの1語 */
export interface Word {
  /** 文の中の書き方（例：一本） */
  readonly surface: string;
  /** 読み（平仮名。例：いっぽん）。分からない語は空の文字列 */
  readonly reading: string;
  readonly source: ReadingSource;
}

/** 語の読みを、字ごとに分けた1つ分 */
export type Seg =
  /** 漢字1字と、その字の読み */
  | {
      readonly kind: 'kanji';
      readonly base: string;
      readonly reading: string;
      /** 常用漢字表にない読み方（表外音訓）なら true。段階に関係なくルビを付ける */
      readonly isHyogaiReading: boolean;
    }
  /** 仮名や記号（ルビは付けない） */
  | { readonly kind: 'kana'; readonly base: string }
  /**
   * 字ごとに分けられない語の固まり。語全体に1つのルビを付ける。
   * jukujikun：付表の語（今日・大人）、irregular：当て字など表の音訓で読めない語、unknown：読みが分からない語
   */
  | {
      readonly kind: 'block';
      readonly base: string;
      readonly reading: string;
      readonly why: 'jukujikun' | 'irregular' | 'unknown';
    };

/** 1語を字ごとに分けた結果 */
export interface SplitResult {
  /** もとの語（手直しのあと） */
  readonly word: Word;
  /** 語の頭から順に並べたもの。base をつなぐと word.surface になる */
  readonly segs: readonly Seg[];
}

/** ルビの層に渡す1つ分 */
export interface RubyPiece {
  /** ルビを付ける字（1字、または字ごとに分けられない語の固まり） */
  readonly base: string;
  /** 付けるルビ（平仮名）。付けないときは undefined */
  readonly ruby: string | undefined;
  /** 段階に関係なくいつも付けるルビ（表外字・表外音訓・付表の語など）なら true */
  readonly isAlways: boolean;
}

/** 利用者が直した読み・足した言葉。書き方（例：林）から読み（平仮名。例：はやし）を引く */
export type UserDictionary = ReadonlyMap<string, string>;
