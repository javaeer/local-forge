// 一致性护栏：静态扫描源码，断言四处数据源互不漂移。
// 零依赖（不 import 业务模块，避免 vue / DOM 环境要求），本地与 CI 均可直接 `node` 运行。
//
// 覆盖的断言：
//   A. NAV 每条必须有 titleKey 与 groupKey（缺 key 会让侧边栏直接显示原始 key 串）
//   B. NAV 的每条路由在 router 的 fileToPath 中存在（导航不死链）
//   C. router 的每个视图都被 SelfTestPanel 的 VIEW_ROUTES 覆盖（渲染冒烟测试不漏）
//   D. TOOLS（首页卡片）的路径在 fileToPath 中存在（首页不死链）
//   E. 所有 i18n key 都能在词条文件里找到（缺 key 会回退成 key 本身）
//   F. CSS 分类名（动态拼接 key）5 语言齐全
//   G. 首页卡片 / 分组（动态拼接 key）5 语言齐全
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const results = []
const check = (id, title, fn) => {
  try {
    const detail = fn()
    results.push({ id, ok: true, title, detail })
  } catch (e) {
    results.push({ id, ok: false, title, error: e.message })
  }
}
const fail = (msg) => { throw new Error(msg) }

const navSrc = read('src/lib/nav.js')
const routerSrc = read('src/router/index.js')
const panelSrc = read('src/components/SelfTestPanel.vue')
const formatsSrc = read('src/lib/formats.js')
const i18nSrcs = ['src/lib/i18n.js', 'src/lib/i18n.dev.js', 'src/lib/i18n.svg.js', 'src/lib/i18n.css.js'].map(read)

// ---------- 解析 ----------
// NAV 条目：逐行抽取（每行一个对象字面量）
const navItems = []
for (const line of navSrc.split('\n')) {
  const m = line.match(/\{\s*path:\s*'([^']+)'/)
  if (!m) continue
  navItems.push({
    path: m[1],
    titleKey: (line.match(/titleKey:\s*'([^']+)'/) || [])[1],
    groupKey: (line.match(/groupKey:\s*'([^']+)'/) || [])[1],
    shortKey: (line.match(/shortKey:\s*'([^']+)'/) || [])[1],
    group: (line.match(/group:\s*'([^']+)'/) || [])[1],
  })
}

// router 的 fileToPath：'File.vue': '/path'
const fileToPath = {}
for (const m of routerSrc.matchAll(/'([A-Za-z0-9_]+\.vue)':\s*'(\/[^']*)'/g)) fileToPath[m[1]] = m[2]
const routerPaths = new Set(Object.values(fileToPath))

// SelfTestPanel 的 VIEW_ROUTES：{ path: '/x', file: 'X.vue' }
const viewRoutes = []
for (const m of panelSrc.matchAll(/\{\s*path:\s*'([^']+)',\s*file:\s*'([^']+)'\s*\}/g)) {
  viewRoutes.push({ path: m[1], file: m[2] })
}

// 首页卡片：to: '/xxx?query'
const cardTos = [...formatsSrc.matchAll(/to:\s*'([^']+)'/g)].map((m) => m[1])

// i18n 词条里出现过的所有 key 名（前面为 { 或 , ，兼容 `nav: { key: 'x' }` 单行写法）
const i18nKeys = new Set()
for (const src of i18nSrcs) {
  for (const m of src.matchAll(/[{,]\s*([A-Za-z][A-Za-z0-9_]*):\s*['"`]/g)) i18nKeys.add(m[1])
}

// 视图里通过 T('...') 使用的 key
// 注意：形如 T('css.cat.' + key) 属「动态拼接」，运行时才确定，跳过（由断言 F 单独守护）
const viewTKeys = new Set()
try {
  for (const f of readdirSync(join(root, 'src/views'))) {
    if (!f.endsWith('.vue')) continue
    const src = read(`src/views/${f}`)
    for (const m of src.matchAll(/\bT\(\s*'([^']+)'(?!\s*\+)/g)) viewTKeys.add(m[1])
  }
} catch { /* 目录不存在则跳过 */ }

// CSS 分类名（CssReference 用 T('css.cat.' + key) 动态拼接，静态扫描抓不到）
const cssCats = (() => {
  try {
    const block = read('src/lib/cssref.js').match(/CATEGORY_ORDER\s*=\s*\[([\s\S]*?)\]/)
    return block ? [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : []
  } catch { return [] }
})()
const cssCatSrc = (() => { try { return read('src/lib/i18n.css.js') } catch { return '' } })()

// 首页卡片 key（formats.js 的 groupKey / titleKey / descKey，与 css.cat 一样是运行时拼接引用）
const cardKeys = [...formatsSrc.matchAll(/(?:groupKey|titleKey|descKey):\s*'([^']+)'/g)].map((m) => m[1])
// 首页词条按语言分文件：i18n.home.zh.js / en / ja / ko / es
const homeSrc = ['zh', 'en', 'ja', 'ko', 'es']
  .map((l) => { try { return read(`src/lib/i18n.home.${l}.js`) } catch { return '' } })
  .join('\n')

// ---------- 断言 ----------
check('parse', '数据源解析', () => {
  if (navItems.length < 20) fail(`NAV 解析过少：${navItems.length}`)
  if (Object.keys(fileToPath).length < 20) fail(`fileToPath 解析过少：${Object.keys(fileToPath).length}`)
  if (viewRoutes.length < 10) fail(`VIEW_ROUTES 解析过少：${viewRoutes.length}`)
  if (cardTos.length < 20) fail(`首页卡片解析过少：${cardTos.length}`)
  return `NAV ${navItems.length} · 视图 ${Object.keys(fileToPath).length} · 冒烟 ${viewRoutes.length} · 卡片 ${cardTos.length}`
})

check('nav-i18n-keys', 'A. NAV 必填 titleKey / groupKey', () => {
  const bad = navItems.filter((n) => !n.titleKey || !n.groupKey)
  if (bad.length) fail('缺 key 的条目：' + bad.map((n) => n.path).join(', '))
  return `${navItems.length} 条路由均已接入 i18n`
})

check('nav-deadlink', 'B. NAV 路由在 router 中存在', () => {
  const bad = navItems.filter((n) => n.path !== '/' && !routerPaths.has(n.path))
  if (bad.length) fail('导航死链：' + bad.map((n) => n.path).join(', '))
  return `${navItems.length} 条导航路径均可达`
})

check('view-smoke-coverage', 'C. router 视图被 VIEW_ROUTES 全覆盖', () => {
  const covered = new Map(viewRoutes.map((v) => [v.file, v.path]))
  const missing = []
  for (const [file, path] of Object.entries(fileToPath)) {
    if (!covered.has(file)) missing.push(`${file}(${path})`)
    else if (covered.get(file) !== path) missing.push(`${file}: 路径不一致 ${covered.get(file)} ≠ ${path}`)
  }
  if (missing.length) fail('未被渲染冒烟覆盖：' + missing.join(', '))
  return `${Object.keys(fileToPath).length} 个视图全部纳入渲染自检`
})

check('card-deadlink', 'D. 首页卡片路径可达', () => {
  const bad = []
  for (const to of cardTos) {
    const p = to.split('?')[0]
    if (!routerPaths.has(p)) bad.push(to)
  }
  if (bad.length) fail('卡片死链：' + bad.join(', '))
  return `${cardTos.length} 张卡片路径均可达`
})

check('i18n-key-exists', 'E. i18n key 均存在', () => {
  const keys = new Set()
  for (const n of navItems) {
    if (n.titleKey) keys.add(n.titleKey)
    if (n.shortKey) keys.add(n.shortKey)
    if (n.groupKey) keys.add(n.groupKey)
  }
  for (const k of viewTKeys) keys.add(k)
  const missing = [...keys].filter((k) => !i18nKeys.has(k.split('.').pop()))
  if (missing.length) fail('词条缺失：' + missing.join(', '))
  return `校验 ${keys.size} 个 key（导航 ${keys.size - viewTKeys.size} + 视图 ${viewTKeys.size}）均存在`
})

check('css-cat-i18n', 'F. CSS 分类名（动态拼接 key）5 语言齐全', () => {
  if (!cssCats.length) fail('未能从 cssref.js 解析 CATEGORY_ORDER')
  const bad = []
  for (const c of cssCats) {
    // 每个分类在每个语言块里都要出现一次（5 语言）
    const n = (cssCatSrc.match(new RegExp(`(?:[{,]|^)\\s*${c}\\s*:\\s*['"\`]`, 'gm')) || []).length
    if (n < 5) bad.push(`${c}(${n}/5)`)
  }
  if (bad.length) fail('分类名缺语言：' + bad.join(', '))
  return `${cssCats.length} 个分类 × 5 语言齐全`
})

check('home-card-i18n', 'G. 首页卡片 / 分组 key 5 语言齐全', () => {
  if (!cardKeys.length) fail('formats.js 未解析到 groupKey / titleKey / descKey')
  const bad = []
  for (const k of cardKeys) {
    const leaf = k.split('.').pop()
    const n = (homeSrc.match(new RegExp(`(?:[{,]|^)\\s*${leaf}\\s*:\\s*['"\`]`, 'gm')) || []).length
    if (n < 5) bad.push(`${k}(${n}/5)`)
  }
  if (bad.length) fail('卡片词条缺语言：' + bad.join(', '))
  return `${cardKeys.length} 个卡片 / 分组 key × 5 语言齐全`
})

// ---------- 报告 ----------
let pass = 0
console.log('=== 一致性护栏 ===')
for (const r of results) {
  console.log(`${r.ok ? '✓ PASS' : '✗ FAIL'} | ${r.id} | ${r.title}${r.ok ? (r.detail ? ' — ' + r.detail : '') : ' — ' + r.error}`)
  if (r.ok) pass++
}
console.log(`\n结果：${pass}/${results.length} 通过`)
process.exit(pass === results.length ? 0 : 1)
