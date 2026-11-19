// 正则测试 Worker：把用户正则放到独立线程执行，避免 (a+)+$ 这类灾难性回溯卡死主线程。
// 匹配语义与 text.js 的 collectRegexMatches 保持一致；Worker 内联实现以避免模块循环依赖。
self.onmessage = (e) => {
  const { pattern, flags, text } = e.data || {}
  try {
    const src = String(text ?? '')
    if (src.length > 20000) throw new Error('测试文本过长（上限 20000 字符），请精简后再试')
    let re
    try {
      re = new RegExp(pattern ?? '', flags || '')
    } catch (err) {
      throw new Error('正则表达式不合法：' + err.message)
    }
    const matches = []
    if (flags && flags.includes('g')) {
      let m
      let guard = 0
      while ((m = re.exec(src)) !== null && guard++ < 1000) {
        matches.push({ match: m[0], index: m.index, groups: m.slice(1) })
        if (m[0] === '') re.lastIndex++
      }
    } else {
      const m = re.exec(src)
      if (m) matches.push({ match: m[0], index: m.index, groups: m.slice(1) })
    }
    self.postMessage({ ok: true, result: { count: matches.length, matches: matches.slice(0, 200) } })
  } catch (err) {
    self.postMessage({ ok: false, error: err && err.message ? err.message : String(err) })
  }
}
