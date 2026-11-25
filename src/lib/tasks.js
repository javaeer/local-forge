// 首页「任务化」入口数据（单数据源）。
// 一级任务只声明精选路由 path（steps），二级分组（children）覆盖其余工序；
// 工序标题 / 图标从 formats.js 反查（其能力字段来自 Tool Registry），
// 不为任务维护第二份工序文案映射，避免与首页卡片文案漂移。
import { TOOLS } from './formats.js'

export const TASKS = [
  {
    id: 'pack',
    icon: 'bi-file-earmark-zip',
    titleKey: 'task.pack.title',
    descKey: 'task.pack.desc',
    steps: [
      '/zip-compress',
      '/archive?mode=extract',
      '/archive?mode=convert&to=zip',
      '/zip-compress?password=1',
    ],
    children: [
      { id: 'pack-create', steps: ['/archive?mode=create&fmt=tar', '/archive?mode=create&fmt=tar.gz', '/archive?mode=merge'] },
      { id: 'pack-extract', steps: ['/zip-extract'] },
      { id: 'pack-split', steps: ['/zip-compress?split=1'] },
      { id: 'pack-secure', steps: ['/password-recovery', '/repair', '/share-files'] },
    ],
  },
  {
    id: 'convert',
    icon: 'bi-arrow-left-right',
    titleKey: 'task.convert.title',
    descKey: 'task.convert.desc',
    steps: [
      '/image-convert',
      '/media-convert',
      '/pdf-tools?mode=compress',
      '/pdf-pro?tab=img2pdf',
    ],
    children: [
      { id: 'convert-image', steps: ['/image-convert?mode=compress', '/image-convert?mode=view', '/app-icon', '/svg-tool'] },
      { id: 'convert-media', steps: ['/media-convert?mode=compress', '/media-convert?mode=zip', '/media-pro?tab=gif', '/media-pro?tab=audio', '/media-pro?tab=frames', '/media-pro?tab=clip', '/media-fetch'] },
      { id: 'convert-doc', steps: ['/pdf-tools?mode=preview', '/pdf-tools?mode=merge', '/pdf-tools?mode=split', '/pdf-pro?tab=pdf2img', '/pdf-pro?tab=stamp', '/pdf-pro?tab=organize'] },
      { id: 'convert-publish', steps: ['/wechat-article', '/text', '/css-reference'] },
    ],
  },
  {
    id: 'extract',
    icon: 'bi-card-text',
    titleKey: 'task.extract.title',
    descKey: 'task.extract.desc',
    steps: [
      '/ocr',
      '/hash',
      '/exif',
      '/ocr?tab=pdf',
    ],
    children: [
      { id: 'extract-ocr', steps: ['/qr-code', '/qr-code?tab=decode', '/qr-code?tab=batch'] },
      { id: 'extract-verify', steps: ['/hash?tab=dup'] },
    ],
  },
  {
    id: 'knowledge',
    icon: 'bi-journal-bookmark',
    titleKey: 'task.knowledge.title',
    descKey: 'task.knowledge.desc',
    steps: [
      '/dictionary',
      '/classics',
      '/poem-meter',
      '/chants',
    ],
    children: [
      { id: 'knowledge-meter', steps: ['/ci-meter'] },
      { id: 'knowledge-tcm', steps: ['/tcmbooks'] },
      { id: 'knowledge-bencao', steps: ['/bencao'] },
    ],
  },
]

// 同一个 to 在 formats.js 中可能出现多次（如 /archive?mode=extract）。
// 取首次出现的工序作为代表，保证任务卡显示的是「多格式解压」这类主入口。
const INDEX = new Map()
for (const g of TOOLS) {
  for (const it of g.items) {
    if (!INDEX.has(it.to)) INDEX.set(it.to, it)
  }
}

// 反查工序标题 / 图标；找不到时返回 null（护栏断言 H/K 保证正常数据不会走到这里）。
export function stepInfo(path) {
  return INDEX.get(path) || null
}

// 路由 steps -> 可渲染的工序信息（保留 to，附 titleKey / icon）。
export function taskSteps(paths) {
  return (paths || []).map((to) => ({
    to,
    ...(INDEX.get(to) || { title: to, icon: 'bi-arrow-right-circle' }),
  }))
}

// 二级分组 -> 可渲染数据（标题走 i18n key，工序与一级同构）。
export function taskChildren(task) {
  return (task.children || []).map((c) => ({
    id: c.id,
    titleKey: `task.child.${c.id}.title`,
    steps: taskSteps(c.steps),
  }))
}

// 工序完整清单（一级 + 二级，去重）：供护栏/自检确认 55 张卡全部覆盖。
export function allTaskPaths() {
  const set = new Set()
  for (const t of TASKS) {
    for (const p of t.steps) set.add(p)
    for (const c of t.children || []) for (const p of c.steps) set.add(p)
  }
  return [...set]
}
