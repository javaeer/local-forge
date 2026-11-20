// 静态数据加载层回归：静态托管的 SPA 回退页不能被当成 JSON。
// 截图里的 `Unexpected token '<', "<!doctype "... is not valid JSON`
// 就是 200 HTML 直接进 JSON.parse 造成的，这里把诊断链锁死。
import test from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { fetchGzJson, parseGzJson } from '../../src/lib/gzjson.js'

const CMD = 'npm run poems-full:fetch'
const LABEL = '全量库索引'
const URL = '/classics/full-index.json.gz'
const HTML = '<!doctype html><html><head><title>LocalForge</title></head><body>首页</body></html>'

function res(body, { status = 200, contentType = 'application/gzip' } = {}) {
  return new Response(body, { status, headers: { 'content-type': contentType } })
}

async function stubFetch(fn, run) {
  const orig = globalThis.fetch
  globalThis.fetch = fn
  try {
    await run()
  } finally {
    globalThis.fetch = orig
  }
}

test('parseGzJson：gzip 数据正常解析', async () => {
  const payload = { v: 1, shards: 2 }
  const buf = gzipSync(Buffer.from(JSON.stringify(payload)))
  assert.deepEqual(await parseGzJson(buf, { label: LABEL, cmd: CMD }), payload)
})

test('parseGzJson：服务器已解压的明文 JSON 也正常解析', async () => {
  const payload = { v: 1, shards: 2 }
  assert.deepEqual(
    await parseGzJson(Buffer.from(JSON.stringify(payload)), { label: LABEL, cmd: CMD }),
    payload,
  )
})

test('fetchGzJson：200 HTML（SPA 回退）报“未发布”，不漏原始 JSON 语法错', async () => {
  await stubFetch(async () => res(HTML, { contentType: 'text/html' }), async () => {
    await assert.rejects(
      () => fetchGzJson('classics/full-index.json.gz', { cmd: CMD, label: LABEL }),
      (e) => {
        assert.match(e.message, /未随本次构建发布/)
        assert.match(e.message, /classics\/full-index\.json\.gz/)
        assert.match(e.message, /npm run poems-full:fetch/)
        assert.doesNotMatch(e.message, /Unexpected token/)
        return true
      },
    )
  })
})

test('fetchGzJson：body 是 HTML 但 content-type 标错也能识别', async () => {
  await stubFetch(async () => res('  \n' + HTML, { contentType: 'application/octet-stream' }), async () => {
    await assert.rejects(
      () => fetchGzJson('classics/full/s0.json.gz', { cmd: CMD, label: '全量库分片 s0' }),
      /未随本次构建发布/,
    )
  })
})

test('fetchGzJson：404 同时提示生成命令与部署动作', async () => {
  await stubFetch(async () => res('', { status: 404, contentType: 'text/plain' }), async () => {
    await assert.rejects(
      () => fetchGzJson('classics/full-index.json.gz', { cmd: CMD, label: LABEL }),
      (e) => {
        assert.match(e.message, /数据不存在/)
        assert.match(e.message, /npm run poems-full:fetch/)
        assert.match(e.message, /随站点发布/)
        return true
      },
    )
  })
})

test('fetchGzJson：真损坏的 JSON 提示重跑快照，不误报成“未发布”', async () => {
  await stubFetch(async () => res('{"v":', { contentType: 'application/json' }), async () => {
    await assert.rejects(
      () => fetchGzJson('classics/full-index.json.gz', { cmd: CMD, label: LABEL }),
      (e) => {
        assert.match(e.message, /数据损坏/)
        assert.match(e.message, /npm run poems-full:fetch/)
        assert.doesNotMatch(e.message, /未随本次构建发布/)
        return true
      },
    )
  })
})

test('fetchGzJson：读到 gzip 时返回解析后的数据', async () => {
  const payload = { v: 1, shards: 1, entries: [] }
  await stubFetch(async () => res(gzipSync(Buffer.from(JSON.stringify(payload)))), async () => {
    const { data, url } = await fetchGzJson('classics/full-index.json.gz', { cmd: CMD, label: LABEL })
    assert.deepEqual(data, payload)
    assert.equal(url, URL)
  })
})
