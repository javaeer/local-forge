#!/usr/bin/env node
// 拉取 / 更新内置词典数据。词库是「数据」不是「代码」：
// 应当可替换、可校验、可定时更新；仓库不保留快照（public/dict/*.gz 已 gitignore）。
//
// 管辖三份数据：
//   1. cc-cedict.txt.gz   CC-CEDICT 汉英词库（CC BY-SA 4.0，~12 万条）
//   2. en-ipa-us.txt.gz   英语 IPA 音标·美式（open-dict-data/ipa-dict，MIT）
//   3. en-ipa-uk.txt.gz   英语 IPA 音标·英式（open-dict-data/ipa-dict，MIT）
//
// 用法：
//   node scripts/fetch-dict.mjs                     # 下载全部缺失/无效的文件
//   node scripts/fetch-dict.mjs --only cedict       # 只处理某一份数据
//   node scripts/fetch-dict.mjs --check             # 只校验现有快照，不联网（CI 用）
//   node scripts/fetch-dict.mjs --if-missing        # dev / build 钩子用
//
// 校验项（任一失败 → 退出码 1）：
//   1. gzip 能完整解压（截断会抛 unexpected end of file）
//   2. 条数下限
//   3. 抽样字段完整
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCedict } from '../src/lib/dict.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = 'public/dict'

// 每份数据：文件名 / 多个镜像源（依序尝试）/ 条数下限 / 校验函数
const SOURCES = [
  {
    id: 'cedict',
    out: `${DIR}/cc-cedict.txt.gz`,
    urls: [
      'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz',
      'https://cc-cedict.org/editor/download.php?file=cedict_1_0_ts_utf-8_mdbg.txt.gz',
    ],
    min: 100000,
    verify(text) {
      const entries = parseCedict(text)
      const bad = entries.filter((e) => !e.s || !e.p || !e.d.length)
      if (bad.length) throw new Error(`${bad.length} 条字段不完整，首条：${JSON.stringify(bad[0])}`)
      return { count: entries.length, sample: entries[Math.floor(entries.length / 2)] }
    },
    sampleText(s) { return `${s.s}（${s.t}）[${s.p}] ${s.d[0]}` },
  },
  {
    id: 'ipa-us',
    out: `${DIR}/en-ipa-us.txt.gz`,
    urls: [
      'https://fastly.jsdelivr.net/gh/open-dict-data/ipa-dict@master/data/en_US.txt',
      'https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/en_US.txt',
    ],
    min: 100000,
    verify: verifyIpa,
    sampleText(s) { return `${s.w} /${s.ipa[0]}/` },
  },
  {
    id: 'ipa-uk',
    out: `${DIR}/en-ipa-uk.txt.gz`,
    urls: [
      'https://fastly.jsdelivr.net/gh/open-dict-data/ipa-dict@master/data/en_UK.txt',
      'https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/en_UK.txt',
    ],
    min: 50000,
    verify: verifyIpa,
    sampleText(s) { return `${s.w} /${s.ipa[0]}/` },
  },
]

// ipa-dict 行格式：word\t/ipa1/, /ipa2/
function verifyIpa(text) {
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
  const bad = lines.filter((l) => !/^[^\t]+\t\/.+\//.test(l))
  if (bad.length > lines.length * 0.01) throw new Error(`${bad.length} 行不符合 word⇥/ipa/ 格式`)
  const mid = lines[Math.floor(lines.length / 2)].split('\t')
  return { count: lines.length, sample: { w: mid[0], ipa: [mid[1].replace(/,\s*$/, '')] } }
}

const args = process.argv.slice(2)
const flag = (n, d = '') => {
  const i = args.indexOf('--' + n)
  return i >= 0 ? (args[i + 1] ?? '') : d
}
const has = (n) => args.includes('--' + n)

function verifyBuf(buf, src, label) {
  let text
  try {
    text = gunzipSync(buf).toString('utf8')
  } catch (e) {
    throw new Error(`${label} 不是完整的 gzip：${e.message}（下载多半被截断，重试即可）`)
  }
  const r = src.verify(text)
  if (r.count < src.min) throw new Error(`${label} 条数异常：${r.count} < ${src.min}`)
  return r
}

async function download(src) {
  let lastErr
  for (const url of src.urls) {
    try {
      console.log(`↓ 下载 ${url}`)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (e) {
      lastErr = e
      console.log(`  · 源不可用（${e.message}），换下一个镜像`)
    }
  }
  throw lastErr
}

async function handle(src) {
  const outPath = resolve(ROOT, src.out)

  if (existsSync(outPath)) {
    try {
      const r = verifyBuf(readFileSync(outPath), src, '快照')
      console.log(`✓ ${src.id} 快照有效（${r.count.toLocaleString()} 条），跳过`)
      return true
    } catch (e) {
      console.log(`· ${src.id} 现有快照无效（${e.message}），重新下载…`)
    }
  } else if (has('check') || has('if-missing')) {
    // --if-missing 遇缺即补；--check 只验不下载，直接报错
    if (has('check')) throw new Error(`快照不存在：${src.out}`)
  }

  if (has('check')) return true

  const buf = await download(src)
  console.log(`  收到 ${(buf.length / 1048576).toFixed(2)} MB`)
  const r = verifyBuf(buf, src, '下载结果')
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, buf)
  console.log(`✓ 已写入 ${src.out} · ${r.count.toLocaleString()} 条 · 抽样 ${src.sampleText(r.sample)}`)
  return true
}

async function main() {
  const only = flag('only')
  const list = only ? SOURCES.filter((s) => s.id === only) : SOURCES
  if (!list.length) throw new Error(`--only ${only} 不存在，可选：${SOURCES.map((s) => s.id).join(' / ')}`)
  if (has('check')) console.log('校验现有快照（不联网）…')
  for (const src of list) await handle(src)
}

main().catch((e) => {
  console.error('✗ ' + e.message)
  process.exit(1)
})
