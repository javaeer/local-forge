// CSS 速查表的引擎自检（独立模块，避免污染大数据文件 cssref.js）。
// 复用 cssref.js 导出的数据与方法，供 SelfTestPanel「运行全部自检」调用。
import { CATEGORY_ORDER, D, getVisual, hlCSS } from './cssref.js'

export async function selfTest() {
  const items = []
  const T = async (id, title, fn) => {
    try { const detail = await fn(); items.push({ id, title, ok: true, detail }) }
    catch (e) { items.push({ id, title, ok: false, error: { message: e.message, stack: e.stack } }) }
  }
  await T('categories', '7 大类完整', () => {
    if (CATEGORY_ORDER.length !== 7) throw new Error('分类数异常：' + CATEGORY_ORDER.length)
    return '7 类'
  })
  let propCount = 0
  await T('props-shape', '属性结构 [desc,code]', () => {
    for (const key of CATEGORY_ORDER) {
      const cat = D[key]
      for (const p of Object.keys(cat.props)) {
        const e = cat.props[p]
        if (!Array.isArray(e) || e.length !== 2) throw new Error(`结构异常 ${key}.${p}`)
        propCount++
      }
    }
    if (propCount < 250) throw new Error('属性过少：' + propCount)
    return propCount + ' 属性'
  })
  await T('getVisual', '全部属性可视化生成', () => {
    let n = 0
    for (const key of CATEGORY_ORDER) for (const p of Object.keys(D[key].props)) {
      const v = getVisual(p, key)
      if (typeof v !== 'string' || !v.length) throw new Error(`getVisual 为空 ${key}.${p}`)
      n++
    }
    if (n !== propCount) throw new Error('可视化为空：' + n + '/' + propCount)
    return n + ' 图示'
  })
  await T('hlCSS', '代码高亮', () => {
    const h = hlCSS('a { color: red; }')
    if (!/class="kw">color/.test(h)) throw new Error('关键字未高亮')
    if (!hlCSS('a { background: url(https://x.com/a.png); }').includes('https://')) throw new Error('URL 被误伤')
    return 'ok'
  })
  return { module: 'cssref', items }
}
