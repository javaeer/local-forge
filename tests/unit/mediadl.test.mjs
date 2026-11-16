// 媒体获取内核（src/lib/mediadl.js）单元测试 —— 纯函数 + 配置持久化。
//
// 覆盖范围刻意不含真实网络拉取与 ffmpeg 合并：
//   · fetchMediaBlob / mergeParts 依赖浏览器 fetch 与 @ffmpeg/ffmpeg 内核，
//     由 _e2e_media_fetch.mjs 在真实浏览器里覆盖；
//   · 本文件只测「无副作用即可判定」的部分，保证 CI 里零网络、零 WASM。
import { test } from 'node:test'
import assert from 'node:assert/strict'

// Node 默认没有 localStorage（22 起为实验特性），这里给内核一个最小实现，
// 使桥接地址的读写逻辑可以在纯 Node 下验证。
const store = new Map()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: (k) => { store.delete(k) },
    clear: () => store.clear(),
  },
})

const { parseUrls, applyBridge, getBridgeUrl, setBridgeUrl, clearBridgeUrl, selfTest } =
  await import('../../src/lib/mediadl.js')

test('parseUrls：多行拆分并去除空行与首尾空白', () => {
  assert.deepEqual(parseUrls('https://a.test/1.ts\nhttps://a.test/2.ts'), [
    'https://a.test/1.ts',
    'https://a.test/2.ts',
  ])
  // 空行 / 纯空白 / 制表符 / CRLF 都要被吃掉
  assert.deepEqual(parseUrls('  https://a.test/1.ts \r\n\n\t\n https://a.test/2.ts  '), [
    'https://a.test/1.ts',
    'https://a.test/2.ts',
  ])
})

test('parseUrls：空输入与纯空白返回空数组', () => {
  assert.deepEqual(parseUrls(''), [])
  assert.deepEqual(parseUrls('   \n\t\n  '), [])
  assert.deepEqual(parseUrls(null), [])
  assert.deepEqual(parseUrls(undefined), [])
})

test('parseUrls：单行也保留原顺序', () => {
  const one = parseUrls('https://a.test/only.mp4')
  assert.equal(one.length, 1)
  assert.equal(one[0], 'https://a.test/only.mp4')
})

test('applyBridge：空桥接时原样返回目标地址（直链模式）', () => {
  assert.equal(applyBridge('', 'https://x.test/a.mp4'), 'https://x.test/a.mp4')
  assert.equal(applyBridge(null, 'https://x.test/a.mp4'), 'https://x.test/a.mp4')
  assert.equal(applyBridge('   ', 'https://x.test/a.mp4'), 'https://x.test/a.mp4')
})

test('applyBridge：{url} 占位符被替换为编码后的目标地址', () => {
  const out = applyBridge('https://p.test/fetch/{url}', 'https://x.test/a b.mp4?k=1&j=2')
  assert.ok(out.startsWith('https://p.test/fetch/'), out)
  assert.ok(out.includes(encodeURIComponent('https://x.test/a b.mp4?k=1&j=2')), out)
  assert.ok(!out.includes('{url}'), '占位符必须被完全替换')
})

test('applyBridge：无占位符时追加 ?url= ；已有查询串则用 &url=', () => {
  assert.equal(
    applyBridge('https://p.test', 'https://x.test/a.mp4'),
    'https://p.test?url=' + encodeURIComponent('https://x.test/a.mp4'),
  )
  assert.equal(
    applyBridge('https://p.test/proxy?token=abc', 'https://x.test/a.mp4'),
    'https://p.test/proxy?token=abc&url=' + encodeURIComponent('https://x.test/a.mp4'),
  )
})

test('桥接地址：写入 / 读取 / 清除', () => {
  store.clear()
  assert.equal(getBridgeUrl(), '', '初始应为空（直链模式）')

  assert.equal(setBridgeUrl('  https://my.proxy/{url}  '), 'https://my.proxy/{url}', '写入时应 trim')
  assert.equal(getBridgeUrl(), 'https://my.proxy/{url}')

  setBridgeUrl('')
  assert.equal(getBridgeUrl(), '', '传空字符串等价于清除')

  setBridgeUrl('https://other.proxy')
  clearBridgeUrl()
  assert.equal(getBridgeUrl(), '')
})

test('桥接地址：localStorage 不可用时降级为空且不抛错', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('SecurityError: 隐私模式') },
  })
  try {
    assert.equal(getBridgeUrl(), '', '读失败应降级为空字符串')
    assert.doesNotThrow(() => setBridgeUrl('https://x.test'))
    assert.doesNotThrow(() => clearBridgeUrl())
  } finally {
    Object.defineProperty(globalThis, 'localStorage', saved)
  }
})

test('selfTest：全部子项通过且不触碰网络与 WASM 内核', async () => {
  store.clear()
  const r = await selfTest()
  assert.equal(r.module, '媒体获取')
  assert.ok(Array.isArray(r.items) && r.items.length >= 4, '至少 4 项自检')
  for (const it of r.items) {
    assert.equal(it.ok, true, `${it.id} 失败：${it.error && it.error.message}`)
  }
  // 合并管线的懒加载项应报告「未触发」，证明 selfTest 不会预载 ffmpeg
  const wiring = r.items.find((i) => i.id === 'media-wiring')
  assert.ok(wiring, '应含 media-wiring 项')
  assert.equal(wiring.detail, '内核按需加载，当前未触发')
})
