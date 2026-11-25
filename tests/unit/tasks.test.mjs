// 首页任务入口单测：数据层完整性、工序反查、无重复、五语词条。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TASKS, stepInfo, taskSteps, taskChildren, allTaskPaths } from '../../src/lib/tasks.js'
import { TOOLS, TOOL_COUNT } from '../../src/lib/formats.js'
import { APP_COMMANDS_KEY } from '../../src/lib/app-commands.js'
import { T } from '../../src/lib/i18n.dev.js'
import { locale } from '../../src/lib/i18n.js'

const LANGS = ['zh-CN', 'en', 'ja-JP', 'ko-KR', 'es-ES']

test('首页任务为 4 个固定入口，每个至少 3 道工序', () => {
  assert.equal(TASKS.length, 4)
  assert.deepEqual(TASKS.map((t) => t.id), ['pack', 'convert', 'extract', 'knowledge'])
  for (const task of TASKS) {
    assert.ok(task.steps.length >= 3, `${task.id} 工序过少`)
    assert.ok(task.titleKey && task.descKey && task.icon, `${task.id} 缺展示字段`)
  }
})

test('16 条任务工序全部可在 formats.js 反查到标题与图标', () => {
  const cardTos = new Set(TOOLS.flatMap((g) => g.items.map((it) => it.to)))
  const paths = []
  for (const task of TASKS) {
    for (const to of task.steps) {
      const info = stepInfo(to)
      assert.ok(info, `工序无法反查：${to}`)
      assert.ok(info.titleKey, `工序缺 titleKey：${to}`)
      assert.ok(info.icon, `工序缺 icon：${to}`)
      assert.ok(cardTos.has(to), `工序不在 ${TOOL_COUNT} 张卡片内：${to}`)
      paths.push(to)
    }
  }
  assert.equal(paths.length, 16)
})

test('任务工序无重复，且路由可达（query 变体按 path 查）', () => {
  const all = TASKS.flatMap((t) => t.steps)
  assert.equal(new Set(all).size, all.length)
  for (const to of all) assert.ok(to.startsWith('/'), `非法路由：${to}`)
})

test('taskSteps 保留原路由并携带可渲染的标题 key', () => {
  for (const task of TASKS) {
    const steps = taskSteps(task.steps)
    assert.equal(steps.length, task.steps.length)
    for (const s of steps) {
      assert.ok(s.to)
      assert.ok(s.titleKey)
      assert.ok(s.icon)
    }
  }
})

test('二级任务：每组 ≤4、工序可在 formats 反查、一级+二级无重复', () => {
  for (const task of TASKS) {
    const children = task.children || []
    assert.ok(children.length <= 4, `${task.id} 二级分组超过 4：${children.length}`)
    const all = [...task.steps]
    for (const c of children) {
      const rendered = taskChildren(task).find((x) => x.id === c.id)
      assert.ok(rendered.titleKey, `${c.id} 缺标题 key`)
      assert.ok(rendered.steps.length > 0, `${c.id} 无工序`)
      for (const s of rendered.steps) {
        assert.ok(stepInfo(s.to), `${c.id} 工序无法反查：${s.to}`)
        assert.ok(s.titleKey && s.icon, `${c.id} 工序缺展示字段：${s.to}`)
        all.push(s.to)
      }
    }
    assert.equal(new Set(all).size, all.length, `${task.id} 一级+二级存在重复工序`)
  }
})

test('二级任务覆盖首页全部唯一工序，无遗漏无死链', () => {
  const cards = new Set(TOOLS.flatMap((g) => g.items.map((i) => i.to)))
  const paths = allTaskPaths()
  assert.equal(new Set(paths).size, paths.length, '任务清单存在重复')
  const notCovered = [...cards].filter((c) => !paths.includes(c))
  const dead = paths.filter((p) => !cards.has(p))
  assert.deepEqual(notCovered, [], `未被任务覆盖的卡片：${notCovered.join(', ')}`)
  assert.deepEqual(dead, [], `任务死链：${dead.join(', ')}`)
})

test('二级分组标题五语齐全', () => {
  const keys = TASKS.flatMap((t) => taskChildren(t).map((c) => c.titleKey))
  assert.ok(keys.length > 0)
  try {
    for (const loc of LANGS) {
      locale.value = loc
      for (const k of keys) assert.ok(T(k) && T(k) !== k, `${loc} 缺二级词条：${k}`)
    }
  } finally {
    locale.value = 'zh-CN'
  }
})

test('任务描述五语非空且不与任务标题重复', () => {
  const pairs = [
    ['task.pack.title', 'task.pack.desc'],
    ['task.convert.title', 'task.convert.desc'],
    ['task.extract.title', 'task.extract.desc'],
    ['task.knowledge.title', 'task.knowledge.desc'],
  ]
  try {
    for (const loc of LANGS) {
      locale.value = loc
      for (const [titleKey, descKey] of pairs) {
        const title = T(titleKey)
        const desc = T(descKey)
        assert.ok(desc.length > 0, `${loc} 描述为空：${descKey}`)
        assert.notEqual(desc, title, `${loc} 描述与标题重复：${descKey}`)
      }
    }
  } finally {
    locale.value = 'zh-CN'
  }
})

test('全局命令总线使用 Symbol key，避免字符串 key 碰撞', () => {
  assert.equal(typeof APP_COMMANDS_KEY, 'symbol')
  assert.notEqual(APP_COMMANDS_KEY, Symbol('appCommands'))
})

test('任务词条五语齐全，切换语言不泄漏原始 key', () => {
  const keys = [
    'task.pack.title', 'task.pack.desc',
    'task.convert.title', 'task.convert.desc',
    'task.extract.title', 'task.extract.desc',
    'task.knowledge.title', 'task.knowledge.desc',
    'task.allTools', 'task.cmdCta', 'task.recentCta',
  ]
  try {
    for (const loc of LANGS) {
      locale.value = loc
      const missing = keys.filter((k) => !T(k) || T(k) === k)
      assert.deepEqual(missing, [], `${loc} 缺任务词条：${missing.join(', ')}`)
    }
  } finally {
    locale.value = 'zh-CN'
  }
})
