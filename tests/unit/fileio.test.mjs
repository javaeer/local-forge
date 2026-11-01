// 文件 IO 工具单测（formatBytes / guardSize 为纯逻辑）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatBytes, guardSize } from '../../src/lib/fileio.js'

test('formatBytes 各量级格式化', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(1048576), '1.0 MB')
  assert.equal(formatBytes(1073741824), '1.00 GB')
})

test('formatBytes 对 NaN / null 返回占位符', () => {
  assert.equal(formatBytes(undefined), '—')
  assert.equal(formatBytes(NaN), '—')
})

test('guardSize 在阈值内放行、超限给提示', () => {
  const ok = guardSize({ size: 100 * 1024 * 1024 }, 200 * 1024 * 1024)
  assert.equal(ok.ok, true)
  const big = guardSize({ size: 8 * 1024 * 1024 * 1024 }, 2 * 1024 * 1024 * 1024)
  assert.equal(big.ok, false)
  assert.ok(big.message && big.message.length)
})
