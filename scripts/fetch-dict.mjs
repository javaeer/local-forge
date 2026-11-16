#!/usr/bin/env node
// 拉取 / 更新内置词典数据（CC-CEDICT，CC BY-SA 4.0）。
//
// 为什么单独成脚本而不把词库塞进 git 历史：词库是「数据」不是「代码」，
// 应当可替换、可校验、可定时更新；仓库只保留一份快照（public/dict/cc-cedict.txt.gz）。
//
// 用法：
//   node scripts/fetch-dict.mjs                     # 下载默认源，写入 public/dict/cc-cedict.txt.gz
//   node scripts/fetch-dict.mjs --url <u> --out <p>
//   node scripts/fetch-dict.mjs --check             # 只校验现有快照，不联网（CI 用）
//
// 校验项（任一失败 → 退出码 1）：
//   1. gzip 能完整解压（截断会抛 unexpected end of file）
//   2. 解析出的词条数 ≥ 100000
//   3. 抽样字段完整（简繁 / 拼音 / 释义）
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCedict } from '../src/lib/dict.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_URL = 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz'
const DEFAULT_OUT = 'public/dict/cc-cedict.txt.gz'
const MIN_ENTRIES = 100000

const args = process.argv.slice(2)
const flag = (n, d = '') => {
  const i = args.indexOf('--' + n)
  return i >= 0 ? (args[i + 1] ?? '') : d
}
const has = (n) => args.includes('--' + n)

function verify(gzBuffer, label) {
  let text
  try {
    text = gunzipSync(gzBuffer).toString('utf8')
  } catch (e) {
    throw new Error(`${label} 不是完整的 gzip：${e.message}（下载多半被截断，重试即可）`)
  }
  const entries = parseCedict(text)
  if (entries.length < MIN_ENTRIES) {
    throw new Error(`${label} 词条数异常：${entries.length} < ${MIN_ENTRIES}`)
  }
  const bad = entries.filter((e) => !e.s || !e.p || !e.d.length)
  if (bad.length) throw new Error(`${label} 有 ${bad.length} 条字段不完整，首条：${JSON.stringify(bad[0])}`)
  const sample = entries[Math.floor(entries.length / 2)]
  return { entries: entries.length, sample }
}

async function main() {
  const outPath = resolve(ROOT, flag('out', DEFAULT_OUT))

  // --if-missing：构建钩子用。快照存在且校验通过就跳过下载，CI / 本地都不重复拉。
  if (has('if-missing') && existsSync(outPath)) {
    try {
      const r = verify(readFileSync(outPath), '快照')
      console.log(`✓ 词库快照已存在且有效（${r.entries.toLocaleString()} 条），跳过下载`)
      return
    } catch (e) {
      console.log(`· 现有快照无效（${e.message}），重新下载…`)
    }
  }

  if (has('check')) {
    if (!existsSync(outPath)) throw new Error(`快照不存在：${outPath}`)
    const r = verify(readFileSync(outPath), '快照')
    console.log(`✓ 快照有效：${r.entries.toLocaleString()} 条 · 抽样 ${r.sample.s} [${r.sample.p}]`)
    return
  }

  const url = flag('url', DEFAULT_URL)
  console.log(`↓ 下载 ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const buf = Buffer.from(await res.arrayBuffer())
  console.log(`  收到 ${(buf.length / 1048576).toFixed(2)} MB`)

  const r = verify(buf, '下载结果')
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, buf)
  console.log(`✓ 已写入 ${outPath}`)
  console.log(`  词条 ${r.entries.toLocaleString()} 条 · 体积 ${(buf.length / 1048576).toFixed(2)} MB`)
  console.log(`  抽样：${r.sample.s}（${r.sample.t}）[${r.sample.p}] ${r.sample.d[0]}`)
}

main().catch((e) => {
  console.error('✗ ' + e.message)
  process.exit(1)
})
