# THIRD_PARTY_NOTICES

よみがなPDF が使っているライブラリと辞書の著作権表示・ライセンスです。拡張機能にも同梱しています。

## kuromoji.js（@patdx/kuromoji）

- 使っている版：`@patdx/kuromoji` 1.0.4（kuromoji.js 0.1.2 をもとにしたもの）
- 入手先：https://github.com/patdx/kuromoji.js 、もとの kuromoji.js は https://github.com/takuyaa/kuromoji.js
- ライセンス：Apache License, Version 2.0（全文は拡張機能の中の `licenses/Apache-2.0.txt`、または http://www.apache.org/licenses/LICENSE-2.0 ）

```text
Copyright 2014 Takuya Asano
Copyright 2010-2014 Atilika Inc. and contributors
```

## mecab-ipadic（IPADIC）

kuromoji.js の辞書は、mecab-ipadic-2.7.0-20070801 のデータからできています（kuromoji.js の NOTICE.md より）。
拡張機能は、この辞書を `dict/` に同梱しています。

```text
Library dependencies
====================

This software includes a binary and/or source version of data from

* mecab-ipadic-2.7.0-20070801

which can be obtained from

http://atilika.com/releases/mecab-ipadic/mecab-ipadic-2.7.0-20070801.tar.gz

or

http://jaist.dl.sourceforge.net/project/mecab/mecab-ipadic/2.7.0-20070801/mecab-ipadic-2.7.0-20070801.tar.gz



Copyright and license
=====================


mecab-ipadic-2.7.0-20070801
---------------------------

Copyright 2000, 2001, 2002, 2003 Nara Institute of Science
and Technology.  All Rights Reserved.

Use, reproduction, and distribution of this software is permitted.
Any copy of this software, whether in its original form or modified,
must include both the above copyright notice and the following
paragraphs.

Nara Institute of Science and Technology (NAIST),
the copyright holders, disclaims all warranties with regard to this
software, including all implied warranties of merchantability and
fitness, in no event shall NAIST be liable for
any special, indirect or consequential damages or any damages
whatsoever resulting from loss of use, data or profits, whether in an
action of contract, negligence or other tortuous action, arising out
of or in connection with the use or performance of this software.

A large portion of the dictionary entries
originate from ICOT Free Software.  The following conditions for ICOT
Free Software applies to the current dictionary as well.

Each User may also freely distribute the Program, whether in its
original form or modified, to any third party or parties, PROVIDED
that the provisions of Section 3 ("NO WARRANTY") will ALWAYS appear
on, or be attached to, the Program, which is distributed substantially
in the same form as set out herein and that such intended
distribution, if actually made, will neither violate or otherwise
contravene any of the laws and regulations of the countries having
jurisdiction over the User or the intended distribution itself.

NO WARRANTY

The program was produced on an experimental basis in the course of the
research and development conducted during the project and is provided
to users as so produced on an experimental basis.  Accordingly, the
program is provided without any warranty whatsoever, whether express,
implied, statutory or otherwise.  The term "warranty" used herein
includes, but is not limited to, any warranty of the quality,
performance, merchantability and fitness for a particular purpose of
the program and the nonexistence of any infringement or violation of
any right of any third party.

Each user of the program will agree and understand, and be deemed to
have agreed and understood, that there is no warranty whatsoever for
the program and, accordingly, the entire risk arising from or
otherwise connected with the program is assumed by the user.

Therefore, neither ICOT, the copyright holder, or any other
organization that participated in or was otherwise related to the
development of the program and their respective officials, directors,
officers and other employees shall be held liable for any and all
damages, including, without limitation, general, special, incidental
and consequential damages, arising out of or otherwise in connection
with the use or inability to use the program or any product, material
or result produced or otherwise obtained by using the program,
regardless of whether they have been advised of, or otherwise had
knowledge of, the possibility of such damages at any time during the
project or thereafter.  Each user will be deemed to have agreed to the
foregoing by his or her commencement of use of the program.  The term
"use" as used herein includes, but is not limited to, the use,
modification, copying and distribution of the program and the
production of secondary products from the program.

In the case where the program, whether in its original form or
modified, was distributed or delivered to or received by a user from
any person, organization or entity other than ICOT, unless it makes or
grants independently of ICOT any specific warranty to the user in
writing, such person, organization or entity, will also be exempted
from and not be held liable to the user for any such damages as noted
above as far as the program is concerned.
```

## PDF.js（pdfjs-dist）

- 使っている版：`pdfjs-dist` 6.4.299
- 入手先：https://github.com/mozilla/pdf.js
- ライセンス：Apache License, Version 2.0（全文は拡張機能の中の `licenses/Apache-2.0.txt`、または http://www.apache.org/licenses/LICENSE-2.0 ）

```text
Copyright 2024 Mozilla Foundation
```

拡張機能は、PDF.js が PDF を読むのに使う次のデータも同梱しています。それぞれのライセンスの文は、同じフォルダに入っています。

| フォルダ          | 中身                                                            | ライセンスの文                                                      |
| ----------------- | --------------------------------------------------------------- | ------------------------------------------------------------------- |
| `cmaps/`          | Adobe の CMap（Copyright 1990-2009 Adobe Systems Incorporated） | `cmaps/LICENSE`                                                     |
| `standard_fonts/` | Foxit のフォント（PDFium）、Liberation フォント                 | `standard_fonts/LICENSE_FOXIT`・`standard_fonts/LICENSE_LIBERATION` |
| `iccs/`           | 色の変換に使う ICC プロファイル（CC0 1.0）                      | `iccs/LICENSE`                                                      |
| `wasm/`           | JBIG2（PDFium）・OpenJPEG・qcms の画像・色の処理                | `wasm/LICENSE_*`                                                    |

## Noto Serif JP・Noto Sans JP（ルビのフォント）

ルビの字に使う、仮名だけのフォントです。Noto Serif JP と Noto Sans JP（太さ 400）から、平仮名・片仮名の字だけを取り出して作りました（`npm run fonts:build`、`scripts/build-ruby-fonts.ts`）。作った `ruby-serif.woff2`・`ruby-sans.woff2` は拡張機能に同梱し、外からは読みません。字の形は変えていません。

- 入手先：https://github.com/notofonts/noto-cjk 、https://fonts.google.com/noto
- ライセンス：SIL Open Font License, Version 1.1（全文は拡張機能の中の `licenses/OFL-1.1.txt`、または https://openfontlicense.org ）
- 取り出して作り直したので、Reserved Font Name（「Source」）を避けて、family の名前を「Yomigana Ruby Serif」「Yomigana Ruby Sans」にしています

```text
Noto Serif JP: Copyright 2017-2023 Adobe (http://www.adobe.com/).
Noto Sans JP: Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.
```
