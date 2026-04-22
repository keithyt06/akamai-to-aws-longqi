# Wrapup · 收尾与交付日实施计划 · Skeleton

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

> **⚠ 本 plan 为 Skeleton**：task 级别清晰，进入 Wrapup 前用 `/superpowers:writing-plans` 细化到 2-5 分钟 sub-step 粒度。

**Goal:** Part 1-5 全部绿灯后，做最后的收尾：delivery HTML 打磨 + 所有 MD→HTML 一次生成 + 99-comparison-matrix 总览页 + 1 小时评审预演 + README 状态更新。交付日 2026-05-22。

**Architecture:** 一个 MD → HTML 的渲染脚本（Python + Jinja2 + markdown-it-py），套用 `Cloudfront/delivery/assets/style.css` 出 12 份 HTML。`99-comparison-matrix.html` 汇总 test-harness `report/out/` 下 12 张 matrix（iframe 或直接嵌入）。

**Tech Stack:** Python 3.11 · markdown-it-py · jinja2

**Spec reference:** [`../specs/2026-04-22-akamai-to-aws-longqi-design.md`](../specs/2026-04-22-akamai-to-aws-longqi-design.md) §7 Wk5

**Prerequisite:** Part 1-5 全部完成，`test-harness/report/out/NN-*-matrix.html` 12 张全绿（或已解释的红）。

---

## 文件结构

```
Cloudfront/delivery/
├── scripts/
│   └── render.py                     ← 新增：MD → HTML 批量渲染
├── assets/
│   ├── style.css                     ← 扩展：打磨细节
│   └── app.js                        ← 可选：复制按钮、TOC
├── 01..12 章节 .html                 ← 本 task 从 .md 批量生成
├── 99-comparison-matrix.html         ← 新增：汇总页
└── index.html                        ← 扩展：加"评分总览"和状态 badge

scripts/
└── preview.sh                        ← 本地 HTTP server 预览 delivery
```

---

## Task 23：MD → HTML 批量渲染

### Sub-tasks (skeleton)

- [ ] **23.1 写 `delivery/scripts/render.py`**（约 80 行）：

  ```python
  """Render delivery MD files to HTML using shared dark AWS theme."""
  import sys
  from pathlib import Path
  from markdown_it import MarkdownIt
  from jinja2 import Template

  ROOT = Path(__file__).resolve().parents[1]
  md = MarkdownIt('commonmark', {'html': True, 'linkify': True}).enable('table')

  TEMPLATE = Template("""<!DOCTYPE html>
  <html lang="zh"><head>
    <meta charset="UTF-8">
    <title>{{ title }}</title>
    <link rel="stylesheet" href="assets/style.css">
  </head><body>
  <header class="site">
    <h1>{{ title }}</h1>
    <p class="meta"><a href="index.html">← 返回目录</a></p>
  </header>
  <main>{{ body | safe }}</main>
  </body></html>
  """)

  for mdf in sorted(ROOT.glob('[0-9][0-9]-*.md')):
      html_body = md.render(mdf.read_text())
      title = mdf.stem.replace('-', ' ').title()
      out = ROOT / (mdf.stem + '.html')
      out.write_text(TEMPLATE.render(title=title, body=html_body))
      print(f'Rendered {mdf.name} -> {out.name}')
  ```

- [ ] **23.2 跑一次**：`cd Cloudfront/delivery && python3 scripts/render.py`

- [ ] **23.3 commit**：`wrapup: md->html batch renderer with dark AWS theme`

---

## Task 24：汇总页 99-comparison-matrix.html

### Sub-tasks (skeleton)

- [ ] **24.1 写 `delivery/99-comparison-matrix.html`**：

  ```html
  <!DOCTYPE html>
  <html lang="zh"><head>
    <meta charset="UTF-8">
    <title>99 · 对比测试总览矩阵</title>
    <link rel="stylesheet" href="assets/style.css">
  </head><body>
  <header class="site"><h1>99 · 对比测试总览矩阵</h1>
    <p class="meta"><a href="index.html">← 返回目录</a></p>
  </header>
  <main>
    <h2>12 章测试结果</h2>
    <table>
      <thead>
        <tr><th>章节</th><th>测试数</th><th>通过</th><th>失败/缺口</th><th>详情</th></tr>
      </thead>
      <tbody id="summary-body"></tbody>
    </table>

    <h2>每章详细矩阵</h2>
    <div id="chapters"></div>

    <script>
      const chapters = [
        { id: '01-distribution',       title: 'Distribution + Origin 分流' },
        { id: '02-redirect',           title: 'PC↔M 跳转' },
        { id: '03-akacache-backdoor',  title: '?akaCache=nce Backdoor' },
        { id: '04-ttl-matrix',         title: 'Cache TTL 矩阵' },
        { id: '05-query-normalize',    title: 'Query String 规范化' },
        { id: '06-cookie-cache-key',   title: 'Cookie Cache Key' },
        { id: '07-headers-hsts',       title: 'Headers + HSTS + XFF' },
        { id: '08-waf-policy-framework', title: 'WAF 框架' },
        { id: '09-custom-rules-asn',   title: 'Custom Rules + ASN' },
        { id: '10-rate-slowpost-bot',  title: 'Rate + Bot' },
        { id: '11-realtime-logs',      title: 'Real-time Logs → Doris' },
        { id: '12-tag-cd',             title: 'Tag Invalidation + CD' },
      ];
      const container = document.getElementById('chapters');
      chapters.forEach(c => {
        const h = document.createElement('h3');
        h.textContent = c.id + ' · ' + c.title;
        const frame = document.createElement('iframe');
        frame.src = '../test-harness/report/out/' + c.id + '-matrix.html';
        frame.style = 'width:100%;height:400px;border:1px solid #555';
        container.appendChild(h); container.appendChild(frame);
      });
    </script>
  </main></body></html>
  ```

- [ ] **24.2 扩展 index.html**：在 12 章节卡片后加"99 对比总览"的 card（Phase 0 骨架里已有占位，取消 `pending` badge，改为 `done`）。

- [ ] **24.3 预览**：

  ```bash
  cd Cloudfront/delivery
  python3 -m http.server 8000
  # 浏览器打开 http://localhost:8000/index.html 逐一点 12 章节 + 99 总览
  ```

- [ ] **24.4 commit**：`wrapup: 99-comparison-matrix summary + index update`

---

## Task 25：评审材料 + 1 小时预演

### Sub-tasks (skeleton)

- [ ] **25.1 写 `delivery/REVIEW-AGENDA.md`**：1 小时评审议程（按 spec §5.3 的 1 小时常规讲法：Part 1 + Part 2 + ch08 WAF 概览 + Part 5）。
- [ ] **25.2 预演**：按议程走一遍 index.html + 相关章节，记录卡顿/不清晰的点，回头修 delivery。
- [ ] **25.3 演示脚本** `scripts/demo.sh`：按顺序运行关键 curl 命令 + 截图命令，演示用。
- [ ] **25.4 commit**：`wrapup: review agenda + demo script`

---

## Task 26：项目 README + 最终提交

### Sub-tasks (skeleton)

- [ ] **26.1 更新顶层 `README.md`**：
  - "项目状态" 全部 ✅
  - 加 "Quick Start for Customer" 段：`git clone` + `terraform init/apply` + 访问 delivery/index.html
  - 加 "Known Gaps" 列举（TLS fingerprint 不等价、Bot Manager 非 1:1、HTTP/3 让位给 CICD）
- [ ] **26.2 更新 plans index**：所有 7 份 plan 状态改为 `✅ 已完成`。
- [ ] **26.3 最后一次 `terraform destroy` + `apply` 验证**：证明 30 分钟内从零拉起全部环境。
- [ ] **26.4 tag 版本**：
  ```bash
  git tag -a v1.0.0 -m "Customer delivery · 2026-05-22"
  git push origin v1.0.0
  ```
- [ ] **26.5 commit + push**：`wrapup: final delivery · all green · ready for customer review`

---

## Wrapup 完成里程碑

**日期**：2026-05-22 交付日

- [ ] Task 23: MD → HTML 全部渲染
- [ ] Task 24: 99-comparison-matrix 完成
- [ ] Task 25: 评审材料 + 预演
- [ ] Task 26: README 最终版 + v1.0.0 tag

## 交付内容清单（给客户）

| 内容 | 位置 |
|---|---|
| 设计 spec | [`docs/superpowers/specs/2026-04-22-akamai-to-aws-longqi-design.md`](../specs/2026-04-22-akamai-to-aws-longqi-design.md) |
| Akamai 现状调研 | `Akamai/doc/` 11 份 |
| CloudFront Console 手册 | `Cloudfront/hands-on/` 12 份 |
| 业务 mock 源码 | `Cloudfront/beautyforever/` |
| Terraform IaC | `Cloudfront/terraform/` |
| 客户评审文档 | `Cloudfront/delivery/` 12 章 + 总览 |
| 对比测试框架 | `Cloudfront/test-harness/` |
| Git Tag | `v1.0.0` |

## 已知迁移缺口（2026-04-22 客户回复后更新）

**按类型汇总。✅ = 客户已明确接受或提供替代方案；🟡 = 待 Keith 进一步解释后客户决定。**

### 协议 / 网络能力
1. ✅ **HTTP/3**（客户 G1）：HTTP/2 够用，主要演示 CICD 持续集成发布
2. ✅ **`SureRoute PERFORMANCE`**（客户 G2 2026-04-22 决定不做）：主要客户群体在北美，CloudFront 全球 Edge 能扛住；若未来延迟问题可再接 AWS Global Accelerator
3. ✅ **`Adaptive Acceleration`**（客户 G3 2026-04-22 决定不做）：AA 是 Akamai 前端加速（Push/Preconnect/Preload），和 AWS WAF SDK **无关**；迁移后若需 preconnect/preload 由前端在 Nuxt `<head>` 手工加 `<link>` 即可
4. ✅ **Origin Shield**（客户 T2 2026-04-22 决定不开）：默认 `origin_shield_enabled = false`；北美客户群 CloudFront Edge 直连足够

### WAF / 安全
5. ✅ **TLS Fingerprint 规则**（客户 G5 2026-04-22 round-3 确认）：**用 Bot Control Targeted 覆盖**（G6 已启用）——AWS WAF SDK + ML 模型收集几十维度浏览器指纹（canvas/WebGL/screen/fonts 等），是 TLS JA3/JA4 单维指纹的超集替代
6. ✅ **Akamai Bot Manager → AWS Bot Control**（客户 G6）：按 path 同时演示 Common（公开页）+ Targeted（敏感 API 路径）两档
7. ✅ **Slow POST**（客户 G7 2026-04-22）：不做原生等价；用 Rate-Based Rule（POST 3/5 rpm）+ CloudFront Origin read timeout 30s + ALB idle timeout 60s 共同覆盖威胁面
8. **Rate Policy 窗口**：Akamai rpm vs AWS 5-min sliding，换算 `Akamai rpm × 5`（delivery §10 自动处理）

### 精度 / 缓存
9. ✅ **`prefreshCache = 90%`**（客户 T3 决定不做）：CDN 自动预刷不做，业务侧**独立预热方案**覆盖
10. ✅ **`cacheError ttl=10s preserveStale=true`**（客户 T3 + 成本确认无影响）：保留 `stale-if-error=60s` + CER min-TTL=10；SIE 在源站 5xx 时返回已有缓存，**不产生额外回源请求，无额外成本**
11. **Mobile UA 检测**：Akamai `deviceCharacteristic[IS_MOBILE]` vs CloudFront Function UA 正则——边角 UA 可能分歧

### 图像 / 前端辅助
12. ✅ **`Image and Video Manager (IVM)`**（客户 G4）：API 是静态 JSON，不需要
13. **`Augment insights` / mPulse**：客户自决是否用 CloudWatch RUM 替代

### 黑盒 / 待人工审阅
14. **Akamai `Advanced` XML metadata**（essl §18）：未解析，迁移前人工审阅
15. ✅ **"Js tag" 真相**（客户 T6）：读 raw JSON 发现是 `.js` 文件的 cacheTag 不是 JS 注入；归并 ch12 Tag Invalidation（`bf-www-js` / `bf-m-js`）
16. ✅ **`modifyOutgoingRequestHeader`**（客户 T7 读 raw JSON）：保留原值 `Source-Auth: akamai-lqhair`

### 客户决策项
17. ✅ **HSTS preload**（客户 T12 2026-04-22 决定 POC 不加）：保留 `max-age=2y + includeSubDomains`，**不含 preload**（对齐 Akamai 生产 v62 未启用）；客户可后续按需开启
18. ✅ **`breakConnection: enabled=true`（api）**（客户 T10 2026-04-22 决定不迁）：演练残留，迁移后主动移除
19. ✅ **X-WAF-Rules-Triggered**（客户 T9 2026-04-22 决定做）：WAF Labels 桥接；业务用途 = 日志标记 + SEO 降级（mock 在命中高风险规则时注入 `<meta robots=noindex,nofollow>` demo）

## 下一步（客户侧）

POC 交付后，客户团队后续工作（本项目不含）：
- 切换 `www/m/api.beautyforever.com` DNS 到 CloudFront（蓝绿/灰度方案）
- 把 POC Terraform 的参数化改造为多环境（dev/staging/prod）
- 把 POC Doris 单机改为和现有生产 Doris 集群对接
- 对 HTTP/3 / Bot / TLS fingerprint 三块决定是否迁移或补偿方案
