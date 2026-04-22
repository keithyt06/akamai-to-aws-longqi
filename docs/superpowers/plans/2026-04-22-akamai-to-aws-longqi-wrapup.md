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

## 已知迁移缺口（写入 delivery / README / coverage-matrix）

**按类型汇总（全部来自 `docs/superpowers/specs/coverage-matrix.md` 🟡 状态项）**：

### 协议 / 网络能力
1. **HTTP/3**：为 CloudFront CICD 放弃（trade-off，客户可选是否接受）
2. **Akamai `SureRoute PERFORMANCE`**：AWS 无精确等价；Origin Shield + Tiered Cache 部分替代；动态路径优化能力有损失
3. **Akamai `Adaptive Acceleration`**（MPulse 驱动 Push/Preconnect/Preload）：AWS 无原生等价；客户可用应用层 `<link rel="preconnect">` 等补偿

### WAF / 安全
4. **TLS Fingerprint 规则**（Client TLS Fingerprint 系列 Custom Rules）：AWS WAF 不原生支持 JA3/JA4
5. **Akamai Bot Manager** → AWS Bot Control：非 1:1 映射，AWS 是 `Common` / `Targeted` 等级
6. **Slow POST**：AWS 无原生等价；`size_constraint_statement` + CloudFront 超时 partial equivalence
7. **Rate Policy 窗口**：Akamai rpm vs AWS 5-min sliding，数值按 "Akamai rpm × 5" 换算

### 精度 / 缓存
8. **`prefreshCache = 90%`** → `stale-while-revalidate = 10%×TTL` 近似（精度差异 < 1 分钟）
9. **`cacheError ttl=10s preserveStale=true`** → `stale-if-error=60` + Custom Error Response min-TTL=10 近似
10. **Mobile UA 检测**：Akamai `deviceCharacteristic[IS_MOBILE]` 用内部设备库；CloudFront Function 用 UA 正则——边角 UA 可能分歧

### 图像 / 前端辅助
11. **`Image and Video Manager (IVM)`**：AWS 无原生图像处理；可用 CloudFront + Lambda@Edge 或 CloudFront Image Optimizer（2024）补
12. **`Augment insights` / mPulse**：AWS 可选 CloudWatch RUM 替代；客户自决

### 黑盒 / 待人工审阅
13. **Akamai `Advanced` XML metadata**（essl §18）：未解析，迁移前人工审阅
14. **`Js tag` 注入**（essl §11）：POC 用 placeholder；客户提供真实 JS 源码后再上
15. **`modifyOutgoingRequestHeader`** 具体回源头列表：POC 只建结构；具体 header 待客户补齐（spec §8.3 T7）

### 客户决策项
16. **HSTS preload 不可逆**：客户确认接受再 apply
17. **`breakConnection: enabled=true`（api）** 故障注入：客户确认保留还是删除
18. **Origin Shield 区域选择**：默认 `ap-northeast-1` 主区；客户可指定

## 下一步（客户侧）

POC 交付后，客户团队后续工作（本项目不含）：
- 切换 `www/m/api.beautyforever.com` DNS 到 CloudFront（蓝绿/灰度方案）
- 把 POC Terraform 的参数化改造为多环境（dev/staging/prod）
- 把 POC Doris 单机改为和现有生产 Doris 集群对接
- 对 HTTP/3 / Bot / TLS fingerprint 三块决定是否迁移或补偿方案
