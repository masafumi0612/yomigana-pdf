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
