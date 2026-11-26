#!/usr/bin/env node
// 拉取 / 更新内置词典数据。词库是「数据」不是「代码」：
// 应当可替换、可校验、可定时更新；仓库不保留快照（public/dict/*.gz 已 gitignore）。
//
// 管辖四份数据：
//   1. cc-cedict.txt.gz   CC-CEDICT 汉英词库（CC BY-SA 4.0，~12 万条）
//   2. ecdict.csv.gz      ECDICT 英汉/英英双解词库（MIT，~77 万条）
//   3. en-ipa-us.txt.gz   英语 IPA 音标·美式（open-dict-data/ipa-dict，MIT）
//   4. en-ipa-uk.txt.gz   英语 IPA 音标·英式（open-dict-data/ipa-dict，MIT）
//
// 用法：
//   node scripts/fetch-dict.mjs                     # 下载全部缺失/无效的文件
//   node scripts/fetch-dict.mjs --only cedict       # 只处理某一份数据
//   node scripts/fetch-dict.mjs --skip ecdict       # 跳过大词库（dev/build 钩子用，避免首装拉 66MB）
//   node scripts/fetch-dict.mjs --check             # 只校验现有快照，不联网（CI 用）
//   node scripts/fetch-dict.mjs --if-missing        # dev / build 钩子用
//
// 校验项（任一失败 → 退出码 1）：
//   1. gzip 能完整解压（截断会抛 unexpected end of file）
//   2. 条数下限
//   3. 抽样字段完整
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCedict, parseEcdict } from '../src/lib/dict.js'

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
    id: 'ecdict',
    out: `${DIR}/ecdict.csv.gz`,
    // ECDICT 主仓库单文件 ~53MB，超出 jsDelivr gh 的 20MB 上限，只能走 raw 源。
    urls: [
      'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv',
      // 单一 raw 源遇瞬时抖动会整批失败（CI 曾因 ECDICT 拉不到而 dictionary e2e 超时）。
      // ghfast 为 raw.githubusercontent 的只读镜像，作为后备；内容校验（min/verify）保证等价。
      'https://ghfast.top/https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv',
    ],
    min: 700000,
    verify(text) {
      const entries = parseEcdict(text)
      const bad = entries.filter((e) => !e.s || !e.d.length)
      if (bad.length) throw new Error(`${bad.length} 条字段不完整，首条：${JSON.stringify(bad[0])}`)
      return { count: entries.length, sample: entries[Math.floor(entries.length / 2)] }
    },
    sampleText(s) { return `${s.s}${s.p ? ' /' + s.p + '/' : ''} ${s.d[0]}` },
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

// 按魔数（1f 8b）自动识别 gzip / 纯文本：CC-CEDICT 源是 .gz，ipa-dict 源是 .txt。
// 统一落盘为 gzip（与 public/dict/*.gz 文件名、浏览器端 maybeGunzip 保持一致）。
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

function verifyBuf(buf, src, label) {
  const text = decodeBuf(buf, label)
  const r = src.verify(text)
  if (r.count < src.min) throw new Error(`${label} 条数异常：${r.count} < ${src.min}`)
  return r
}

async function download(src) {
  let lastErr
  // 每个源最多 3 次尝试：ECDICT 等大文件走公网 raw，瞬时抖动（连接重置/超时）常见，
  // 单次失败即换源可能把所有镜像都浪费在同一波抖动上。短退避后重试更稳。
  const ATTEMPTS = 3
  for (const url of src.urls) {
    for (let i = 1; i <= ATTEMPTS; i++) {
      try {
        console.log(`↓ 下载 ${url}${i > 1 ? `（重试 ${i}/${ATTEMPTS}）` : ''}`)
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
        return Buffer.from(await res.arrayBuffer())
      } catch (e) {
        lastErr = e
        console.log(`  · 源不可用（${e.message}）`)
        if (i < ATTEMPTS) await new Promise((r) => setTimeout(r, 800 * i))
      }
    }
    console.log('  · 换下一个镜像')
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
  console.log(`  收到 ${(buf.length / 1048576).toFixed(2)} MB${isGz(buf) ? '（gzip）' : '（纯文本）'}`)
  const r = verifyBuf(buf, src, '下载结果')
  mkdirSync(dirname(outPath), { recursive: true })
  // 源是纯文本时本地压缩成 gzip 再落盘；源本身是 gz 则原样写入
  const out = isGz(buf) ? buf : gzipSync(Buffer.from(decodeBuf(buf, '下载结果'), 'utf8'), { level: 9 })
  writeFileSync(outPath, out)
  console.log(`✓ 已写入 ${src.out}（${(out.length / 1048576).toFixed(2)} MB）· ${r.count.toLocaleString()} 条 · 抽样 ${src.sampleText(r.sample)}`)
  return true
}

async function main() {
  const only = flag('only')
  let list = only ? SOURCES.filter((s) => s.id === only) : SOURCES
  const skip = flag('skip').split(',').map((x) => x.trim()).filter(Boolean)
  if (has('all')) list = SOURCES
  else if (skip.length && !only) list = list.filter((s) => !skip.includes(s.id))
  if (!list.length) throw new Error(`--only ${only} 不存在，可选：${SOURCES.map((s) => s.id).join(' / ')}`)
  if (has('check')) console.log('校验现有快照（不联网）…')
  for (const src of list) await handle(src)
}

main().catch((e) => {
  console.error('✗ ' + e.message)
  process.exit(1)
})
