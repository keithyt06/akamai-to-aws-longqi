# akamai-to-aws-longqi

> 把 **许昌龙麒 / beautyforever.com** 的 CDN + WAF 从 **Akamai** 等价迁移到 **AWS CloudFront + AWS WAF** 的 POC 项目。

| 项 | 值 |
|---|---|
| 客户 | Xuchang Longqi E-Commerce Co., Ltd.（许昌龙麒电子商务） |
| 业务域名 | `www.beautyforever.com`、`m.beautyforever.com`、`api.beautyforever.com` |
| 演示域名 | `www.beautyforever.keithyu.cloud`、`m.beautyforever.keithyu.cloud`、`api.beautyforever.keithyu.cloud` |
| Akamai 调研日期 | 2026-04-21（live audit） |
| 交付目标 | POC + 可交接代码 · 截止 **2026-05-22** |
| 验证方式 | 行为对比测试（Akamai 只读基线 vs CloudFront 实测） |

## 项目结构

```
akamai-to-aws-longqi/
├── README.md                       ← 本文件
├── CLAUDE.md                       ← 项目给 Claude 的规则
├── AKAMAI-READONLY.md              ← Akamai 只读约束
│
├── docs/superpowers/
│   ├── specs/
│   │   └── 2026-04-22-akamai-to-aws-longqi-design.md   ← 🎯 总体设计 spec
│   └── plans/                      ← 实施计划（待 writing-plans 产出）
│
├── Akamai/                         ← ✅ 现状调研已完成
│   ├── doc/    11 份结构化分析
│   ├── raw/    Akamai API 原始 JSON
│   └── html/   可视化视图
│
└── Cloudfront/                     ← 🚧 本项目主要产出
    ├── hands-on/       AWS Console 手动配置手册（12 章）
    ├── beautyforever/  极简 Node.js mock 源站（单 EC2 演示）
    ├── terraform/      可交接的 IaC
    ├── delivery/       客户评审交付物（MD + HTML，深色 AWS Architect 主题）
    └── test-harness/   行为对比测试框架
```

## 快速索引

- 设计文档：[`docs/superpowers/specs/2026-04-22-akamai-to-aws-longqi-design.md`](./docs/superpowers/specs/2026-04-22-akamai-to-aws-longqi-design.md)
- Akamai 现状：[`Akamai/doc/README.md`](./Akamai/doc/README.md)
- 动静态分析：[`Akamai/doc/90-dynamic-static-analysis.md`](./Akamai/doc/90-dynamic-static-analysis.md)
- 运维交叉比对：[`Akamai/doc/40-ops-verification.md`](./Akamai/doc/40-ops-verification.md)
- Akamai 只读约束：[`AKAMAI-READONLY.md`](./AKAMAI-READONLY.md)

## 12 章节交付

| 部 | 章节 | 主题 |
|---|---|---|
| 1 流量入口 | 01 | Distribution + Origin 分流（HTTP/2-only） |
|  | 02 | PC ↔ M 跳转 + UA / 路径白名单 |
|  | 03 | `?akaCache=nce` 全局缓存 Backdoor |
| 2 缓存行为 | 04 | Cache Policy + TTL 矩阵 |
|  | 05 | Query String 规范化（34 参数 EXCLUDE + utm 白名单） |
|  | 06 | Cookie Cache Key（CloudFront Functions） |
| 3 Response | 07 | Headers + HSTS + True-Client-IP + XFF Bug 修复 |
| 4 WAF | 08 | WAF 框架：Match Targets + 3 Policy |
|  | 09 | Custom Rules + ASN 202425 |
|  | 10 | Rate Policy + Slow POST + Bot Manager |
| 5 可观测 + 红利 | 11 | Real-time Logs → Kinesis → Python → Doris |
|  | 12 | Tag-Based Invalidation + Continuous Deployment |

## 项目状态

- [x] Phase -1：Akamai 现状调研（`Akamai/` 已完成，2026-04-21）
- [x] Phase 0：总体设计 spec（本文件 + `docs/superpowers/specs/...`）
- [ ] Phase 0：基础设施骨架（Wk1）
- [ ] Phase 1-N：12 章节按并行度推进（Wk2-Wk4）
- [ ] 收尾与评审（Wk5）

## 使用的工具链

- **Akamai 访问**：`akamai` CLI v2.0.3（`property-manager` + `appsec` plugin）、`edgegrid-python` SDK
- **AWS 部署**：Terraform ≥ 1.5
- **mock 源站**：Node.js ≥ 20
- **对比测试**：Python 3.11 + `httpx` + `pyyaml` + `jinja2`
- **日志消费**：Python + Doris MySQL client

## 维护者

Keith (AWS SA) · via OpenClaw / Claude Code
