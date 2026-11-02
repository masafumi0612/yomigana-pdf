/** 1つのテスト用 PDF について、確かめること */
export interface Expectation {
  /**
   * 使うフォント（PDF の BaseFont から、部分集合の頭の6文字を除いたもの）。順は問わず、過不足なく合うこと
   */
  fonts: string[];
  /** 画像だけで、文字が1つもないこと */
  noText?: boolean;
  /**
   * true：縦書きの字があること（pdf.js の dir=ttb で、縦書きのフォントがある）。
   * なし：縦書きの字も縦書きのフォントもないこと
   */
  vertical?: boolean;
  /** 横書きの字（dir=ttb でないもの）があること */
  horizontal?: boolean;
  /** true：横倒しの字（回した横書き）があること。なし：ないこと */
  rotated?: boolean;
  /** 読む順に組み直した文（もとからあるルビを除く）に、どこかで出てくる言葉 */
  words?: string[];
  /** 縦書きの段落に出てくる言葉 */
  verticalWords?: string[];
  /** 横書きの行に出てくる言葉 */
  horizontalWords?: string[];
  /** もとからルビが付いていると見なされるべき字 */
  rubyOn?: string;
  /** ルビが付いていると見なされてはいけない字 */
  noRubyOn?: string;
}

/** test-pdfs/out からの名前（.pdf を除く）ごとの、確かめること */
export const EXPECTATIONS: Readonly<Record<string, Expectation>> = {
  'vertical-story': {
    fonts: ['NotoSansJP-Regular', 'NotoSerifJP-Bold', 'NotoSerifJP-Regular'],
    vertical: true,
    words: [
      '今日',
      '大人',
      '明日',
      '一人',
      '薔薇',
      '蜜柑',
      '檸檬',
      '生憎',
      '一本',
      '三本',
      '発表',
      '雨雲',
      '林さん',
      '小鳥遊さん',
      '12月',
      '10年前',
    ],
  },
  'horizontal-print': {
    fonts: ['NotoSansJP-Bold', 'NotoSansJP-Regular'],
    horizontal: true,
    words: [
      '学年だより',
      '11月号',
      '令和8年11月2日（月）発行',
      '今月のめあて',
      '11月12日（木）',
      '学習発表会',
      '避難訓練',
      '日付',
      '行事',
      '持ち物',
      '弁当、水筒、敷物、雨具',
      '防災頭巾',
      '健康観察カード',
    ],
  },
  'existing-ruby': {
    fonts: ['NotoSansJP-Regular', 'NotoSerifJP-Bold', 'NotoSerifJP-Regular'],
    vertical: true,
    horizontal: true,
    words: [
      '港の博物館',
      '漂着した陶器',
      '遥か遠い国',
      '承りました',
      '記念の栞',
      '羅針盤',
      '観察ノート',
      '表面',
      '図鑑',
      '裏側',
      '粒状',
      '油虫',
      '抜け殻',
      '仰いました',
    ],
    rubyOn:
      '港博物館私夏休入口大船模型漁師底壺羅針盤漂陶遥承栞理科観察朝顔種植十日双葉開表面図鑑蕾蟻裏粒油抜殻仰',
    noRubyOn: '着器遠国最後記念側状虫帰電車今見船話',
  },
  'mixed-layout': {
    fonts: ['NotoSansJP-Bold', 'NotoSansJP-Regular', 'NotoSerifJP-Bold', 'NotoSerifJP-Regular'],
    vertical: true,
    horizontal: true,
    rotated: true,
    words: [
      'しぜん新聞',
      '川の生き物を調べたよ',
      '生き物の観察をしました',
      'すんでいる生き物がちがいました',
      'カワゲラの幼虫',
      'わかったこと',
      '図1',
      '観察した場所',
      '小川の流れ',
      '流れが速い',
      'ゆるやか',
      'メダカ',
    ],
  },
  sample: {
    fonts: ['NotoSansJP-Regular', 'NotoSerifJP-Bold', 'NotoSerifJP-Regular'],
    vertical: true,
    horizontal: true,
    words: [
      '狐の時計屋さん',
      '眼鏡',
      '一人の女の子',
      '明日',
      '今日',
      '大人',
      '兎',
      '栗鼠',
      '苺',
      '蜜柑',
      '苺と檸檬のひんやりゼリー',
      '果物のジュース',
      '冷蔵庫',
      '葡萄',
    ],
  },
  'scanned-like': { fonts: [], noText: true },
  'mixed-direction': {
    fonts: ['NotoSansJP-Bold', 'NotoSansJP-Regular', 'NotoSerifJP-Bold', 'NotoSerifJP-Regular'],
    vertical: true,
    horizontal: true,
    verticalWords: [
      '窓辺の薔薇',
      '今日は12月24日です',
      '大人になってから30年',
      '辞典で調べました',
      '図鑑には、薔薇のなかまが15しゅるい',
      '「図鑑」の「鑑」の読み方',
      '氏名のらん',
    ],
    horizontalWords: [
      'こくご5年',
      '組氏名',
      '11月6日',
      'ことばのいみ',
      '窓辺',
      '辞典',
      '図鑑',
      '大人',
      '今日',
      'ことばのいみを調べる本',
    ],
  },
  // Word で縦書きの文書を PDF にすると、縦書きの印（縦書きのフォント・dir=ttb）が付かない。
  // 字は1字ずつの横書きとして置かれるので、文としては組み直せない（字があることだけ確かめる）
  'word/word-vertical': {
    fonts: ['Calibri', 'YuMincho-Regular'],
    horizontal: true,
    words: ['今', '大', '窓', '辺', '鑑', '蜜', '柑', '林'],
  },
  'word/word-horizontal': {
    fonts: ['Calibri'],
    horizontal: true,
    horizontalWords: ['今日は朝から雨だった', '窓辺', '図鑑', '十二月三日', '明日'],
  },
};
