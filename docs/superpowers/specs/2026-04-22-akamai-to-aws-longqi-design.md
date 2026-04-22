# Akamai → AWS CloudFront 迁移 POC · 总体设计 Spec

> **项目**：`akamai-to-aws-longqi`
> **客户**：许昌龙麒电子商务（Xuchang Longqi E-Commerce Co., Ltd.）
> **业务**：`beautyforever.com`（www + m + api）
> **Akamai 数据截止**：2026-04-21 live audit
> **Spec 日期**：2026-04-22
> **交付目标**：POC + 可交接代码 · 2026-05-22
> **作者**：Keith · via Claude Opus 4.7

---

## 1. 目标与非目标

### 1.1 目标

用 **CloudFront + AWS WAF** 等价复现许昌龙麒 `beautyforever.com` 在 Akamai 上的**全部生产行为**（基于 2026-04-21 live audit），并通过**行为对比测试**证明等价，输出：

1. 可跑通的 POC 演示环境（3 个演示域名、1 台 EC2 源站、2 个 CloudFront Distribution、3 个 WAF Web ACL、Kinesis+Doris 日志链路）
2. 可交接给客户运维的 Terraform IaC
3. AWS Console 手动配置手册（12 章）
4. 客户评审级交付文档（MD + HTML 深色主题）
5. 覆盖 12 章节的行为对比测试矩阵

### 1.2 非目标（明确排除）

- **不做**真实电商业务逻辑（购物车/支付/订单）
- **不做**生产切换 runbook（客户内部团队后续接手）
- **不做**多环境/多 workspace（dev/staging/prod 分层）
- **不做**和旧项目 `longqi-cloudfront` 的 import / 复用 / 对比
- **不搬** Akamai 空 Bypass Network List（`146351_SECURITYBYPASSLIST`，`elementCount = 0`）
- **不做**对客户 Akamai 生产账号的任何破坏性测试
- **不做** Akamai `Advanced` XML metadata（essl §18）的等价复现（黑盒，delivery §01.5 声明未解析）

---

## 2. 环境假设

### 2.1 AWS

| 项 | 值 |
|---|---|
| AWS 账号 | Keith 演示账号（Phase 0 确认 Account ID） |
| Terraform profile | `default`（或 Phase 0 指定） |
| 主区域 | `ap-northeast-1`（东京） |
| CloudFront Web ACL 区域 | `us-east-1` |
| ACM 证书区域 | `us-east-1`（CloudFront 强制） |
| tfstate 后端 | S3 + DynamoDB lock（Phase 0 创建） |

### 2.2 域名与证书

| 项 | 值 |
|---|---|
| 生产业务域名（客户持有） | `www.beautyforever.com`、`m.beautyforever.com`、`api.beautyforever.com` |
| POC 演示域名（Keith 持有） | `www.beautyforever.keithyu.cloud`、`m.beautyforever.keithyu.cloud`、`api.beautyforever.keithyu.cloud` |
| Hosted Zone | `keithyu.cloud`（Route53） |
| 证书 | 3 个 ACM 证书（`us-east-1`），每个演示子域一张，DNS 验证 |

### 2.3 源站

| 项 | 值 |
|---|---|
| 实例 | 1 台 EC2（`t3.small`，`ap-northeast-1`） |
| 框架 | Node.js ≥ 20，单进程按 Host header 分流 |
| 前置 | 1 个 ALB，3 条 host-based listener rule（`www/m/api.beautyforever.keithyu.cloud` → 同一 EC2 的不同 upstream 路径或端口） |
| Mock 真实度 | 极简 Node.js mock；只返回能验证 CDN/WAF 行为的响应（Set-Cookie、Cache-Control、UA 判断、Vary） |

### 2.4 Akamai 访问（只读）

| 项 | 值 |
|---|---|
| 凭据 | `/root/.edgerc`，sections `[default]` `[papi]` `[appsec]` |
| 账号 | 客户 `act_F-AC-4891758`（Xuchang Longqi） |
| 访问模式 | **只读**，详见 [AKAMAI-READONLY.md](../../../AKAMAI-READONLY.md) |
| 用途 | 对比测试基线抓取、rule tree 重读、响应头采样 |

### 2.5 日志链路（对齐客户现状）

```
CloudFront Real-time Logs
    ↓
Kinesis Data Stream
    ↓
Python consumer (EC2)
    ↓
Doris (single-node, EC2)
```

Doris 单机部署参考现有脚本（客户侧已有经验），由 Terraform 拉起。

---

## 3. 目录结构 & 每个目录的 Definition of Done

### 3.1 最终目录树

```
akamai-to-aws-longqi/
├── README.md
├── CLAUDE.md
├── AKAMAI-READONLY.md
├── .gitignore
│
├── docs/superpowers/
│   ├── specs/       本 spec 所在
│   └── plans/       writing-plans 产出
│
├── Akamai/          ✅ 只读的现状调研（已完成）
│   ├── doc/  11 份 md
│   ├── raw/  API 原始 JSON
│   └── html/
│
└── Cloudfront/
    ├── hands-on/    12 份 AWS Console 手册 + README
    ├── beautyforever/  Node.js mock + docker-compose + README
    ├── terraform/   main.tf + variables.tf + outputs.tf + modules/ + environments/poc/ + README
    ├── delivery/    index.html + 12 份 MD+HTML + 99-comparison-matrix.html + assets/ + README
    └── test-harness/ cases/ + baseline/ + probe/ + report/ + Makefile + README
```

### 3.2 Definition of Done 矩阵

| 目录 | 完成标准 | 验收信号 |
|---|---|---|
| `Akamai/` | 已完成（2026-04-21） | 无需改动 |
| `hands-on/` | 12 份 md 手册，每份都是亲手在 AWS Console 操作过一遍的步骤截图 + 要点 + 对应 terraform resource | 按 md 从零手动点一遍能复现同样 CloudFront |
| `beautyforever/` | 3 路由 mock 服务，覆盖 Akamai rule tree 要求的所有响应特征（Set-Cookie/Cache-Control/Vary/状态码/跳转） | `docker-compose up` 启动后 curl 各路径能拿到符合 Akamai 文档预期的响应 |
| `terraform/` | 单 `terraform apply` 从零拉起 POC 环境；`terraform destroy` 干净释放 | 新 AWS 账号 clone 后 30 分钟内 apply 成功并对比测试通过 |
| `delivery/` | 12 份 MD + HTML（深色 AWS Architect 主题） + 汇总矩阵 + index；客户能在无讲解下自助阅读并打 ✅/❌/📝 | Keith 1 小时评审会能完整讲完 |
| `test-harness/` | YAML 用例 ≥ 60 条（每章 5-8 条），`make all` 输出 `report/comparison.html` | 12 章 diff 矩阵全绿 或已解释的红 |

---

## 4. 实施阶段：Phase 0 基建

Phase 0 估计 3-5 个工作日。所有章节并行推进的前提。

| # | 项 | 说明 |
|---|---|---|
| 1 | AWS 账号准入 | 账号 ID、profile、tfstate S3 bucket + DynamoDB lock |
| 2 | Route53 + ACM | `keithyu.cloud` hosted zone 确认 + 3 个子域 ACM 证书（`us-east-1`） |
| 3 | 源站：1 台 EC2 + 1 ALB | EC2 `t3.small`，Node.js mock 骨架，ALB 3 条 host-based listener rule |
| 4 | CloudFront 骨架 | 2 Distribution（essl / api），`HttpVersion = http2`，指向 ALB，无 cache policy（后续章节补） |
| 5 | WAF 骨架 | 3 个空 Web ACL（对齐 Policy Deny / Alert / Api），Association 到 Distribution |
| 6 | Doris on EC2 | 单机部署（Terraform 自动化），暴露 MySQL 9030 端口 |
| 7 | Kinesis + Python consumer | CloudFront Real-time Logs → KDS → Python consumer（deploy on EC2 或 ECS）→ Doris INSERT |
| 8 | test-harness 骨架 | 目录树 + baseline/probe 占位脚本 + smoke 用例（首页 200 OK） |
| 9 | delivery 骨架 | `index.html` + 12 章节占位 + 自写深色主题 CSS |
| 10 | 项目级 guard-rails | CLAUDE.md、AKAMAI-READONLY.md、.gitignore（已完成） |

---

## 5. 12 章节清单（按客户认知顺序）

### 5.1 章节地图

| 部 | # | 章节 | Akamai 依据 | 关键技术手段 |
|---|---|---|---|---|
| **1 流量入口** | 01 | Distribution + Origin 分流 | essl v62 Hostnames 父规则分 www/m；api v10 独立 property；HTTP/3 取消 | 2 Distribution、Host-based ALB routing、HTTP/2-only |
|  | 02 | PC ↔ M 跳转 + UA / 路径白名单 | 302 跳转；`LqPassWaf/851.3` UA 白名单；Apple Pay `.well-known` 白名单；`js/css` 不跳转 | CloudFront Function（viewer-request） |
|  | 03 | `?akaCache=nce` Backdoor | Akamai 全域绕缓存开关 | CloudFront Function 强制 `Cache-Control: no-store` |
| **2 缓存行为** | 04 | Cache Policy + TTL 矩阵 | 首页 6h / 列表 6h / 博客 365d / 活动 6h / `/static/` 1d / CSS+JS+字体+图片 365d；api 默认 NO_STORE | CachePolicy per-behavior、OriginRequestPolicy |
|  | 05 | Query String 规范化 | 列表&详情 EXCLUDE 34 参数；api IGNORE 20+ 广告参数；`utm_source=google/facebook/tiktok` 进 cache key | CloudFront Function + CachePolicy QueryStringsConfig |
|  | 06 | Cookie Cache Key | www/m: `currency/group_id/abTest`；api: `customer_group/currency` | CloudFront Function（viewer-request）规范化 cookie 并注入 cache-key header |
| **3 Response** | 07 | Headers + HSTS + True-Client-IP + XFF 修复 | 删 `X-Powered-By/Server`；HSTS 2 年 + preload（Akamai staging 已有）；True-Client-IP；修 `" x-authentic-ip"` 前导空格 bug | Response Headers Policy + CloudFront Function |
| **4 WAF** | 08 | WAF 框架：Match Targets + 3 Policy | `Policy Deny` (qik1_201886) / `Policy Alert` (1218_239915) / `Policy Api` (0124_243504) | 3 Web ACL（或 1 ACL + scope-down by host） |
|  | 09 | Custom Rules + ASN 拦截 | 19 条 Custom Rules；当天新增 Rule `60383229`（ASN 202425 + www.beautyforever.com） | AWS WAF Custom Rule、`ASN match statement` |
|  | 10 | Rate Policy + Slow POST + Bot Manager | 5 Rate Policy（Origin Error 5/8rpm、Page View 15/25、POST Page 3/5、API 13/20、Static 13/20）；Slow POST；Bot Manager | WAF Rate-Based Rule、Bot Control Managed Rule |
| **5 可观测 + 红利** | 11 | Real-time Logs → Doris | Akamai DataStream（客户现有 Kinesis → Python → Doris 架构） | CloudFront Real-time Logs + KDS + Python consumer + Doris EC2 |
|  | 12 | Tag-Based Invalidation + Continuous Deployment | Akamai `cacheTag`（`bf-all/bf-home/bf-listinfo/bf-blog/bf-activity`）+ Fast Purge by Tag；CloudFront 新能力：蓝绿 | `Surrogate-Key` 响应头 + `CreateInvalidationForDistributionTenant`；primary + staging distribution + CDP |

### 5.2 叙事逻辑

- **Part 1 入口**：客户请求进入 CDN 的第一步（分流 → 跳转 → backdoor），顺序天然
- **Part 2 缓存**：TTL（概念）→ Query String（清洗）→ Cookie（最难）。难点在后，客户热身后进入
- **Part 3 Response**：缓存决定后，响应路径的 header 处理
- **Part 4 WAF**：横切关注点，分 3 章。框架（08）→ 规则细节（09, 10）
- **Part 5 红利**：CloudFront 独有或更好的能力，客户带走正面印象

### 5.3 分层演示

| 会议时长 | 讲什么 |
|---|---|
| 15 分钟快讲 | Part 1 + Part 5（入口 + 红利） |
| 1 小时常规 | Part 1 + Part 2 + ch08 WAF 概览 + Part 5 |
| 3 小时全覆盖 | 全 12 章 |

### 5.4 章节依赖图

```
Phase 0 基建
  │
  ├─ ch01 Distribution + Origin 分流   ← 所有后续章节的基底
  │    │
  │    ├─ ch02 PC↔M 跳转 ─────────┐
  │    ├─ ch03 ?akaCache=nce ─────┤  Part 1 串行
  │    │                          │
  │    ├─ ch04 TTL 矩阵 ──────────┐
  │    ├─ ch05 Query 规范化 ──────┤  Part 2 串行（都进 cache key 收口）
  │    ├─ ch06 Cookie Cache Key ──┘
  │    │
  │    └─ ch07 Headers + HSTS ─── Part 3 独立
  │
  ├─ ch08 WAF 框架
  │    └─ ch09 Custom Rules ─── 与 ch10 并行
  │    └─ ch10 Rate + Bot
  │
  ├─ ch11 Real-time Logs → Doris （Phase 0 拉通后独立）
  │
  └─ ch12 Tag Invalidation + CICD （依赖 ch01 稳定）
```

Team Agent 分线建议：
- 线 A：Part 1 → Part 2 → Part 3（串行 cache 主线）
- 线 B：Part 4（WAF）
- 线 C：ch11（Logs → Doris）
- 线 D：ch12（最后做，依赖 Distribution 稳定）

### 5.5 每章统一交付模板

每章节号 `NN` 在 4 个目录 + 1 个 harness 下各有产出：

```
Cloudfront/
├── hands-on/NN-<topic>.md
│   ├─ ① Akamai 现状摘录（引用 Akamai/doc/ 的锚点）
│   ├─ ② CloudFront / WAF 等价做法（Console 步骤 + 截图位）
│   ├─ ③ 关键配置项截图/表格
│   └─ ④ 与 terraform/modules/NN-*/ 的对应关系
│
├── beautyforever/<path>/
│   └─ 该章节涉及的 mock 路由或中间件
│
├── terraform/modules/NN-<topic>/
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   └── README.md（引用 hands-on/NN-*.md）
│
├── delivery/NN-<topic>.md + .html
│   ├─ §NN.1 问题陈述（Akamai 原做法）
│   ├─ §NN.2 CloudFront 对应方案（Akamai→AWS 对照表）
│   ├─ §NN.3 差异与 trade-off（如 ch01 的 HTTP/3 取消）
│   ├─ §NN.4 验证证据（test-harness 产出的对比数据）
│   └─ §NN.5 客户确认项 ✅/❌/📝
│
└── test-harness/cases/NN-<topic>.yaml
    └─ 5-8 条 YAML 用例（baseline + probe + diff 预期）
```

---

## 6. test-harness 架构

### 6.1 目标

**一键**产出 delivery §NN.4 所需的"验证证据"。

### 6.2 结构

```
test-harness/
├── cases/                       # 人读的测试用例（YAML）
│   ├── 01-distribution.yaml
│   ├── 02-redirect.yaml
│   ├── 03-akacache-backdoor.yaml
│   ├── 04-ttl-matrix.yaml
│   ├── 05-query-normalize.yaml
│   ├── 06-cookie-cache-key.yaml
│   ├── 07-headers-hsts.yaml
│   ├── 08-waf-policy-framework.yaml
│   ├── 09-custom-rules-asn.yaml
│   ├── 10-rate-slowpost-bot.yaml
│   ├── 11-realtime-logs.yaml
│   └── 12-tag-cd.yaml
│
├── baseline/                    # Akamai 侧（只读）
│   ├── probe.py                 # GET only, asserts method
│   └── artifacts/YYYY-MM-DD/    # JSON 快照，按日期存档
│
├── probe/                       # CloudFront 侧（主动测试，含破坏性）
│   ├── probe.py
│   └── artifacts/YYYY-MM-DD/
│
├── report/
│   ├── compare.py               # diff baseline + probe，生成矩阵
│   ├── templates/               # Jinja HTML 模板
│   └── out/                     # 给 delivery 引用的 HTML/JSON 片段
│
├── Makefile                     # make baseline / probe / report / all
└── README.md
```

### 6.3 YAML 用例格式

```yaml
# test-harness/cases/02-redirect.yaml
chapter: 02-redirect
cases:
  - id: pc-ua-to-m-302
    description: "Mobile UA 访问 www 首页应 302 到 m 域名"
    request:
      url: "https://{host}/"
      headers:
        User-Agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 …)"
    expectations:
      status: 302
      location_regex: "^https://m\\.beautyforever\\.(com|keithyu\\.cloud)/"
    hosts:
      akamai: www.beautyforever.com
      cloudfront: www.beautyforever.keithyu.cloud

  - id: lqpasswaf-ua-no-redirect
    description: "LqPassWaf UA 白名单，不跳转"
    request:
      url: "https://{host}/"
      headers:
        User-Agent: "LqPassWaf/851.3"
    expectations:
      status: 200
    hosts:
      akamai: www.beautyforever.com
      cloudfront: www.beautyforever.keithyu.cloud

  - id: apple-pay-path-no-redirect
    description: "Apple Pay .well-known 路径不跳转"
    request:
      url: "https://{host}/.well-known/apple-developer-merchantid-domain-association.txt"
    expectations:
      status: 200
    hosts:
      akamai: m.beautyforever.com
      cloudfront: m.beautyforever.keithyu.cloud
```

### 6.4 输出

```
test-harness/report/out/
├── 01-distribution-matrix.html     # 可被 delivery/01-*.html <iframe> 或 partial 引入
├── ...
├── 12-tag-cd-matrix.html
├── all-summary.html                 # 全 12 章总览
└── raw/
    └── YYYY-MM-DD-<chapter>.json    # 结构化 diff 数据
```

### 6.5 安全栅栏（硬编码）

- `baseline/probe.py` 启动时 assert `method in {"GET", "HEAD"}`
- baseline 请求 User-Agent 固定 `Keithyu-Akamai-Baseline/1.0 (read-only)`
- baseline 对客户生产域名限速 ≤ 10 req/hour
- baseline 运行窗口：00:00-06:00 CST（夜间低峰）
- 仅允许打客户生产域名（white-list in code）
- 任何破坏性用例（rate limit / WAF block / Bot）只绑定 `cloudfront` host，不绑定 `akamai` host

---

## 7. 排期（一个月，22 工作日）

按工作日估计，数字 = 人·工作日（PD）。

| 周 | 起止 | 工作 | PD |
|---|---|---|---|
| **Wk1** | 04/22–04/28 | **Phase 0 基建**：AWS/tfstate/Route53/ACM、EC2+ALB+Node.js 骨架、2 Distribution + 3 WebACL、Doris EC2、Kinesis + Python 骨架、test-harness + delivery 骨架 | 5 |
| **Wk2** | 04/29–05/05 | Part 1 + 半个 Part 2：ch01 Distribution、ch02 跳转、ch03 backdoor、ch04 TTL、ch05 Query 规范化 | 5 |
| **Wk3** | 05/06–05/12 | 完成 Part 2 + Part 3 + 启动 Part 4：ch06 Cookie、ch07 Headers、ch08 WAF 框架；ch11 Real-time Logs 并行 | 5 |
| **Wk4** | 05/13–05/19 | 完成 Part 4 + 启动 Part 5：ch09 Custom Rules+ASN、ch10 Rate+Bot、ch12 Tag+CICD、harness 全用例闭环 | 5 |
| **Wk5 半** | 05/20–05/22 | 收尾：delivery HTML 打磨、对比矩阵总览、预演 | 2 |
| **合计** |  |  | **22 PD** |

### 关键里程碑

| 日期 | 里程碑 | 验收 |
|---|---|---|
| 2026-04-29 | Phase 0 完成 | `terraform apply` 起 2 Distribution + 3 WebACL + Doris + Kinesis；smoke 测试绿 |
| 2026-05-06 | Part 1 全完 | ch01-03 delivery + test-harness 全绿 |
| 2026-05-13 | Part 2 + Part 3 全完 | cookie cache key + 34 参数 EXCLUDE 验证通过 |
| 2026-05-20 | Part 4 + Part 5 全完 | 12 章全绿 |
| 2026-05-22 | 交付日 | 客户评审 |

---

## 8. 风险与未决项

### 8.1 风险登记

| # | 风险 | 应对 |
|---|---|---|
| R1 | **ch06 Cookie Cache Key** 是 CloudFront Functions 最复杂一块，可能超 2 PD | Wk4 预留 buffer；必要时降级为 Lambda@Edge |
| R2 | **AWS WAF Bot Control 与 Akamai Bot Manager 规则模型差异** | ch10 声明"尽力而为等价"，差异项列入 delivery §10.3 |
| R3 | **WAF WCU 上限 1500** 可能装不下 19 条 Custom Rules + 5 条 Rate + Bot Control | Phase 0 算 WCU 预算；超限拆成 2 Web ACL |
| R4 | **Doris 单机** 可能和客户生产规格不符 | POC 只保证单机能跑；集群扩展留给客户自己 |
| R5 | **Akamai Advanced XML metadata**（essl §18 黑盒） | delivery §01.5 声明未解析，切换前人工审阅 |
| R6 | **ch01 HTTP/3 取消** 客户可能不接受 | delivery §01.3 给出 trade-off：为了拿 CICD 放弃 HTTP/3；CICD 不启用时可开回 HTTP/3 |
| R7 | **一个月时间盒内 12 章全做完压力大** | 优先级分级：P0 = 必须（ch01-10）、P1 = 强烈推荐（ch11-12）、极端情况 P1 可延后 |
| R8 | **客户 DataStream 日志拿不到样本** | ch09/10 破坏性场景改用 rule tree 配置字段 + CloudFront 侧实测印证 |

### 8.2 Phase 0 启动前待决的未决项（基础设施层）· **2026-04-22 客户已确认**

| # | 项 | 客户确认值 |
|---|---|---|
| U1 | AWS 账号 ID / profile | **`434465421667`**（旧 longqi 演示账号）· profile `default` |
| U2 | 源站 EC2 实例类型 | **`t3.xlarge`**（客户指定，高于默认 t3.small） |
| U3 | Doris 单机 EC2 实例类型 | **`t3.xlarge`** |
| U4 | baseline 打 Akamai 生产的频率 / 窗口 | **一次性对比测试，不限 recurring 频率和时间窗口**（部署完之后跑一次做方案验证） · 保留 READ-ONLY + 固定 UA 硬栅栏 |
| U5 | tfstate S3 bucket 名 | **`tfstate-akamai-to-aws-longqi-434465421667`** |
| U6 | `keithyu.cloud` hosted zone | **Route53 已就绪，ACM 证书已存在** — Phase 0 Task 02 可复用已有证书（见下方 note） |

> **U6 note**：Route53 + ACM 证书已存在 → phase0 Task 02（ACM 创建）可改为**用 terraform `data "aws_acm_certificate"` 引用已有证书**，而非 `resource` 新建；能省约 5 分钟 apply 时间并避免重复证书。实施时先用 `aws acm list-certificates --region us-east-1` 确认存量证书是否覆盖 `*.beautyforever.keithyu.cloud` 所需 SAN。

### 8.3 技术层待细化 / 客户需确认项

以下项在 2026-04-22 交叉 review 中发现（详见 [`coverage-matrix.md`](./coverage-matrix.md)）。客户已于 2026-04-22 回复部分项，其余仍在评估中。

| # | 技术点 | 客户 2026-04-22 回复 | 状态 |
|---|---|---|---|
| T1 | **Host 透传方案**：CF Function 注入 `X-Viewer-Host`，ALB 按此 header 分流 | **接受**。真实源 ALB `lq-bf-nuxt-1212474737` 也按域名分流、背后单台，拓扑等价 | ✅ 已确认 |
| T2 | Origin Shield 是否开启 | **不开**（北美客户群，CloudFront Edge 直连足够） | ✅ opted-out (2026-04-22 第 2 轮) |
| T3 | SWR / SIE 处理 | **SWR 不做**（客户有独立预热方案）；**SIE 保留 60s**（无额外成本） | ✅ 已确认 |
| T4 | api 扩展名分桶 TTL | **接受默认值**（CSS/JS/字体 365d、图片 30d、Files 7d；对齐 Akamai） | ✅ 已确认 |
| T5 | `/static/*` 特殊 token `LT1RVf0XvMD1A78LUGJ2JvcSkHTKq8vb` | **保留**（按 token 值拆 cache 版本） | ✅ 已确认 |
| T6 | "Js tag" 真相 | **发现不是 JS 注入** —— 读 raw JSON 确认 `Js tag` 节点的 behaviors 只有 `cacheTag` (值 `bf-www-js` / `bf-m-js`)；合并到 ch12 Tag Invalidation | ✅ 已确认（无需客户提供 JS） |
| T7 | `modifyOutgoingRequestHeader` 具体回源头 | **从 raw JSON 提取：`Source-Auth: akamai-lqhair`**（essl + api 同值）。POC 保留原值迁移无感 | ✅ 已确认 |
| T8 | WAF Managed Rule Group 选哪些 | **全部启用**：CRS + SQLi + KBI + Linux + Unix + PHP | ✅ 已确认 |
| T9 | AWS WAF Labels → `X-WAF-Rules-Triggered` 方案 | **做**。业务用途 = 日志标记 + SEO 降级；mock 命中高风险规则时注入 `<meta robots=noindex,nofollow>` demo | ✅ 已确认 (2026-04-22 第 2 轮) |
| T10 | `breakConnection: enabled=true`（api）保留与否 | **不迁**（演练残留） | ✅ opted-out (2026-04-22 第 2 轮) |
| T11 | Adaptive Accel / SureRoute / IVM 缺口 | 全部 **不迁**（见 G2/G3/G4） | ✅ 已确认 |
| T12 | HSTS preload 是否启用 | **POC 不加**（对齐 Akamai 生产 v62 未启用；保留 max-age=2y + includeSubDomains） | ✅ 已确认 (2026-04-22 第 2 轮) |

### 8.4 迁移缺口接受度（G 系列）· **2026-04-22 客户已确认**

| # | 缺口 | 客户决策 |
|---|---|---|
| G1 | HTTP/3 放弃（换 CICD） | ✅ **接受**：HTTP/2 够用，演示 CICD 持续集成能力 |
| G2 | SureRoute PERFORMANCE | ✅ **不做**：北美客户群 CloudFront 能扛住 |
| G3 | Adaptive Acceleration | ✅ **不做**：AA 和 WAF 无关；前端可用 `<link rel="preconnect">` 补偿 |
| G4 | Image and Video Manager | ✅ **不需要**：API 是静态 JSON |
| G5 | TLS Fingerprint 规则 | ✅ **用 Bot Control Targeted 覆盖**（客户 2026-04-22 round-3 确认）：AWS WAF SDK + 服务端 ML 模型识别能力是 TLS JA3/JA4 的超集；已在 G6 按 path 对敏感 API 启用 |
| G6 | Bot Manager → Bot Control | ✅ **按 path 同时演示 `Common` + `Targeted` 两档** |
| G7 | Slow POST Protection | ✅ **用 Rate-Based Rule 替代**：POST 3/5 rpm + CloudFront read timeout 30s + ALB idle timeout 60s 共同覆盖 |

---

## 9. Akamai 数据源交叉引用

本 spec 中所有 Akamai 配置细节的字节级真相在 `Akamai/` 目录。每个章节的 delivery §NN.1 必须回引到下表的锚点，确保等价性追溯。

| 主题 | Akamai 数据源 |
|---|---|
| Account / Contract / Group | [`Akamai/doc/00-account-overview.md`](../../../Akamai/doc/00-account-overview.md) |
| essl Property v62（www + m） | [`Akamai/doc/10-property-beautyforever-essl.md`](../../../Akamai/doc/10-property-beautyforever-essl.md) + [`Akamai/raw/essl_rules.json`](../../../Akamai/raw/essl_rules.json) |
| api Property v10 | [`Akamai/doc/11-property-api-beautyforever.md`](../../../Akamai/doc/11-property-api-beautyforever.md) + [`Akamai/raw/api_rules.json`](../../../Akamai/raw/api_rules.json) |
| WAF Security Config 89613 v145 | [`Akamai/doc/20-waf-security-configuration.md`](../../../Akamai/doc/20-waf-security-configuration.md) + raw JSON |
| 域名维度：www | [`Akamai/doc/30-domain-www-beautyforever-com.md`](../../../Akamai/doc/30-domain-www-beautyforever-com.md) |
| 域名维度：m | [`Akamai/doc/31-domain-m-beautyforever-com.md`](../../../Akamai/doc/31-domain-m-beautyforever-com.md) |
| 域名维度：api | [`Akamai/doc/32-domain-api-beautyforever-com.md`](../../../Akamai/doc/32-domain-api-beautyforever-com.md) |
| 运维交叉比对 | [`Akamai/doc/40-ops-verification.md`](../../../Akamai/doc/40-ops-verification.md) |
| 动静态分析 | [`Akamai/doc/90-dynamic-static-analysis.md`](../../../Akamai/doc/90-dynamic-static-analysis.md) |

### 9.1 Akamai → CloudFront 行为对照矩阵

**[`coverage-matrix.md`](./coverage-matrix.md)** — 66 条行为逐条对照，持续演化的"真相源"。任何 spec / plan 改动后必须同步。

---

## 10. 下一步

1. 用户审阅本 spec
2. 如有调整：就地修订、重新审阅
3. 批准后：`/superpowers:writing-plans` 产出 `docs/superpowers/plans/` 下的分阶段实施计划（Phase 0 + 12 章 + 收尾）
4. 按 plan 开始 Phase 0 执行

---

**Spec 结束**
