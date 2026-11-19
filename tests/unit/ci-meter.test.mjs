// 词牌格律校验单测（古典文学模块第 2 期）。
//
// 与 poem-meter.test.mjs 同样的两侧夹逼：
//   - 好词必须零 error（误报会让工具失去可信度）——11 首传世名篇逐一断言
//   - 坏词必须报错（漏报会让工具失去价值）——改韵脚、改平仄、漏字三种破坏各一条
//
// 词比诗多三个坑，这里都单独锁住：
//   1. 入声邻部通押（苏轼《念奴娇》「壁」属第十七部，其余属第十八部，历来公认合律）
//   2. 词林正韵「半韵」（晏殊《浣溪沙》「杯/回」与「台/来」分属第三、第五部，实为同部通押）
//   3. 同字数异断句（《青玉案》贺铸体五仄韵、苏轼体四仄韵，都是 67 字，选错体会把韵位整体错位）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  buildCiIndex, analyzeCi, resolveTune, normalizeTuneName, decodeCell,
  parseCiLines, extractChars, tuneGrid, suggestTunes,
  MARK_RHYME, MARK_SENT, MARK_READ,
} from '../../src/lib/cimeter.js'
import { buildIndex } from '../../src/lib/poemmeter.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const CI_SNAPSHOT = join(ROOT, 'public/classics/citunes.json.gz')
const RHYME_SNAPSHOT = join(ROOT, 'public/classics/rhyme.json.gz')
const hasSnapshot = existsSync(CI_SNAPSHOT) && existsSync(RHYME_SNAPSHOT)

let cache = null
function real() {
  if (!cache) {
    const ci = JSON.parse(gunzipSync(readFileSync(CI_SNAPSHOT)).toString('utf8'))
    const rh = JSON.parse(gunzipSync(readFileSync(RHYME_SNAPSHOT)).toString('utf8'))
    cache = { ciIndex: buildCiIndex(ci), toneIndex: buildIndex(rh) }
  }
  return cache
}

// 传世名篇。任何一首被判出律，都视为引擎缺陷。
const MASTERPIECES = {
  水调歌头: '明月几时有，把酒问青天。不知天上宫阙，今夕是何年。我欲乘风归去，又恐琼楼玉宇，高处不胜寒。起舞弄清影，何似在人间。\n转朱阁，低绮户，照无眠。不应有恨，何事长向别时圆。人有悲欢离合，月有阴晴圆缺，此事古难全。但愿人长久，千里共婵娟。',
  如梦令: '昨夜雨疏风骤，浓睡不消残酒。试问卷帘人，却道海棠依旧。知否，知否，应是绿肥红瘦。',
  念奴娇: '大江东去，浪淘尽，千古风流人物。故垒西边，人道是、三国周郎赤壁。乱石穿空，惊涛拍岸，卷起千堆雪。江山如画，一时多少豪杰。\n遥想公瑾当年，小乔初嫁了，雄姿英发。羽扇纶巾，谈笑间、樯橹灰飞烟灭。故国神游，多情应笑我，早生华发。人生如梦，一尊还酹江月。',
  雨霖铃: '寒蝉凄切，对长亭晚，骤雨初歇。都门帐饮无绪，方留恋处，兰舟催发。执手相看泪眼，竟无语凝噎。念去去、千里烟波，暮霭沉沉楚天阔。\n多情自古伤离别，更那堪、冷落清秋节。今宵酒醒何处，杨柳岸、晓风残月。此去经年，应是良辰好景虚设。便纵有、千种风情，更与何人说。',
  虞美人: '春花秋月何时了，往事知多少。小楼昨夜又东风，故国不堪回首月明中。\n雕栏玉砌应犹在，只是朱颜改。问君能有几多愁，恰似一江春水向东流。',
  声声慢: '寻寻觅觅，冷冷清清，凄凄惨惨戚戚。乍暖还寒时候，最难将息。三杯两盏淡酒，怎敌他、晚来风急。雁过也，正伤心，却是旧时相识。\n满地黄花堆积。憔悴损，如今有谁堪摘。守着窗儿，独自怎生得黑。梧桐更兼细雨，到黄昏、点点滴滴。这次第，怎一个愁字了得。',
  醉花阴: '薄雾浓云愁永昼，瑞脑消金兽。佳节又重阳，玉枕纱厨，半夜凉初透。\n东篱把酒黄昏后，有暗香盈袖。莫道不销魂，帘卷西风，人比黄花瘦。',
  一剪梅: '红藕香残玉簟秋。轻解罗裳，独上兰舟。云中谁寄锦书来，雁字回时，月满西楼。\n花自飘零水自流。一种相思，两处闲愁。此情无计可消除，才下眉头，却上心头。',
  卜算子: '驿外断桥边，寂寞开无主。已是黄昏独自愁，更著风和雨。\n无意苦争春，一任群芳妒。零落成泥碾作尘，只有香如故。',
  破阵子: '醉里挑灯看剑，梦回吹角连营。八百里分麾下炙，五十弦翻塞外声。沙场秋点兵。\n马作的卢飞快，弓如霹雳弦惊。了却君王天下事，赢得生前身后名。可怜白发生。',
  浣溪沙: '一曲新词酒一杯，去年天气旧亭台。夕阳西下几时回。\n无可奈何花落去，似曾相识燕归来。小园香径独徘徊。',
}

/* ---------------- 1. 索引 ---------------- */

test('buildCiIndex：词牌与体数达到预期规模', { skip: !hasSnapshot }, () => {
  const { ciIndex } = real()
  assert.ok(ciIndex.names.length >= 800, `词牌数 ${ciIndex.names.length}`)
  assert.ok(ciIndex.stats.formats >= 2400, `体数 ${ciIndex.stats.formats}`)
  assert.ok(ciIndex.stats.chars >= 190000)
  assert.equal(ciIndex.stats.parts, 19, '词林正韵应为 19 部')
  assert.ok(ciIndex.stats.rhymeChars >= 7000, `词韵字数 ${ciIndex.stats.rhymeChars}`)
})

test('buildCiIndex：格律描述池化后每体都能取回原文', { skip: !hasSnapshot }, () => {
  const { ciIndex } = real()
  for (const name of ciIndex.names.slice(0, 50)) {
    for (const f of ciIndex.byName.get(name).formats) {
      assert.equal(typeof f.sketch, 'string')
      assert.ok(f.sketch.length > 0, `${name} 格律描述为空`)
      assert.equal(f.p.length, f.len)
    }
  }
})

test('buildCiIndex：缺 ci 字段时抛出明确错误', () => {
  assert.throws(() => buildCiIndex({}), /词谱数据结构异常/)
})

/* ---------------- 2. 谱串编解码 ---------------- */

test('decodeCell：与转码脚本的编码表一致', () => {
  // 编码规则：值 = 35 + 平仄码 * 7 + 标记码
  assert.deepEqual(decodeCell(String.fromCharCode(35)), { tone: '中', mark: 0, markName: '' })
  assert.deepEqual(decodeCell(String.fromCharCode(35 + 7)), { tone: '平', mark: 0, markName: '' })
  assert.deepEqual(decodeCell(String.fromCharCode(35 + 14)), { tone: '仄', mark: 0, markName: '' })
  assert.equal(decodeCell(String.fromCharCode(35 + 7 + 3)).markName, '韵')
  assert.equal(decodeCell(String.fromCharCode(35 + 14 + 2)).markName, '句')
  assert.throws(() => decodeCell(' '), /词谱编码异常/)
})

/* ---------------- 3. 词牌名归一 ---------------- */

test('resolveTune：别名、繁体、书名号、空格都能解析', { skip: !hasSnapshot }, () => {
  const { ciIndex } = real()
  assert.equal(resolveTune(ciIndex, '水调歌头'), '水调歌头')
  assert.equal(resolveTune(ciIndex, '水調歌頭'), '水调歌头', '繁体应能识别')
  assert.equal(resolveTune(ciIndex, '花犯念奴'), '水调歌头', '别名应能识别')
  assert.equal(resolveTune(ciIndex, '元会曲'), '水调歌头')
  assert.equal(resolveTune(ciIndex, '金縷曲'), '贺新郎')
  assert.equal(resolveTune(ciIndex, ' 念奴娇 '), '念奴娇')
  assert.equal(resolveTune(ciIndex, '《如梦令》'), '如梦令')
  assert.equal(resolveTune(ciIndex, '一江春水'), '虞美人')
  assert.equal(resolveTune(ciIndex, '根本没有这个词牌'), null)
})

test('normalizeTuneName：繁简逐字归一，表外字原样保留', () => {
  assert.equal(normalizeTuneName('水調歌頭'), '水调歌头')
  assert.equal(normalizeTuneName('金縷曲'), '金缕曲')
  assert.equal(normalizeTuneName('龘'), '龘')
})

/* ---------------- 4. 文本解析 ---------------- */

test('parseCiLines：顿号是句内顿，不切句', () => {
  const lines = parseCiLines('东风夜放花千树，更吹落、星如雨。')
  assert.deepEqual(lines, ['东风夜放花千树', '更吹落星如雨'])
})

test('parseCiLines：空行与非中文行被忽略', () => {
  assert.deepEqual(parseCiLines('\n\nAuthor 2024\n明月几时有\n'), ['明月几时有'])
})

test('extractChars：只留汉字', () => {
  assert.equal(extractChars('明月，几时-有123 ？').join(''), '明月几时有')
})

/* ---------------- 5. 名篇零误报 ---------------- */

for (const [name, text] of Object.entries(MASTERPIECES)) {
  test(`名篇零误报：《${name}》`, { skip: !hasSnapshot }, () => {
    const r = analyzeCi(text, { ...real(), tuneName: name })
    const errs = r.issues.filter((i) => i.level === 'error')
    assert.equal(errs.length, 0, `不应报错，实际：${errs.map((e) => `${e.code}@${e.pos ?? ''}`).join(',')}`)
    assert.ok(r.ok)
    assert.ok(r.score >= 90, `合谱率偏低：${r.score}%`)
    assert.equal(r.tune.name, resolveTune(real().ciIndex, name))
  })
}

test('名篇零误报：不指定词牌也能自动识别', { skip: !hasSnapshot }, () => {
  const r = analyzeCi(MASTERPIECES.虞美人, real())
  assert.equal(r.tune.name, '虞美人')
  assert.ok(r.tune.auto)
  assert.ok(r.ok, r.issues.map((i) => i.code).join(','))
})

/* ---------------- 6. 词特有的三个坑 ---------------- */

test('入声邻部通押：苏轼《念奴娇》「壁」不判出韵', { skip: !hasSnapshot }, () => {
  const r = analyzeCi(MASTERPIECES.念奴娇, { ...real(), tuneName: '念奴娇' })
  assert.ok(r.ok, '《念奴娇》是公认合律之作，不应判出韵')
  const ru = r.issues.filter((i) => i.code === 'ci-rhyme-ru')
  assert.equal(ru.length, 1, '应给出 1 条入声通押提示')
  assert.equal(ru[0].level, 'info')
  assert.equal(ru[0].ch, '壁')
})

test('词林正韵半韵通押：晏殊《浣溪沙》「杯/回」与「台/来」不判出韵', { skip: !hasSnapshot }, () => {
  const r = analyzeCi(MASTERPIECES.浣溪沙, { ...real(), tuneName: '浣溪沙' })
  assert.ok(r.ok, '十灰两半在词中通押属常态，不应判错')
})

test('同字数异断句：《青玉案》应选四仄韵体而非五仄韵体', { skip: !hasSnapshot }, () => {
  const text = '东风夜放花千树，更吹落、星如雨。宝马雕车香满路。凤箫声动，玉壶光转，一夜鱼龙舞。\n蛾儿雪柳黄金缕，笑语盈盈暗香去。众里寻他千百度。蓦然回首，那人却在，灯火阑珊处。'
  const r = analyzeCi(text, { ...real(), tuneName: '青玉案' })
  assert.ok(r.ok, '辛弃疾《青玉案》不应被判出韵')
  const rhymes = r.cells.filter((c) => c.mark === MARK_RHYME).length
  assert.equal(rhymes, 8, `应选四仄韵体（前后段各四韵 = 8），实际韵位 ${rhymes}`)
})

/* ---------------- 7. 漏报侧：必须报错 ---------------- */

test('漏报侧：韵脚换字必须报混韵', { skip: !hasSnapshot }, () => {
  const bad = MASTERPIECES.虞美人.replace('几多愁', '几多喜')
  const r = analyzeCi(bad, { ...real(), tuneName: '虞美人' })
  assert.equal(r.ok, false)
  assert.ok(r.issues.some((i) => i.code === 'ci-rhyme-mixed' && i.level === 'error'))
})

test('漏报侧：韵脚平仄不符必须报错', { skip: !hasSnapshot }, () => {
  const bad = MASTERPIECES.虞美人.replace('又东风', '又东雨')
  const r = analyzeCi(bad, { ...real(), tuneName: '虞美人' })
  assert.equal(r.ok, false)
  assert.ok(r.issues.some((i) => i.code === 'ci-tone-rhyme'))
})

test('漏报侧：字数不符必须报 error，且不刷屏', { skip: !hasSnapshot }, () => {
  const bad = MASTERPIECES.虞美人.replace('往事知多少', '往事知多')
  const r = analyzeCi(bad, { ...real(), tuneName: '虞美人' })
  assert.equal(r.ok, false)
  assert.ok(r.issues.some((i) => i.code === 'ci-length'))
  const off = r.issues.filter((i) => i.code === 'ci-tone-off')
  assert.equal(off.length, 0, '整体错位时应抑制逐字「出谱」，只报字数不符')
})

/* ---------------- 8. 边界 ---------------- */

test('空输入：返回 fatal noLines', { skip: !hasSnapshot }, () => {
  const r = analyzeCi('   \n\n', real())
  assert.equal(r.fatal.code, 'noLines')
  assert.equal(r.score, 0)
})

test('不知名词牌：返回 fatal tuneNotFound', { skip: !hasSnapshot }, () => {
  const r = analyzeCi(MASTERPIECES.虞美人, { ...real(), tuneName: '根本没有这个词牌' })
  assert.equal(r.fatal.code, 'tuneNotFound')
  assert.equal(r.score, 0)
})

test('字数无任何词牌吻合：返回 fatal noFormat', { skip: !hasSnapshot }, () => {
  const r = analyzeCi('孤', real())
  assert.equal(r.fatal.code, 'noFormat')
})

test('suggestTunes：按字数给出候选词牌', { skip: !hasSnapshot }, () => {
  const list = suggestTunes(real().ciIndex, 56)
  assert.ok(list.length > 0)
  assert.ok(list.some((x) => x.name === '虞美人'), '56 字应有《虞美人》')
})

test('formatIndex：指定体会生效，并返回同词牌其他体', { skip: !hasSnapshot }, () => {
  const { ciIndex, toneIndex } = real()
  const all = ciIndex.byName.get('水调歌头').formats
  assert.ok(all.length > 5, '《水调歌头》应有多体')
  const r = analyzeCi(MASTERPIECES.水调歌头, { ciIndex, toneIndex, tuneName: '水调歌头', formatIndex: all.length - 1 })
  assert.equal(r.tune.formatIndex, all.length - 1)
  assert.equal(r.tune.alternatives.length, all.length)
})

/* ---------------- 9. 填词助手 ---------------- */

test('tuneGrid：给出按句分行的格子，含平仄与韵位', { skip: !hasSnapshot }, () => {
  const g = tuneGrid(real().ciIndex, '水调歌头')
  assert.equal(g.name, '水调歌头')
  assert.equal(g.len, 95)
  const cells = g.lines.flatMap((l) => l.cells)
  assert.equal(cells.length, 95)
  assert.ok(cells.every((c) => ['中', '平', '仄'].includes(c.tone)))
  assert.ok(g.lines.some((l) => l.rhyme), '应有押韵的句子')
  // 句内顿（读）不是每个词牌都有，改在全库范围验证解析链路没丢标记
  const withRead = real().ciIndex.names.slice(0, 200).some((n) =>
    tuneGrid(real().ciIndex, n).lines.some((l) => l.cells.some((c) => c.mark === MARK_READ)),
  )
  assert.ok(withRead, '前 200 个词牌中应至少有一个含句内顿')
  // 除末句外，每行都应以句/韵收尾
  g.lines.slice(0, -1).forEach((l) => {
    assert.ok(l.cells[l.cells.length - 1].mark >= MARK_SENT, '行末应为句读界')
  })
})

test('tuneGrid：别名与不存在的词牌', { skip: !hasSnapshot }, () => {
  assert.equal(tuneGrid(real().ciIndex, '花犯念奴').name, '水调歌头')
  assert.equal(tuneGrid(real().ciIndex, '根本没有'), null)
})
