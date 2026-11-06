// 1つの文を、正規化 → 形態素解析 → 読みの手直し → 字ごとの分割 → 段階の判定 に通し、
// もとの文のどこにどのルビを付けるかを出す
import { applyFixups } from './fixups';
import { judge } from './judge';
import { toHiragana } from './kana';
import { normalizeForAnalysis } from './normalize';
import { splitReading } from './split';
import type { Level, Token, UserDictionary, Word } from './types';

/** ルビのもとになった語。直した読みは語ごとに保存するので、読みを直すときは語ごと直す */
export interface RubyWord {
  /** 語の書き方（正規化した文のもの。直した読みの言葉と同じ形。例：図鑑） */
  readonly surface: string;
  /** 語全体の読み（平仮名。例：ずかん）。分からない語は空の文字列 */
  readonly reading: string;
  /** 利用者が直した読みなら true */
  readonly isUserFixed: boolean;
}

/** 文の中の、ルビを付ける1か所 */
export interface RubySpan {
  /** ルビを付ける字の頭の位置（もとの文の UTF-16 の番号） */
  readonly start: number;
  /** ルビを付ける字の終わりの次の位置（もとの文の UTF-16 の番号） */
  readonly end: number;
  /** 付けるルビ（平仮名） */
  readonly ruby: string;
  /** 段階に関係なくいつも付けるルビ（表外字・表外音訓・付表の語など）なら true */
  readonly isAlways: boolean;
  /** ルビのもとになった語（字ごとに付けたルビでも、どの語の一部かが分かる） */
  readonly word: RubyWord;
}

/** ルビの付け方 */
export interface AnnotateOptions {
  /** 利用者が選んだ段階 */
  readonly level: Level;
  /** 利用者が直した読み・足した言葉 */
  readonly userDictionary: UserDictionary;
}

/** 字ごとに分けた1つ分を、もとの文の位置にしたもの */
interface Unit {
  readonly start: number;
  readonly end: number;
  /** 段階に関係なく、この1つ分の読み（平仮名）。仮名はそのまま平仮名にしたもの */
  readonly reading: string;
  /** 段階に合わせて、ルビを付けるなら true */
  readonly hasRuby: boolean;
  readonly isAlways: boolean;
  readonly word: RubyWord;
}

/** もとの文の同じ字にかかる、1つ分の集まり */
interface Group {
  readonly start: number;
  end: number;
  readonly units: Unit[];
  /** 頭の1つ分の語。まとめた1つは、1字が広がった1つの語から来る */
  readonly word: RubyWord;
}

/**
 * 1つの文の、ルビを付ける所を出す。
 * @param text もとの文（PDF から取り出した文字）
 * @param tokenize 正規化した文を kuromoji で語に分ける
 * @param options ルビの付け方
 * @returns ルビを付ける所（文の頭から順）。位置はもとの文のもの
 */
export function annotate(
  text: string,
  tokenize: (normalized: string) => readonly Token[],
  options: AnnotateOptions,
): RubySpan[] {
  const { text: normalized, toOriginal } = normalizeForAnalysis(text);
  const units: Unit[] = [];
  let position = 0;
  for (const word of applyFixups(tokenize(normalized), options.userDictionary)) {
    const result = splitReading(word);
    const rubyWord = toRubyWord(word);
    // 1字が何字にも広がった所（㍿ → 株式会社）では、習った字も含めて語全体の読みが要る
    const everyReading = judge(result, 'all');
    for (const [index, piece] of judge(result, options.level).entries()) {
      const end = position + piece.base.length;
      units.push({
        start: originalAt(toOriginal, position, text),
        end: originalAt(toOriginal, end, text),
        reading: everyReading[index]?.ruby ?? toHiragana(piece.base),
        hasRuby: piece.ruby !== undefined,
        isAlways: piece.isAlways,
        word: rubyWord,
      });
      position = end;
    }
  }
  return groupUnits(units).flatMap(toSpan);
}

/**
 * 正規化した文の位置から、もとの文の位置を引く。
 * @param toOriginal 正規化した文の位置から、もとの位置を引く表
 * @param position 正規化した文の位置
 * @param text もとの文
 * @returns もとの文の位置
 */
function originalAt(toOriginal: readonly number[], position: number, text: string): number {
  return toOriginal[position] ?? text.length;
}

/**
 * もとの文の同じ字にかかる1つ分をまとめる。1字が何字にも広がった所では、
 * 最後の1つ分のほかは、もとの文で長さがなくなる（頭と終わりが同じ位置になる）ので、次とまとめる。
 * @param units 1つ分の並び（頭から順）
 * @returns まとめたもの
 */
function groupUnits(units: readonly Unit[]): Group[] {
  const groups: Group[] = [];
  for (const unit of units) {
    const group = groups.at(-1);
    if (group !== undefined && group.start === group.end) {
      group.end = unit.end;
      group.units.push(unit);
    } else {
      groups.push({ start: unit.start, end: unit.end, units: [unit], word: unit.word });
    }
  }
  return groups;
}

/**
 * まとめた1つを、ルビを付ける所にする。
 * @param group まとめた1つ
 * @returns ルビを付けるなら1つ、付けないなら空
 */
function toSpan(group: Group): RubySpan[] {
  if (!group.units.some((unit) => unit.hasRuby)) {
    return [];
  }
  return [
    {
      start: group.start,
      end: group.end,
      ruby: group.units.map((unit) => unit.reading).join(''),
      isAlways: group.units.some((unit) => unit.isAlways),
      word: group.word,
    },
  ];
}

/**
 * 読みを直したあとの語を、ルビのもとになった語の形にする。
 * @param word 読みを直したあとの語
 * @returns ルビのもとになった語
 */
function toRubyWord(word: Word): RubyWord {
  return { surface: word.surface, reading: word.reading, isUserFixed: word.source === 'user' };
}
