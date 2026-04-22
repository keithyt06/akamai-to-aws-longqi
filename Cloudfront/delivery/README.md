# Cloudfront / delivery

> 客户评审级交付物。深色 AWS Architect 主题，MD + HTML 双版本。

## 目标

Keith 在 1 小时评审会上逐章讲完 12 章；客户也能自助阅读 HTML 并打 ✅/❌/📝 返回。每章有明确的"Akamai 现状 → CloudFront 方案 → 差异 → 验证证据 → 客户确认"五段结构。

## 结构（待实现）

```
delivery/
├── index.html               # 入口，含章节导航 + TOC + 总评分
├── assets/
│   ├── style.css            # 深色 AWS Architect 主题（自写）
│   ├── app.js               # 复制按钮、TOC、章节跳转
│   └── icons/
│
├── 01-distribution-behaviors.md  + .html
├── 02-redirect-whitelist.md      + .html
├── 03-akacache-backdoor.md       + .html
├── 04-cache-policy-ttl.md        + .html
├── 05-query-normalize.md         + .html
├── 06-cookie-cache-key.md        + .html
├── 07-headers-hsts-xff.md        + .html
├── 08-waf-policy-framework.md    + .html
├── 09-custom-rules-asn.md        + .html
├── 10-rate-slowpost-bot.md       + .html
├── 11-realtime-logs-doris.md     + .html
├── 12-tag-invalidation-cd.md     + .html
│
├── 99-comparison-matrix.html     # 全 12 章 test-harness 结果汇总
└── README.md                     # 本文件
```

## 每章五段结构

| § | 标题 | 内容 |
|---|---|---|
| §NN.1 | **问题陈述：Akamai 原做法** | 从 `Akamai/doc/` 提炼，含关键配置项、rule 锚点 |
| §NN.2 | **CloudFront 对应方案** | Akamai → AWS 对照表 + 配置片段（terraform HCL 或 Console 步骤）|
| §NN.3 | **差异与 trade-off** | 明确列出不等价点（如 ch01 HTTP/3 取消）|
| §NN.4 | **验证证据** | 引用 `test-harness/report/out/NN-*-matrix.html` |
| §NN.5 | **客户确认项** | ✅ / ❌ / 📝 勾选列表 |

## 样式规范

- 深色 AWS Architect 主题（自写 CSS，不复用旧项目 assets）
- 主色：AWS 橙 `#ec7211`（标题强调）、AWS 深蓝 `#232f3e`（背景）、灰 `#8c8c8c`（次要文字）
- 代码块：等宽字体 + 深灰底
- 表格：对照表左右对齐（Akamai 左、AWS 右）
- 每章顶部有"本章对应 Akamai 数据源"链接卡
- 每章末有 ✅/❌/📝 勾选表

## HTML 生成方式

MD → HTML 使用 Python + `markdown-it-py` 或 `pandoc`（Phase 0 定），自写 Jinja 模板套 `assets/style.css`。不依赖外部 CDN，HTML 可离线打开。

## 章节对应

详见 [`docs/superpowers/specs/2026-04-22-akamai-to-aws-longqi-design.md`](../../docs/superpowers/specs/2026-04-22-akamai-to-aws-longqi-design.md) §5.5。
