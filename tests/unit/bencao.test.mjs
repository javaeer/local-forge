// 本草纲目模块（第 6 期）单元测试：解析器 + 数据层 + 分节导航。
//
// 数据快照（public/tcm/bencao.json.gz）不在仓库里，涉及快照的断言用 hasSnapshot 跳过——
// 本地跑过 npm run bencao:fetch 后即生效。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// 解析器来自抓取脚本（脚本有 main 守卫，import 不会触发下载）
const { parseBencao, cleanBody, buOf, excerptOf } = await import(
  join(ROOT, 'scripts/fetch-bencao.mjs')
)
const bencao = await import(join(ROOT, 'src/lib/bencao.js'))
const { splitSections } = bencao

const hasSnapshot = existsSync(join(ROOT, 'public/tcm/bencao.json.gz'))

// 一小段带分节的正文样例（人参节选，覆盖 origin / 分节 / 换行）
const SAMPLE_BODY = `（《本经》上品）
【释名】人　（音参。或省作）、黄参（《吴普》）。
【气味】甘，微寒，无毒。
【主治】补五脏，安精神，定魂魄。久服轻身延年（《本经》）。
【附方】人参膏：用人参十两细切。`

test('buOf：16 部归类与上游目录字段归位', () => {
  assert.equal(buOf('水部第五卷\\水之一'), '水部')
  assert.equal(buOf('草部卷十四\\草之三'), '草部') // 缺「第」字的目录段
  assert.equal(buOf('菜部二十八卷\\菜之三'), '菜部') // 同上
  assert.equal(buOf('纲目第七卷\\土之一'), '土部') // 土部条目挂在「纲目第七卷」下
  assert.equal(buOf('石部第九卷\\金石之三'), '金石部') // 石部是金石部延续
  assert.equal(buOf('金石部第八卷\\金石之一'), '金石部')
  assert.equal(buOf('主治第三卷\\百病主治药'), '序例') // 主治卷归序例
  assert.equal(buOf('序例第二卷\\序例'), '序例')
  assert.equal(buOf(''), '序例')
})

test('cleanBody：缺字占位符转全角空格、不猜字', () => {
  assert.equal(cleanBody('人参\\x 味甘'), '人参　味甘')
  assert.equal(cleanBody('杨KT 所著'), '杨　所著')
  assert.equal(cleanBody('身体强KT KT 然'), '身体强　　然') // 相邻两个占位符 = 两个缺字
  assert.equal(cleanBody('多　　余空格 与 普通空格'), '多　　余空格 与 普通空格') // 全角空格 1:1 保留缺字计数
  assert.ok(!/\\x|KT/.test(cleanBody('人\\x参KT 身')))
})

test('parseBencao：三段标签解析（目录→篇名→多行正文）', () => {
  // 合成源文本：与上游「目录→篇名→内容：…（多行）」结构一致
  const src = [
    '<目录>草部第十二卷\\草之一',
    '<篇名>人参',
    '内容：（《本经》上品）',
    '【释名】黄参。',
    '【主治】补五脏。',
    '第二行正文。',
    '<目录>纲目第七卷\\土之一',
    '<篇名>白垩',
    '内容：（《别录》下品）',
    '【气味】苦，温。',
    '<目录>',
    '<篇名>本草纲目',
    '内容：无正文的部头条目',
  ].join('\n')
  const entries = parseBencao(src)
  assert.equal(entries.length, 3)
  assert.ok(entries[0].name.includes('本草纲目') === false)
  const rs = entries[0]
  assert.ok(rs.dir.includes('草部第十二卷'))
  assert.ok(rs.body.includes('【释名】') && rs.body.includes('第二行正文。'), '多行正文完整')
  const bk = entries[2]
  assert.equal(bk.name, '本草纲目')
  assert.equal(bk.dir, '')
})

test('excerptOf：主治摘要截取', () => {
  const ex = excerptOf(SAMPLE_BODY.replace(/\n/g, '\n'))
  assert.ok(ex.startsWith('补五脏'), ex)
  assert.ok(ex.length <= 60)
  assert.equal(excerptOf('没有主治标记的正文'), '没有主治标记的正文')
})

test('splitSections：正文分节与出处行', () => {
  const { origin, sections } = splitSections(SAMPLE_BODY)
  assert.equal(origin, '《本经》上品')
  assert.deepEqual(
    sections.map((s) => s.tag),
    ['释名', '气味', '主治', '附方'],
  )
  assert.ok(sections[0].text.startsWith('人　'))
  assert.equal(sections.find((s) => s.tag === '附方').text, '人参膏：用人参十两细切。')
  // 无分节正文
  const p = splitSections('一段没有分节的正文')
  assert.equal(p.origin, '')
  assert.equal(p.sections.length, 1)
  assert.equal(p.sections[0].tag, '')
})

test('buOf 与抓取脚本侧一致（两份实现不许漂移）', () => {
  for (const d of ['水部第五卷\\水之一', '纲目第七卷\\土之一', '石部第九卷\\金石之三', '', '主治第四卷\\百病主治药']) {
    assert.equal(buOf(d), bencao.buOf(d), d)
  }
})

/* ---------------- 快照相关（本地有快照才跑） ---------------- */

test('快照：规模与结构断言', { skip: !hasSnapshot }, () => {
  const data = JSON.parse(gunzipSync(readFileSync(join(ROOT, 'public/tcm/bencao.json.gz'))).toString('utf8'))
  assert.equal(data.v, 1)
  assert.ok(data.items.length >= 1900)
  assert.ok(data.dirs.length >= 100 && data.dirs.length <= 200)
  const bu = new Set(data.dirs.map((d) => bencao.buOf(d || '')))
  assert.equal(bu.size, 17) // 16 部 + 序例
  const yao = data.items.filter((it) => bencao.buOf(data.dirs[it[0]] || '') !== '序例')
  assert.ok(yao.length >= 1700)
  const zhuzhi = yao.filter((it) => it[2].includes('【主治】')).length
  assert.ok(zhuzhi >= 1500, `含主治 ${zhuzhi} >= 1500`)
  const rs = data.items.find((it) => it[1] === '人参')
  assert.ok(rs && rs[2].length > 9000)
  assert.ok(rs[3].startsWith('补五脏'), '人参主治摘要')
})

test('快照：索引与全量同构、无占位符残留', { skip: !hasSnapshot }, () => {
  const idx = JSON.parse(gunzipSync(readFileSync(join(ROOT, 'public/tcm/bencao-index.json.gz'))).toString('utf8'))
  assert.equal(idx.v, 1)
  assert.equal(idx.items.length, 1921)
  for (const [di, name, ex] of idx.items) {
    if (!ex || !name) throw new Error(`索引条目异常：${name}`)
    if (ex.length > 60) throw new Error(`索引摘要过长：${name}`)
  }
  const full = JSON.parse(gunzipSync(readFileSync(join(ROOT, 'public/tcm/bencao.json.gz'))).toString('utf8'))
  for (const [di, name, body] of full.items) {
    if (/\\x|KT/.test(body)) throw new Error(`《${name}》残留上游占位符`)
    if (body.includes('\r')) throw new Error(`《${name}》含 CR`)
  }
})
