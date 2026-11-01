# 漢字データの出典

`src/text/data/kanji.json`（漢字の段階と音訓）と `src/text/data/fuhyo.json`（付表の語）は、下の元のデータから `npm run data:build`（`data/build-kanji.ts`）で作ります。

元のデータはリポジトリに入れません。手元の `FURIGANA_DATA_DIR`（なければ `~/dev/furigana-data`）に、下の場所の名前で置きます。

## 1. 常用漢字表

| 項目       | 内容                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------- |
| 名前       | 常用漢字表（平成22年内閣告示第2号）                                                                 |
| 作った人   | 文化庁                                                                                              |
| URL        | https://www.bunka.go.jp/kokugo_nihongo/sisaku/joho/joho/kijun/naikaku/pdf/joyokanjihyo_20101130.pdf |
| 置く場所   | `joyo/joyokanjihyo_20101130.pdf`                                                                    |
| SHA-256    | `d9f28aeb4ce8250dbde07de20ac66cca71805ba09d94e4942c752dffa84d8d42`                                  |
| 使うところ | 本表（11〜161ページ）の字・音・訓、付表（162〜163ページ）の語と読み                                 |
| 権利       | 内閣告示なので、著作権の対象になりません（著作権法第13条）                                          |

変えたところ：

1. 文字の層から取り出したので、送り仮名の区切り（細い字）が消えています。訓の例（「囲む」など）から送り仮名を取り戻し、`かこ.む` の形にしました。
2. 例・備考・旧字体・1字下げ（特別な音訓）の印は入れていません。
3. 許容字体のうち、文字の番号が別の4字（叱・填・剥・頬）を、正字体（𠮟・塡・剝・頰）と同じ字として足しました。
4. 付表は、1つの読みに語が2つある行（海女・海士 など）を1語ずつに分けました。「（「しはす」とも言う。）」のような注は入れていません。

## 2. 音訓の小・中・高等学校段階別割り振り表

| 項目       | 内容                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------- |
| 名前       | 音訓の小・中・高等学校段階別割り振り表（平成29年3月）                                               |
| 作った人   | 文部科学省                                                                                          |
| URL        | https://www.mext.go.jp/a_menu/shotou/new-cs/__icsFiles/afieldfile/2017/05/15/1385768.pdf            |
| 置く場所   | `mext/onkun-wakefuri-h29.pdf`（52ページ）                                                           |
| SHA-256    | `0bc189982a50122f1e35dd6a751bfdff0ec5a0ad67e99eda916d012f859a5ae4`                                  |
| 使うところ | 本表（2〜50ページ）の漢字の右の数字（学年別漢字配当表の学年）だけ                                   |
| 権利       | [文部科学省ウェブサイト利用規約](https://www.mext.go.jp/b_menu/1351168.htm)に従います（出典を明記） |

変えたところ：

1. 字ごとの学年（1〜6）だけを取り出し、段階 `g1`〜`g6` にしました。音訓ごとの段階（小・中・高の ○）は、まだ使っていません。
2. 学年は小学校学習指導要領（平成29年告示）の学年別漢字配当表と同じものです。PDF そのものは配りません。

## 3. kanji-frequency（漢字の頻度）

| 項目       | 内容                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------- |
| 名前       | kanji-frequency                                                                               |
| 作った人   | scriptin                                                                                      |
| URL        | https://github.com/scriptin/kanji-frequency （コミット `62df9362`）                           |
| 置く場所   | `scriptin/aozora_characters.csv`、`scriptin/wikipedia_characters.csv`、`scriptin/LICENSE.txt` |
| SHA-256    | aozora `66f74f31de3529407ac962111a0bc3e9c0803ccf748df286a6f6f4598a872e14`                     |
|            | wikipedia `d92c147b27ae9616461f6082b831213ac0027fed919f3a9815cce44711165567`                  |
|            | LICENSE.txt `9e5f1b3c610b9c2da5c313bf81d577a7d1acec686bdb0384edefa6df0f90cd94`                |
| 使うところ | 青空文庫と Wikipedia の字ごとの数（列は `rank,code_point_hex,char,char_count`）               |
| 権利       | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)                                     |

変えたところ（CC BY 4.0 で求められる、変更の明記）：

1. 字の数そのものは配りません。常用漢字のうち小学校で習わない 1,110字だけを取り出し、その中で数の多い順の順位に直しました。
2. 許容字体（叱・填・剥・頬）の数を、正字体（𠮟・塡・剝・頰）の数に足しました（青空文庫には 𠮟・塡・頰 がありません）。
3. 青空文庫と Wikipedia の順位の平均で並べ直し、上から 350字を `m1`（中1の目安）、次の 400字を `m2`（中2の目安）、残りの 360字を `joyo` にしました。同じ順位のときは文字の番号の小さいほうを先にします。

## 取ってくる手順

```sh
mkdir -p ~/dev/furigana-data/joyo ~/dev/furigana-data/mext
cd ~/dev/furigana-data
curl -o joyo/joyokanjihyo_20101130.pdf https://www.bunka.go.jp/kokugo_nihongo/sisaku/joho/joho/kijun/naikaku/pdf/joyokanjihyo_20101130.pdf
curl -o mext/onkun-wakefuri-h29.pdf https://www.mext.go.jp/a_menu/shotou/new-cs/__icsFiles/afieldfile/2017/05/15/1385768.pdf
mkdir -p scriptin
SCRIPTIN=https://raw.githubusercontent.com/scriptin/kanji-frequency/62df93626e51a61c3dec58b51bfa20bef79491d7
curl -o scriptin/aozora_characters.csv "$SCRIPTIN/data/aozora_characters.csv"
curl -o scriptin/wikipedia_characters.csv "$SCRIPTIN/data/wikipedia_characters.csv"
curl -o scriptin/LICENSE.txt "$SCRIPTIN/LICENSE.txt"
sha256sum joyo/*.pdf mext/*.pdf scriptin/*   # 上の表と同じか確かめる
```

## 作る手順

```sh
npm run data:build   # 別の場所に置いたときは FURIGANA_DATA_DIR=... npm run data:build
```

次の数が合わないと、何も書かずに止まります：常用漢字 2,136字（重なりなし）、学年ごとの字（1年 80・2年 160・3年 200・4年 202・5年 193・6年 191、すべて常用漢字）、小学校で習わない字 1,110字（350・400・360 に分ける。すべて頻度のデータにある）、付表 116行・123語。
