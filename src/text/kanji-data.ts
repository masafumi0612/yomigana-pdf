// 漢字の段階と音訓、付表の語を引く。データは data/build-kanji.ts が作る
import fuhyoJson from './data/fuhyo.json';
import kanjiJson from './data/kanji.json';

/**
 * 漢字の段階。g1〜g6 は小学1〜6年（学年別漢字配当表）、m1・m2 は中1・中2の目安、
 * joyo はそれより上の常用漢字。
 */
export type KanjiTier = 'g1' | 'g2' | 'g3' | 'g4' | 'g5' | 'g6' | 'm1' | 'm2' | 'joyo';

/** 段階を、習う順に並べたもの */
export const KANJI_TIERS: readonly KanjiTier[] = [
  'g1',
  'g2',
  'g3',
  'g4',
  'g5',
  'g6',
  'm1',
  'm2',
  'joyo',
];

/** 常用漢字1字の情報 */
export interface KanjiInfo {
  readonly tier: KanjiTier;
  /** 音（片仮名） */
  readonly on: readonly string[];
  /** 訓（平仮名。送り仮名は「かこ.む」のように . で分ける） */
  readonly kun: readonly string[];
}

/** 常用漢字表の付表の語（熟字訓・当て字）と読み */
export interface FuhyoWord {
  readonly word: string;
  readonly reading: string;
}

/**
 * 常用漢字表が認める許容字体のうち、文字の番号が別のもの（データでは正字体のすぐ後に入っている）。
 * 正字体と同じ字なので、字の数には入れない
 */
const ALLOWED_FORMS: ReadonlySet<string> = new Set(['叱', '填', '剥', '頬']);

interface KanjiData {
  readonly kanji: Readonly<Record<string, KanjiInfo>>;
}

// JSON の段階は文字列として読まれるので、作るときに確かめた形として扱う
const kanjiByChar: ReadonlyMap<string, KanjiInfo> = new Map(
  Object.entries((kanjiJson as KanjiData).kanji),
);

/** 付表の語の一覧（付表の順） */
export const FUHYO_WORDS: readonly FuhyoWord[] = fuhyoJson.fuhyo;

/**
 * 常用漢字の情報を引く。許容字体（叱・填・剥・頬）も正字体と同じ情報を返す。
 * @param char 1字
 * @returns 常用漢字の情報。常用漢字でなければ undefined
 */
export function getKanjiInfo(char: string): KanjiInfo | undefined {
  return kanjiByChar.get(char);
}

/**
 * 常用漢字か（許容字体を含む）。
 * @param char 1字
 * @returns 常用漢字なら true
 */
export function isJoyo(char: string): boolean {
  return kanjiByChar.has(char);
}

/**
 * 漢字の段階を引く。
 * @param char 1字
 * @returns 段階。常用漢字でなければ undefined
 */
export function getKanjiTier(char: string): KanjiTier | undefined {
  return kanjiByChar.get(char)?.tier;
}

/**
 * 段階 tier の字を、段階 level までに習うか。
 * @param tier 字の段階
 * @param level 読む人が習い終えた段階
 * @returns tier が level と同じか、それより前なら true
 */
export function isTierWithin(tier: KanjiTier, level: KanjiTier): boolean {
  return KANJI_TIERS.indexOf(tier) <= KANJI_TIERS.indexOf(level);
}

/**
 * 段階 level までに習う常用漢字の字の数を数える。許容字体は正字体と同じ字なので数えない。
 * @param level 読む人が習い終えた段階
 * @returns 字の数（例：g1 は 80、joyo は常用漢字すべての 2,136）
 */
export function countKanjiWithin(level: KanjiTier): number {
  let count = 0;
  for (const [char, info] of kanjiByChar) {
    if (!ALLOWED_FORMS.has(char) && isTierWithin(info.tier, level)) count += 1;
  }
  return count;
}
