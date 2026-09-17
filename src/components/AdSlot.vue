<script setup>
// 广告位占位组件 —— 为后期接入 Google AdSense 等第三方广告预留。
// 接入方式（以 AdSense 为例）：
//   1) 在 index.html <head> 引入广告脚本（注意此处用 <\/script> 转义，避免被 SFC 解析器误判为块结束）。
//   2) 把下方 .ad-slot 占位 div 替换为：
//      <ins class="adsbygoogle" style="display:block"
//           data-ad-client="ca-pub-XXXX" data-ad-slot="YYYY"
//           data-ad-format="auto" data-full-width-responsive="true"></ins>
//      并在其后调用 (adsbygoogle = window.adsbygoogle || []).push({});
// 当前该组件不加载任何广告脚本、不收集任何数据，仅作布局占位。
defineProps({
  label: { type: String, default: '广告位预留' },
})
</script>

<template>
  <aside class="ad-slot" aria-label="advertisement">
    <span class="ad-tag">{{ label }}</span>
    <p class="ad-hint">
      此处为广告位预留区，后续将接入 Google AdSense 等第三方广告。<br />
      当前未加载任何广告脚本，不收集数据。
    </p>
  </aside>
</template>

<style scoped>
.ad-slot {
  margin: 18px 0;
  padding: 22px;
  border: 1px dashed var(--line);
  border-radius: 12px;
  background: var(--panel);
  text-align: center;
  color: var(--muted);
  min-height: 96px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.ad-tag {
  font-size: 11px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--accent);
}
.ad-hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
}
</style>
