// 数＋助数詞（一本・三匹・二十日）の読みを作る。助数詞ごとの読みは data/counters.tsv にまとめる
import countersTsv from './data/counters.tsv?raw';
import { parseTsv } from './tsv';

/** 数の最後の位。1〜9 は一の位の数字、ほかは 10・100・1000・10000 ちょうど */
const LAST_PLACES = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '100',
  '1000',
  '10000',
] as const;

const COUNTER_COLUMNS = [
  '助数詞',
  ...LAST_PLACES,
  '何',
  '決まった読み',
  'あいまいな数',
  'メモ',
] as const;

/** 万の位（読める数は 1万 の 1万倍 より小さいもの。億 は扱わない） */
const MAN = 10_000;
const MAX_NUMBER = MAN * MAN - 1;

/** 数の読み（位ごと）。添字がその位の数字 */
const ONES = placeWords('いち に さん よん ご ろく なな はち きゅう');
const TENS = placeWords(
  'じゅう にじゅう さんじゅう よんじゅう ごじゅう ろくじゅう ななじゅう はちじゅう きゅうじゅう',
);
const HUNDREDS = placeWords(
  'ひゃく にひゃく さんびゃく よんひゃく ごひゃく ろっぴゃく ななひゃく はっぴゃく きゅうひゃく',
);
const THOUSANDS = placeWords(
  'せん にせん さんぜん よんせん ごせん ろくせん ななせん はっせん きゅうせん',
);

/** 漢数字の数字 */
const KANJI_DIGITS: ReadonlyMap<string, number> = new Map(
  Array.from('〇一二三四五六七八九', (char, digit): [string, number] => [char, digit]),
);
/** 漢数字の位 */
const KANJI_PLACES: ReadonlyMap<string, number> = new Map([
  ['十', 10],
  ['百', 100],
  ['千', 1000],
  ['万', MAN],
]);

/** 助数詞1つ分の読み方 */
interface CounterReadings {
  /** 数の最後の位（LAST_PLACES）から、「その位の数＋助数詞」の読み（例：本 の 1 → いっぽん） */
  readonly byLastPlace: ReadonlyMap<string, string>;
  /** 何＋助数詞 の読み。ないときは空の文字列 */
  readonly nan: string;
  /** 決まった数だけの読み（例：日 の 2 → ふつか） */
  readonly exact: ReadonlyMap<number, string>;
  /** 読みを決められない数の書き方（例：日 の 一） */
  readonly ambiguous: ReadonlySet<string>;
}

const counters: ReadonlyMap<string, CounterReadings> = new Map(
  parseTsv(countersTsv, COUNTER_COLUMNS).map((row) => [
    row.助数詞,
    {
      byLastPlace: new Map(
        LAST_PLACES.map((place): [string, string] => [place, row[place]]).filter(
          ([, reading]) => reading !== '',
        ),
      ),
      nan: row.何,
      exact: new Map(
        splitList(row.決まった読み).map((pair): [number, string] => {
          const [value, reading] = pair.split('=');
          return [Number(value), reading ?? ''];
        }),
      ),
      ambiguous: new Set(splitList(row.あいまいな数)),
    },
  ]),
);

/**
 * 数＋助数詞 の読みを作る。数の最後の位で音が変わる（二十三本 → にじゅうさんぼん）。
 * @param numberText 数の書き方（漢数字・算用数字・何。例：二十三）
 * @param counter 助数詞（例：本）
 * @returns 読み（平仮名）。表にない助数詞・読めない数・読みを決められない組み合わせは undefined
 */
export function readCounter(numberText: string, counter: string): string | undefined {
  const readings = counters.get(counter);
  const text = numberText.normalize('NFKC');
  if (readings === undefined || readings.ambiguous.has(text)) {
    return undefined;
  }
  if (text === '何') {
    return readings.nan === '' ? undefined : readings.nan;
  }
  const value = parseNumber(text);
  if (value === undefined) {
    return undefined;
  }
  const exact = readings.exact.get(value);
  if (exact !== undefined) {
    return exact;
  }
  const { place, word } = lastPlaceOf(value);
  const form = readings.byLastPlace.get(place);
  if (form === undefined) {
    return undefined;
  }
  // 数の読みの終わり（最後の位の読み）を、表の読みに置きかえる。
  // 表の読みと位の読みの、頭のそろった字は残す（さんびゃく＋本 → さんびゃ＋っぽん）
  const reading = readNumber(value);
  const kept = commonPrefixLength(word, form);
  return reading.slice(0, reading.length - (word.length - kept)) + form.slice(kept);
}

/**
 * 位ごとの数の読みの並びを作る。
 * @param list 1〜9 の読みを空白で区切ったもの
 * @returns 添字がその位の数字になる並び（0 は空の文字列）
 */
function placeWords(list: string): string[] {
  return ['', ...list.split(' ')];
}

/**
 * 表のセルの「,」区切りの並びを分ける。
 * @param cell セル（例：2=ふつか,3=みっか）
 * @returns 分けたもの。空のセルなら空の配列
 */
function splitList(cell: string): string[] {
  return cell === '' ? [] : cell.split(',');
}

/**
 * 数の書き方を数にする。
 * @param text NFKC で正規化した書き方（算用数字か漢数字）
 * @returns 数。1 より小さい・大きすぎる・読めない書き方は undefined
 */
function parseNumber(text: string): number | undefined {
  const value = /^\d+$/u.test(text) ? Number(text) : parseKanjiNumber(text);
  return value !== undefined && value >= 1 && value <= MAX_NUMBER ? value : undefined;
}

/**
 * 漢数字を数にする。位の字を使う書き方（二十三・三千五百）と、位の字を使わず〇を含む書き方（二〇二六）を読む。
 * 位の字も〇もない2字以上の並び（二三）は「2か3」の意味なので読まない。
 * @param text 漢数字
 * @returns 数。読めない書き方は undefined
 */
function parseKanjiNumber(text: string): number | undefined {
  const chars = Array.from(text);
  if (!chars.every((char) => KANJI_DIGITS.has(char) || KANJI_PLACES.has(char))) {
    return undefined;
  }
  if (!chars.some((char) => KANJI_PLACES.has(char))) {
    return chars.length === 1 || chars.includes('〇')
      ? Number(chars.map((char) => KANJI_DIGITS.get(char)).join(''))
      : undefined;
  }
  let total = 0;
  let group = 0;
  let digit: number | undefined;
  let previousPlace = Number.POSITIVE_INFINITY;
  for (const char of chars) {
    const charDigit = KANJI_DIGITS.get(char);
    const place = KANJI_PLACES.get(char) ?? 0;
    if (charDigit !== undefined) {
      // 数字が続く（二三十）か、位の書き方に〇がある（十〇）
      if (digit !== undefined || charDigit === 0) {
        return undefined;
      }
      digit = charDigit;
    } else if (place === MAN) {
      total = (group + (digit ?? 0)) * MAN;
      if (total === 0 || previousPlace === MAN) {
        return undefined;
      }
      group = 0;
      digit = undefined;
      previousPlace = MAN;
    } else {
      // 位は大きい順に1回ずつ（十百 や 十十 は読まない）
      if (place >= previousPlace) {
        return undefined;
      }
      group += (digit ?? 1) * place;
      digit = undefined;
      previousPlace = place;
    }
  }
  return total + group + (digit ?? 0);
}

/**
 * 数の読みを作る（例：2026 → にせんにじゅうろく）。
 * @param value 1 以上 MAX_NUMBER 以下の数
 * @returns 読み（平仮名）
 */
function readNumber(value: number): string {
  const upper = Math.floor(value / MAN);
  return (upper > 0 ? `${readUnderMan(upper)}まん` : '') + readUnderMan(value % MAN);
}

/**
 * 1万より小さい数の読みを作る。
 * @param value 0 以上 9999 以下の数
 * @returns 読み（平仮名）。0 なら空の文字列
 */
function readUnderMan(value: number): string {
  const digitAt = (unit: number): number => Math.floor(value / unit) % 10;
  return [
    THOUSANDS[digitAt(1000)],
    HUNDREDS[digitAt(100)],
    TENS[digitAt(10)],
    ONES[digitAt(1)],
  ].join('');
}

/**
 * 数の最後の位と、その位の読みを引く（23 → 3 と さん、300 → 100 と ひゃく）。
 * @param value 1 以上の数
 * @returns 最後の位（LAST_PLACES のどれか）と、その位を1つだけ読んだ読み
 */
function lastPlaceOf(value: number): { place: string; word: string } {
  const one = value % 10;
  if (one !== 0) {
    return { place: String(one), word: ONES[one] ?? '' };
  }
  if (value % 100 !== 0) {
    return { place: '10', word: 'じゅう' };
  }
  if (value % 1000 !== 0) {
    return { place: '100', word: 'ひゃく' };
  }
  return value % MAN === 0 ? { place: '10000', word: 'まん' } : { place: '1000', word: 'せん' };
}

/**
 * 2つの文字列の頭から、同じ字が続く長さを数える。
 * @param a 1つ目
 * @param b 2つ目
 * @returns 同じ字が続く長さ
 */
function commonPrefixLength(a: string, b: string): number {
  let length = 0;
  while (length < a.length && a[length] === b[length]) {
    length += 1;
  }
  return length;
}
