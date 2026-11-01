// 跨工具工作流单测：FLOWS 目标可达 + WF_LABELS 5 语言齐全（暴露 ja/ko/es 缺失的真实缺陷）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FLOWS, WF_LABELS, flowsFrom, stashFiles, takeFiles, consumePending } from '../../src/lib/workflow.js'
import { navByPath } from '../../src/lib/nav.js'

const LANGS = ['zh-CN', 'en', 'ja-JP', 'ko-KR', 'es-ES']

test('FLOWS 的每个「下一步」目标都真实可达（去 query 后在 NAV 中存在）', () => {
  for (const [from, list] of Object.entries(FLOWS)) {
    assert.ok(navByPath(from), `FLOWS 起点不在 NAV：${from}`)
    for (const edge of list) {
      const target = edge.to.split('?')[0]
      assert.ok(navByPath(target), `工作流「${from} → ${edge.to}」目标不可达`)
    }
  }
})

test('WF_LABELS 每个 key 在 5 语言下都有文案', () => {
  for (const [key, map] of Object.entries(WF_LABELS)) {
    for (const loc of LANGS) {
      assert.ok(map[loc], `工作流词条 ${key} 缺语言 ${loc}`)
    }
  }
})

test('flowsFrom 忽略 query 仍命中', () => {
  assert.deepEqual(flowsFrom('/zip-extract?foo=1'), FLOWS['/zip-extract'])
})

test('文件传递：stashFiles → takeFiles 一次性取出并清空', () => {
  const files = [{ name: 'a.zip' }, { name: 'b.png' }]
  stashFiles(files, '/zip-extract')
  // consumePending 取「全部 + 来源」
  const r = consumePending()
  assert.equal(r.from, '/zip-extract')
  assert.equal(r.files.length, 2)
  // 取空后应返回 null
  assert.equal(consumePending(), null)
})
