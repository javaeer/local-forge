#!/usr/bin/env node
// 拉取 / 更新「词牌格律」数据（古典文学模块第 2 期）。
//
// 与 fetch-classics.mjs 同一套约定：多镜像、条数下限、截断校验、`--check/--if-missing/--force`。
// 数据来源 charlesix59/chinese_word_rhyme（MIT，原始出处搜韵 / 维基文库）：
//   1. Ci_Tunes.json       词谱本体：818 词牌 / 2475 体 / 195052 字，19.6 MB
//   2. Ci_Word_Tune.json   词林正韵逐字表：5037 字 / 19 部 + 跨部「多」
//
// 为什么要转码：上游每个字是一个对象 `{"tune":"仄","rhythm":"韵"}`，19.6 MB 直接给前端是灾难
// （每字 105.8 字节，几乎全是键名与括号）。这里把「平仄谱 + 句读标记」压成每字一个 ASCII 字符，
// 未压缩从 19.6 MB 降到 < 800 KB，gzip 后约 200 KB，语义逐字等价（脚本内全量往返自检）。
//
// 用法：
//   node scripts/fetch-citunes.mjs              # 下载并生成
//   node scripts/fetch-citunes.mjs --if-missing # dev / build 钩子用：快照有效即跳过
//   node scripts/fetch-citunes.mjs --check      # 只校验现有快照，不联网（CI 用）
//   node scripts/fetch-citunes.mjs --force      # 忽略现有快照，强制重下
//
// 校验项（任一失败 → 退出码 1）：
//   1. 上游字节数必须等于 GitHub 记录的 19596381（断点续传在本项目已踩过两次坑：
//      HTTP 200 + 半截文件、`-C -` 返回 206 但只续了 2 MB，都只有长度校验能拦住）
//   2. JSON 必须可完整解析
//   3. 词牌数 >= 800、体数 >= 2400、总字数 >= 190000、词韵字 >= 4800
//   4. 转码往返自检：全部 2475 体逐字比对平仄谱，任一不符即失败
//   5. 产出未压缩体积 < 800 KB
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = 'public/classics'
const OUT = `${DIR}/citunes.json.gz`
const RHYME_SNAPSHOT = `${DIR}/rhyme.json.gz`

// 上游文件在 GitHub 上的确切字节数。用于拦截截断——这是本项目最常踩的坑（见文件头注释）。
const EXPECT_BYTES = 19596381
const MAX_UNPACKED = 800 * 1024

/* ---------------- 单字符编码 ---------------- */
//
// 每字一个 ASCII 字符：值 = 35 + 平仄码 * 7 + 标记码
//   平仄码 0=中（可平可仄） 1=平 2=仄
//   标记码 0=句中 1=读（顿） 2=句（不押韵的句末） 3=韵 4=叶 5=叠 6=换头
// 用 35（'#'）起算而非 33，是为了绕开 '"'（34）——否则 JSON 字符串会被撕裂。
const TONE_CODE = { 中: 0, 平: 1, 仄: 2 }
const MARK_CODE = { '': 0, 读: 1, 句: 2, 韵: 3, 叶: 4, 叠: 5, 换: 6 }
const MARK_OF = ['', '读', '句', '韵', '叶', '叠', '换']

function encodeCell(tone, mark) {
  return String.fromCharCode(35 + TONE_CODE[tone] * 7 + MARK_CODE[mark])
}

function decodeCell(ch) {
  const v = ch.charCodeAt(0) - 35
  if (v < 0 || v > 20) throw new Error(`非法编码字符 ${JSON.stringify(ch)}（码位 ${ch.charCodeAt(0)}）`)
  return { tone: ['中', '平', '仄'][Math.floor(v / 7)], mark: MARK_OF[v % 7] }
}

/* ---------------- 词林正韵：平水韵 → 19 部推导表 ---------------- */
//
// 上游 Ci_Word_Tune.json 只有 5037 字，GB2312 一级常用字缺 112 个（他、余、己、宏、忧、评、玄…），
// 这些字落在韵脚上会让校验显示「未知」。用平水韵 106 部按词林正韵的合并规则推导补全。
//
// 「半」标记：十灰、九佳、十三元、十贿、九泰、十卦、十一队、十三阮、十四愿 九个韵部在词林正韵里
// 是拆开分属两部的（如十灰的「灰/回」入第三部、「怀/排」入第五部），无法按部整体映射，
// 必须逐字判定——这些字如果上游没收录，就宁可放行，交给人判断（不猜）。
const RHYME_MAP = {
  上平声部: {
    一东: [1], 二冬: [1], 三江: [2], 四支: [3], 五微: [3], 六鱼: [4], 七虞: [4],
    八齐: [3], 九佳: [5], 十灰: [3, 5], 十一真: [6], 十二文: [6], 十三元: [6, 7],
    十四寒: [7], 十五删: [7],
  },
  下平声部: {
    一先: [7], 二萧: [8], 三肴: [8], 四豪: [8], 五歌: [9], 六麻: [10], 七阳: [2],
    八庚: [11], 九青: [11], 十蒸: [11], 十一尤: [12], 十二侵: [13], 十三覃: [14],
    十四盐: [14], 十五咸: [14],
  },
  上声部: {
    一董: [1], 二肿: [1], 三讲: [2], 四纸: [3], 五尾: [3], 六语: [4], 七麌: [4],
    八荠: [3], 九蟹: [5], 十贿: [3, 5], 十一轸: [6], 十二吻: [6], 十三阮: [6, 7],
    十四旱: [7], 十五潸: [7], 十六铣: [7], 十七筱: [8], 十八巧: [8], 十九皓: [8],
    二十哿: [9], 二十一马: [10], 二十二养: [2], 二十三梗: [11], 二十四迥: [11],
    二十五有: [12], 二十六寝: [13], 二十七感: [14], 二十八俭: [14], 二十九豏: [14],
  },
  去声部: {
    一送: [1], 二宋: [1], 三绛: [2], 四寘: [3], 五未: [3], 六御: [4], 七遇: [4],
    八霁: [3], 九泰: [3, 5], 十卦: [5, 10], 十一队: [3, 5], 十二震: [6], 十三问: [6],
    十四愿: [6, 7], 十五翰: [7], 十六谏: [7], 十七霰: [7], 十八啸: [8], 十九效: [8],
    二十号: [8], 二十一个: [9], 二十二祃: [10], 二十三漾: [2], 二十四敬: [11],
    二十五径: [11], 二十六宥: [12], 二十七沁: [13], 二十八勘: [14], 二十九艳: [14],
    三十陷: [14],
  },
  入声部: {
    一屋: [15], 二沃: [15], 三觉: [16], 四质: [17], 五物: [18], 六月: [18], 七曷: [18],
    八黠: [18], 九屑: [18], 十药: [16], 十一陌: [17], 十二锡: [17], 十三职: [17],
    十四缉: [17], 十五合: [19], 十六叶: [18], 十七洽: [19],
  },
}

const PART_NAME = ['', '第一部', '第二部', '第三部', '第四部', '第五部', '第六部', '第七部', '第八部', '第九部',
  '第十部', '第十一部', '第十二部', '第十三部', '第十四部', '第十五部', '第十六部', '第十七部', '第十八部', '第十九部']

// 入声部（15-19）在词林正韵里没有平仄之分，一律当仄声；平/上/去声部按平仄分组
function partOfTone(partIdx) {
  return partIdx >= 15 ? '仄' : null
}

/* ---------------- 下载 ---------------- */

const MIRRORS = [
  'https://cdn.jsdelivr.net/gh/charlesix59/chinese_word_rhyme@main/data',
  'https://gcore.jsdelivr.net/gh/charlesix59/chinese_word_rhyme@main/data',
  'https://fastly.jsdelivr.net/gh/charlesix59/chinese_word_rhyme@main/data',
  'https://raw.githubusercontent.com/charlesix59/chinese_word_rhyme/main/data',
]

function isGz(buf) {
  return buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b
}

function decodeBuf(buf, label) {
  if (!isGz(buf)) return buf.toString('utf8')
  try {
    return gunzipSync(buf).toString('utf8')
  } catch (e) {
    throw new Error(`${label} 不是完整的 gzip：${e.message}（下载多半被截断，重试即可）`)
  }
}

// 带长度校验的下载：先 GET 到内存，比对字节数；短了就换镜像重来，绝不让半截文件落地。
async function download(name, minBytes, expectBytes) {
  let lastErr
  for (const base of MIRRORS) {
    const url = `${base}/${name}`
    try {
      console.log(`↓ 下载 ${url}`)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (expectBytes && buf.length !== expectBytes) {
        throw new Error(`字节数不符：收到 ${buf.length}，应为 ${expectBytes}（下载被截断）`)
      }
      if (buf.length < minBytes) throw new Error(`字节数不足：${buf.length} < ${minBytes}`)
      const text = decodeBuf(buf, name)
      let obj
      try {
        obj = JSON.parse(text)
      } catch (e) {
        throw new Error(`JSON 解析失败：${e.message}（已收到 ${buf.length} 字节，末尾 ${JSON.stringify(text.slice(-24))}）`)
      }
      console.log(`  收到 ${(buf.length / 1024 / 1024).toFixed(1)} MB`)
      return { obj, bytes: buf.length }
    } catch (e) {
      lastErr = e
      console.log(`  · 源不可用（${e.message}），换下一个镜像`)
    }
  }
  throw lastErr
}

/* ---------------- 转码 ---------------- */

function packFormat(f, pool) {
  let p = ''
  let split = 0
  const dirty = []
  f.tunes.forEach((t, i) => {
    let mark = t.rhythm || ''
    // 上游有极少量爬虫错位：把例词的字（枝/女/竹/年/雁/二/十/图）、或谱符号（平/仄）混进了 rhythm。
    // 这些位置无法判定句读，按「句中」处理并计数上报——不臆测，也不让脏值破坏编码表。
    if (mark && !(mark in MARK_CODE)) {
      dirty.push(mark)
      mark = ''
    }
    p += encodeCell(t.tune, mark)
    if (t.shift === 'true') split = i + 1
  })
  const sketch = f.sketch || ''
  let sk = pool.indexOf(sketch)
  if (sk < 0) {
    sk = pool.length
    pool.push(sketch)
  }
  return {
    s: sk,
    a: f.author || '',
    d: clip(f.desc || '', 48),
    p,
    b: split,
    ...(dirty.length ? { _dirty: dirty } : {}),
  }
}

// 注释截断到 n 字。上游每体注释平均 77 字，全量 574 KB 是体积超标的主因；
// 48 字足够覆盖「此与毛词同，惟…异」这类变体差异说明的前半句。
function clip(s, n) {
  const arr = Array.from(s)
  return arr.length <= n ? s : arr.slice(0, n).join('')
}

// 词韵表：以 Ci_Word_Tune.json 为权威（逐字标注，含「半」韵部的拆分结果），
// 再用平水韵推导补上游未收录的字。
function buildCiRhyme(ciWordTune, pingshui) {
  const buckets = {} // 部名 → { 平:Set, 仄:Set, 多:Set }
  const ensure = (part) => (buckets[part] ||= { 平: new Set(), 仄: new Set(), 多: new Set() })
  const multi = new Set() // 跨部字（上游标 rhyme:"多"）
  let fromUpstream = 0

  for (const [ch, v] of Object.entries(ciWordTune)) {
    if (v.rhyme === '多') {
      multi.add(ch)
      continue
    }
    if (!PART_NAME.includes(v.rhyme)) continue
    ensure(v.rhyme)[v.tune]?.add(ch)
    fromUpstream++
  }

  // 平水韵推导补全
  let derived = 0
  const derivedHalf = new Set() // 落在「半」韵部、无法确定归属的字
  if (pingshui?.rhyme) {
    const known = new Set([...Object.values(buckets).flatMap((b) => [...b.平, ...b.仄, ...b.多]), ...multi])
    for (const [part, groups] of Object.entries(pingshui.rhyme)) {
      const isPing = /^[上下]平/.test(part)
      for (const [name, str] of Object.entries(groups)) {
        const targets = RHYME_MAP[part]?.[name]
        if (!targets) continue
        for (const ch of str) {
          if (known.has(ch)) continue
          if (targets.length > 1) {
            derivedHalf.add(ch)
            continue
          }
          ensure(PART_NAME[targets[0]])[isPing ? '平' : '仄'].add(ch)
          derived++
        }
      }
    }
  }

  const out = {}
  for (const [part, b] of Object.entries(buckets)) {
    out[part] = { 平: [...b.平].join(''), 仄: [...b.仄].join(''), 多: [...b.多].join('') }
  }
  return {
    rhyme: out,
    multi: [...multi].join(''),
    half: [...derivedHalf].join(''),
    stats: {
      chars: fromUpstream,
      derived,
      multi: multi.size,
      half: derivedHalf.size,
      parts: Object.keys(out).length,
    },
  }
}

/* ---------------- 自检 ---------------- */

function roundTrip(raw, packed, pool) {
  let cells = 0
  for (const [name, v] of Object.entries(raw)) {
    const fs2 = packed[name].f
    if (fs2.length !== v.formats.length) throw new Error(`自检失败：${name} 体数不符`)
    v.formats.forEach((f, i) => {
      if (pool[fs2[i].s] !== (f.sketch || '')) throw new Error(`自检失败：${name} 第 ${i} 体格律描述不符`)
    })
    v.formats.forEach((f, i) => {
      const p = fs2[i].p
      if (p.length !== f.tunes.length) throw new Error(`自检失败：${name} 第 ${i} 体字数不符`)
      for (let j = 0; j < p.length; j++) {
        const back = decodeCell(p[j])
        if (back.tone !== f.tunes[j].tune) {
          throw new Error(`自检失败：${name} 第 ${i} 体第 ${j} 字 平仄不符（${f.tunes[j].tune} → ${back.tone}）`)
        }
        const wantMark = f.tunes[j].rhythm && f.tunes[j].rhythm in MARK_CODE ? f.tunes[j].rhythm : ''
        if (back.mark !== wantMark) {
          throw new Error(`自检失败：${name} 第 ${i} 体第 ${j} 字 标记不符（${wantMark} → ${back.mark}）`)
        }
        cells++
      }
      if (fs2[i].b !== (f.tunes.findLastIndex?.((t) => t.shift === 'true') ?? -1) + 1) {
        // 换头位置：以最后一个 shift 为准，两侧算法必须一致
        const expect = f.tunes.reduce((acc, t, k) => (t.shift === 'true' ? k + 1 : acc), 0)
        if (fs2[i].b !== expect) throw new Error(`自检失败：${name} 第 ${i} 体换头位置不符`)
      }
    })
  }
  return cells
}

/* ---------------- 主流程 ---------------- */

const args = process.argv.slice(2)
const has = (n) => args.includes('--' + n)

function loadPingshui() {
  const p = resolve(ROOT, RHYME_SNAPSHOT)
  if (!existsSync(p)) {
    console.log('· 未找到平水韵快照，跳过词韵推导补全（先跑 npm run classics:fetch 更完整）')
    return null
  }
  return JSON.parse(decodeBuf(readFileSync(p), '平水韵快照'))
}

function checkSnapshot() {
  const p = resolve(ROOT, OUT)
  if (!existsSync(p)) throw new Error(`快照不存在：${OUT}`)
  const data = JSON.parse(decodeBuf(readFileSync(p), '快照'))
  if (data.v !== 1) throw new Error(`快照版本异常：${data.v}`)
  const s = data.stats || {}
  if (!(s.tunes >= 800)) throw new Error(`词牌数异常：${s.tunes}`)
  if (!(s.formats >= 2400)) throw new Error(`体数异常：${s.formats}`)
  if (!(s.chars >= 190000)) throw new Error(`总字数异常：${s.chars}`)
  if (!(s.rhymeChars >= 4800)) throw new Error(`词韵字数异常：${s.rhymeChars}`)
  // 反解一遍：抽查全部谱串字符都在合法码位内
  const pool = data.sketch || []
  let cells = 0
  for (const v of Object.values(data.ci)) {
    for (const f of v.f) {
      if (!(f.s >= 0 && f.s < pool.length)) throw new Error(`格律描述索引越界：${f.s}`)
      for (const ch of f.p) {
        decodeCell(ch)
        cells++
      }
    }
  }
  if (cells !== s.chars) throw new Error(`谱串字数 ${cells} 与统计 ${s.chars} 不符`)
  return s
}

async function main() {
  if (has('check')) {
    const s = checkSnapshot()
    console.log(`✓ citunes 快照有效 · ${s.tunes} 词牌 / ${s.formats} 体 / ${s.chars} 字 / 词韵 ${s.rhymeChars} 字`)
    return
  }

  const outPath = resolve(ROOT, OUT)
  if (existsSync(outPath) && !has('force')) {
    try {
      const s = checkSnapshot()
      console.log(`✓ citunes 快照有效（${s.tunes} 词牌 / ${s.formats} 体），跳过`)
      return
    } catch (e) {
      console.log(`· 现有快照无效（${e.message}），重新下载…`)
    }
  } else if (has('if-missing') && !has('force')) {
    console.log('· 快照缺失，开始下载')
  }

  const tunes = await download('Ci_Tunes.json', EXPECT_BYTES, EXPECT_BYTES)
  const ciWord = await download('Ci_Word_Tune.json', 200000)
  const raw = tunes.obj
  const ciWordTune = ciWord.obj

  const names = Object.keys(raw)
  if (names.length < 800) throw new Error(`词牌数异常：${names.length} < 800`)

  const ci = {}
  const sketchPool = []
  let formats = 0
  let chars = 0
  const dirtyMap = new Map()
  for (const [name, v] of Object.entries(raw)) {
    const fs2 = (v.formats || []).map((f) => packFormat(f, sketchPool))
    for (const f of fs2) {
      formats++
      chars += f.p.length
      if (f._dirty) for (const d of f._dirty) dirtyMap.set(d, (dirtyMap.get(d) || 0) + 1)
      delete f._dirty
    }
    ci[name] = { d: clip(v.desc || '', 64), f: fs2 }
  }
  if (formats < 2400) throw new Error(`体数异常：${formats} < 2400`)
  if (chars < 190000) throw new Error(`总字数异常：${chars} < 190000`)

  const cells = roundTrip(raw, ci, sketchPool)
  console.log(`  转码往返自检通过：${cells} 字逐字一致`)

  const cr = buildCiRhyme(ciWordTune, loadPingshui())
  if (cr.stats.chars < 4800) throw new Error(`词韵字数异常：${cr.stats.chars} < 4800`)

  const payload = {
    v: 1,
    source: 'charlesix59/chinese_word_rhyme (MIT)，词谱原始出处搜韵',
    builtAt: new Date().toISOString().slice(0, 10),
    stats: {
      tunes: names.length,
      formats,
      chars,
      rhymeChars: cr.stats.chars + cr.stats.derived,
      rhymeDerived: cr.stats.derived,
      rhymeMulti: cr.stats.multi,
      rhymeHalf: cr.stats.half,
      parts: cr.stats.parts,
    },
    sketch: sketchPool,
    rhyme: cr.rhyme,
    rhymeMulti: cr.multi,
    rhymeHalf: cr.half,
    ci,
  }

  const json = JSON.stringify(payload)
  const unpacked = Buffer.byteLength(json)
  if (unpacked > MAX_UNPACKED) {
    throw new Error(`转码后体积 ${(unpacked / 1024).toFixed(0)} KB 超过 ${MAX_UNPACKED / 1024} KB 上限`)
  }
  const gz = gzipSync(Buffer.from(json, 'utf8'), { level: 9 })
  mkdirSync(resolve(ROOT, DIR), { recursive: true })
  writeFileSync(outPath, gz)

  console.log(
    `✓ 已写入 ${OUT} · 未压缩 ${(unpacked / 1024).toFixed(0)} KB / gzip ${(gz.length / 1024).toFixed(0)} KB\n` +
      `  ${names.length} 词牌 / ${formats} 体 / ${chars} 字词谱 · 词林正韵 ${cr.stats.parts} 部 ${payload.stats.rhymeChars} 字` +
      `（上游 ${cr.stats.chars} · 推导补 ${cr.stats.derived} · 跨部 ${cr.stats.multi} · 待定 ${cr.stats.half}）`,
  )
  if (dirtyMap.size) {
    console.log(`  ⚠ 上游 ${[...dirtyMap.values()].reduce((a, b) => a + b, 0)} 处句读标记为脏值，已按「句中」处理：${[...dirtyMap.keys()].join('、')}`)
  }
}

main().catch((e) => {
  console.error(`✗ ${e.message}`)
  process.exit(1)
})
