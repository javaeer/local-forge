// 文本 / 编码工具箱纯函数单测（零 DOM 依赖，node --test 直接跑）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  base64Encode, base64Decode, base64UrlEncode, base64UrlDecode,
  hexEncode, hexDecode, jsonFormat, jsonMinify, jsonValidate,
  uuidV4, shaDigest, timestampToDate, dateToTimestamp,
  regexTest, passwordStrength, jwtParse,
} from '../../src/lib/text.js'

test('base64 中文往返一致', () => {
  const s = '你好 LocalForge 文件不上传'
  assert.equal(base64Decode(base64Encode(s)), s)
})

test('base64url 含中文往返一致', () => {
  const s = 'JSON·Base64·JWT·正则'
  assert.equal(base64UrlDecode(base64UrlEncode(s)), s)
})

test('hex 编码/解码往返', () => {
  assert.equal(hexEncode('AB'), '4142')
  assert.equal(hexDecode('4142'), 'AB')
})

test('jsonFormat 美化 / jsonMinify 压缩', () => {
  const ugly = '{"a":1,"b":[2,3]}'
  const pretty = jsonFormat(ugly)
  assert.match(pretty, /\n\s+"a"/)
  assert.equal(jsonMinify(pretty), ugly)
})

test('jsonValidate 区分合法 / 非法', () => {
  assert.equal(jsonValidate('{"a":1}').ok, true)
  const bad = jsonValidate('{oops')
  assert.equal(bad.ok, false)
  assert.equal(typeof bad.pos, 'number')
})

test('uuidV4 形如 UUID 且唯一', () => {
  const a = uuidV4(), b = uuidV4()
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  assert.notEqual(a, b)
})

test('shaDigest 支持多算法与默认 SHA-256', async () => {
  const r = await shaDigest('abc', ['SHA-256', 'SHA-1'])
  assert.equal(r['SHA-256'], 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(r['SHA-1'], 'a9993e364706816aba3e25717850c26c9cd0d89d')
  const def = await shaDigest('abc')
  assert.equal(def['SHA-256'], r['SHA-256'])
})

test('timestampToDate / dateToTimestamp 互转', () => {
  const ts = 1700000000
  const d = timestampToDate(ts)
  assert.equal(d.seconds, ts)
  assert.equal(d.iso, '2023-11-14T22:13:20.000Z')
  const back = dateToTimestamp('2024-01-01T00:00:00Z')
  assert.equal(back.seconds, 1704067200)
})

test('regexTest 按 (source, flags, text) 返回匹配数', () => {
  const r = regexTest('\d+', 'g', 'abc123 456')
  assert.equal(r.count, 2)
  assert.equal(r.matches[0].match, '123')
  // 无匹配也应返回 count=0 而非抛错
  assert.equal(regexTest('\d+', 'g', 'no digits').count, 0)
})

test('regexTest 非法正则抛错（交由上层 UI 兜底）', () => {
  assert.throws(() => regexTest('(', '', 'x'), /正则表达式不合法/)
})

test('passwordStrength 返回结构化评分', () => {
  const r = passwordStrength('Abcdef1!xyz')
  assert.equal(typeof r.score, 'number')
  assert.ok(['weak', 'medium', 'strong'].includes(r.level) || typeof r.label === 'string')
})

test('jwtParse 解析三段式并校验过期', () => {
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const token = `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: '42', name: '阿明' })}.sig`
  const r = jwtParse(token)
  assert.equal(r.payload.sub, '42')
  assert.equal(r.payload.name, '阿明')
  assert.equal(r.expired, false)
})
