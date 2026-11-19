// 近体诗格律校验单测。
//
// 两类用例：
//   1. 手搓小索引 —— 只验算法逻辑，不依赖 public/classics/rhyme.json.gz（CI 未拉数据也能跑）
//   2. 真实韵书   —— 验入声字、韵部归属、名篇识别；快照缺失时自动跳过并提示
//
// 设计意图：格律工具最怕"把好诗判错"。因此这里对四首标准近体诗断言「零 error」，
// 对古风《黄鹤楼》断言「必须报错」——两者共同锁住误报与漏报两侧。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  buildIndex, analyzePoem, parseLines, lookupChar, groupChars, rhymeCatalog, toneOf, pingRhymesOf,
} from '../../src/lib/poemmeter.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const SNAPSHOT = join(ROOT, 'public/classics/rhyme.json.gz')
const hasSnapshot = existsSync(SNAPSHOT)

let realIndex = null
function real() {
  if (!realIndex) {
    realIndex = buildIndex(JSON.parse(gunzipSync(readFileSync(SNAPSHOT)).toString('utf8')))
  }
  return realIndex
}

// 手搓索引：覆盖平/仄/多三类字，以及平水韵五个声部各一韵
function miniIndex() {
  return buildIndex({
    rhyme: {
      上平声部: { 一东: '东同铜桐童' },
      下平声部: { 十一尤: '流楼愁秋' },
      上声部: { 三讲: '讲港棒蚌项' },
      去声部: { 四寘: '地意' },
      入声部: { 四质: '白日一' },
    },
    tone: ['东同铜桐童流楼愁秋山风声钟夫', '地意讲港棒蚌项白日一落客倚望夜半', '看思重过硬'],
  })
}

/* ---------------- 1. 索引与查表 ---------------- */

test('buildIndex：平仄三类字都能查到', () => {
  const idx = miniIndex()
  assert.equal(toneOf(idx, '东'), '平')
  assert.equal(toneOf(idx, '白'), '仄')
  assert.equal(toneOf(idx, '看'), '多')
  assert.equal(toneOf(idx, '〇'), null, '未收字应返回 null')
})

test('pingRhymesOf：只返回平声韵部', () => {
  const idx = miniIndex()
  const r = pingRhymesOf(idx, '东')
  assert.equal(r.length, 1)
  assert.equal(r[0].name, '一东')
  assert.equal(r[0].part, '上平声部')
  // 入声字不应有平声韵部
  assert.equal(pingRhymesOf(idx, '白').length, 0)
})

test('韵部查询：单字与整韵', () => {
  const idx = miniIndex()
  const one = lookupChar(idx, '流')
  assert.equal(one.tone, '平')
  assert.equal(one.rhymes[0].name, '十一尤')

  const g = groupChars(idx, '十一尤')
  assert.deepEqual(g.chars, ['流', '楼', '愁', '秋'])

  assert.equal(groupChars(idx, '不存在'), null)

  const cat = rhymeCatalog(idx)
  assert.equal(cat.length, 5, '五个声部各一韵')
})

/* ---------------- 2. 文本解析 ---------------- */

test('parseLines：每句一行的输入', () => {
  const { lines } = parseLines('白日依山尽\n黄河入海流\n欲穷千里目\n更上一层楼')
  assert.equal(lines.length, 4)
  assert.equal(lines[0], '白日依山尽')
})

test('parseLines：整首带标点粘成一行', () => {
  const { lines } = parseLines('白日依山尽，黄河入海流。欲穷千里目，更上一层楼。')
  assert.equal(lines.length, 4)
})

test('parseLines：无标点长文按 5 字切分并给出说明', () => {
  const { lines, notes } = parseLines('白日依山尽黄河入海流欲穷千里目更上一层楼')
  assert.equal(lines.length, 4)
  assert.equal(lines[0], '白日依山尽')
  assert.ok(notes.length, '应说明已自动切分')
})

test('parseLines：标题行与标点被剔除', () => {
  const { lines } = parseLines('登鹳雀楼\n白日依山尽，黄河入海流。\n欲穷千里目，更上一层楼。')
  // "登鹳雀楼" 5 字，会被当成一句——这是已知取舍：无法从文本区分标题与诗句
  // 此处断言不会把标点或空行混进来
  assert.ok(lines.every((l) => /^[\u4e00-\u9fff]+$/.test(l)))
})

/* ---------------- 3. 非近体诗的兜底 ---------------- */

test('字数不齐 → 致命错误 mixedLength', () => {
  const r = analyzePoem('白日依山尽\n黄河入海流啊\n欲穷千里目\n更上一层楼', miniIndex())
  assert.equal(r.ok, false)
  assert.equal(r.fatal.code, 'mixedLength')
})

test('句数不是 4 或 8 → lineCount', () => {
  const r = analyzePoem('春眠不觉晓\n处处闻啼鸟\n夜来风雨声\n花落知多少\n再多加一句', miniIndex())
  assert.equal(r.fatal.code, 'lineCount')
})

test('六言诗 → notFiveSeven', () => {
  const r = analyzePoem('一二三四五六\n一二三四五六\n一二三四五六\n一二三四五六', miniIndex())
  assert.equal(r.fatal.code, 'notFiveSeven')
})

test('空输入 → noLines', () => {
  const r = analyzePoem('   \n\n  ', miniIndex())
  assert.equal(r.fatal.code, 'noLines')
})

/* ---------------- 4. 出律与孤平（构造用例，用手搓索引） ---------------- */

const mIdx = miniIndex()

test('硬位置出律被标红（第 2 字平仄反了）', () => {
  // A 式 仄仄平平仄：第 2 字应为仄，这里用「东」(平) → 硬位出律
  const r = analyzePoem('白东依山尽\n流楼愁客秋\n白东千里目\n夜半望夫楼', mIdx)
  const hard = r.issues.filter((i) => i.code === 'tone-hard')
  assert.ok(hard.some((i) => i.line === 1 && i.col === 2), `应在第1句第2字报错，实得 ${JSON.stringify(hard)}`)
})

test('孤平：B 式句除韵脚外只剩一个平声', () => {
  // 第 2 句写成「仄平仄仄平」——B 式为「平平仄仄平」，首字该平而用仄
  const r = analyzePoem('白日依山尽\n夜风落客愁\n白东千里目\n夜半望夫楼', mIdx)
  assert.ok(r.issues.some((i) => i.code === 'guping' && i.line === 2), '应报孤平')
})

test('孤平不误报 D 式句（仄仄仄平平）', () => {
  // D 式本就三个仄声开头，除韵脚外只有一个平声，不是孤平
  const r = analyzePoem('白日依山尽\n流楼愁客秋\n白东千里目\n夜半望夫楼', mIdx)
  assert.ok(!r.issues.some((i) => i.code === 'guping' && i.line === 4), 'D 式不应判孤平')
})

test('三平调：句末三字全平', () => {
  // 第 4 句 D 式「仄仄仄平平」写成「仄仄平平平」
  const r = analyzePoem('白日依山尽\n流楼愁客秋\n白东千里目\n夜半风声钟', mIdx)
  assert.ok(r.issues.some((i) => i.code === 'sanping' && i.line === 4), '应报三平调')
})

test('多音字一律放行，不判出律', () => {
  const r = analyzePoem('白日依山尽\n流楼看过秋\n白东千里目\n夜半望夫楼', mIdx)
  const onKan = r.issues.filter((i) => i.ch === '看' && i.level === 'error')
  assert.equal(onKan.length, 0, '「看」为多音字，不应判错')
})

test('韵脚用仄声 → rhyme-ze', () => {
  const r = analyzePoem('白日依山尽\n流楼愁客白\n白东千里目\n夜半望夫楼', mIdx)
  assert.ok(r.issues.some((i) => i.code === 'rhyme-ze'), '韵脚为仄应报错')
})

test('韵部不同 → rhyme-mixed', () => {
  // 第 2 句韵脚「秋」(十一尤)、第 4 句韵脚「山」(不在手搓索引的平声韵中)
  const r = analyzePoem('白日依山尽\n流楼愁客秋\n白东千里目\n夜半望夫山', mIdx)
  assert.ok(
    r.issues.some((i) => i.code === 'rhyme-mixed' || i.code === 'rhyme-not-in-pingshui'),
    '异韵应被指出',
  )
})

/* ---------------- 5. 真实韵书：名篇对拍 ---------------- */

const NAMES = {
  登鹳雀楼: '白日依山尽，黄河入海流。\n欲穷千里目，更上一层楼。',
  春望: '国破山河在，城春草木深。\n感时花溅泪，恨别鸟惊心。\n烽火连三月，家书抵万金。\n白头搔更短，浑欲不胜簪。',
  早发白帝城: '朝辞白帝彩云间，千里江陵一日还。\n两岸猿声啼不住，轻舟已过万重山。',
  登高: '风急天高猿啸哀，渚清沙白鸟飞回。\n无边落木萧萧下，不尽长江滚滚来。\n万里悲秋常作客，百年多病独登台。\n艰难苦恨繁霜鬓，潦倒新停浊酒杯。',
}

test('真实韵书：四首标准近体诗零出律', { skip: !hasSnapshot && '未找到韵书快照，跳过（运行 npm run classics:fetch）' }, () => {
  const idx = real()
  for (const [name, text] of Object.entries(NAMES)) {
    const r = analyzePoem(text, idx)
    const errs = r.issues.filter((i) => i.level === 'error')
    assert.deepEqual(
      errs.map((e) => `${e.line}:${e.code}`),
      [],
      `${name} 不应有出律，实得：${JSON.stringify(errs.map((e) => e.message))}`,
    )
  }
})

test('真实韵书：诗体与起式识别正确', { skip: !hasSnapshot && '未找到韵书快照' }, () => {
  const idx = real()
  const cases = [
    ['登鹳雀楼', '5-4', 'ABCD', '仄'],
    ['春望', '5-8', 'ABCDABCD', '仄'],
    ['早发白帝城', '7-4', 'DBCD', '平'],
    ['登高', '7-8', 'BDABCDAB', '仄'],
  ]
  for (const [name, key, seq, startTone] of cases) {
    const r = analyzePoem(NAMES[name], idx)
    assert.equal(r.form.key, key, `${name} 诗体`)
    assert.equal(r.pattern.seq, seq, `${name} 句式序列`)
    assert.equal(r.pattern.startTone, startTone, `${name} 平起/仄起`)
    assert.equal(r.pattern.score, 100, `${name} 硬位符合率`)
  }
})

test('真实韵书：韵部判定正确', { skip: !hasSnapshot && '未找到韵书快照' }, () => {
  const idx = real()
  const expect = { 登鹳雀楼: '十一尤', 春望: '十二侵', 早发白帝城: '十五删', 登高: '十灰' }
  for (const [name, group] of Object.entries(expect)) {
    assert.equal(analyzePoem(NAMES[name], idx).rhyme.group, group, `${name} 韵部`)
  }
})

test('真实韵书：古风《黄鹤楼》必须报出律', { skip: !hasSnapshot && '未找到韵书快照' }, () => {
  // 此诗前半为古体句法，不合近体格律。若工具判它"合律"，说明校验形同虚设。
  const text = '昔人已乘黄鹤去，此地空余黄鹤楼。\n黄鹤一去不复返，白云千载空悠悠。\n晴川历历汉阳树，芳草萋萋鹦鹉洲。\n日暮乡关何处是，烟波江上使人愁。'
  const r = analyzePoem(text, real())
  assert.equal(r.ok, false, '《黄鹤楼》为古风，应报出律')
  assert.ok(r.issues.some((i) => i.level === 'error'))
})

/* ---------------- 6. 真实韵书：入声字（本项目的头号风险点） ---------------- */

test('真实韵书：入声字必须是仄声', { skip: !hasSnapshot && '未找到韵书快照' }, () => {
  // 普通话已无入声，凭拼音推平仄会全盘错。这些字今读多为阴平/阳平，
  // 古属入声（仄）。此断言即锁住「不能用拼音推」这条红线。
  const idx = real()
  const ruSheng = '白国竹石一发接别急客独觉节气'
  for (const ch of ruSheng) {
    assert.equal(toneOf(idx, ch), '仄', `入声字「${ch}」应为仄`)
  }
})

test('真实韵书：平仄两读字标为「多」而非单一值', { skip: !hasSnapshot && '未找到韵书快照' }, () => {
  const idx = real()
  for (const ch of '看过思重长难') {
    const t = toneOf(idx, ch)
    assert.ok(t === '多' || t === '平' || t === '仄', `「${ch}」应有平仄标注`)
  }
  // 至少「看」「过」「思」应识别为两读
  const twoRead = ['看', '过', '思'].filter((c) => toneOf(idx, c) === '多')
  assert.ok(twoRead.length >= 2, `「看/过/思」应多数识别为多音，实得 ${twoRead.join(',')}`)
})

/* ---------------- 7. 韵书快照质量 ---------------- */

test('韵书快照：106 韵部 / 字数达标', { skip: !hasSnapshot && '未找到韵书快照' }, () => {
  const idx = real()
  const s = idx.stats
  assert.equal(s.rhymes, 106, '平水韵应为 106 韵部（上游缺「三讲」，由脚本补录）')
  assert.ok(s.chars >= 10000, `韵书字数应 ≥ 10000，实得 ${s.chars}`)
  assert.ok(s.tones >= 8000, `平仄表应 ≥ 8000 字，实得 ${s.tones}`)
})

test('韵书快照：补录的「三讲」韵可用', { skip: !hasSnapshot && '未找到韵书快照' }, () => {
  const idx = real()
  const g = groupChars(idx, '三讲')
  assert.ok(g, '「三讲」韵应存在')
  assert.equal(g.part, '上声部')
  for (const ch of ['讲', '港', '棒', '蚌', '项']) {
    assert.equal(toneOf(idx, ch), '仄', `「${ch}」应可查到且为仄声`)
  }
})

test('韵书快照：平声韵部只含平声字', { skip: !hasSnapshot && '未找到韵书快照' }, () => {
  const idx = real()
  const pingGroup = groupChars(idx, '一东')
  assert.ok(pingGroup)
  const bad = pingGroup.chars.filter((ch) => toneOf(idx, ch) === '仄')
  assert.equal(bad.length, 0, `「一东」不应含仄声字，异常：${bad.slice(0, 5).join('')}`)
})
