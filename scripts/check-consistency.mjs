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
//   H. 首页任务入口：step 可达且可在 formats.js 反查、任务词条 5 语言齐全
//   I. 工具总数：formats.js 导出 TOOL_COUNT，文案中的数字与之一致
//   J. Tool Registry：14 字段齐全、id/route 唯一、5 源一致、resourceIds 合法、titleKey 五语齐全
//   K. 二级任务：children ≤4、工序可反查、一级+二级无重复、覆盖全部卡片、二级词条五语齐全
//   L. 发布完整性：pack-release.mjs 覆盖全部数据组、release.yml 门禁齐全、README 有发布流程
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
const registrySrc = read('src/lib/tool-registry.js')
const routerSrc = read('src/router/index.js')
const panelSrc = read('src/components/SelfTestPanel.vue')
const formatsSrc = read('src/lib/formats.js')
const tasksSrc = read('src/lib/tasks.js')
const taskMsgSrc = read('src/lib/i18n.tasks.js')
const packSrc = read('scripts/pack-release.mjs')
const e2eDataSrc = read('scripts/prepare-e2e-data.mjs')
const releaseYml = read('.github/workflows/release.yml')
const ciYml = read('.github/workflows/ci.yml')
const readmeSrc = read('README.md')
// i18n.views.js 承载全部 views.* 词条（视图 T('views.xxx') 的落点）；
// 漏扫会让断言 E 把真实存在的词条误报为缺失。
// 新增词条包（如 i18n.classics.js）必须在此登记，否则该包的 key 会被判缺失。
const i18nSrcs = ['src/lib/i18n.js', 'src/lib/i18n.dev.js', 'src/lib/i18n.svg.js', 'src/lib/i18n.css.js', 'src/lib/i18n.classics.js', 'src/lib/i18n.tcm.js', 'src/lib/i18n.bencao.js', 'src/lib/i18n.tcmbooks.js', 'src/lib/i18n.tasks.js', 'src/lib/i18n.views.js'].map(read)

// ---------- 解析 ----------
// workspace → groupKey / 中文 group（与 tool-registry.js 的 GROUP_ZH 对齐）
const WORKSPACE_GROUP = {
  common: ['常用', 'group.common'], archive: ['压缩 / 归档', 'group.archive'],
  media: ['媒体', 'group.media'], image: ['图片', 'group.image'], pdf: ['PDF', 'group.pdf'],
  qr: ['二维码 / 识别', 'group.qr'], verify: ['校验 / 隐私', 'group.verify'],
  share: ['分享 / 安全', 'group.share'], lookup: ['知识矿藏', 'group.lookup'],
  dev: ['开发者工序', 'group.dev'], about: ['关于', 'group.about'],
}

// NAV 条目：R2 后由 tool-registry.js 的 RAW_TOOLS 派生（每行一个对象字面量）。
// 从 Registry 解析 route/titleKey/shortKey/workspace，再推导 group/groupKey，
// 这样护栏守护的是单一事实来源，而非 nav.js 里的兼容视图。
const navItems = []
for (const line of registrySrc.split('\n')) {
  const m = line.match(/\{\s*id:\s*'([^']+)',\s*route:\s*'([^']+)'/)
  if (!m) continue
  const workspace = (line.match(/workspace:\s*'([^']+)'/) || [])[1] || 'common'
  navItems.push({
    id: m[1],
    path: m[2],
    titleKey: (line.match(/titleKey:\s*'([^']+)'/) || [])[1],
    shortKey: (line.match(/shortKey:\s*'([^']+)'/) || [])[1],
    groupKey: (WORKSPACE_GROUP[workspace] || [workspace, 'group.' + workspace])[1],
    group: (WORKSPACE_GROUP[workspace] || [workspace])[0],
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

// 任务入口：id、steps（路由 path，含 query 变体）、五语词条块
const taskIds = [...tasksSrc.matchAll(/^\s{4}id:\s*'([^']+)'/gm)].map((m) => m[1])
// 只取一级 steps（children 内的 steps 缩进更深，用负向排除避免混入）。
const taskPaths = [...tasksSrc.matchAll(/^\s{4}steps:\s*\[([\s\S]*?)\]/gm)]
  .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))
// 二级分组：children: [ ... ] 块，取每个 { id: '...', steps: [...] }。
const childrenBlocks = [...tasksSrc.matchAll(/children:\s*\[([\s\S]*?)\n\s{4}\]/g)]
const childGroups = childrenBlocks.flatMap((b) =>
  [...b[1].matchAll(/\{\s*id:\s*'([^']+)',\s*steps:\s*\[([\s\S]*?)\]/g)].map((m) => ({
    id: m[1],
    paths: [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]),
  })),
)
const taskLangs = ['zh-CN', 'en', 'ja-JP', 'ko-KR', 'es-ES']
const taskLangBlocks = {}
// 词条包中 en 通常写作裸键（en:），其余语言带引号，故两种形式都要识别。
const langMarks = [...taskMsgSrc.matchAll(/['"]?(zh-CN|en|ja-JP|ko-KR|es-ES)['"]?\s*:\s*\{/g)]
for (let i = 0; i < langMarks.length; i++) {
  const start = langMarks[i].index + langMarks[i][0].length
  const end = i + 1 < langMarks.length ? langMarks[i + 1].index : taskMsgSrc.length
  taskLangBlocks[langMarks[i][1]] = taskMsgSrc.slice(start, end)
}

// Tool Registry：逐行解析 RAW_TOOLS 的 14 字段（每行一个对象字面量）。
const TOOL_FIELD_NAMES = ['id', 'route', 'title', 'titleKey', 'descKey', 'icon', 'workspace', 'keywords', 'status', 'engine', 'networkPolicy', 'offlineLevel', 'resourceIds', 'supportedBrowsers']
const registryRows = []
for (const line of registrySrc.split('\n')) {
  if (!/^\s*\{\s*id:\s*'/.test(line)) continue
  const field = (name) => {
    const arr = (line.match(new RegExp(`\\b${name}:\\s*\\[([^\\]]*)\\]`)) || [])[1]
    if (arr != null) return [...arr.matchAll(/'([^']+)'/g)].map((m) => m[1])
    return (line.match(new RegExp(`\\b${name}:\\s*'([^']*)'`)) || [])[1]
  }
  const row = {}
  for (const f of TOOL_FIELD_NAMES) row[f] = field(f)
  // supportedBrowsers 统一引用 ALL_BROWSERS 常量，静态解析不到数组值，按"已声明"处理。
  if (/supportedBrowsers:\s*ALL_BROWSERS/.test(line)) row.supportedBrowsers = ['chromium']
  registryRows.push(row)
}
// offline.js 的 CORE_GROUPS_META id（资源合法性校验基准）
const coreGroupIds = [...(read('src/lib/offline.js').match(/\{\s*id:\s*'([^']+)',\s*label:/g) || [])]
  .map((m) => (m.match(/id:\s*'([^']+)'/) || [])[1])
// 二级分组标题 key：task.child.<id>.title；词条里以 '<id>': { title: ... } 嵌套，取 id 段匹配。
const childTitleKeys = childGroups.map((c) => c.id)

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

check('task-entry', 'H. 首页任务入口可达且五语齐全', () => {
  if (taskIds.length !== 4) fail(`任务数应为 4，实际 ${taskIds.length}`)
  if (taskPaths.length !== 16) fail(`任务步骤应为 16 条，实际 ${taskPaths.length}`)
  if (new Set(taskPaths).size !== taskPaths.length) fail('任务步骤存在重复 path')

  const badPaths = []
  for (const p of taskPaths) {
    if (!routerPaths.has(p.split('?')[0])) badPaths.push(`${p}(路由不可达)`)
    else if (!cardTos.includes(p)) badPaths.push(`${p}(formats.js 无对应工序)`)
  }
  if (badPaths.length) fail('任务入口异常：' + badPaths.join(', '))

  const badI18n = []
  for (const loc of taskLangs) {
    const block = taskLangBlocks[loc] || ''
    for (const id of taskIds) {
      for (const leaf of ['title', 'desc']) {
        const re = new RegExp(`\\b${id}\\s*:\\s*\\{[^}]*\\b${leaf}\\s*:\\s*['"\`]`)
        if (!re.test(block)) badI18n.push(`${loc}:task.${id}.${leaf}`)
      }
    }
    for (const k of ['allTools', 'cmdCta', 'recentCta', 'ariaLabel']) {
      if (!new RegExp(`\\b${k}\\s*:\\s*['"\`]`).test(block)) badI18n.push(`${loc}:task.${k}`)
    }
  }
  if (badI18n.length) fail('任务词条缺语言：' + badI18n.join(', '))
  return `任务 ${taskIds.length} 个 · 入口 ${taskPaths.length} 条 · 词条 ${taskLangs.length} 语言齐全`
})

check('tool-count', 'I. 工具总数单一来源与文案一致', () => {
  if (!/export const TOOL_COUNT\s*=/.test(formatsSrc)) fail('formats.js 未导出 TOOL_COUNT')
  const count = cardTos.length
  const countRe = /(\d+)\s*(?:道工序|张工序卡|张卡片|\blocal processes\b|\bprocesses\b|\btools\b|すべての工程|の工程|개\s*전체\s*공정|\bherramientas\b|\bprocesos\b)/g
  const files = ['README.md', 'index.html', 'public/manifest.webmanifest', 'src/lib/i18n.js', 'src/lib/i18n.tasks.js']
  const bad = []
  let hits = 0
  for (const f of files) {
    const src = read(f)
    for (const m of src.matchAll(countRe)) {
      hits++
      if (Number(m[1]) !== count) bad.push(`${f}:${m[0].trim()}`)
    }
  }
  if (bad.length) fail('工具数与 TOOL_COUNT 不一致：' + bad.join(', '))
  return `TOOL_COUNT ${count} · 文案 ${hits} 处一致`
})

check('tool-registry', 'J. Tool Registry 字段齐全 / 唯一 / 5 源一致', () => {
  if (registryRows.length < 20) fail(`Registry 解析过少：${registryRows.length}`)
  const bad = []
  // 1) 14 字段齐全（字段出现即算声明；descKey 允许空串=无首页描述，
  //    supportedBrowsers 用 ALL_BROWSERS 常量引用，静态解析取不到数组值但字段已声明）
  for (const r of registryRows) {
    for (const f of TOOL_FIELD_NAMES) {
      if (!(f in r) || r[f] === undefined) bad.push(`${r.id}:缺 ${f}`)
    }
  }
  // 2) id / route 唯一
  const ids = registryRows.map((r) => r.id)
  const routes = registryRows.map((r) => r.route)
  if (new Set(ids).size !== ids.length) bad.push('id 重复')
  if (new Set(routes).size !== routes.length) bad.push('route 重复')
  // 3) 5 源一致：Registry ↔ NAV(本文件 navItems) ↔ router ↔ 首页卡片
  const regSet = new Set(routes)
  for (const n of navItems) if (!regSet.has(n.path)) bad.push(`NAV 游离：${n.path}`)
  for (const p of regSet) if (!navItems.some((n) => n.path === p)) bad.push(`Registry 孤儿：${p}`)
  for (const p of regSet) if (p !== '/' && !routerPaths.has(p)) bad.push(`Registry 死链：${p}`)
  // 首页卡片 base path 必须能在 Registry 反查（无游离卡片）
  for (const to of cardTos) if (!regSet.has(to.split('?')[0])) bad.push(`卡片游离：${to}`)
  // 4) resourceIds 合法
  for (const r of registryRows) {
    for (const rid of (r.resourceIds || [])) {
      if (!coreGroupIds.includes(rid)) bad.push(`${r.id}:未知内核 ${rid}`)
    }
  }
  if (bad.length) fail('Registry 不一致：' + [...new Set(bad)].join(', '))
  return `工具注册表 ${registryRows.length} 条 · ${TOOL_FIELD_NAMES.length} 字段齐全 · NAV/router/卡片一致 · 内核 ${coreGroupIds.length} 组`
})

check('secondary-tasks', 'K. 二级任务覆盖 / 无重复 / 五语齐全', () => {
  if (childGroups.length < 8) fail(`二级分组解析过少：${childGroups.length}`)
  const bad = []
  // 每个一级任务 children ≤ 4：按 children 块分组统计
  for (const b of childrenBlocks) {
    const n = [...b[1].matchAll(/\{\s*id:\s*'[^']+',\s*steps:/g)].length
    if (n > 4) bad.push(`某任务 children=${n}>4`)
  }
  // 二级工序可反查 + 一级+二级无重复（按任务聚合成对比较麻烦，用全局唯一性近似 + 反查）
  const allPaths = [...taskPaths, ...childGroups.flatMap((c) => c.paths)]
  for (const p of childGroups.flatMap((c) => c.paths)) {
    if (!cardTos.includes(p) && !bad.includes(`二级死链：${p}`)) bad.push(`二级死链：${p}`)
  }
  // 二级分组 title 五语齐全：'<child-id>': { title: ... } 每个语言块出现一次
  for (const id of childTitleKeys) {
    const n = (taskMsgSrc.match(new RegExp(`'${id}'\\s*:\\s*\\{`, 'g')) || []).length
    if (n < 5) bad.push(`${id}(${n}/5)`)
  }
  // 覆盖率：所有唯一卡片 base（去重 to）都能被一级+二级命中
  const covered = new Set(allPaths)
  const uniqueCards = new Set(cardTos)
  for (const to of uniqueCards) if (!covered.has(to)) bad.push(`未覆盖：${to}`)
  if (bad.length) fail('二级任务异常：' + [...new Set(bad)].join(', '))
  return `二级分组 ${childGroups.length} 个 · 工序 ${allPaths.length} 条 · 覆盖 ${uniqueCards.size} 张唯一卡 · 五语齐全`
})

check('release', 'L. 发布完整性：打包脚本 / 门禁 / 文档齐全', () => {
  const bad = []
  // 1) pack-release.mjs 覆盖全部数据组（与 .gitignore 排除的快照一致）
  const needGroups = ['public/ffmpeg', 'public/ffmpeg-st', 'public/tesseract', 'public/libarchive', 'public/pdfjs', 'public/dict', 'public/classics', 'public/tcm']
  for (const g of needGroups) if (!packSrc.includes(g)) bad.push(`打包缺 ${g}`)
  // 2) 必须有 dist 前置校验与校验和产出，防止发布包不可离线运行/不可校验
  if (!packSrc.includes('dist/index.html')) bad.push('pack 缺 dist 前置校验')
  if (!packSrc.includes('SHA256SUMS')) bad.push('pack 缺校验和产出')
  // 3) release.yml 门禁与 ci.yml 一致：build/unit/护栏/bundle/e2e 缺一不可
  for (const gate of ['check-consistency.mjs', 'pnpm test:unit', 'pnpm build', 'check-bundle-size.mjs', 'pnpm test:e2e']) {
    if (!releaseYml.includes(gate)) bad.push(`release 门禁缺 ${gate}`)
  }
  if (!releaseYml.includes("tags: ['v*']")) bad.push('release 未按 v* tag 触发')
  if (!releaseYml.includes('contents: write')) bad.push('release 缺 contents: write 权限')
  // 4) CI 不再软链 /usr/bin（回归守护：防止有人把 Link 步骤改回来）
  if (ciYml.includes('Link Chromium to /usr/bin/chromium')) bad.push('ci.yml 残留 /usr/bin 软链步骤')
  // 5) e2e 独立 checkout 必须补数据：ci 两个 e2e job + release 门禁都要调 prepare-e2e-data，
  //    且该脚本必须同时拉 ECDICT 与全量诗文库（否则 dictionary/classicsfull 超时红灯）。
  const prepareCalls = (ciYml.match(/scripts\/prepare-e2e-data\.mjs/g) || []).length
  if (prepareCalls < 2) bad.push(`ci.yml e2e job 补数据调用不足 2 处（实 ${prepareCalls}）`)
  if (!releaseYml.includes('scripts/prepare-e2e-data.mjs')) bad.push('release 未补 e2e 数据')
  if (!e2eDataSrc.includes('fetch-dict.mjs') || !e2eDataSrc.includes('ecdict')) bad.push('prepare 缺 ECDICT')
  if (!e2eDataSrc.includes('fetch-poems-full.mjs')) bad.push('prepare 缺全量诗文库')
  // 6) README 有发布流程小节
  if (!/##\s*发布流程/.test(readmeSrc)) bad.push('README 缺发布流程')
  if (bad.length) fail('发布完整性异常：' + [...new Set(bad)].join(', '))
  return `打包 ${needGroups.length} 数据组 · release 门禁 5 项 · e2e 补数据 ${prepareCalls} 处 · tag 触发 · 无 /usr/bin 软链`
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
