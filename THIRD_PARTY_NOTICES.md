# THIRD_PARTY_NOTICES

よみがなPDF が使っているライブラリ・辞書・フォントの著作権表示とライセンスです。拡張機能にも同梱しています。

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

ルビの字に使う、仮名だけのフォントです。Noto Serif JP と Noto Sans JP（太さ 400）から、平仮名・片仮名の字だけを取り出し、縦書きの送りの表を足して作りました（`npm run fonts:build`、`scripts/build-ruby-fonts.ts`）。作った `ruby-serif.woff2`・`ruby-sans.woff2` は拡張機能に同梱し、外からは読みません。字の形は変えていません。

- 入手先：https://github.com/notofonts/noto-cjk 、https://fonts.google.com/noto
- ライセンス：SIL Open Font License, Version 1.1（全文は拡張機能の中の `licenses/OFL-1.1.txt`、または https://openfontlicense.org ）
- 取り出して作り直したので、Reserved Font Name（「Source」）を避けて、family の名前を「Yomigana Ruby Serif」「Yomigana Ruby Sans」にしています
- 設定の画面から開く見本の PDF（拡張機能の中の `sample/yomigana-sample.pdf`）にも、Noto Serif JP と Noto Sans JP の部分集合（見本に使った字だけ）を埋め込んでいます。見本の文は、この拡張のために書き下ろしたものです（`test-pdfs/src/sample.html`）

```text
Noto Serif JP: Copyright 2017-2023 Adobe (http://www.adobe.com/).
Noto Sans JP: Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.
```

## Preact（preact）

設定の画面と、ライセンスと出典の画面を作るのに使っています。

- 使っている版：`preact` 11.0.1
- 入手先：https://github.com/preactjs/preact
- ライセンス：MIT License

```text
The MIT License (MIT)

Copyright (c) 2015-present Jason Miller

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## pdf-lib（pdf-lib）

ルビを書き込んだ PDF を作るのに使っています。

- 使っている版：`pdf-lib` 1.17.1
- 入手先：https://github.com/Hopding/pdf-lib
- ライセンス：MIT License

```text
MIT License

Copyright (c) 2019 Andrew Dillon

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

pdf-lib が使う、次の部品も一緒に入っています。MIT License の部品の許諾の文は、上の pdf-lib の文と同じです。

| 部品                                              | 著作権表示                           | ライセンス |
| ------------------------------------------------- | ------------------------------------ | ---------- |
| `@pdf-lib/standard-fonts` 1.0.0                   | Copyright (c) 2018 Andrew Dillon     | MIT        |
| `@pdf-lib/upng` 1.0.1（UPNG.js をもとにしたもの） | Copyright (c) 2017 Photopea          | MIT        |
| `tslib` 1.14.1                                    | Copyright (c) Microsoft Corporation. | 0BSD       |

`@pdf-lib/standard-fonts` には、PDF の標準の 14 書体の字の幅の表（Adobe の AFM ファイルから作ったもの）が入っています。表に書かれている著作権表示は次のとおりです。

```text
Copyright (c) 1985, 1987, 1989, 1990, 1997 Adobe Systems Incorporated.  All Rights Reserved.
```

Adobe が AFM ファイルに付けて配っている配布条件の文（MustRead）は次のとおりです。AFM ファイルを配るときはこの文を一緒に配ること、著作権表示を残すこと、変更を目立つように書くことが条件です。文は書き換えずに写しています（SPDX の `APAFML`（Adobe Postscript AFM License）に載っている、Adobe の文）。

- 出典：https://raw.githubusercontent.com/spdx/license-list-data/main/text/APAFML.txt （https://spdx.org/licenses/APAFML.html ）

```text
Copyright (c) 1985, 1987, 1989, 1990, 1991, 1992, 1993, 1997 Adobe Systems Incorporated. All Rights Reserved.

This file and the 14 PostScript(R) AFM files it accompanies may be used, copied, and distributed for any purpose and without charge, with or without modification, provided that all copyright notices are retained; that the AFM files are not distributed without this file; that all modifications to this file or any of the AFM files are prominently noted in the modified file(s); and that this paragraph is not modified. Adobe Systems has no responsibility or obligation to support the use of the AFM files.
```

`tslib` のライセンス（0BSD）の文：

```text
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

## fontkit（@pdf-lib/fontkit）

ルビのフォントを読み、PDF に入れるのに使っています。`@pdf-lib/fontkit` は、pdf-lib のために fontkit を作り直したもの（fork）です。

- 使っている版：`@pdf-lib/fontkit` 1.1.1
- 入手先：https://github.com/Hopding/fontkit 、もとの fontkit は https://github.com/foliojs/fontkit
- ライセンス：MIT License（`@pdf-lib/fontkit` のパッケージにはライセンスの文が入っていないので、もとの fontkit の文を載せます）

```text
MIT License

Copyright (c) 2014-present Devon Govett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`@pdf-lib/fontkit` のファイルには、次の部品が一緒に入っています。MIT License の部品の許諾の文は、上の fontkit の文と同じです。

| 部品                                                                                                             | 著作権表示                                                                                                      | ライセンス      |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------- |
| restructure（`@pdf-lib/restructure`）                                                                            | Copyright (c) 2015-present Devon Govett                                                                         | MIT             |
| unicode-properties（`@pdf-lib/unicode-properties`）・unicode-trie                                                | Copyright 2018（作った人：Devon Govett）                                                                        | MIT             |
| tiny-inflate                                                                                                     | Copyright (c) 2015-present Devon Govett                                                                         | MIT             |
| dfa                                                                                                              | 作った人：Devon Govett                                                                                          | MIT             |
| brotli.js（`@pdf-lib/brotli`）                                                                                   | 作った人：Devon Govett。中の復号の部分は Copyright 2013 Google Inc. All Rights Reserved.                        | MIT・Apache-2.0 |
| clone                                                                                                            | Copyright © 2011-2015 Paul Vorbach                                                                              | MIT             |
| deep-equal                                                                                                       | Copyright (c) 2012, 2013, 2014 James Halliday, 2009 Thomas Robinson                                             | MIT             |
| object-keys                                                                                                      | Copyright (C) 2013 Jordan Harband                                                                               | MIT             |
| is-arguments・object-is・is-regex                                                                                | Copyright (c) 2014 Jordan Harband                                                                               | MIT             |
| regexp.prototype.flags                                                                                           | Copyright (C) 2014 Jordan Harband                                                                               | MIT             |
| define-properties                                                                                                | Copyright (C) 2015 Jordan Harband                                                                               | MIT             |
| is-date-object                                                                                                   | Copyright (c) 2015 Jordan Harband                                                                               | MIT             |
| has-symbols                                                                                                      | Copyright (c) 2016 Jordan Harband                                                                               | MIT             |
| get-intrinsic・call-bind                                                                                         | Copyright (c) 2020 Jordan Harband                                                                               | MIT             |
| function-bind                                                                                                    | Copyright (c) 2013 Raynos.                                                                                      | MIT             |
| has                                                                                                              | Copyright (c) 2013 Thiago de Arruda                                                                             | MIT             |
| base64-arraybuffer                                                                                               | Copyright (c) 2012 Niklas von Hertzen                                                                           | MIT             |
| buffer                                                                                                           | Copyright (c) Feross Aboukhadijeh, and other contributors. Copyright Node.js contributors. All rights reserved. | MIT             |
| base64-js                                                                                                        | Copyright (c) 2014 Jameson Little                                                                               | MIT             |
| ieee754                                                                                                          | Copyright 2008 Fair Oaks Labs, Inc.                                                                             | BSD-3-Clause    |
| iconv-lite                                                                                                       | Copyright (c) 2011 Alexander Shtuchkin                                                                          | MIT             |
| safer-buffer                                                                                                     | Copyright (c) 2018 Nikita Skovoroda                                                                             | MIT             |
| Node.js の events・util・stream・string_decoder・process をブラウザ用に写したもの（rollup-plugin-node-builtins） | Copyright Joyent, Inc. and other Node contributors.                                                             | MIT             |

brotli.js の中の Google の部分のライセンス（Apache License, Version 2.0）の全文は、拡張機能の中の `licenses/Apache-2.0.txt` にあります。

ieee754 のライセンス（BSD-3-Clause）の文：

```text
Copyright 2008 Fair Oaks Labs, Inc.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
this list of conditions and the following disclaimer in the documentation
and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
may be used to endorse or promote products derived from this software without
specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## pako（pako）

pdf-lib と fontkit が、PDF とフォントのデータを縮める・戻すのに使っています。

- 使っている版：`pako` 1.0.11
- 入手先：https://github.com/nodeca/pako
- ライセンス：MIT License と zlib License（pako は zlib を JavaScript に移したもの）

```text
(The MIT License)

Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

zlib の部分（`lib/zlib/` の中）の文：

```text
(C) 1995-2013 Jean-loup Gailly and Mark Adler
(C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin

This software is provided 'as-is', without any express or implied
warranty. In no event will the authors be held liable for any damages
arising from the use of this software.

Permission is granted to anyone to use this software for any purpose,
including commercial applications, and to alter it and redistribute it
freely, subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not
  claim that you wrote the original software. If you use this software
  in a product, an acknowledgment in the product documentation would be
  appreciated but is not required.
2. Altered source versions must be plainly marked as such, and must not be
  misrepresented as being the original software.
3. This notice may not be removed or altered from any source distribution.
```
