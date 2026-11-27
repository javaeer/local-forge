// 统一文本复制：优先用异步 Clipboard API，失败时降级到 execCommand。
// 背景：headless 浏览器 / 非安全上下文 / 未授予剪贴板权限时，
// navigator.clipboard.writeText 会 reject；此时 execCommand('copy') 仍可用，
// 避免「复制全文」等功能在这些环境下误报失败（CI 的 chrome-headless-shell
// 曾因此让 bencao/tcmbooks 的 e2e 挂掉）。
export async function copyText(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 继续走降级
    }
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = String(text ?? '')
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, ta.value.length)
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    return ok
  } catch {
    return false
  }
}
