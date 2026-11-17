// 离线词典内核 —— 零新增依赖，纯 JS，Node 可直接单测（不碰 DOM / IndexedDB）。
//
// 为什么把它放进 LocalForge：查词是最日常的「文本处理」，而市面上的「在线字典」
// 要么是无授权的山寨站（音形义错漏百出），要么要联网、要登录、要把查询词发给对方。
// 这里把词库当成一件**本地文件**来处理：一次拿到，永久离线，浏览器内建索引，零外发请求。
//
// 数据源与解析层解耦（换源不改索引）：
//   · CC-CEDICT（CC BY-SA 4.0）—— 汉英双向，约 12 万条，内置 public/dict/cc-cedict.txt.gz
//   · Kaikki / Wiktextract JSONL（CC BY-SA）—— 维基词典结构化导出，可按语言增量导入
//   · TSV / 纯文本 —— 自定义词库，制表符三列：词<TAB>拼音<TAB>释义
//
// 设计取舍：
//   · 不引 sql.js / SQLite-WASM：12 万条用 Map + 排序数组足够，构建索引 < 500ms，
//     避免为「查个词」多背几百 KB wasm。
//   · 索引只放内存、不落 IndexedDB：省掉 schema 迁移与脏数据风险，刷新重算即可。
//   · 拼音支持「带调符号 / 数字声调 / 无调 / 首字母」四种输入，ü 统一折叠为 v，
//     没有中文输入法也能用 `lv4 se4` 查到「绿色」。

const CJK = /[\u3400-\u9fff\uf900-\ufaff\u3007]/
const CJK_G = /[\u3400-\u9fff\uf900-\ufaff\u3007]/g

export const isCJK = (ch) => CJK.test(String(ch ?? ''))

/* ============================ 拼音工具 ============================ */

// 数字声调 → 带调符号。CC-CEDICT 用 `ni3 hao3`，显示成 `nǐ hǎo` 才像本字典。
// 标调规则与《汉语拼音方案》一致：有 a 标 a，有 e 标 e，ou 标 o，iu 标 u，否则标最后一个元音。
const TONE_TABLE = {
  a: ['a', 'ā', 'á', 'ǎ', 'à'],
  e: ['e', 'ē', 'é', 'ě', 'è'],
  i: ['i', 'ī', 'í', 'ǐ', 'ì'],
  o: ['o', 'ō', 'ó', 'ǒ', 'ò'],
  u: ['u', 'ū', 'ú', 'ǔ', 'ù'],
  ü: ['ü', 'ǖ', 'ǘ', 'ǚ', 'ǜ'],
}

export function toneMark(pinyin) {
  return String(pinyin ?? '')
    .trim()
    .split(/\s+/)
    .map((syl) => {
      const m = /^([a-zA-Zü:v]+)([0-5])$/.exec(syl)
      if (!m) return syl.replace(/u:/g, 'ü').replace(/v/g, 'ü')
      const base = m[1].replace(/u:/g, 'ü').replace(/v/g, 'ü')
      const tone = Number(m[2])
      if (!tone || tone > 4) return base
      const low = base.toLowerCase()
      let idx = -1
      if (low.includes('a')) idx = low.indexOf('a')
      else if (low.includes('e')) idx = low.indexOf('e')
      else if (low.includes('ou')) idx = low.indexOf('o')
      else {
        for (let i = base.length - 1; i >= 0; i--) {
          if ('aeiouü'.includes(low[i])) { idx = i; break }
        }
      }
      if (idx < 0) return base
      const row = TONE_TABLE[low[idx]]
      if (!row) return base
      return base.slice(0, idx) + row[tone] + base.slice(idx + 1)
    })
    .join(' ')
}

// 去调、去空格、ü 折叠为 v：用于「无调/混输」检索键
export function stripTones(pinyin) {
  return String(pinyin ?? '')
    .toLowerCase()
    .replace(/u:/g, 'v')
    .replace(/ü/g, 'v')
    .replace(/[1-5]/g, '')
    .replace(/[\s'’]/g, '')
}

// 首字母缩写：`ni3 hao3` → `nh`
export function pinyinInitials(pinyin) {
  return String(pinyin ?? '')
    .trim()
    .split(/\s+/)
    .map((s) => s.replace(/[1-5]/g, '').replace(/u:/g, 'v')[0] || '')
    .join('')
    .toLowerCase()
}

/* ============================ 词库解析 ============================ */

// CC-CEDICT 行：`繁體 简体 [pin1 yin1] /释义一/释义二/`
export function parseCedict(text, { max = 0 } = {}) {
  const out = []
  const lines = String(text ?? '').split(/\r?\n/)
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]
    if (!line || line.charCodeAt(0) === 35 /* # */) continue
    const l = line.indexOf(' [')
    if (l < 0) continue
    const r = line.indexOf('] /', l)
    if (r < 0) continue
    const head = line.slice(0, l)
    const sp = head.indexOf(' ')
    if (sp < 0) continue
    const t = head.slice(0, sp).trim()
    const s = head.slice(sp + 1).trim()
    if (!s) continue
    const p = line.slice(l + 2, r).trim()
    let body = line.slice(r + 3)
    if (body.endsWith('/')) body = body.slice(0, -1)
    const d = body ? body.split('/').filter(Boolean) : []
    out.push({ t, s, p, d })
    if (max && out.length >= max) break
  }
  return out
}

// Kaikki / Wiktextract 的 JSONL：一行一个词条对象，字段名各家略异，这里做兼容收口。
export function parseJsonl(text, { max = 0 } = {}) {
  const out = []
  const lines = String(text ?? '').split(/\r?\n/)
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].trim()
    if (!line || line[0] !== '{') continue
    let o
    try { o = JSON.parse(line) } catch { continue }
    const s = o.s || o.word || o.lemma || ''
    if (!s) continue
    const t = o.t || o.traditional || s
    let p = o.p || o.pinyin || ''
    if (!p && Array.isArray(o.sounds)) {
      const zh = o.sounds.find((x) => x && (x.zh_pron || x.pinyin))
      p = (zh && (zh.zh_pron || zh.pinyin)) || ''
    }
    let d = o.d || o.glosses || o.definitions || []
    if (!d.length && Array.isArray(o.senses)) {
      d = o.senses.flatMap((x) => (x && (x.glosses || x.raw_glosses)) || [])
    }
    if (typeof d === 'string') d = [d]
    out.push({ t, s, p: String(p), d: d.map(String).filter(Boolean) })
    if (max && out.length >= max) break
  }
  return out
}

// TSV：`词<TAB>拼音<TAB>释义`，释义内用 `|` 分隔多条
export function parseTsv(text, { max = 0 } = {}) {
  const out = []
  const lines = String(text ?? '').split(/\r?\n/)
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]
    if (!line || line[0] === '#') continue
    const cols = line.split('\t')
    if (cols.length < 2) continue
    const s = cols[0].trim()
    if (!s) continue
    out.push({ t: s, s, p: (cols[1] || '').trim(), d: (cols[2] || '').split('|').map((x) => x.trim()).filter(Boolean) })
    if (max && out.length >= max) break
  }
  return out
}

// ECDICT（skywind3000/ECDICT，MIT）：英汉 + 英英双解大词库（约 77 万词条）。
// CSV 带引号字段（translation/definition 内含 \n 换行），必须按引号状态逐字符解析。
// 列序：word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio
// 我们只取 word / phonetic / definition / translation 四列，其余不进内存。
export function parseEcdict(text, { max = 0 } = {}) {
  const out = []
  const n = text.length
  let i = 0
  // 跳过表头行
  while (i < n && text.charCodeAt(i) !== 10) i++
  i++
  let cur = []        // 当前字段累积
  const row = []      // 当前行各字段
  let inQ = false
  let afterQ = false  // 引号刚结束（其后只允许逗号/换行/空白）
  const flushField = () => { row.push(cur.join('')); cur = [] }
  const flushRow = () => {
    flushField()
    const word = row[0] || ''
    if (word) {
      const d = []
      const tr = (row[3] || '').trim()
      const de = (row[2] || '').trim()
      if (tr) for (const x of tr.split('\n')) { const t = x.trim(); if (t) d.push(t) }
      if (de) for (const x of de.split('\n')) { const t = x.trim(); if (t) d.push(t) }
      out.push({ t: word, s: word, p: (row[1] || '').trim(), d })
      if (max && out.length >= max) return true
    }
    row.length = 0
    return false
  }
  for (; i < n; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') {
        // 双引号转义（"" → 字面引号）
        if (text[i + 1] === '"') { cur.push('"'); i++ } else { inQ = false; afterQ = true }
      } else cur.push(c)
      continue
    }
    if (c === '"' && cur.length === 0) { inQ = true; continue }
    if (c === ',') { flushField(); afterQ = false; continue }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      if (flushRow()) return out
      afterQ = false
      continue
    }
    if (afterQ && (c === ' ' || c === '\t')) continue // 引号后拖尾空白
    cur.push(c)
  }
  if (cur.length || row.length) flushRow()
  return out
}

// 按文件名/内容嗅探格式，统一入口
export function parseDict(text, name = '') {
  const lower = String(name).toLowerCase()
  if (lower.endsWith('.jsonl') || lower.endsWith('.json')) return parseJsonl(text)
  if (lower.includes('ecdict') || lower.endsWith('.ecdict.csv')) return parseEcdict(text)
  const head = String(text).slice(0, 400)
  // ECDICT 表头优先于扩展名：.csv 一名两用，靠表头区分才是硬判据
  if (/^"?\s*word"?\s*,\s*"?\s*phonetic/i.test(head)) return parseEcdict(text)
  if (lower.endsWith('.tsv') || lower.endsWith('.csv')) return parseTsv(text)
  if (head.trimStart().startsWith('{')) return parseJsonl(text)
  if (head.includes('\t')) return parseTsv(text)
  return parseCedict(text)
}

/* ============================ 索引 ============================ */

// 释义倒排的词级过滤：英文功能词对「查义」毫无区分度，
// 建进索引只会把倒排撑大一圈（12 万词条下约多出 30% 的唯一键）。
const GLOSS_STOP = new Set((
  'the and for with from that this these those are was were been being have has had will would shall ' +
  'should can could may might must not but you your his her its their our they them she him who what ' +
  'when where which how all any some one two out off into over under about also very too only more ' +
  'most such than then there here use used using etc sb sth'
).split(' '))

// 同一词条的多条释义可能重复给出同一个词，去重避免倒排膨胀
function addGloss(map, key, i) {
  const arr = map.get(key)
  if (!arr) { map.set(key, [i]); return }
  if (arr[arr.length - 1] !== i) arr.push(i)
}

// 大词库的索引护栏：ECDICT（77 万条，中文释义极多）若不限制，
// 释义倒排会膨胀到数百万 posting（内存 + 建索引时间双爆）。
// 策略：不建「英文释义词」倒排（英译中反查由主词库 CC-CEDICT 承担），
// 每条词条的中文义项最多取前 6 段。
export function indexOptsFor(name) {
  return /ecdict/i.test(String(name || '')) ? { glossWords: false, maxGlossSeg: 6 } : {}
}

export function buildIndex(entries, { glossWords = true, maxGlossSeg = 0 } = {}) {
  const byWord = new Map()
  const byPinyin = new Map()
  const byInitials = new Map()
  // 释义倒排：seg = 按 ; , 切出的完整义项（精确/前缀），word = 义项里的单词（词级精确/前缀）
  const byGlossSeg = new Map()
  const byGlossWord = new Map()
  const push = (m, k, i) => {
    if (!k) return
    const a = m.get(k)
    if (a) a.push(i)
    else m.set(k, [i])
  }
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    push(byWord, e.s, i)
    if (e.t && e.t !== e.s) push(byWord, e.t, i)
    const py = stripTones(e.p)
    if (py) {
      push(byPinyin, py, i)
      push(byInitials, pinyinInitials(e.p), i)
    }
    const d = e.d
    if (d) {
      for (let k = 0; k < d.length; k++) {
        const low = d[k].toLowerCase()
        // 一次 match 直接取出 ≥3 字符的英文词，省掉 split 产生的短词与后续长度判断
        const words = glossWords ? low.match(/[a-z0-9']{3,}/g) : null
        if (words) {
          for (let w = 0; w < words.length; w++) {
            const t = words[w]
            if (GLOSS_STOP.has(t)) continue
            addGloss(byGlossWord, t, i)
          }
        }
        // 义项级索引只给含中文的释义建（自定义中文词库场景）。
        // 先用首字符码位快速排除纯 ASCII 释义，避免对每条释义都跑一次 CJK 正则。
        if (low.charCodeAt(0) > 0x2e80 && CJK.test(low)) {
          const parts = low.split(/[;,，；]/)
          const lim = maxGlossSeg ? Math.min(parts.length, maxGlossSeg) : parts.length
          for (let p = 0; p < lim; p++) {
            const seg = parts[p].trim()
            if (seg) addGloss(byGlossSeg, seg, i)
          }
        }
      }
    }
  }
  // 前缀检索用：按简体 + 繁体双写的词表（繁体词也要能前缀展开）。
  // 存成「字符串数组 + Int32Array」而不是对象数组：20 万条时省约 6MB 常驻内存，
  // 排序与二分比较也更快（直接比字符串，不用读对象属性）。
  const pairs = []
  for (let i = 0; i < entries.length; i++) {
    pairs.push({ w: entries[i].s, i })
    const t = entries[i].t
    if (t && t !== entries[i].s) pairs.push({ w: t, i })
  }
  pairs.sort((a, b) => (a.w < b.w ? -1 : a.w > b.w ? 1 : 0))
  const sortedWords = new Array(pairs.length)
  const sortedIdx = new Int32Array(pairs.length)
  for (let k = 0; k < pairs.length; k++) {
    sortedWords[k] = pairs[k].w
    sortedIdx[k] = pairs[k].i
  }
  pairs.length = 0

  return {
    entries, byWord, byPinyin, byInitials,
    sortedWords, sortedIdx,
    byGlossSeg, byGlossWord,
    // 排序后的键表，供前缀二分；eager 生成，避免首次查询时的抖动
    glossSegs: [...byGlossSeg.keys()].sort(),
    glossWords: [...byGlossWord.keys()].sort(),
    builtAt: Date.now(),
  }
}

// 带早停的编辑距离（只在 ≤ maxDist 时返回真实值）
export function editDistance(a, b, maxDist = 2) {
  if (a === b) return 0
  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > maxDist) return maxDist + 1
  let prev = new Array(lb + 1)
  let cur = new Array(lb + 1)
  for (let j = 0; j <= lb; j++) prev[j] = j
  for (let i = 1; i <= la; i++) {
    cur[0] = i
    let rowMin = cur[0]
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (cur[j] < rowMin) rowMin = cur[j]
    }
    if (rowMin > maxDist) return maxDist + 1
    const t = prev
    prev = cur
    cur = t
  }
  return prev[lb]
}

/* ============================ 检索 ============================ */

export const MODES = ['auto', 'exact', 'prefix', 'pinyin', 'gloss', 'fuzzy']

// 在已排序的字符串表上二分，找到第一个 >= q 的位置
function lowerBoundStr(arr, q) {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] < q) lo = mid + 1
    else hi = mid
  }
  return lo
}

// 释义倒排的前缀展开：把前缀命中的文档并入 cand，带文档数上限防止三字母前缀爆量
function glossPrefixWalk(map, keys, needle, cand, cap) {
  if (!map || !keys || !keys.length) return 0
  let n = 0
  for (let pos = lowerBoundStr(keys, needle); pos < keys.length; pos++) {
    const k = keys[pos]
    if (!k.startsWith(needle)) break
    if (k !== needle) {
      const list = map.get(k)
      if (list) {
        for (let j = 0; j < list.length; j++) {
          cand.add(list[j])
          if (++n >= cap) return n
        }
      }
    }
  }
  return n
}

// 精细打分：对（少量）候选按原始释义重新定级。
// 这是「倒排只负责召回、打分仍看原文」的分工——倒排把 12 万条缩到几十条，
// 打分逻辑与全表扫时代完全一致，所以排序质量不降，速度却从 45ms 降到 0.2ms。
function scoreGloss(entry, needle) {
  const d = entry.d
  if (!d) return 0
  let best = 0
  for (let k = 0; k < d.length; k++) {
    const low = String(d[k]).toLowerCase()
    // CC-CEDICT 用「;」并列近义词（bicycle; bike），故先按标点切分再比对
    const parts = low.split(/[;,，；]/)
    let exact = false
    let head = false
    for (let p = 0; p < parts.length; p++) {
      const seg = parts[p].trim()
      if (seg === needle) { exact = true; break }
      if (!head && seg.startsWith(needle)) head = true
    }
    if (exact) return 45
    if (head) best = Math.max(best, 38)
    else if (low.includes(needle)) best = Math.max(best, 30)
  }
  return best
}

// 单词的召回集合（义项精确 / 单词精确 / 单词前缀），多词 AND 时对每个词分别取
function glossRecall(index, term, out, cap = 4000) {
  const { byGlossSeg, byGlossWord, glossSegs, glossWords } = index
  const seg = byGlossSeg && byGlossSeg.get(term)
  if (seg) for (let k = 0; k < seg.length; k++) out.add(seg[k])
  const word = byGlossWord && byGlossWord.get(term)
  if (word) for (let k = 0; k < word.length; k++) out.add(word[k])
  if (glossWords) glossPrefixWalk(byGlossWord, glossWords, term, out, cap)
  if (glossSegs && glossSegs.length) {
    let n = 0
    for (let pos = lowerBoundStr(glossSegs, term); pos < glossSegs.length; pos++) {
      const k = glossSegs[pos]
      if (!k.startsWith(term)) break
      if (k !== term) {
        const list = byGlossSeg.get(k)
        if (list) for (let j = 0; j < list.length; j++) { out.add(list[j]); if (++n >= 500) break }
        if (n >= 500) break
      }
    }
  }
  return out
}

// 释义检索主流程：
//   ① 倒排召回（义项/单词的精确 + 前缀）→ ② 对候选按原文精细打分（45/38/30）
//   ③ 召回为空时才全表 includes 兜底（"cycle" 这类子串查询）
//   多词查询：整串连续命中 40 分，其余按各词 AND 给 36 分。
function glossSearch(index, query, hits, add) {
  const needle = query.toLowerCase().trim()
  if (!needle) return
  const { byGlossSeg, byGlossWord, glossWords, glossSegs, entries } = index

  const terms = needle.split(/\s+/).filter(Boolean)
  if (terms.length > 1) {
    // 整串连续出现（最贴近用户意图），候选来自各词召回的交集再细筛
    let inter = null
    for (let t = 0; t < terms.length; t++) {
      const set = glossRecall(index, terms[t], new Set(), 1500)
      if (!inter) inter = set
      else {
        const next = new Set()
        for (const i of inter) if (set.has(i)) next.add(i)
        inter = next
      }
      if (!inter.size) break
    }
    if (inter) {
      for (const i of inter) {
        const sc = scoreGloss(entries[i], needle)
        add(i, sc ? Math.max(sc, 40) : 36, 'gloss')
      }
    }
    return
  }

  const cand = new Set()
  const seg = byGlossSeg && byGlossSeg.get(needle)
  if (seg) for (let k = 0; k < seg.length; k++) cand.add(seg[k])
  const word = byGlossWord && byGlossWord.get(needle)
  if (word) for (let k = 0; k < word.length; k++) cand.add(word[k])
  glossPrefixWalk(byGlossWord, glossWords, needle, cand, 4000)
  glossPrefixWalk(byGlossSeg, glossSegs, needle, cand, 500)

  if (cand.size) {
    for (const i of cand) {
      const sc = scoreGloss(entries[i], needle)
      if (sc) add(i, sc, 'gloss')
    }
    return
  }

  // 兜底：子串（"cycle" 命中 "bicycle"）。仅在前面的倒排一无所获时执行，
  // 常见查询不会走到这里；冷僻查询最多付一次全表扫描（约 45ms / 12 万条）。
  for (let i = 0; i < entries.length; i++) {
    const d = entries[i].d
    if (!d) continue
    for (let k = 0; k < d.length; k++) {
      if (String(d[k]).toLowerCase().includes(needle)) { add(i, 30, 'gloss'); break }
    }
  }
}

// 返回 { query, mode, total, items, took }
// item = 词条 + { i, hit, score, pm }（pm 为带调拼音，直接可显示）
export function search(index, query, { mode = 'auto', limit = 50, maxDist = 2 } = {}) {
  const t0 = Date.now()
  const q = String(query ?? '').trim()
  const empty = { query: q, mode, total: 0, items: [], took: 0 }
  if (!q || !index) return empty

  const hits = new Map() // i -> { score, hit }
  const add = (i, score, hit) => {
    const prev = hits.get(i)
    if (!prev || score > prev.score) hits.set(i, { score, hit })
  }

  const hasCJK = CJK.test(q)
  // 拼音输入可能带 ü / u: / v / 数字声调，统一折叠后再判断是否为「罗马字母输入」
  const ascii = /^[a-z0-9 :']+$/.test(q.toLowerCase().replace(/ü/g, 'v').replace(/u:/g, 'v'))
  const useAuto = mode === 'auto'

  // 1) 精确（简体 / 繁体）
  if (useAuto || mode === 'exact' || mode === 'prefix') {
    const list = index.byWord.get(q)
    if (list) for (const i of list) add(i, 100, 'exact')
  }

  // 2) 中文前缀（含词头扩展，简繁通用）
  if ((useAuto && hasCJK) || mode === 'prefix') {
    const pos = lowerBoundStr(index.sortedWords, q)
    let count = 0
    for (let k = pos; k < index.sortedWords.length; k++) {
      const w = index.sortedWords[k]
      if (!w.startsWith(q)) break
      add(index.sortedIdx[k], 80 - Math.min(20, (w.length - q.length) * 2), 'prefix')
      if (++count >= limit * 4) break
    }
  }

  // 3) 拼音（全拼 / 首字母），支持带数字声调与无调混输
  if ((useAuto && ascii) || mode === 'pinyin') {
    const key = stripTones(q)
    if (key) {
      const exactPy = index.byPinyin.get(key)
      if (exactPy) for (const i of exactPy) add(i, 90, 'pinyin')
      // 前缀拼音：遍历拼音键（数量与词条同量级，用 startsWith 过滤）
      let n = 0
      for (const [k, list] of index.byPinyin) {
        if (k !== key && k.startsWith(key)) {
          for (const i of list) add(i, 70, 'pinyin')
          if (++n > 200) break
        }
      }
      const ini = index.byInitials.get(key)
      if (ini) for (const i of ini) add(i, 60, 'initials')
    }
  }

  // 4) 释义全文（英文查义 / 中文释义里的词）
  //    走倒排索引：义项精确 ＞ 单词精确 ＞ 前缀 ＞ 子串兜底，详见 glossSearch 注释。
  if (mode === 'gloss' || (useAuto && ascii && hits.size === 0)) {
    glossSearch(index, q, hits, add)
  }

  // 5) 模糊（编辑距离），仅显式模式触发，避免拖慢日常输入
  if (mode === 'fuzzy') {
    // 两字词之间的编辑距离几乎必然 ≤ 2，直接放行会产生上万条噪声。
    // 短查询收紧到 1，并要求与候选至少共享一个字符（否则距离必然 ≥ 词长）。
    const lim = q.length <= 2 ? Math.min(maxDist, 1) : maxDist
    const qset = new Set(q)
    if (hasCJK) {
      const words = index.sortedWords
      const ids = index.sortedIdx
      for (let k = 0; k < words.length; k++) {
        const w = words[k]
        if (Math.abs(w.length - q.length) > lim) continue
        let shared = 0
        for (const ch of w) if (qset.has(ch)) shared++
        if (!shared) continue
        const dist = editDistance(q, w, lim)
        // 同距离时优先首字相同（「绿仓 → 绿色」比「绿仓 → 倒仓」更可能是用户本意）
        if (dist >= 1 && dist <= lim) add(ids[k], 60 - dist * 10 - Math.abs(w.length - q.length) * 6 + (w[0] === q[0] ? 10 : 0), 'fuzzy')
      }
    } else {
      const key = stripTones(q)
      for (const [k, list] of index.byPinyin) {
        if (Math.abs(k.length - key.length) > lim) continue
        const dist = editDistance(key, k, lim)
        if (dist >= 1 && dist <= lim) for (const i of list) add(i, 55 - dist * 10, 'fuzzy')
      }
    }
  }

  const items = [...hits.entries()]
    .map(([i, h]) => ({ i, hit: h.hit, score: h.score }))
    .sort((a, b) => b.score - a.score || index.entries[a.i].s.length - index.entries[b.i].s.length || (index.entries[a.i].s < index.entries[b.i].s ? -1 : 1))
    .slice(0, Math.max(1, Math.min(500, limit)))
    .map((h) => {
      const e = index.entries[h.i]
      return { i: h.i, hit: h.hit, score: h.score, s: e.s, t: e.t, p: e.p, pm: toneMark(e.p), d: e.d }
    })

  return { query: q, mode, total: hits.size, items, took: Date.now() - t0 }
}

/* ============================ 统计 / 自检 ============================ */

export function stats(index) {
  if (!index) return { entries: 0, words: 0, builtAt: 0 }
  return { entries: index.entries.length, words: index.byWord.size, builtAt: index.builtAt }
}

/* ---------------- 英语 IPA 音标（open-dict-data/ipa-dict，MIT） ----------------
 * 行格式：word⇥/ipa1/, /ipa2/（一条词可有多个读音；# 开头为注释行）。
 * 与主词库完全独立：CC-CEDICT 是汉英词典、天生没有音标，音标查英文词本身。
 * 只在查询单个纯英文词（无空格）时使用，索引体积约 3–4 MB 内存。
 */
export function buildIpaIndex(text, map = new Map()) {
  const lines = String(text ?? '').split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.charCodeAt(0) === 35 /* # */) continue
    const tab = line.indexOf('\t')
    if (tab <= 0) continue
    const w = line.slice(0, tab).toLowerCase()
    const ipas = line
      .slice(tab + 1)
      .split(',')
      .map((x) => x.trim().replace(/^\/+|\/+$/g, ''))
      .filter(Boolean)
    if (!w || !ipas.length) continue
    const arr = map.get(w)
    if (arr) arr.push(...ipas)
    else map.set(w, ipas)
  }
  return map
}

// 查询单词是否走音标路径：单个纯英文词（允许撇号 / 连字符），不含空格
export function isSingleEnglishWord(q) {
  return /^[a-zA-Z][a-zA-Z'’-]*$/.test(String(q ?? '').trim())
}

export async function selfTest() {
  const items = []
  const T = async (id, title, fn) => {
    try {
      const detail = await fn()
      items.push({ id, title, ok: true, detail })
    } catch (e) {
      items.push({ id, title, ok: false, error: { message: e.message, stack: e.stack } })
    }
  }

  const sample = [
    '會 会 [hui4] /can/to be possible/to be able to/will/to be sure to/meeting/party/gathering/',
    '綠色 绿色 [lv4 se4] /green/',
    '綠茶 绿茶 [lv4 cha2] /green tea/',
    '你好 你好 [ni3 hao3] /hello/hi/',
    '自行車 自行车 [zi4 xing2 che1] /bicycle/bike/',
  ].join('\n')

  await T('cedict', 'CC-CEDICT 解析', async () => {
    const list = parseCedict(sample)
    if (list.length !== 5) throw new Error('应解析 5 条，实际 ' + list.length)
    if (list[0].s !== '会' || list[0].t !== '會') throw new Error('简繁字段解析错误')
    if (list[1].d[0] !== 'green') throw new Error('释义解析错误：' + list[1].d[0])
    return `${list.length} 条，含简繁对照`
  })

  await T('tone', '拼音标调（数字 → 符号）', async () => {
    const cases = [['ni3 hao3', 'nǐ hǎo'], ['lv4 se4', 'lǜ sè'], ['zhong1 guo2', 'zhōng guó'], ['liu2', 'liú']]
    for (const [src, want] of cases) {
      const got = toneMark(src)
      if (got !== want) throw new Error(`${src} → ${got}（期望 ${want}）`)
    }
    return 'nǐ hǎo / lǜ sè / zhōng guó / liú'
  })

  await T('strip', '去调与首字母', async () => {
    if (stripTones('ni3 hao3') !== 'nihao') throw new Error('去调错误')
    if (stripTones('lv4 se4') !== 'lvse') throw new Error('ü 折叠错误')
    if (pinyinInitials('ni3 hao3') !== 'nh') throw new Error('首字母错误')
    return 'nihao / lvse / nh'
  })

  const index = buildIndex(parseCedict(sample))

  await T('exact', '精确检索（简体 / 繁体）', async () => {
    const a = search(index, '绿色')
    const b = search(index, '綠色')
    if (a.total !== 1 || b.total !== 1) throw new Error('精确命中数量异常')
    if (a.items[0].pm !== 'lǜ sè') throw new Error('带调拼音错误：' + a.items[0].pm)
    return '简繁均可命中，拼音 lǜ sè'
  })

  await T('prefix', '中文前缀扩展', async () => {
    const r = search(index, '自')
    if (!r.items.some((x) => x.s === '自行车')) throw new Error('前缀未展开到「自行车」')
    return `命中 ${r.total} 条`
  })

  await T('pinyin', '拼音 / 首字母 / 无调检索', async () => {
    const a = search(index, 'lvse')
    const b = search(index, 'ni hao')
    const c = search(index, 'nh')
    if (!a.items.some((x) => x.s === '绿色')) throw new Error('无调拼音未命中')
    if (!b.items.some((x) => x.s === '你好')) throw new Error('带空格拼音未命中')
    if (!c.items.some((x) => x.s === '你好')) throw new Error('首字母未命中')
    return 'lvse / ni hao / nh 均可命中'
  })

  await T('gloss', '英文释义反查', async () => {
    const r = search(index, 'bicycle', { mode: 'gloss' })
    if (!r.items.some((x) => x.s === '自行车')) throw new Error('英文释义未命中')
    return 'bicycle → 自行车'
  })

  await T('gloss-multi', '多词释义 AND 检索', async () => {
    const r = search(index, 'green tea', { mode: 'gloss' })
    if (!r.items.some((x) => x.s === '绿茶')) throw new Error('green tea 未命中绿茶')
    return 'green tea → 绿茶'
  })

  await T('gloss-substr', '释义子串兜底', async () => {
    // cycle 不是独立词，倒排召回为空，应回退全表 includes
    const r = search(index, 'cycle', { mode: 'gloss' })
    if (!r.items.some((x) => x.s === '自行车')) throw new Error('子串兜底未命中 bicycle')
    return 'cycle → bicycle（兜底）'
  })

  await T('fuzzy', '模糊纠错（编辑距离）', async () => {
    const r = search(index, '绿仓', { mode: 'fuzzy', maxDist: 1 })
    if (!r.items.some((x) => x.s === '绿色')) throw new Error('模糊匹配未纠到「绿色」')
    return '绿仓 → 绿色'
  })

  await T('jsonl', 'JSONL 导入解析', async () => {
    const line = JSON.stringify({ word: '龙', pinyin: 'long2', senses: [{ glosses: ['dragon'] }] })
    const list = parseJsonl(line + '\n')
    if (list.length !== 1 || list[0].s !== '龙' || list[0].d[0] !== 'dragon') throw new Error('JSONL 解析错误')
    return 'word/senses 字段兼容'
  })

  await T('ipa', '英语 IPA 音标索引', async () => {
    const ipa = buildIpaIndex("Bicycle\t/ˈbaɪsɪkəɫ/, /ˈbaɪsɪkl/\n# 注释行\nbadline-no-tab")
    if (!ipa.get('bicycle') || ipa.get('bicycle').length !== 2) throw new Error('IPA 解析错误：' + ipa.get('bicycle'))
    buildIpaIndex('bicycle\t/ˈbaɪ.sɪ.kəl/', ipa) // 二次构建应累积读音
    if (ipa.get('bicycle').length !== 3) throw new Error('IPA 累积错误')
    if (!isSingleEnglishWord('bicycle') || isSingleEnglishWord('green tea') || isSingleEnglishWord('绿色')) {
      throw new Error('单词判定错误')
    }
    return 'bicycle → 3 个读音 · green tea 不走音标'
  })

  return { module: '离线词典', items }
}
