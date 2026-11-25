// 首页「任务化」入口数据（单数据源）。
// 任务只声明路由 path（steps），工序标题 / 图标从 formats.js 反查，
// 不为任务维护第二份 i18n 映射，避免与首页 55 张卡片文案漂移。
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
  },
]

// 同一个 to 在 formats.js 中可能出现多次（如 /archive?mode=extract）。
// 取首次出现的工序作为代表，保证任务卡显示的是「多格式解压」这类主入口，
// 而不是后被覆盖的「提取 DMG/IPSW」等细分项。
const INDEX = new Map()
for (const g of TOOLS) {
  for (const it of g.items) {
    if (!INDEX.has(it.to)) INDEX.set(it.to, it)
  }
}

// 反查工序标题 / 图标；找不到时返回 null（护栏断言 H 保证正常数据不会走到这里）。
export function stepInfo(path) {
  return INDEX.get(path) || null
}

// 任务步骤 -> 可渲染的工序信息（保留 to，附 titleKey / icon）。
export function taskSteps(task) {
  return (task.steps || []).map((to) => ({
    to,
    ...(INDEX.get(to) || { title: to, icon: 'bi-arrow-right-circle' }),
  }))
}
