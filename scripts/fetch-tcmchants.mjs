#!/usr/bin/env node
// 拉取 / 生成「中医药歌诀库」（中医药经典模块第 5 期数据层）。
//
// 与 fetch-poems.mjs 同一套约定：数据是「数据」不是「代码」，仓库不保留快照，
// predev / prebuild 自动补齐（npm run tcmchants:fetch -- --if-missing）。
//
// 管辖八本歌诀 / 韵文经典（作者均殁逾百年，原文属公共领域）：
//   1. 汤头歌诀            清·汪昂    balayuxf/TCM-Ancient-Books 084
//   2. 濒湖脉学            明·李时珍  同上 506
//   3. 药性歌括四百味      明·龚廷贤  garychowcmu/daizhigev20 医藏（主源缺此书）
//   4. 珍珠囊补遗药性赋    金·李东垣  TCM-Ancient-Books 045
//   5. 医学三字经          清·陈修园  同上 592
//   6. 长沙方歌括          清·陈修园  同上 094
//   7. 金匮方歌括          清·陈念祖  同上 095
//   8. 时方歌括            清·陈修园  同上 093
//
// 数据源注意事项（2026-11 实测，勿凭直觉改动）：
//   - TCM-Ancient-Books 的文件是 **GB18030 编码**，必须用 TextDecoder('gb18030') 转码；
//   - 该仓库在 jsDelivr 超过包体积限额时会返回 200 + 错误说明文本（约 144B），
//     所以体积下限校验是硬要求，且必须保留 raw.githubusercontent 兜底镜像；
//   - 源文本里 `\x` 是成对的占位符（校勘标记丢失后的残迹）：医学三字经用它包住
//     三字经正文，其余书里包住卷首计数、炮制说明等短句。统一剥标记、保留内容；
//   - `KT` 是上游数字化时缺失字符的占位符（如「身体强 KT KT 然」），统一换成全角空格；
//   - daizhige 版药性歌括四百味存在**条目粘连**（前一条夹注残断后直接接下一条）与
//     **缺字**（如「黄　性温」缺「芪」）。处理原则：**不猜字**——
//     粘连用 SIBAI_SPLITS 勘误表在已知边界处拆开；缺字保留全角空格并标「存疑」注。
//
// 产物：public/tcm/tcmchants.json.gz（八书约 1100 条，传输格式为定长数组省体积）。
//
// 用法：
//   node scripts/fetch-tcmchants.mjs              # 下载并生成
//   node scripts/fetch-tcmchants.mjs --if-missing # dev / build 钩子：快照有效即跳过
//   node scripts/fetch-tcmchants.mjs --check      # 只校验现有快照，不联网（CI 用）
//   node scripts/fetch-tcmchants.mjs --force      # 忽略现有快照，强制重下
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = 'public/tcm'
const OUT = `${DIR}/tcmchants.json.gz`
const CHECK = process.argv.includes('--check')
const FORCE = process.argv.includes('--force')
const IF_MISSING = process.argv.includes('--if-missing')

// 体积上限（gzip 后）。实测 273 KB，收紧到 320 KB（+15% 余量）；
// 超限说明转码 / 解析策略退化（比如把整本按语都塞进了韵文），拦下而不是默默发布。
const MAX_GZIP = 320 * 1024

const MIRRORS = [
  (repo, p) => `https://fastly.jsdelivr.net/gh/${repo}/master/${encodeURI(p)}`,
  (repo, p) => `https://cdn.jsdelivr.net/gh/${repo}/master/${encodeURI(p)}`,
  // jsDelivr 对超 50MB 的仓库按日限额会间歇性 404/403，raw 又极慢，
  // ghproxy 系代理实测秒回，作第三优先兜底
  (repo, p) => `https://ghproxy.net/https://raw.githubusercontent.com/${repo}/master/${encodeURI(p)}`,
  (repo, p) => `https://gh-proxy.com/https://raw.githubusercontent.com/${repo}/master/${encodeURI(p)}`,
  (repo, p) => `https://raw.githubusercontent.com/${repo}/master/${encodeURI(p)}`,
]

const REPO = 'balayuxf/TCM-Ancient-Books'
const REPO_DZG = 'garychowcmu/daizhigev20'

/* ---------------- 下载 ---------------- */

async function getText(paths, minBytes) {
  const errs = []
  for (const url of paths) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000) })
      if (!res.ok) {
        errs.push(`${url} → HTTP ${res.status}`)
        continue
      }
      const buf = Buffer.from(await res.arrayBuffer())
      // jsDelivr 超包限额返回 200 + 几百字节的错误说明，体积下限是唯一便宜的拦截
      if (buf.length < minBytes) {
        errs.push(`${url} → 体积 ${buf.length} < ${minBytes}（疑似截断或限额页）`)
        continue
      }
      return buf
    } catch (e) {
      errs.push(`${url} → ${e.message}`)
    }
  }
  throw new Error(`全部镜像失败：\n  ${errs.join('\n  ')}`)
}

async function fetchBook(file, minBytes) {
  const buf = await getText(MIRRORS.map((m) => m(REPO, file)), minBytes)
  return new TextDecoder('gb18030').decode(buf)
}

async function fetchSibaiwei() {
  const buf = await getText(MIRRORS.map((m) => m(REPO_DZG, '医藏/药性歌括四百味.txt')), 15_000)
  return buf.toString('utf8') // daizhige 是 UTF-8，实测确认
}

/* ---------------- 清洗 ---------------- */

// 行级清洗：剥校验占位符、替换缺字占位、去行尾排版空格。
// 保留所有文字内容，绝不「补字」——缺字一律留空并标存疑。
export function cleanLine(s) {
  return s
    .replace(/\\x/g, '')
    .replace(/KT/g, '　')
    .replace(/\uFFFD/g, '　')
    .replace(/[ \t]+$/g, '')
}

// 块正文 → 连续文本。源文件是固定宽度排版，断行都在句中，直接拼接恢复原貌。
export function joinBody(body) {
  return body
    .split('\n')
    .map(cleanLine)
    .filter((s) => s && !s.startsWith('<'))
    .join('')
}

// 抽出（…）夹注：歌诀类书里括号内容是注释，从韵文中剥离，返回 { text, notes }。
// 上游有括号残断（有「（」无「）」）的情况，残段同样进 notes，韵文不留悬挂括号。
export function extractNotes(text) {
  const notes = []
  let out = text.replace(/（[^（）]*）/g, (m) => {
    notes.push(m.slice(1, -1))
    return ''
  })
  out = out.replace(/（[^（）]*$/g, (m) => {
    notes.push(m.slice(1))
    return ''
  })
  return { text: out, notes }
}

/* ---------------- 通用块解析 ---------------- */

// <篇名> 块切分：每块 = { name, dir, body }。源文本结构规整（实测八本书全部一致）。
export function splitBlocks(raw) {
  const t = raw.replace(/\r/g, '')
  return t
    .split(/^<篇名>/m)
    .slice(1)
    .map((p) => {
      const name = cleanLine(p.split('\n')[0] || '').replace(/[，,。]$/, '')
      const dir = cleanLine((p.match(/^<目录>(.*)$/m) || [])[1] || '')
      const body = p.split('\n').slice(1).join('\n')
      return { name, dir, body }
    })
    .filter((b) => b.name)
}

// 空 dir 的块（上游 <目录> 行丢失）回填分组：向右看最近的「非空且非组头」的 dir。
// 组头块（名字与目录相同，如「补益之剂」）不算，否则书首散条会被挂到错误的卷。
// 实测汤头歌诀「益气聪明汤」等书首散条右侧第一个真条目是「四君子汤」（补益之剂），
// 向右回填才正确；歌诀原文顺序即信息，不动。
function backfillDirs(blocks) {
  const out = blocks.map((b) => ({ ...b }))
  for (let i = 0; i < out.length; i++) {
    if (out[i].dir) continue
    let g = ''
    for (let j = i + 1; j < out.length; j++) {
      if (out[j].dir && out[j].name !== out[j].dir) {
        g = out[j].dir
        break
      }
    }
    out[i].dir = g
  }
  return out
}

const FRONT_NAMES = new Set(['叙', '序', '凡例', '小引', '后跋', '跋'])

/* ---------------- 各书解析 ---------------- */

// 汤头歌诀 / 时方歌括：方名条目，正文 = 歌诀 + （夹注）。
// 跳过书名块、序跋，以及「名字与目录相同」的分组头（如「补益之剂 · 十首、附方七」）。
// 时方歌括的歌诀后常接「陈修园曰 / 柯韵伯曰」式论说，从第一个「X曰。」处切开进 note，
// 韵文只留歌诀本体——背诵界面不该滚出整页散文。
export function parseJuege(blocks, bookName) {
  const items = []
  for (const b of backfillDirs(blocks)) {
    if (b.name === bookName || FRONT_NAMES.has(b.name) || !b.dir || b.name === b.dir) continue
    const body = joinBody(b.body)
    if (!body) continue
    const { text: noNote, notes } = extractNotes(body.replace(/^属性：/, ''))
    const proseAt = noNote.search(/[\u4e00-\u9fff]{1,4}曰。/)
    const prose = proseAt >= 0 ? noNote.slice(proseAt) : ''
    const text = proseAt >= 0 ? noNote.slice(0, proseAt) : noNote
    if (!text) continue
    items.push({
      group: b.dir,
      title: b.name,
      verse: text,
      note: [...notes, prose].filter(Boolean).map((n) => n.replace(/[。；]+$/, '')).join('；'),
    })
  }
  return items
}

// 长沙方歌括 / 金匮方歌括：条目含主治、组成、煎服法、「歌曰 …」方歌与「蔚按」按语。
// 只收含歌曰的块（组成目录块与「歌见长沙方歌括」互引块没有韵文，背诵无意义）。
// 方歌 = 每个「歌曰」之后到按语标记（蔚按 / 元犀按 / 令韶 / 按。）之前的文字；
// 其余全文进 note，原样保留——按语是陈氏父子的治学心得，删了可惜。
export function parseFangge(blocks) {
  const items = []
  for (const b of blocks) {
    if (!b.dir || !/歌曰/.test(b.body)) continue
    const body = joinBody(b.body)
    const pressed = body.split(/(?=蔚按|元犀按|令韶|按。)/)[0]
    const verses = []
    for (const seg of pressed.split(/(?=歌曰)/).slice(1)) {
      const v = seg.replace(/^歌曰\s*/, '').trim()
      if (v) verses.push(v)
    }
    if (!verses.length) continue
    const after = body.slice(pressed.length).trim()
    items.push({
      group: b.dir.replace(/\\/g, ' · '),
      title: b.name,
      verse: verses.join('\n'),
      note: [after, ...extractNotes(body).notes].filter(Boolean).join('\n注：'),
    })
  }
  return items
}

// 濒湖脉学：二十七脉 + 四言举要。〔体状诗〕〔相类诗〕〔主病诗〕小节是韵文（进 verse），
// 小节之外的散文解说（属性：起）进 note；无小节标记的块（四言举要）整块当韵文。
export function parseBinhu(blocks) {
  const items = []
  for (const b of blocks) {
    if (b.name === '濒湖脉学' || FRONT_NAMES.has(b.name)) continue
    const lines = b.body.split('\n').map(cleanLine).filter((s) => s && !s.startsWith('<'))
    const note = []
    const verse = []
    let cur = -1
    for (const l of lines) {
      const m = l.match(/^〔(体状诗|相类诗|主病诗|体状相类诗)〕\s*(.*)$/)
      if (m) {
        verse.push(m[2])
        cur = verse.length - 1
        continue
      }
      if (cur >= 0) {
        verse[cur] += l
      } else {
        note.push(l.replace(/^属性：/, ''))
      }
    }
    if (!verse.length) {
      const body = joinBody(b.body)
      if (body) items.push({ group: '脉学', title: b.name, verse: body.replace(/^属性：/, ''), note: '' })
      continue
    }
    items.push({ group: '脉学', title: b.name, verse: verse.join('\n'), note: note.join('') })
  }
  return items
}

// 段内清洗：去 <篇名>/<目录> 残行、剥占位符、拼接断行
function cleanSeg(s) {
  return s
    .split('\n')
    .filter((l) => !l.trim().startsWith('<'))
    .map(cleanLine)
    .join('')
    .trim()
}

// 医学三字经：正文用 \x 成对包住三字经句，\x 外是注文。先按 \x 切分、再清洗——
// 顺序不能反：cleanLine 会剥掉标记本身，先清洗就再也切不开了。
export function parseSanzijing(blocks, bookName) {
  const items = []
  for (const b of blocks) {
    if (b.name === bookName || FRONT_NAMES.has(b.name) || !b.dir) continue
    const segs = b.body.split(/\\x/).map(cleanSeg)
    const verse = []
    const note = []
    segs.forEach((s, i) => {
      if (!s) return
      if (i % 2 === 1) verse.push(s)
      else note.push(s.replace(/^属性：/, ''))
    })
    if (!verse.length) continue
    items.push({ group: b.dir.replace(/\\/g, ' · '), title: b.name, verse: verse.join('\n'), note: note.join('') })
  }
  return items
}

// 珍珠囊补遗药性赋：卷一总赋（寒热温平四性赋文）+ 卷二起逐味药条目。
// \x 里是炮制畏恶说明（进 note，标〔炮制〕），其余为赋文（verse）。切分同样在清洗前。
export function parseYaoxingfu(blocks, bookName) {
  const items = []
  for (const b of blocks) {
    if (b.name === bookName || FRONT_NAMES.has(b.name) || !b.dir || b.name === b.dir) continue
    const segs = b.body.split(/\\x/).map(cleanSeg)
    const noteParts = []
    const verseParts = []
    segs.forEach((s, i) => {
      if (!s) return
      if (i % 2 === 1) noteParts.push(`〔炮制〕${s}`)
      else verseParts.push(s.replace(/^(属性|内容)：/, ''))
    })
    const { text, notes } = extractNotes(verseParts.join(''))
    if (!text) continue
    items.push({
      group: b.dir.replace(/\\/g, ' · '),
      title: b.name,
      verse: text,
      note: [...noteParts, ...notes].filter(Boolean).join('；'),
    })
  }
  return items
}

/* ---------------- 药性歌括四百味 ---------------- */

// 药名后接的性味标志字：味X / 性X / 气X / 直接性味字（「白朮甘温」式）
const TASTE = '甘辛酸苦咸寒温平凉涩淡毒'
const NAME_RE = new RegExp(`^([\\u4e00-\\u9fff　]{1,6}?)?(?:味|性|气)?[${TASTE}]`)

// daizhige 版条目粘连勘误表：在已知边界（通行本下一条药的首句）把粘连的两条拆开。
// 只拆分、不补字；2026-11 对 daizhige 版逐条核对录入。上游文本若变，
// checkSnapshot 的条数断言会兜底报错。
const SIBAI_SPLITS = [
  '茯苓味淡', // 白朮 ┆ 茯苓
  '当归甘温', // 甘草 ┆ 当归
  '熟地微温', // 生地 ┆ 熟地
  '黄芩苦寒', // 黄连 ┆ 黄芩
  '栀子性寒', // 黄柏 ┆ 栀子
  '贝母微寒', // 滑石 ┆ 贝母
  '枳壳微温', // 枳实 ┆ 枳壳
  '川乌大热', // 附子 ┆ 川乌
  '桂枝小梗', // 肉桂 ┆ 桂枝
  '葶苈辛苦', // 牵牛 ┆ 葶苈
  '漏芦性寒', // 金银花 ┆ 漏芦
  '杏仁温苦', // 桑皮 ┆ 杏仁
  '莱菔根甘', // 竹沥 ┆ 莱菔
  '榧实味甘', // 梨 ┆ 榧实
  '粟壳性涩', // 瓜蒂 ┆ 粟壳
  '蓖麻子辛', // 藜芦 ┆ 蓖麻子
  '石斛味甘', // 山茱萸 ┆ 石斛
  '牛膝味苦', // 菟丝 ┆ 牛膝
  '蛇蜕辟恶', // 花蛇 ┆ 蛇蜕
  '生姜性温', // 童便 ┆ 生姜
  '半夏味辛', // 南星 ┆ 半夏
  '藿香辛温', // 半夏 ┆ 藿香
]

// 无性味标志字的条目（「茯神补心，善镇惊悸」式，药名后直接接功效动词），
// 前缀表兜底提取药名；否则这批条目会被 NAME_RE 漏掉。
const SIBAI_PREFIX_TITLES = [
  '桂枝小梗', '茯神', '沉香', '桑上寄生', '田螺', '蛤蜊肉', '预知子', '看症夜明砂', '人之头发',
  '腽肭脐', '硫黄', '轻粉', '牛肉', '鳖肉', '陈仓谷米', '麻油', '竹茹',
]
// 前缀含上游衍文的，标题勘正并在注里说明
const SIBAI_PREFIX_FIX = {
  桂枝小梗: '桂枝',
  看症夜明砂: '夜明砂',
}

// 标题过吞勘正：NAME_RE 的性味字表含「毒」，「醋消肿毒」会被吞成「醋消肿」，裁回「醋」。
const SIBAI_TITLE_TRIM = {
  醋消肿: '醋',
}

// 缺字药名勘误：仅对「药名不全」的场景给出通行名，韵文原样保留空格占位并标存疑。
const SIBAI_FIX_TITLES = {
  '黄　': '黄芪',
  本: '藁本',
  威灵: '威灵仙',
  '冬葵　子': '冬葵子',
  '萆　': '萆薢',
  '刺　': '刺猬皮',
  身白芍: '白芍',
}

export function parseSibaiwei(raw) {
  const lines = raw
    .replace(/\r/g, '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  // 先按勘误表拆粘连：源行中部出现下一条药的首句（位置 ≥2、且前文已够一条完整条目）时切开
  const lines2 = []
  for (const l of lines) {
    let rest = l
    let changed = true
    while (changed) {
      changed = false
      for (const needle of SIBAI_SPLITS) {
        const i = rest.indexOf(needle)
        if (i >= 2 && rest.slice(0, i).length >= 20) {
          lines2.push(rest.slice(0, i))
          rest = rest.slice(i)
          changed = true
          break
        }
      }
    }
    lines2.push(rest)
  }

  const items = []
  let suspect = 0
  let pendingMeta = []
  let pendingPost = []
  for (const l of lines2) {
    // 书首总括两行、书尾跋四行：四字句韵文，各合并成一条便于背诵
    if (/^(诸药之性|君臣佐使)/.test(l)) {
      pendingMeta.push(l)
      continue
    }
    if (/^(药共四百|汤丸膏散|云林歌括|理加斫削)/.test(l)) {
      pendingPost.push(l)
      continue
    }
    const m = l.match(NAME_RE)
    let title = m ? m[1] : ''
    if (title && SIBAI_TITLE_TRIM[title]) title = SIBAI_TITLE_TRIM[title]
    let prefixFixed = ''
    if (!title) {
      for (const p of SIBAI_PREFIX_TITLES) {
        if (l.startsWith(p)) {
          prefixFixed = p
          title = SIBAI_PREFIX_FIX[p] || p
          break
        }
      }
    }
    if (!title) continue
    let fixed = ''
    if (SIBAI_FIX_TITLES[title]) {
      fixed = title
      title = SIBAI_FIX_TITLES[title]
    }
    const { text, notes } = extractNotes(l)
    // 歌括正文是四字句；残断（粘连切开 / 上游缺文）时字数不再成四的倍数，或有空格占位 → 存疑
    const bare = text.replace(/[。，、；]/g, '')
    const bad = bare.length % 4 !== 0 || /[　]/.test(text)
    if (bad) suspect++
    const fixTag = [
      fixed ? `【原文药名缺字，通行本作「${title}」】` : '',
      prefixFixed && SIBAI_PREFIX_FIX[prefixFixed] ? `【原文药名处疑有衍文「${prefixFixed.replace(SIBAI_PREFIX_FIX[prefixFixed], '')}」】` : '',
    ]
      .filter(Boolean)
      .join('；')
    const tag = bad ? '【存疑：原文此处疑有缺文，以空格标示】' : ''
    items.push({
      group: '药性歌括',
      title,
      verse: text,
      note: [fixTag, tag, ...notes].filter(Boolean).join('；'),
    })
  }
  if (pendingMeta.length) {
    items.unshift({ group: '药性歌括', title: '（总括）', verse: pendingMeta.join(''), note: '' })
  }
  if (pendingPost.length) {
    items.push({ group: '药性歌括', title: '（跋）', verse: pendingPost.join(''), note: '' })
  }
  return { items, suspect }
}

/* ---------------- 打包 ---------------- */

// items 用定长数组（与 poems.json.gz 同思路）：0=书序 1=分组 2=标题 3=韵文 4=夹注/注
function pack(books) {
  const items = []
  books.forEach((b, bi) => {
    for (const it of b.items) items.push([bi, it.group, it.title, it.verse, it.note])
  })
  return {
    v: 1,
    books: books.map((b) => ({ id: b.id, name: b.name, author: b.author, note: b.note || '', n: b.items.length })),
    items,
  }
}

export function unpack(data) {
  const books = data.books.map((b) => ({ ...b, items: [] }))
  for (const [bi, group, title, verse, note] of data.items) {
    books[bi].items.push({ group, title, verse, note })
  }
  return books
}

export function roundTrip(books, data) {
  const back = unpack(data)
  if (back.length !== books.length) throw new Error('自检失败：书数不符')
  let n = 0
  books.forEach((b, i) => {
    if (back[i].items.length !== b.items.length) throw new Error(`自检失败：${b.name} 条数不符`)
    b.items.forEach((it, j) => {
      const o = back[i].items[j]
      for (const k of ['group', 'title', 'verse', 'note']) {
        if (o[k] !== it[k]) throw new Error(`自检失败：${b.name} 第 ${j + 1} 条 ${k} 不符`)
      }
      n++
    })
  })
  return n
}

/* ---------------- 校验（--check，不联网） ---------------- */

const FLOORS = {
  tang: 170,
  mai: 24,
  sibaiwei: 340,
  yaoxingfu: 100,
  sanzijing: 55,
  changsha: 85,
  jinkui: 140,
  shifang: 65,
}

export function checkSnapshot(buf) {
  const data = JSON.parse(gunzipSync(buf).toString('utf8'))
  if (data.v !== 1) throw new Error(`schema 版本异常：${data.v}`)
  const stats = {}
  for (const b of data.books) stats[b.id] = b.n
  const bad = Object.entries(FLOORS).filter(([id, n]) => (stats[id] || 0) < n)
  if (bad.length) throw new Error('分册条数不足：' + bad.map(([id, n]) => `${id} ${stats[id] || 0}<${n}`).join(' / '))
  let chars = 0
  const names = data.books.map((b) => b.name)
  for (const [bi, , title, verse, note] of data.items) {
    if (bi < 0 || bi >= data.books.length) throw new Error(`书序越界：${bi}`)
    if (!title || !verse) throw new Error(`${names[bi]}《${title}》空标题或空韵文`)
    if (!/[\u4e00-\u9fff]/.test(verse)) throw new Error(`${names[bi]}《${title}》韵文无汉字`)
    if (verse.includes('\r') || (note || '').includes('\r')) throw new Error(`${names[bi]}《${title}》含 CR`)
    if (/\\x|KT/.test(verse + note)) throw new Error(`${names[bi]}《${title}》残留上游占位符`)
    chars += verse.length + (note || '').length
  }
  // 八书实测约 22.8 万字，下限卡 20 万，少于此数说明有书没拉到或解析漏段
  if (chars < 200_000) throw new Error(`正文总字数过少：${chars}`)
  return { stats, items: data.items.length, chars, gzip: buf.length }
}

/* ---------------- 主流程 ---------------- */

const BOOK_DEFS = [
  { id: 'tang', name: '汤头歌诀', author: '清·汪昂', file: '084-汤头歌诀.txt', min: 60_000, parse: (bs) => parseJuege(bs, '汤头歌诀') },
  { id: 'mai', name: '濒湖脉学', author: '明·李时珍', file: '506-濒湖脉学.txt', min: 20_000, parse: parseBinhu },
  { id: 'yaoxingfu', name: '珍珠囊补遗药性赋', author: '金·李东垣', file: '045-珍珠囊补遗药性赋.txt', min: 60_000, parse: (bs) => parseYaoxingfu(bs, '珍珠囊补遗药性赋') },
  { id: 'sanzijing', name: '医学三字经', author: '清·陈修园', file: '592-医学三字经.txt', min: 80_000, parse: (bs) => parseSanzijing(bs, '医学三字经') },
  { id: 'changsha', name: '长沙方歌括', author: '清·陈修园', file: '094-长沙方歌括.txt', min: 80_000, parse: parseFangge },
  { id: 'jinkui', name: '金匮方歌括', author: '清·陈念祖', file: '095-金匮方歌括.txt', min: 80_000, parse: parseFangge },
  { id: 'shifang', name: '时方歌括', author: '清·陈修园', file: '093-时方歌括.txt', min: 60_000, parse: (bs) => parseJuege(bs, '时方歌括') },
]

async function main() {
  mkdirSync(join(ROOT, DIR), { recursive: true })
  const outPath = join(ROOT, OUT)

  if (CHECK) {
    if (!existsSync(outPath)) {
      console.error(`✗ 快照不存在：${OUT}（请先运行 node scripts/fetch-tcmchants.mjs）`)
      process.exit(1)
    }
    try {
      const r = checkSnapshot(readFileSync(outPath))
      console.log(`✓ 歌诀库快照校验通过：${r.items} 条 / ${r.chars} 字 / gzip ${(r.gzip / 1024).toFixed(0)} KB`)
      console.log(`  分册：${Object.entries(r.stats).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
    } catch (e) {
      console.error(`✗ 快照校验失败：${e.message}`)
      process.exit(1)
    }
    return
  }

  if (!FORCE && existsSync(outPath)) {
    try {
      const r = checkSnapshot(readFileSync(outPath))
      if (IF_MISSING) {
        console.log(`· 歌诀库快照已存在且有效（${r.items} 条），跳过`)
        return
      }
      console.log(`· 歌诀库快照已存在且有效（${r.items} 条），跳过（--force 可强制重建）`)
      return
    } catch (e) {
      console.log(`· 现有快照无效（${e.message}），重新生成`)
    }
  }

  console.log('· 正在下载七本古籍（GB18030）…')
  const raws = await Promise.all(BOOK_DEFS.map((b) => fetchBook(b.file, b.min)))
  console.log('· 正在下载药性歌括四百味（UTF-8 补源）…')
  const sibaiRaw = await fetchSibaiwei()

  const books = BOOK_DEFS.map((def, i) => ({
    ...def,
    items: def.parse(splitBlocks(raws[i])),
  }))
  const sibai = parseSibaiwei(sibaiRaw)
  books.splice(2, 0, { id: 'sibaiwei', name: '药性歌括四百味', author: '明·龚廷贤', items: sibai.items })

  for (const b of books) {
    if (b.items.length < (FLOORS[b.id] || 1)) {
      throw new Error(`${b.name} 条数异常：${b.items.length} < ${FLOORS[b.id]}`)
    }
  }

  const data = pack(books)
  const n = roundTrip(books, data)
  const gz = gzipSync(Buffer.from(JSON.stringify(data)), { level: 9 })
  if (gz.length > MAX_GZIP) throw new Error(`产物超体积上限：${(gz.length / 1024).toFixed(0)} KB > ${MAX_GZIP / 1024} KB`)
  writeFileSync(outPath, gz)

  const stats = checkSnapshot(gz)
  console.log(`✓ 已生成 ${OUT}`)
  console.log(`  ${n} 条 / ${stats.chars} 字 / 药性歌括存疑 ${sibai.suspect} 条 / gzip ${(gz.length / 1024).toFixed(0)} KB`)
  for (const b of data.books) console.log(`  · ${b.name}（${b.author}）${b.n} 条`)
}

// 被 import 时不触发下载（单测只取解析函数）
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('✗ ' + e.message)
    process.exit(1)
  })
}
