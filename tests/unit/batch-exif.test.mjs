// 回归护栏：exif-clean 必须把 stripMetadata 的 {blob,...} 解构出真实 Blob。
// 曾把整个结果对象当 blob 返回 → 下游 new File([对象]) 序列化成 "[object Object]"
// → 配方后续图片工序解码失败 → 结果被过滤为空 → 用户拿不到成果。
import test from 'node:test'
import assert from 'node:assert/strict'
import { OPS } from '../../src/lib/batch.js'

// 1x1 透明 PNG
const PNG = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
))

test('exif-clean：返回真实 Blob（非 {blob,...} 包装对象）', async () => {
  const file = new File([PNG], 'photo.png', { type: 'image/png' })
  const out = await OPS['exif-clean'].run(file, {})
  assert.ok(out && typeof out === 'object', 'op 应返回 {name, blob}')
  assert.ok(out.blob instanceof Blob, 'blob 必须是 Blob 实例，不能是 stripMetadata 的结果对象')
  assert.equal(typeof out.blob.arrayBuffer, 'function', 'blob 必须可 arrayBuffer')
  assert.ok(out.blob.size > 0, 'blob 不能为空')
  const bytes = new Uint8Array(await out.blob.arrayBuffer())
  assert.equal(bytes[0], 0x89, '成果应保留 PNG 魔数')
  assert.ok(/-clean\.png$/.test(out.name), '文件名应带 -clean 后缀')
})

test('exif-clean 成果可安全包装成下游 File（不会退化为 "[object Object]"）', async () => {
  const file = new File([PNG], 'photo.png', { type: 'image/png' })
  const { blob } = await OPS['exif-clean'].run(file, {})
  const next = new File([blob], 'photo-clean.png', { type: blob.type })
  assert.equal(next.size, blob.size, '包装后的 File 大小应与 blob 一致，而非 "[object Object]" 的 15 字节')
  const nextBytes = new Uint8Array(await next.arrayBuffer())
  assert.equal(nextBytes[0], 0x89, '下游 File 应保留 PNG 魔数，不是被字符串化的对象')
})
