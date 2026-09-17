<script setup>
import { RouterLink } from 'vue-router'
</script>

<template>
  <h1 class="page-title">隐私协议</h1>
  <p class="page-sub">最后更新：2025 年 · 生效日期同最后更新日</p>

  <div class="panel">
    <h3 style="margin-top: 0"><i class="bi bi-shield-lock"></i> 1. 核心原则：文件不上传</h3>
    <p style="color: var(--muted)">
      LocalForge 是纯前端应用，所有文件处理（压缩、解压、转换、转码、分享）均在你的浏览器本地通过
      JavaScript / WebAssembly 完成。<b style="color: var(--txt)">我们不会将你的任何文件上传到服务器，
      也不会在服务器端存储或读取你的文件。</b> 文件在内存中处理完毕后即被释放。
    </p>
  </div>

  <div class="panel">
    <h3 style="margin-top: 0"><i class="bi bi-bar-chart"></i> 2. 我们收集的数据</h3>
    <p style="color: var(--muted)">
      在「工具使用」过程中，我们不收集、不传输任何个人文件或文件内容。本站不要求登录，
      不设置用于追踪用户的账户体系。
    </p>
  </div>

  <div class="panel">
    <h3 style="margin-top: 0"><i class="bi bi-globe"></i> 3. 第三方广告（含 Google AdSense）</h3>
    <p style="color: var(--muted)">
      为维持运营，本站后续可能接入 <b style="color: var(--txt)">Google AdSense 等第三方广告联盟</b>。
      这类广告由第三方在其服务器上投放，可能会使用 <b style="color: var(--txt)">Cookie、广告标识符及类似技术</b>
      收集你的设备信息、浏览行为与近似地理位置，用于广告投放与效果衡量。
    </p>
    <ul style="color: var(--muted); font-size: 14px; line-height: 1.9; margin: 6px 0 0">
      <li>第三方广告商的数据处理受其各自隐私政策约束（如
        <a href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener">Google 广告政策</a>）。</li>
      <li>你可通过
        <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener">Google 广告设置</a>
        或 <a href="https://optout.aboutads.info" target="_blank" rel="noopener">YourAdChoices</a> 退出个性化广告。</li>
      <li>本站将在实际接入广告前，于本页更新具体广告合作伙伴与数据用途。</li>
    </ul>
  </div>

  <div class="panel">
    <h3 style="margin-top: 0"><i class="bi bi-cookie"></i> 4. Cookie 与本地存储</h3>
    <p style="color: var(--muted)">
      除第三方广告所需的 Cookie 外，本站可能使用浏览器本地存储（localStorage）仅保存你的界面偏好（如主题）。
      这些数据仅存于你的设备，不上传。
    </p>
  </div>

  <div class="panel">
    <h3 style="margin-top: 0"><i class="bi bi-people"></i> 5. 儿童隐私</h3>
    <p style="color: var(--muted)">
      本站不面向 13 岁以下儿童收集个人信息。如你发现儿童向我们提供了个人信息，
      请通过下方方式联系，我们将尽快删除。
    </p>
  </div>

  <div class="panel">
    <h3 style="margin-top: 0"><i class="bi bi-envelope"></i> 6. 联系我们</h3>
    <p style="color: var(--muted)">
      隐私相关问题可提交至
      <a href="https://github.com/javaeer/local-forge/issues" target="_blank" rel="noopener">GitHub Issues</a>。
      本协议可能不时更新，重大变更将在此公示。
    </p>
  </div>

  <div class="row">
    <RouterLink to="/" class="btn"><i class="bi bi-arrow-left"></i> 返回工具箱</RouterLink>
    <RouterLink to="/about" class="btn">关于 LocalForge</RouterLink>
  </div>
</template>
