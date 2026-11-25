// 可恢复任务单测：白名单序列化、TTL、8KB 上限、权限降级、一键清空、最近使用分离。
import { test } from 'node:test'
import assert from 'node:assert/strict'

// Node 无 localStorage：用内存实现替代，供 resume.js 读写。
function installLS() {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  }
  return store
}
installLS()

const mod = await import('../../src/lib/resume.js')
const {
  saveResume, getResume, listResume, hasResume, updateProgress, clearResume,
  safeHandleRef, isSerializable, TTL_DAYS, MAX_SETTINGS_BYTES, LS_KEY,
} = mod

function reset() { try { localStorage.removeItem(LS_KEY) } catch {} }

test('schema：保存后可反查、字段齐全', () => {
  reset()
  assert.equal(saveResume({ toolId: '/zip-compress', route: '/zip-compress', settings: { level: 6 } }), true)
  const r = getResume('/zip-compress')
  assert.ok(r)
  for (const f of ['id', 'toolId', 'route', 'settings', 'createdAt', 'updatedAt', 'progress', 'fileHandleRef', 'downloadRef', 'ttlDays']) {
    assert.ok(f in r, `缺字段 ${f}`)
  }
  assert.equal(r.settings.level, 6)
  assert.equal(r.ttlDays, 7)
  assert.equal(TTL_DAYS, 7)
})

test('绝不写 File / Blob / ArrayBuffer：非法值被剔除，合法值保留', () => {
  assert.equal(isSerializable({ level: 6, name: 'x', ok: true, none: null }), true)
  assert.equal(isSerializable(new Blob(['x'])), false)
  assert.equal(isSerializable(new ArrayBuffer(8)), false)
  assert.equal(isSerializable(() => {}), false)
  reset()
  const fakeFile = (typeof File !== 'undefined') ? new File(['x'], 'a.txt') : { bad: true }
  saveResume({
    toolId: '/ocr', route: '/ocr',
    settings: { lang: 'eng', badFile: fakeFile, nested: { keep: 1, drop: new Blob(['y']) } },
  })
  const s = getResume('/ocr').settings
  assert.equal(s.lang, 'eng')
  assert.ok(!('badFile' in s), 'File 不应被写入')
  assert.equal(s.nested.keep, 1)
  assert.ok(!('drop' in s.nested), 'Blob 不应被写入')
})

test('8KB 上限：超限 settings 拒绝写入', () => {
  reset()
  const huge = { blob: 'x'.repeat(MAX_SETTINGS_BYTES) }
  assert.equal(saveResume({ toolId: '/big', route: '/big', settings: huge }), false)
  assert.equal(getResume('/big'), null)
})

test('TTL 过期：7 天前的记录读取时自动过滤', () => {
  reset()
  const list = [{
    id: 'old', toolId: '/old', route: '/old', settings: {}, createdAt: Date.now() - 8 * 86400000,
    updatedAt: Date.now() - 8 * 86400000, progress: 0, ttlDays: 7,
  }]
  localStorage.setItem(LS_KEY, JSON.stringify(list))
  assert.equal(getResume('/old'), null)
  assert.equal(listResume().length, 0)
})

test('同一工具只保留最新一条快照', () => {
  reset()
  saveResume({ toolId: '/image-convert', route: '/image-convert', settings: { quality: 0.5 } })
  saveResume({ toolId: '/image-convert', route: '/image-convert', settings: { quality: 0.9 } })
  assert.equal(listResume().filter((r) => r.toolId === '/image-convert').length, 1)
  assert.equal(getResume('/image-convert').settings.quality, 0.9)
})

test('progress 仅在 0..1 内写入，updateProgress 可更新', () => {
  reset()
  saveResume({ toolId: '/t', route: '/t', settings: {}, progress: 2 })
  assert.equal(getResume('/t').progress, 0, '越界 progress 归零')
  assert.equal(updateProgress('/t', 0.42), true)
  assert.equal(getResume('/t').progress, 0.42)
})

test('safeHandleRef：权限非 granted 时降级为 null，不抛错', async () => {
  assert.equal(await safeHandleRef(null), null)
  assert.equal(await safeHandleRef({ queryPermission: async () => 'denied' }), null)
  assert.equal(await safeHandleRef({ queryPermission: async () => 'granted' }).then((h) => !!h), true)
  assert.equal(await safeHandleRef({ queryPermission: async () => { throw new Error('x') } }), null)
  assert.equal(await safeHandleRef({ noPermissionApi: true }), null)
})

test('一键清空：clearResume 清空全部，且 hasResume 归零', () => {
  reset()
  saveResume({ toolId: '/a', route: '/a', settings: {} })
  saveResume({ toolId: '/b', route: '/b', settings: {} })
  assert.equal(hasResume('/a'), true)
  clearResume()
  assert.equal(listResume().length, 0)
  assert.equal(hasResume('/a'), false)
  assert.equal(hasResume('/b'), false)
})
