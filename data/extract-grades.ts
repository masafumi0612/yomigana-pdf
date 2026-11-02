// 文部科学省「音訓の小・中・高等学校段階別割り振り表（平成29年3月）」の PDF から、
// 学年別漢字配当表の学年（漢字の右の数字）を取り出す。
// 座標の数は onkun-wakefuri-h29.pdf の組み方に合わせたもの
import { openPdf, readPageItems } from './pdf-text.ts';

/** 本表のページ（1ページ目は表紙と備考、51ページからは付表） */
const FIRST_PAGE = 2;
const LAST_PAGE = 50;
/** 1ページは3段組み。各段の漢字の欄の x */
const KANJI_COLUMN_XS = [70.6, 310.8, 551.0];
/** 漢字の欄から学年の数字までの x の差 */
const GRADE_OFFSET_X = 23.8;
/** 同じ欄・同じ行とみなす座標の差 */
const POSITION_TOLERANCE = 1;
/** 欄の見出し（「漢字」「小学校」など）より下の y */
const HEADER_MIN_Y = 495;

const SINGLE_KANJI = /^[㐀-鿿\u{20000}-\u{2FFFF}]$/u;
const GRADE_DIGIT = /^[1-6]$/u;

/** 割り振り表から取り出したもの */
export interface GradeTable {
  /** 表に載っている漢字（表の順） */
  kanji: string[];
  /** 学年別漢字配当表の字と、その学年（1〜6） */
  grades: Map<string, number>;
}

/**
 * 割り振り表の PDF を読む。
 * @param file onkun-wakefuri-h29.pdf の場所
 * @returns 表の漢字と、小学校で習う字の学年
 */
export async function extractGrades(file: string): Promise<GradeTable> {
  const doc = await openPdf(file);
  const kanji: string[] = [];
  const grades = new Map<string, number>();
  for (let page = FIRST_PAGE; page <= LAST_PAGE; page++) {
    const items = (await readPageItems(doc, page)).filter((it) => it.y < HEADER_MIN_Y);
    for (const columnX of KANJI_COLUMN_XS) {
      const near = (x: number, target: number): boolean =>
        Math.abs(x - target) < POSITION_TOLERANCE;
      const heads = items.filter((it) => near(it.x, columnX) && SINGLE_KANJI.test(it.str));
      kanji.push(...heads.map((it) => it.str));
      for (const digit of items) {
        if (!near(digit.x, columnX + GRADE_OFFSET_X) || !GRADE_DIGIT.test(digit.str)) continue;
        const head = heads.find((it) => near(it.y, digit.y));
        if (head === undefined) {
          throw new Error(`学年の数字の漢字が見つからない p${String(page)} y=${String(digit.y)}`);
        }
        grades.set(head.str, Number(digit.str));
      }
    }
  }
  return { kanji, grades };
}
