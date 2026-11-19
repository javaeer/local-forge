#!/usr/bin/env node
// 拉取 / 更新「诗词格律」引擎数据（L0 层）。
//
// 与 fetch-dict.mjs 同一套约定：数据是「数据」不是「代码」，应当可替换、可校验、
// 可定时更新；仓库不保留快照（public/classics/*.gz 已 gitignore）。
//
// 管辖两份数据（均来自 charlesix59/chinese_word_rhyme，MIT，原始出处为维基文库 / 维基词典）：
//   1. Pingshui_Rhyme.json  平水韵 106 韵部字表（5 声部 / 约 1.07 万字）
//   2. Word_Tune.json       平仄字表（约 8232 字，值域 平 / 仄 / 多）
//
// 用法：
//   node scripts/fetch-classics.mjs              # 下载并生成
//   node scripts/fetch-classics.mjs --if-missing # dev / build 钩子用：快照有效即跳过
//   node scripts/fetch-classics.mjs --check      # 只校验现有快照，不联网（CI 用）
//   node scripts/fetch-classics.mjs --force      # 忽略现有快照，强制重下
//
// 校验项（任一失败 → 退出码 1）：
//   1. JSON 必须可完整解析（截断文件在此拦下）
//   2. 平水韵韵部数 >= 100、字数 >= 9000
//   3. 平仄表字数 >= 7000，且取值只允许 平 / 仄 / 多
//   4. 生成后的紧凑格式能被本脚本反解回原结构（自校验，防止转码写坏）
//
// 体积说明：上游 JSON 用 `{"tune":"平"}` / `["东","同",...]` 这类结构，汉字被引号逗号淹没；
// 这里转成紧凑字串（一韵一串、平仄三类各一串），未压缩从 ~350 KB 降到 ~60 KB，gzip 后约 40 KB。
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = 'public/classics'
const OUT = `${DIR}/rhyme.json.gz`

// 上游数据的人工补录。每一处都必须写明来源，保证可审计——不做黑盒修数据。
//
// 1) 上声部缺「三讲」韵：上游 self 从「二肿」直接跳到「四纸」，整韵 105→106 就差这一个。
//    连带后果是「讲/港/棒/蚌/项」等常用字在韵书与平仄表里双双缺失，格律校验会显示「未知」。
//    字表据维基词典《平水韵·三讲》、搜韵、诗词会三源一致补录（上声，均为仄声）。
const RHYME_PATCH = {
  上声部: {
    三讲: ['讲', '港', '棒', '蚌', '项', '耩', '缿', '傋', '玤', '夯', '棓', '漎', '稖', '顜', '勜', '慃', '庬'],
  },
}

// 把补录并进上游结构（按声部/韵部名定位；上游若日后自行补齐，则跳过不覆盖）
function applyRhymePatch(rhymeObj) {
  const applied = []
  for (const [part, groups] of Object.entries(RHYME_PATCH)) {
    if (!rhymeObj[part]) continue
    for (const [name, list] of Object.entries(groups)) {
      if (rhymeObj[part][name]) continue // 上游已有，尊重上游
      rhymeObj[part][name] = [...list]
      applied.push(`${part}/${name}（${list.length} 字）`)
    }
  }
  // 韵部顺序：按韵目首字的中文序号排，避免补录项被追加到末尾导致展示乱序
  return applied
}

// 上游文件 → 多镜像（依序尝试）→ 条数下限 → 校验函数
const SOURCES = [
  {
    id: 'pingshui',
    urls: [
      'https://fastly.jsdelivr.net/gh/charlesix59/chinese_word_rhyme@main/data/Pingshui_Rhyme.json',
      'https://cdn.jsdelivr.net/gh/charlesix59/chinese_word_rhyme@main/data/Pingshui_Rhyme.json',
      'https://raw.githubusercontent.com/charlesix59/chinese_word_rhyme/main/data/Pingshui_Rhyme.json',
    ],
    min: 9000,
    verify(obj) {
      // { "上平声部": { "一东": ["东","同",...] }, ... }
      if (!obj || typeof obj !== 'object') throw new Error('根节点不是对象')
      const parts = Object.keys(obj)
      if (parts.length < 4) throw new Error(`声部数异常：${parts.length}（应含上平/下平/上/去/入）`)
      let rhymes = 0
      let chars = 0
      for (const p of parts) {
        const group = obj[p]
        if (!group || typeof group !== 'object') throw new Error(`声部 ${p} 不是对象`)
        for (const [name, list] of Object.entries(group)) {
          if (!Array.isArray(list) || !list.length) throw new Error(`韵部 ${p}/${name} 不是非空数组`)
          rhymes++
          chars += list.length
        }
      }
      if (rhymes < 100) throw new Error(`韵部数异常：${rhymes} < 100（平水韵应为 106）`)
      if (chars < 9000) throw new Error(`字数异常：${chars} < 9000`)
      return { count: chars, detail: `${parts.length} 声部 / ${rhymes} 韵部 / ${chars} 字`, sample: { rhymes, parts } }
    },
  },
  {
    id: 'tone',
    urls: [
      'https://fastly.jsdelivr.net/gh/charlesix59/chinese_word_rhyme@main/data/Word_Tune.json',
      'https://cdn.jsdelivr.net/gh/charlesix59/chinese_word_rhyme@main/data/Word_Tune.json',
      'https://raw.githubusercontent.com/charlesix59/chinese_word_rhyme/main/data/Word_Tune.json',
    ],
    min: 7000,
    verify(obj) {
      // { "东": "平", "重": "多", ... }
      if (!obj || typeof obj !== 'object') throw new Error('根节点不是对象')
      const keys = Object.keys(obj)
      const allowed = new Set(['平', '仄', '多'])
      const bad = keys.filter((k) => !allowed.has(obj[k]))
      if (bad.length) throw new Error(`${bad.length} 条平仄取值非法，首条：${bad[0]}=${obj[bad[0]]}`)
      return { count: keys.length, detail: `${keys.length} 字`, sample: { k: keys[0] } }
    },
  },
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

// 解析 + 校验。解析失败一律视为「文件被截断」，这是最常踩的坑
// （用 curl -m 限时或网络抖动时，HTTP 200 + 半截文件是常态）。
function parseAndVerify(text, src, label) {
  const trimmed = text.trim()
  if (!trimmed) throw new Error(`${label} 为空`)
  let obj
  try {
    obj = JSON.parse(trimmed)
  } catch (e) {
    throw new Error(
      `${label} 不是合法 JSON：${e.message}（已收到 ${trimmed.length} 字符，` +
        `末尾为 ${JSON.stringify(trimmed.slice(-24))}，多半下载被截断）`,
    )
  }
  return src.verify(obj)
}

async function download(src) {
  let lastErr
  for (const url of src.urls) {
    try {
      console.log(`↓ 下载 ${url}`)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const text = decodeBuf(buf, src.id)
      const r = parseAndVerify(text, src, src.id)
      return { text, r, bytes: buf.length }
    } catch (e) {
      lastErr = e
      console.log(`  · 源不可用（${e.message}），换下一个镜像`)
    }
  }
  throw lastErr
}

/* ---------------- 紧凑格式编解码 ---------------- */

const TONE_KEYS = ['平', '仄', '多']

// { "上平声部": { "一东": [...] } } → { "上平声部": { "一东": "东同铜..." } }
// 顺带按首现顺序去重：上游部分韵部含重复字（实测 85 韵共 293 处，
// 如「十灰」的 杯/台/才/颓 各出现两次），会让韵部字表与「单字所属韵部」都出现重复项。
function packRhyme(obj) {
  const out = {}
  for (const [part, groups] of Object.entries(obj)) {
    out[part] = {}
    for (const [name, list] of Object.entries(groups)) out[part][name] = [...new Set(list)].join('')
  }
  return out
}

// { "东": "平" } → { 平: "东...", 仄: "...", 多: "..." }
function packTone(obj) {
  const buckets = { 平: [], 仄: [], 多: [] }
  for (const [ch, t] of Object.entries(obj)) buckets[t].push(ch)
  return TONE_KEYS.map((k) => buckets[k].join(''))
}

// 从韵书声部推导平仄，再用上游平仄表补正。
//
// 为什么以韵书为主：Word_Tune.json 只覆盖韵书 77% 的字（实测 8232 / 10671），
// 剩下 2400 余字查不到平仄，用户输入含这些字的诗就会满屏「未知」。
// 而韵书的声部本身就等价于调类——上平/下平为平，上/去/入为仄——覆盖是完整的。
//
// 多音字的判定：同一字同时出现在平声韵部与仄声韵部，即为平仄两读（如「看」「过」「思」）。
// 上游平仄表标为「多」的，一律采纳（专家标注优先于推导结果）。
function deriveTone(rhymeObj, wordTune) {
  const ping = new Set()
  const ze = new Set()
  for (const [part, groups] of Object.entries(rhymeObj)) {
    const isPing = /^[上下]平/.test(part)
    for (const list of Object.values(groups)) {
      for (const ch of list) (isPing ? ping : ze).add(ch)
    }
  }

  const out = {}
  for (const ch of new Set([...ping, ...ze])) {
    if (ping.has(ch) && ze.has(ch)) out[ch] = '多'
    else out[ch] = ping.has(ch) ? '平' : '仄'
  }
  let multiFromTable = 0
  let extraFromTable = 0
  for (const [ch, t] of Object.entries(wordTune)) {
    if (t === '多') {
      if (out[ch] !== '多') multiFromTable++
      out[ch] = '多'
    } else if (!(ch in out)) {
      out[ch] = t
      extraFromTable++
    }
  }
  return { tone: out, stats: { total: Object.keys(out).length, multiFromTable, extraFromTable } }
}

function unpackRhyme(packed) {
  const out = {}
  for (const [part, groups] of Object.entries(packed)) {
    out[part] = {}
    for (const [name, str] of Object.entries(groups)) out[part][name] = Array.from(str)
  }
  return out
}

function unpackTone(arr) {
  const out = {}
  TONE_KEYS.forEach((k, i) => {
    for (const ch of Array.from(arr[i] || '')) out[ch] = k
  })
  return out
}

// 自校验：pack → unpack 必须与原结构逐字等价，否则说明转码逻辑写坏了
function selfCheck(rhymeObj, toneObj, packed) {
  const r2 = unpackRhyme(packed.rhyme)
  for (const [part, groups] of Object.entries(rhymeObj)) {
    for (const [name, list] of Object.entries(groups)) {
      const back = r2[part]?.[name]
      const uniq = [...new Set(list)] // pack 阶段已去重，这里按去重后的序列比对
      if (!back || back.length !== uniq.length) throw new Error(`转码自检失败：${part}/${name} 字数不符`)
      for (let i = 0; i < uniq.length; i++) {
        if (back[i] !== uniq[i]) throw new Error(`转码自检失败：${part}/${name} 第 ${i} 字不符`)
      }
    }
  }
  const t2 = unpackTone(packed.tone)
  const origCount = Object.keys(toneObj).length
  if (Object.keys(t2).length !== origCount) throw new Error(`转码自检失败：平仄表字数 ${Object.keys(t2).length} ≠ ${origCount}`)
  for (const [ch, t] of Object.entries(toneObj)) {
    if (t2[ch] !== t) throw new Error(`转码自检失败：${ch} 应为 ${t}，实为 ${t2[ch]}`)
  }
}

/* ---------------- 主流程 ---------------- */

const args = process.argv.slice(2)
const has = (n) => args.includes('--' + n)

function build(rhymeObj, wordTune) {
  const patched = applyRhymePatch(rhymeObj)
  const { tone, stats: tStats } = deriveTone(rhymeObj, wordTune)
  const packed = { rhyme: packRhyme(rhymeObj), tone: packTone(tone) }
  selfCheck(rhymeObj, tone, packed)
  const rhymes = Object.values(rhymeObj).reduce((a, g) => a + Object.keys(g).length, 0)
  // 字数按去重后的 packed 结果统计，避免把上游重复字算进去
  const chars = Object.values(packed.rhyme).reduce(
    (a, g) => a + Object.values(g).reduce((b, str) => b + Array.from(str).length, 0),
    0,
  )
  return {
    version: 1,
    source: 'charlesix59/chinese_word_rhyme (MIT)',
    builtAt: new Date().toISOString().slice(0, 10),
    stats: {
      parts: Object.keys(rhymeObj).length,
      rhymes,
      chars,
      tones: Object.keys(tone).length,
      multi: tStats.multiFromTable,
      extra: tStats.extraFromTable,
      patched,
    },
    ...packed,
  }
}

// --check：只验快照，不联网
function checkSnapshot() {
  const p = resolve(ROOT, OUT)
  if (!existsSync(p)) throw new Error(`快照不存在：${OUT}`)
  const text = decodeBuf(readFileSync(p), '快照')
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new Error(`快照 JSON 损坏：${e.message}`)
  }
  if (data.version !== 1) throw new Error(`快照版本异常：${data.version}`)
  const s = data.stats || {}
  if (!(s.rhymes >= 100)) throw new Error(`韵部数异常：${s.rhymes}`)
  if (!(s.chars >= 9000)) throw new Error(`韵书字数异常：${s.chars}`)
  if (!(s.tones >= 7000)) throw new Error(`平仄表字数异常：${s.tones}`)
  // 反解一遍，确认紧凑格式没被写坏
  unpackRhyme(data.rhyme)
  unpackTone(data.tone)
  return s
}

async function main() {
  if (has('check')) {
    const s = checkSnapshot()
    console.log(`✓ classics 快照有效 · ${s.parts} 声部 / ${s.rhymes} 韵部 / ${s.chars} 字 / 平仄 ${s.tones} 字`)
    return
  }

  const outPath = resolve(ROOT, OUT)
  if (existsSync(outPath) && !has('force')) {
    try {
      const s = checkSnapshot()
      console.log(`✓ classics 快照有效（${s.rhymes} 韵部 / ${s.chars} 字），跳过`)
      return
    } catch (e) {
      console.log(`· 现有快照无效（${e.message}），重新下载…`)
    }
  } else if (has('if-missing') && !has('force')) {
    // 走到这里说明文件不存在
    console.log('· 快照缺失，开始下载')
  }

  const got = {}
  for (const src of SOURCES) {
    const { text, r, bytes } = await download(src)
    console.log(`  收到 ${(bytes / 1024).toFixed(0)} KB · ${r.detail}`)
    got[src.id] = JSON.parse(text.trim())
  }

  const data = build(got.pingshui, got.tone)
  const json = JSON.stringify(data)
  const gz = gzipSync(Buffer.from(json, 'utf8'), { level: 9 })
  mkdirSync(resolve(ROOT, DIR), { recursive: true })
  writeFileSync(outPath, gz)
  console.log(
    `✓ 已写入 ${OUT} · gzip ${(gz.length / 1024).toFixed(1)} KB / 未压缩 ${(Buffer.byteLength(json) / 1024).toFixed(1)} KB\n` +
      `  ${data.stats.parts} 声部 / ${data.stats.rhymes} 韵部 / ${data.stats.chars} 字 / 平仄表 ${data.stats.tones} 字` +
      `（多音 ${data.stats.multi} · 韵书外补 ${data.stats.extra}）`,
  )
  if (data.stats.patched.length) console.log(`  已人工补录：${data.stats.patched.join('、')}`)
  if (data.stats.rhymes !== 106) {
    console.log(`  ⚠ 注意：韵部数为 ${data.stats.rhymes}，平水韵通行本为 106，差异需人工核对（不阻断构建）`)
  }
}

main().catch((e) => {
  console.error(`✗ ${e.message}`)
  process.exit(1)
})
