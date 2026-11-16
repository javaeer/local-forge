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

// 按文件名/内容嗅探格式，统一入口
export function parseDict(text, name = '') {
  const lower = String(name).toLowerCase()
  if (lower.endsWith('.jsonl') || lower.endsWith('.json')) return parseJsonl(text)
  if (lower.endsWith('.tsv') || lower.endsWith('.csv')) return parseTsv(text)
  const head = String(text).slice(0, 400)
  if (head.trimStart().startsWith('{')) return parseJsonl(text)
  if (head.includes('\t')) return parseTsv(text)
  return parseCedict(text)
}

/* ============================ 索引 ============================ */

export function buildIndex(entries) {
  const byWord = new Map()
  const byPinyin = new Map()
  const byInitials = new Map()
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
  }
  // 前缀检索用：按简体排序的词表
  const sorted = entries
    .map((e, i) => ({ w: e.s, i }))
    .sort((a, b) => (a.w < b.w ? -1 : a.w > b.w ? 1 : 0))
  return { entries, byWord, byPinyin, byInitials, sorted, builtAt: Date.now() }
}

// 在 sorted 上二分，找到第一个 >= q 的位置
function lowerBound(sorted, q) {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid].w < q) lo = mid + 1
    else hi = mid
  }
  return lo
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

  // 2) 中文前缀（含词头扩展）
  if ((useAuto && hasCJK) || mode === 'prefix') {
    const pos = lowerBound(index.sorted, q)
    let count = 0
    for (let k = pos; k < index.sorted.length; k++) {
      const { w, i } = index.sorted[k]
      if (!w.startsWith(q)) break
      add(i, 80 - Math.min(20, (w.length - q.length) * 2), 'prefix')
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
  //    打分区分「释义恰好等于查询词」＞「释义以查询词开头」＞「释义包含」，否则
  //    查 bicycle 时把「释义里顺带提到 bicycle」的词条排到了「自行车」前面。
  if (mode === 'gloss' || (useAuto && ascii && hits.size === 0)) {
    const needle = q.toLowerCase()
    const entries = index.entries
    for (let i = 0; i < entries.length; i++) {
      const d = entries[i].d
      let best = 0
      for (let k = 0; k < d.length; k++) {
        const low = d[k].toLowerCase()
        // CC-CEDICT 用「;」并列近义词（bicycle; bike），故先按标点切分再比对
        const parts = low.split(/[;,]/).map((x) => x.trim())
        if (parts.includes(needle)) { best = 45; break }
        if (parts.some((x) => x.startsWith(needle))) best = Math.max(best, 38)
        else if (low.includes(needle)) best = Math.max(best, 30)
      }
      if (best) add(i, best, 'gloss')
    }
  }

  // 5) 模糊（编辑距离），仅显式模式触发，避免拖慢日常输入
  if (mode === 'fuzzy') {
    // 两字词之间的编辑距离几乎必然 ≤ 2，直接放行会产生上万条噪声。
    // 短查询收紧到 1，并要求与候选至少共享一个字符（否则距离必然 ≥ 词长）。
    const lim = q.length <= 2 ? Math.min(maxDist, 1) : maxDist
    const qset = new Set(q)
    if (hasCJK) {
      for (let k = 0; k < index.sorted.length; k++) {
        const { w, i } = index.sorted[k]
        if (Math.abs(w.length - q.length) > lim) continue
        let shared = 0
        for (const ch of w) if (qset.has(ch)) shared++
        if (!shared) continue
        const dist = editDistance(q, w, lim)
        // 同距离时优先首字相同（「绿仓 → 绿色」比「绿仓 → 倒仓」更可能是用户本意）
        if (dist >= 1 && dist <= lim) add(i, 60 - dist * 10 - Math.abs(w.length - q.length) * 6 + (w[0] === q[0] ? 10 : 0), 'fuzzy')
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
    '你好 你好 [ni3 hao3] /hello/hi/',
    '自行車 自行车 [zi4 xing2 che1] /bicycle/bike/',
  ].join('\n')

  await T('cedict', 'CC-CEDICT 解析', async () => {
    const list = parseCedict(sample)
    if (list.length !== 4) throw new Error('应解析 4 条，实际 ' + list.length)
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

  return { module: '离线词典', items }
}
