#!/usr/bin/env node
// 拉取 / 生成《本草纲目》结构化库（中医药经典模块第 6 期数据层）。
//
// 结构探测结论（2026-11 实测，详见 /workspace/本草纲目_结构探测报告.md）：
//   - 源文本 1,987,242 字符，`<目录>→<篇名>→内容：` 三段标签 1921 组无一例外；
//   - 药条 1669（16 部 / 46 卷）+ 序例 252（含「百病主治药」两卷）；
//   - 正文内天然分节：【主治】2794、【气味】1942、【集解】1354、【附方】1292、【释名】1250、【发明】904…
//
// 数据源注意事项（沿用第 5 期，勿凭直觉改动）：
//   - GB18030 编码，必须 TextDecoder('gb18030') 转码；
//   - jsDelivr 超包限额返回 200 + 错误说明文本，体积下限校验是硬要求；
//   - `\x`（4856 处）与 `KT`（246 处）是上游缺字占位符：`\x根`＝缺字+提示字、
//     KT 多为人名书名缺字。处理原则**不猜字**：统一转全角空格，页面注明。
//
// 产物两份（传输格式均为定长数组省体积）：
//   public/tcm/bencao.json.gz        全量（约 2.2MB）：IndexedDB 单文件下载，与 L2 全量库同范式
//   public/tcm/bencao-index.json.gz  目录（<100KB）：随包内嵌，未下载全量也能浏览与检索药名
//
// 用法：
//   node scripts/fetch-bencao.mjs              # 下载并生成
//   node scripts/fetch-bencao.mjs --if-missing # dev / build 钩子：快照有效即跳过
//   node scripts/fetch-bencao.mjs --check      # 只校验现有快照，不联网（CI 用）
//   node scripts/fetch-bencao.mjs --force      # 忽略现有快照，强制重下
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = 'public/tcm'
const OUT_FULL = `${DIR}/bencao.json.gz`
const OUT_INDEX = `${DIR}/bencao-index.json.gz`
const CHECK = process.argv.includes('--check')
const FORCE = process.argv.includes('--force')
const IF_MISSING = process.argv.includes('--if-missing')

// 体积上下限（gzip 后）。实测全量约 2.2MB、索引约 40KB；超限说明解析策略退化，拦下而不是默默发布。
const MIN_GZIP_FULL = 1_600 * 1024
const MAX_GZIP_FULL = 3_200 * 1024
const MIN_GZIP_INDEX = 24 * 1024
const MAX_GZIP_INDEX = 160 * 1024

const MIRRORS = [
  (repo, p) => `https://fastly.jsdelivr.net/gh/${repo}/master/${encodeURI(p)}`,
  (repo, p) => `https://cdn.jsdelivr.net/gh/${repo}/master/${encodeURI(p)}`,
  (repo, p) => `https://ghproxy.net/https://raw.githubusercontent.com/${repo}/master/${encodeURI(p)}`,
  (repo, p) => `https://gh-proxy.com/https://raw.githubusercontent.com/${repo}/master/${encodeURI(p)}`,
  (repo, p) => `https://raw.githubusercontent.com/${repo}/master/${encodeURI(p)}`,
]

const REPO = 'balayuxf/TCM-Ancient-Books'
const SRC_PATH = '013-本草纲目.txt'
const MIN_SOURCE_BYTES = 3_600_000

/* ---------------- 下载 ---------------- */

async function getSource() {
  const errs = []
  for (const mk of MIRRORS) {
    const url = mk(REPO, SRC_PATH)
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(240_000) })
      if (!res.ok) {
        errs.push(`${url} → HTTP ${res.status}`)
        continue
      }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < MIN_SOURCE_BYTES) {
        errs.push(`${url} → 体积 ${buf.length} < ${MIN_SOURCE_BYTES}（疑似截断或限额页）`)
        continue
      }
      console.log(`  ✓ ${url.split('/')[2]} ${buf.length} bytes`)
      return buf
    } catch (e) {
      errs.push(`${url} → ${e.message}`)
    }
  }
  throw new Error(`全部镜像失败：\n  ${errs.join('\n  ')}`)
}

/* ---------------- 解析 ---------------- */

// 目录字符串的形态（107 种去重）：
//   '水部第五卷\水之一'      —— 部内卷，\ 后是目录小类（草之三 / 水之一）
//   '草部卷十四\草之三'      —— 个别卷缺「第」字，原样保留
//   '主治第四卷\百病主治药'  —— 序例里的主治卷（dir 不含「部」，归序例组）
//   ''                       —— 序例条目（原序、凡例、书目等）
function parseBencao(text) {
  const lines = text.split('\n')
  const entries = []
  let dir = ''
  let name = ''
  let body = null
  const flush = () => {
    if (body !== null) {
      entries.push({ dir, name, body: body.join('\n') })
      body = null
    }
  }
  for (const l of lines) {
    if (l.startsWith('<目录>') || l.startsWith('<篇名>')) {
      flush()
      if (l.startsWith('<目录>')) dir = l.slice(4).trim()
      else name = l.slice(4).trim()
    } else if (l.startsWith('内容：')) {
      body = [l.slice(4)]
    } else if (body !== null) {
      body.push(l)
    }
  }
  flush()
  return entries
}

// 缺字占位符 → 全角空格（1:1 保留缺字计数，相邻两个 KT 就是两个缺字）；
// 吸收占位符邻接的半角空格、压掉连续半角空白。**不猜字**。
function cleanBody(s) {
  return s
    .replace(/\\x/g, '　')
    .replace(/KT/g, '　')
    .replace(/ +　/g, '　')
    .replace(/　 +/g, '　')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

// 部名规范化。原书 16 部：水火土金石草木谷菜果木服器虫鳞介禽兽人。
// 上游目录字段有两处不规范，在此归位：
//   - 土部条目挂在「纲目第七卷\土之一」下（纲目第 7 卷即土部）→ 土部；
//   - 卷 9-11 的「石部第九卷\金石之三」是金石部的延续 → 并回金石部；
//   - 「序例上」「主治第X卷\百病主治药」及空目录 → 序例（伪部）。
const BU_YAO = /^(.+?部)/
export function buOf(dir) {
  if (!dir) return '序例'
  const head = dir.split('\\')[0]
  if (head.startsWith('纲目')) return '土部'
  const m = head.match(BU_YAO)
  if (!m) return '序例'
  return m[1] === '石部' ? '金石部' : m[1]
}

// 主治摘要（索引用）：优先【主治】节首句，退而求正文首句；截到 60 字。
function excerptOf(body) {
  const m = body.match(/【主治】([\s\S]{3,}?)(?=\n【|【|$)/)
  let src = m ? m[1] : body
  src = src.replace(/\n/g, '').trim()
  if (!src) return ''
  return src.slice(0, 60)
}

function build(entries) {
  // 药条：目录含「部」（如 水部第五卷\水之一）；其余（序例第一卷\…、主治第四卷\…、空）归序例。
  // 目录段去重表（'' 表示序例）
  const dirs = []
  const dirIdx = new Map()
  for (const e of entries) {
    if (!dirIdx.has(e.dir)) {
      dirIdx.set(e.dir, dirs.length)
      dirs.push(e.dir)
    }
  }

  const items = entries.map((e, i) => [dirIdx.get(e.dir), e.name, cleanBody(e.body), excerptOf(cleanBody(e.body))])
  const buList = []
  const buIdx = new Map()
  for (const d of dirs) {
    const bu = buOf(d)
    if (!buIdx.has(bu)) {
      buIdx.set(bu, buList.length)
      buList.push(bu)
    }
  }
  return { dirs, items, bu: buList }
}

/* ---------------- 断言 ---------------- */

const FLOOR = {
  total: 1900, // 总条目（1921）
  yao: 1700, // 药条（1775 = 16 部，土部 64 条由「纲目第七卷」归位）
  xu: 130, // 序例（146 = 序例上/序例两卷/主治两卷/无目录 19 条）
  zhuZhi: 1500, // 含【主治】（1539）
  qiWei: 1300, // 含【气味】（1369）
  buCount: 16, // 正部数（另有「序例」伪部 = 17）
}

function assertData(data) {
  const { dirs, items } = data
  if (dirs.length > 200) throw new Error(`目录段异常：${dirs.length}`)
  const yaoItems = items.filter(([di]) => buOf(dirs[di] || '') !== '序例')
  const xuCount = items.length - yaoItems.length
  const zhuZhi = yaoItems.filter((it) => it[2].includes('【主治】')).length
  const qiWei = yaoItems.filter((it) => it[2].includes('【气味】')).length
  const stats = { total: items.length, yao: yaoItems.length, xu: xuCount, zhuZhi, qiWei }
  for (const [k, floor] of Object.entries(FLOOR)) {
    if (stats[k] < floor) throw new Error(`${k} 条数不足：${stats[k]} < ${floor}`)
  }
  const bu = [...new Set(dirs.map((d) => buOf(d || '')))]
  if (bu.length !== FLOOR.buCount + 1) throw new Error(`部数异常：${bu.length}（应为 ${FLOOR.buCount} 部 + 序例）：${bu.join('/')}`)
  for (const [di, name, body] of items) {
    if (!name) throw new Error(`第 ${di} 组存在空标题`)
    if (!body || !/[\u4e00-\u9fff]/.test(body)) throw new Error(`《${name}》正文无汉字`)
    if (body.includes('\r')) throw new Error(`《${name}》含 CR`)
    if (/\\x|KT/.test(body)) throw new Error(`《${name}》残留上游占位符`)
  }
  // 首尾锚点（防截断 / 防换源后结构漂移）
  if (!items[0][1].includes('本草纲目')) throw new Error(`首条异常：${items[0][1]}`)
  const last = items[items.length - 1]
  if (buOf(dirs[last[0]] || '') !== '人部') throw new Error(`末条异常：${last[1]} @ ${dirs[last[0]]}`)
  const rs = items.find((it) => it[1] === '人参')
  if (!rs || rs[2].length < 8000 || !rs[2].includes('【释名】') || !rs[2].includes('【主治】')) {
    throw new Error('人参条结构异常（应 ~9900 字，含释名/主治）')
  }
  return stats
}

function assertExcerpt(data) {
  // 全量条目 = [dirIdx, name, body, excerpt]；索引条目 = [dirIdx, name, excerpt]
  const rs = data.items.find((it) => it[1] === '人参')
  const ex = rs ? rs[3] ?? rs[2] : ''
  if (!ex || ex.length < 10) throw new Error('人参主治摘要缺失')
}

/* ---------------- 产物 ---------------- */

function writeIfChanged(file, buf) {
  const out = join(ROOT, file)
  if (existsSync(out)) {
    const old = readFileSync(out)
    if (Buffer.compare(old, buf) === 0) {
      console.log(`  = ${file} 未变化，跳过写入`)
      return false
    }
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, buf)
  console.log(`  ✓ ${file} ${(buf.length / 1024).toFixed(0)} KB`)
  return true
}

function verifySnapshot() {
  const fullBuf = readFileSync(join(ROOT, OUT_FULL))
  const idxBuf = readFileSync(join(ROOT, OUT_INDEX))
  const data = JSON.parse(gunzipSync(fullBuf).toString('utf8'))
  const idx = JSON.parse(gunzipSync(idxBuf).toString('utf8'))
  const stats = assertData(data)
  assertExcerpt(idx)
  if (data.v !== 1) throw new Error(`schema 版本异常：${data.v}`)
  if (idx.v !== 1) throw new Error(`索引 schema 异常：${idx.v}`)
  if (idx.items?.length !== data.items.length) {
    throw new Error(`索引条数与全量不符：${idx.items?.length} ≠ ${data.items.length}`)
  }
  return { fullBuf, idxBuf, data, stats }
}

/* ---------------- main ---------------- */

// main 守卫：被 import 时不触发下载（单测里会 import 本文件的导出函数做解析测试）
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!FORCE && !CHECK && existsSync(join(ROOT, OUT_FULL)) && existsSync(join(ROOT, OUT_INDEX))) {
    try {
      verifySnapshot()
      console.log(`快照已存在且通过校验，跳过（--force 可强制重建）`)
      process.exit(0)
    } catch (e) {
      console.log(`快照校验失败，将重新生成：${e.message}`)
    }
  }

  if (CHECK) {
    const { fullBuf, idxBuf, stats } = verifySnapshot()
    console.log(`✓ 快照校验通过：${stats.total} 条（药条 ${stats.yao} / 序例 ${stats.xu}），全量 ${(fullBuf.length / 1048576).toFixed(2)}MB，索引 ${(idxBuf.length / 1024).toFixed(0)}KB`)
    process.exit(0)
  }

  console.log('下载本草纲目源文本（GB18030, 3.7MB）…')
  const src = await getSource()
  const text = new TextDecoder('gb18030').decode(src)
  console.log(`  解码 ${text.length} 字符`)

  const entries = parseBencao(text)
  console.log(`  解析 ${entries.length} 条`)
  const data = build(entries)
  const stats = assertData(data)
  console.log(`  断言通过：总 ${stats.total} = 药条 ${stats.yao} + 序例 ${stats.xu}；主治 ${stats.zhuZhi} / 气味 ${stats.qiWei}`)

  const built = new Date().toISOString().slice(0, 10)
  const full = { v: 1, built, source: REPO, note: '缺字以上游占位符转全角空格呈现，原文如此，不作推测', dirs: data.dirs, items: data.items }
  // 索引：目录树 + 摘要（不含正文），未下载全量时也可浏览与检索
  const index = { v: 1, built, source: REPO, dirs: data.dirs, bu: data.bu, items: data.items.map(([di, name, , ex]) => [di, name, ex]) }

  const fullBuf = gzipSync(Buffer.from(JSON.stringify(full)))
  const idxBuf = gzipSync(Buffer.from(JSON.stringify(index)))
  if (fullBuf.length < MIN_GZIP_FULL || fullBuf.length > MAX_GZIP_FULL) {
    throw new Error(`全量产物体积异常：${(fullBuf.length / 1048576).toFixed(2)}MB`)
  }
  if (idxBuf.length < MIN_GZIP_INDEX || idxBuf.length > MAX_GZIP_INDEX) {
    throw new Error(`索引产物体积异常：${(idxBuf.length / 1024).toFixed(0)}KB`)
  }

  console.log('往返自检…')
  const back = JSON.parse(gunzipSync(fullBuf).toString('utf8'))
  assertData(back)
  const backIdx = JSON.parse(gunzipSync(idxBuf).toString('utf8'))
  assertExcerpt(backIdx)

  writeIfChanged(OUT_FULL, fullBuf)
  writeIfChanged(OUT_INDEX, idxBuf)
  console.log(`完成：${stats.total} 条（药条 ${stats.yao} / 序例 ${stats.xu}，${data.bu.length - 1} 部 ${data.dirs.length} 目录段），全量 ${(fullBuf.length / 1048576).toFixed(2)}MB，索引 ${(idxBuf.length / 1024).toFixed(0)}KB`)
}

/* 导出：供单元测试直接测解析逻辑（不触发网络） */
export { parseBencao, cleanBody, build, excerptOf, assertData, FLOOR }
