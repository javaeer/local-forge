// 离线词典内核单测（纯函数，零 DOM 依赖，node --test 直接跑）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toneMark, stripTones, pinyinInitials,
  parseCedict, parseJsonl, parseTsv, parseDict, parseEcdict, stripPosTag,
  buildIndex, search, editDistance, stats,
  buildIpaIndex, isSingleEnglishWord,
} from '../../src/lib/dict.js'

const SAMPLE = [
  '# CC-CEDICT 注释行应被跳过',
  '會 会 [hui4] /can/to be possible/meeting/',
  '綠色 绿色 [lv4 se4] /green/',
  '你好 你好 [ni3 hao3] /hello/hi/',
  '自行車 自行车 [zi4 xing2 che1] /bicycle/bike/',
].join('\n')

test('toneMark 按拼音方案标调', () => {
  assert.equal(toneMark('ni3 hao3'), 'nǐ hǎo')
  assert.equal(toneMark('lv4 se4'), 'lǜ sè')
  assert.equal(toneMark('zhong1 guo2'), 'zhōng guó')
  assert.equal(toneMark('liu2'), 'liú')   // iu 标在 u 上
  assert.equal(toneMark('gui4'), 'guì')   // ui 标在 i 上
  assert.equal(toneMark('ma5'), 'ma')     // 轻声不标
})

test('stripTones 去调、去空格、ü 折叠为 v', () => {
  assert.equal(stripTones('ni3 hao3'), 'nihao')
  assert.equal(stripTones('lv4 se4'), 'lvse')
  assert.equal(stripTones('nu:3'), 'nv')
})

test('pinyinInitials 取每音节首字母', () => {
  assert.equal(pinyinInitials('ni3 hao3'), 'nh')
  assert.equal(pinyinInitials('zi4 xing2 che1'), 'zxc')
})

test('parseCedict 解析简繁、拼音、多释义并跳注释', () => {
  const list = parseCedict(SAMPLE)
  assert.equal(list.length, 4)
  assert.deepEqual(list[0], { t: '會', s: '会', p: 'hui4', d: ['can', 'to be possible', 'meeting'] })
  assert.equal(list[2].d[0], 'hello')
})

test('parseCedict 支持 max 截断', () => {
  assert.equal(parseCedict(SAMPLE, { max: 2 }).length, 2)
})

test('parseTsv / parseJsonl 兼容导入', () => {
  const tsv = parseTsv('龙\tlong2\t龙；dragon|dragon\n# 注释\n')
  assert.equal(tsv.length, 1)
  assert.deepEqual(tsv[0].d, ['龙；dragon', 'dragon'])

  const jsonl = parseJsonl([
    JSON.stringify({ word: '龙', pinyin: 'long2', senses: [{ glosses: ['dragon'] }] }),
    JSON.stringify({ s: '凤', p: 'feng4', d: ['phoenix'] }),
    'not json',
  ].join('\n'))
  assert.equal(jsonl.length, 2)
  assert.equal(jsonl[0].d[0], 'dragon')
  assert.equal(jsonl[1].s, '凤')
})

test('parseDict 按扩展名与内容嗅探格式', () => {
  assert.equal(parseDict(SAMPLE, 'a.txt').length, 4)
  assert.equal(parseDict('龙\tlong2\t龙', 'x.tsv').length, 1)
  assert.equal(parseDict('{"word":"龙","glosses":["dragon"]}', 'x.jsonl').length, 1)
})

test('editDistance 早停结果正确', () => {
  assert.equal(editDistance('绿色', '绿色', 2), 0)
  assert.equal(editDistance('绿仓', '绿色', 2), 1)
  assert.ok(editDistance('你好', '完全不同的词', 1) > 1)
})

test('search 精确命中简体与繁体，并给出带调拼音', () => {
  const idx = buildIndex(parseCedict(SAMPLE))
  const a = search(idx, '绿色')
  const b = search(idx, '綠色')
  assert.equal(a.total, 1)
  assert.equal(b.total, 1)
  assert.equal(a.items[0].pm, 'lǜ sè')
})

test('search 中文前缀扩展', () => {
  const idx = buildIndex(parseCedict(SAMPLE))
  const r = search(idx, '自')
  assert.ok(r.items.some((x) => x.s === '自行车'))
})

test('search 拼音四种写法都能命中', () => {
  const idx = buildIndex(parseCedict(SAMPLE))
  for (const q of ['lvse', 'lv4 se4', 'lüse', 'ni hao', 'nh']) {
    const r = search(idx, q)
    assert.ok(r.total > 0, `查询「${q}」应有结果`)
  }
  assert.ok(search(idx, 'lvse').items.some((x) => x.s === '绿色'))
  assert.ok(search(idx, 'nh').items.some((x) => x.s === '你好'))
})

test('search 英文释义反查', () => {
  const idx = buildIndex(parseCedict(SAMPLE))
  const r = search(idx, 'bicycle', { mode: 'gloss' })
  assert.ok(r.items.some((x) => x.s === '自行车'))
})

test('search 模糊纠错', () => {
  const idx = buildIndex(parseCedict(SAMPLE))
  const r = search(idx, '绿仓', { mode: 'fuzzy', maxDist: 1 })
  assert.ok(r.items.some((x) => x.s === '绿色'))
})

test('search 空查询与 limit 边界安全', () => {
  const idx = buildIndex(parseCedict(SAMPLE))
  assert.equal(search(idx, '   ').total, 0)
  const r = search(idx, '', { limit: 0 })
  assert.equal(r.items.length, 0)
  assert.equal(search(idx, 'a', { limit: 9999 }).items.length <= 500, true)
})

test('stats 统计词条数', () => {
  const idx = buildIndex(parseCedict(SAMPLE))
  const s = stats(idx)
  assert.equal(s.entries, 4)
  assert.ok(s.words >= 4)
})

/* ---------------- 释义倒排（v2）：召回 + 精细打分 ---------------- */

// 释义更丰富的样本：一条释义里既有精确义项，也有长句里的中间词
const SAMPLE_GLOSS = [
  '會 会 [hui4] /can/to be possible/meeting/',
  '綠色 绿色 [lv4 se4] /green/',
  '綠茶 绿茶 [lv4 cha2] /green tea/',
  '茶 茶 [cha2] /tea/',
  '自行車 自行车 [zi4 xing2 che1] /bicycle/bike/',
  '代步車 代步车 [dai4 bu4 che1] /a vehicle for getting around; bicycle/',
  '漢 汉 [han4] /Han/',
  '漢堡 汉堡 [han4 bao3] /hamburger/',
].join('\n')

test('释义倒排：精确义项优先于长句中的同词', () => {
  const idx = buildIndex(parseCedict(SAMPLE_GLOSS))
  const r = search(idx, 'bicycle', { mode: 'gloss' })
  const byName = Object.fromEntries(r.items.map((x) => [x.s, x.score]))
  assert.equal(byName['自行车'], 45, '「bicycle」独立成义项应拿满分')
  assert.equal(byName['代步车'], 45, '长句里按「;」切出的 bicycle 同样视为精确义项')
  // 未建义项级英文索引时，两者同分，靠词长与字典序稳定排序
  assert.ok(r.items.some((x) => x.s === '自行车'))
})

test('释义倒排：多词查询按 AND 处理', () => {
  const idx = buildIndex(parseCedict(SAMPLE_GLOSS))
  const r = search(idx, 'green tea', { mode: 'gloss' })
  assert.ok(r.items.some((x) => x.s === '绿茶'), 'green tea 应命中绿茶')
  assert.ok(!r.items.some((x) => x.s === '茶'), '只有 tea 没有 green 的词条不应命中')

  // 顺序颠倒也应命中（AND 与词序无关）
  const rev = search(idx, 'tea green', { mode: 'gloss' })
  assert.ok(rev.items.some((x) => x.s === '绿茶'))
})

test('释义倒排：单词 tea 只命中自身，不会误伤绿茶', () => {
  const idx = buildIndex(parseCedict(SAMPLE_GLOSS))
  const r = search(idx, 'tea', { mode: 'gloss' })
  const names = r.items.map((x) => x.s)
  assert.ok(names.includes('茶'))
  assert.ok(names.includes('绿茶'), '绿茶释义含 tea，按词命中属预期')
})

test('释义倒排：子串查询仍能靠全表兜底命中', () => {
  const idx = buildIndex(parseCedict(SAMPLE_GLOSS))
  // "cycle" 不是任何独立词，倒排召回为空，走兜底 includes
  const r = search(idx, 'cycle', { mode: 'gloss' })
  assert.ok(r.items.some((x) => x.s === '自行车'), 'cycle 应作为 bicycle 的子串命中')
  const item = r.items.find((x) => x.s === '自行车')
  assert.equal(item.score, 30, '兜底命中给 30 分')
})

test('释义倒排：查不到时返回 0 且不抛错', () => {
  const idx = buildIndex(parseCedict(SAMPLE_GLOSS))
  assert.equal(search(idx, 'zzzznotexist', { mode: 'gloss' }).total, 0)
  assert.equal(search(idx, '   ', { mode: 'gloss' }).total, 0)
})

test('前缀检索：繁体词头也能展开到繁体词条', () => {
  const idx = buildIndex(parseCedict(SAMPLE_GLOSS))
  const r = search(idx, '漢')
  const names = r.items.map((x) => x.s)
  assert.ok(names.includes('汉'), '精确命中「漢 → 汉」')
  assert.ok(names.includes('汉堡'), '繁体前缀「漢」应展开到「漢堡 → 汉堡」')
})

test('索引结构：平行数组长度一致且可二分', () => {
  const idx = buildIndex(parseCedict(SAMPLE_GLOSS))
  assert.equal(idx.sortedWords.length, idx.sortedIdx.length)
  assert.ok(idx.sortedIdx instanceof Int32Array)
  // 20 万条量级下不能退化成对象数组（内存大头）
  assert.equal(typeof idx.sortedWords[0], 'string')
})

test('释义倒排：glossWords 键表已排序（前缀二分前提）', () => {
  const idx = buildIndex(parseCedict(SAMPLE_GLOSS))
  const keys = idx.glossWords
  assert.ok(keys.length > 0)
  for (let i = 1; i < keys.length; i++) {
    assert.ok(keys[i - 1] <= keys[i], `键表未排序：${keys[i - 1]} > ${keys[i]}`)
  }
  // 停用词与 2 字符词不应进索引
  assert.ok(!keys.includes('the') && !keys.includes('to') && !keys.includes('ox'))
})

/* ---------------- 英语 IPA 音标索引 ---------------- */

test('buildIpaIndex：基础解析（word⇥/ipa/）', () => {
  const m = buildIpaIndex("bicycle\t/ˈbaɪsɪkəɫ/\nabout\t/əˈbaʊt/, /əˈbæʊt/")
  assert.deepEqual(m.get('bicycle'), ['ˈbaɪsɪkəɫ'])
  assert.deepEqual(m.get('about'), ['əˈbaʊt', 'əˈbæʊt'], '逗号分隔的多读音应拆开')
})

test('buildIpaIndex：小写归一与噪声容忍', () => {
  const m = buildIpaIndex("Bicycle\t/ˈbaɪsɪkəɫ/\n# 注释行\n\nbadline\t\nx")
  assert.ok(m.has('bicycle'), '大写词头应归一为小写')
  assert.equal(m.size, 1, '注释行 / 空行 / 无 IPA 的行应被跳过')
})

test('buildIpaIndex：传入已有 Map 时累积读音', () => {
  const m = buildIpaIndex("bicycle\t/ˈbaɪsɪkəɫ/")
  buildIpaIndex("bicycle\t/ˈbaɪ.sɪ.kəl/", m)
  assert.equal(m.get('bicycle').length, 2, '美式 + 英式两次构建应累积到同一词')
})

test('isSingleEnglishWord：只放行单个纯英文词', () => {
  for (const ok of ['bicycle', "isn't", 'e-mail', 'A']) assert.ok(isSingleEnglishWord(ok), ok)
  for (const no of ['green tea', '绿色', 'bicycle!', '', ' ', '3d']) {
    assert.ok(!isSingleEnglishWord(no), `应拒绝：${JSON.stringify(no)}`)
  }
})

test('parseEcdict 解析引号 CSV（含内嵌换行与双引号转义）', () => {
  const csv = [
    'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio',
    'bicycle,"ˈbaɪsɪkl","a wheeled vehicle","n. 自行车\nvi. 骑自行车",,3,1,cet4 cet6 ky,2082,2255,"bicycles\nbicycling\nbicycled",,',
    '"say, ""hi""","sei","","int. 你好\n打招呼用语",,,,,,,9,,,',
  ].join('\n')
  const rows = parseEcdict(csv)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].s, 'bicycle')
  assert.equal(rows[0].p, 'ˈbaɪsɪkl', '音标列应带出（供 IPA 展示）')
  assert.deepEqual(rows[0].d.slice(0, 2), ['n. 自行车', 'vi. 骑自行车'], '中文释义在前')
  assert.deepEqual(rows[0].d[2], 'a wheeled vehicle', '英文释义跟在中文后')
  assert.equal(rows[1].s, 'say, "hi"', '双引号应解转义')
  assert.deepEqual(rows[1].d, ['int. 你好', '打招呼用语'])
})

test('parseEcdict：跳表头 / max 截断 / 空行容忍', () => {
  const csv = 'word,phonetic,definition,translation\na,,,"一"\nb,,,"二"\n\n'
  assert.equal(parseEcdict(csv).length, 2)
  assert.equal(parseEcdict(csv, { max: 1 }).length, 1)
  assert.equal(parseEcdict(csv, { max: 1 })[0].s, 'a')
})

test('parseDict 嗅探 ECDICT（文件名与表头两种途径）', () => {
  const csv = 'word,phonetic,definition,translation\n"bicycle","ˈbaɪsɪkl","x","n. 自行车"\n'
  assert.equal(parseDict(csv, 'ecdict.csv')[0].s, 'bicycle')
  assert.equal(parseDict(csv)[0].s, 'bicycle', '按表头 word,phonetic 也应识别')
  assert.equal(parseDict(csv, 'random.csv')[0].s, 'bicycle', '表头嗅探优先于 .csv → TSV')
})


test('stripPosTag 剥离 ECDICT 的词性 / 学科前缀', () => {
  assert.equal(stripPosTag('n. 自行车'), '自行车')
  assert.equal(stripPosTag('vt. 使烦恼'), '使烦恼')
  assert.equal(stripPosTag('a. 无所不在的'), '无所不在的')
  assert.equal(stripPosTag('【化】丙酮'), '丙酮')
  assert.equal(stripPosTag('[医] 发热'), '发热')
  assert.equal(stripPosTag('n./v. 增补'), '增补')
  assert.equal(stripPosTag('自行车'), '自行车', '无前缀应原样返回')
  assert.equal(stripPosTag('n.'), 'n.', '只有前缀不剩正文时不应清空')
})

test('parseEcdict 按字面 \\n 拆义项（ECDICT 的真实分隔符）', () => {
  // 字段内是「反斜杠 + n」两个字符，不是真换行；按真换行拆会得到一条粘连长释义
  const csv = 'word,phonetic,definition,translation\nbicycle,baisikl,"n. a wheeled vehicle\\nv. ride a bicycle","n. 自行车\\nvi. 骑自行车"\n'
  const rows = parseEcdict(csv)
  assert.deepEqual(rows[0].d, ['n. 自行车', 'vi. 骑自行车', 'n. a wheeled vehicle', 'v. ride a bicycle'],
    '中文义项在前、英文在后，且各自按字面 \\n 拆开')
})

test('parseEcdict 带出词频（COCA 优先，退 BNC）', () => {
  const csv = 'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq\na,,,,,,,5312,4366\nb,,,,,,,,900\nc,,,,,,,,,\n'
  const rows = parseEcdict(csv)
  assert.equal(rows[0].f, 4366, 'frq(COCA) 优先')
  assert.equal(rows[1].f, 900, '无 frq 时退 bnc')
  assert.equal(rows[2].f, 0, '两列都空 → 0')
})

test('释义检索：词性前缀不影响命中档位，同分按词频排序', () => {
  const entries = [
    { s: 'rare', t: 'rare', p: '', d: ['n. 自行车'], f: 9000 },
    { s: 'bike', t: 'bike', p: '', d: ['n. 自行车'], f: 2163 },
    { s: 'bikeway', t: 'bikeway', p: '', d: ['n. 自行车道'], f: 40000 },
  ]
  const idx = buildIndex(entries)
  const r = search(idx, '自行车', { mode: 'gloss', limit: 10 })
  const words = r.items.map((x) => x.s)
  assert.ok(words.includes('bike'), '「n. 自行车」应命中 bike')
  assert.equal(r.items[0].s, 'bike', '同为精确命中时词频高的排前')
  const exactHit = r.items.find((x) => x.s === 'bike')
  assert.equal(exactHit.score, 45, '剥离词性前缀后应回到精确档 45 分')
})


test('auto 模式：中文无词条时兜底释义反查（英汉词库场景）', () => {
  // ECDICT 这类词库没有中文词条，中文只能靠释义反查。
  // 早先 gloss 只在 ascii 输入时触发，导致切到英汉词库后查任何中文都是空白。
  const entries = [
    { s: 'precision', t: 'precision', p: '', d: ['n. 精确, 精准, 精密'], f: 3000 },
    { s: 'bike', t: 'bike', p: '', d: ['n. 自行车'], f: 2163 },
  ]
  const idx = buildIndex(entries)
  const r = search(idx, '精准', { limit: 5 })
  assert.ok(r.items.length > 0, '中文输入必须触发释义反查，不能直接空结果')
  assert.equal(r.items[0].s, 'precision')
  assert.equal(r.items[0].hit, 'gloss')
  assert.equal(r.items[0].score, 45, '义项精确命中')
  assert.equal(search(idx, '自行车').items[0].s, 'bike', '同上')
})

test('auto 模式：中文命中词条时不额外跑释义（避免噪声）', () => {
  const entries = [
    { s: '精准', t: '精準', p: 'jīng zhǔn', d: ['accurate'], f: 0 },
    { s: 'precise', t: 'precise', p: '', d: ['n. 精准'], f: 2000 },
  ]
  const idx = buildIndex(entries)
  const r = search(idx, '精准', { limit: 5 })
  assert.equal(r.items[0].s, '精准', '词条精确命中优先')
  assert.equal(r.items[0].hit, 'exact')
})
