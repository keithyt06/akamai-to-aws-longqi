# Akamai → CloudFront 行为对照覆盖矩阵

> Spec 的附件，逐条列出 Akamai 调研发现的所有 behavior，对照本项目 CloudFront 实现状态。
> 新增或修改后，本文件必须同步更新；客户评审时作为"迁移完备性"证据。

**状态图例**：
- ✅ **Done**：有对应实现计划且在 12 章节覆盖
- 🟡 **Gap-declared**：已在 plan 或 delivery 中承认迁移缺口
- 🔴 **Todo**：本 review 发现遗漏，需要在相应 plan 里加 task（本文件更新后，plan 同步）
- ➖ **N/A**：Akamai 专属能力或业务侧不需要迁移的项

---

## A. Distribution / Origin 层

| # | Akamai 特性 | 源 | CloudFront 对应 | 状态 | 归属 plan |
|---|---|---|---|---|---|
| A1 | essl v62 承载 www + m（共用 Property）| essl §1 | 共用单个 Distribution（2 aliases） | ✅ | phase0 T05、part1 T11 |
| A2 | api v10 独立 Property | api §1 | 独立 Distribution | ✅ | phase0 T05 |
| A3 | Origin = AWS ALB（us-east-2 lq-bf-*）| essl §3、api §3 | AWS ALB（ap-northeast-1，POC） | ✅ | phase0 T03 |
| A4 | **`forwardHostHeader = REQUEST_HOST_HEADER`**（透传客户 Host）| essl §3、api §3 | CloudFront 不允许直接透传 Host；用 Function 注入 `x-viewer-host`，ALB listener rule 按此 header 分流 | ✅ (customer T1 2026-04-22) | phase0 T05（C1 fix） |
| A5 | Origin SNI + `verificationMode=CUSTOM` | essl §3 | POC 阶段 CloudFront → ALB 走 HTTP（未启用 HTTPS 回源） | 🟡 delivery §1.3 注明 | delivery/01 |
| A6 | `enableTrueClientIp` + header `True-Client-IP` | essl §3、api §3 | CloudFront Function 从 `CloudFront-Viewer-Address` 派生并注入 `True-Client-IP` + `X-Authentic-IP`（无前导空格，修 Akamai bug） | ✅ | part3 T17 |
| A7 | **`tieredDistribution = true`**（Tier-2 回源聚合）| essl §6、api §6 | **Origin Shield**（默认关闭，variable `origin_shield_enabled=false`） | ✅ opted-out (customer T2 2026-04-22, 北美客户群) | phase0 T05 |
| A8 | HTTP/3 `enhancedAkamaiProtocol` | essl §8、api §8 | **取消**（CICD 要求 HTTP/2-only） | 🟡 delivery §1.3 明示 | part1 T11 |
| A9 | HTTP/2 | essl §8、api §8 | HTTP/2-only（硬编码）| ✅ | phase0 T05 |
| A10 | **`SureRoute PERFORMANCE`**（Akamai 动态路由）| essl §13、api §7 | AWS 无精确等价 | ✅ opted-out (customer G2 2026-04-22, 北美客户群 Edge 直连足够) | delivery §1.3 |
| A11 | **`Adaptive Acceleration`**（MPulse 驱动 Push/Preconnect/Preload）| essl §8、api §8 | AWS 无原生等价；应用层 `<link rel="preconnect">` 补偿 | ✅ opted-out (customer G3 2026-04-22) | wrapup Known Gaps |
| A12 | `Compress gzipResponse = ALWAYS` | essl §11、api §12 | CloudFront `compress = true` | ✅ | phase0 T05 |
| A13 | Certificate：Akamai CPS_MANAGED（Enhanced TLS）| essl §2、api §2 | ACM（us-east-1）+ SAN | ✅ | phase0 T02 |
| A14 | Shared Edge Hostname `beautyforever.com.edgekey.net` | essl §2 | CloudFront 每个 Distribution 独立 edge domain | ✅ | phase0 T05 |
| A15 | CP Code 1435977 / 1435979 按 hostname 覆盖 | essl §4 | mock 注入 `X-Origin-CPCode` diagnostic header；Real-time Logs 按 Host 分组等价 | ✅ | part1 T11 |
| A16 | `allowPost: allowWithoutContentLength=false` | essl §9、api §9 | CloudFront 默认行为等价 | ✅ | N/A 自然对齐 |
| A17 | `autoDomainValidation` (ADV) | api §4 | ACM 自动 DNS 验证等价 | ✅ | phase0 T02 |

## B. 缓存行为

| # | Akamai 特性 | 源 | CloudFront 对应 | 状态 | 归属 plan |
|---|---|---|---|---|---|
| B1 | TTL 矩阵（首页/列表/博客/活动/static/图片/CSS-JS/字体）| essl §7 | 6 条 ordered_cache_behavior + CachePolicy | ✅ | part2 T14 |
| B2 | api 默认 NO_STORE + Sureroute&Caching 双重 NO_STORE | api §6、§7 | CloudFront api Distribution default `Managed-CachingDisabled` | ✅ | phase0 T05、part2 T14 |
| B3 | api 扩展名分桶（CSS/JS 365d、字体 365d、图片 30d、Files 7d、Other 7d、HTML 1d）| api §6 | **需要在 api Distribution 加相同的 ordered_cache_behavior** | ✅ | part2 T14（I8） |
| B4 | **`prefreshCache=90%` (stale-while-revalidate)** | essl §6、api §6 | CDN 自动预刷 **不做**；客户有独立预热方案覆盖 | ✅ opted-out (customer T3 2026-04-22) | part2 T14 |
| B5 | **`cacheError` ttl=10s preserveStale=true** | essl §6、api §6 | 源站发 `stale-if-error=Y` + CloudFront Custom Error Responses | ✅ | part2 T14（I1） |
| B6 | `validateEntityTag=false` | essl §6、api §6 | CloudFront 默认尊重 ETag；对齐 | ✅ | N/A |
| B7 | **`removeVary` 两侧差异（essl=true, api=false）** | essl §6 vs api §6 | www/m 侧用 Response Headers Policy 剔除 Vary；api 侧保留 | ✅ | part3 T17（I7） |
| B8 | `downstreamCache allowBehavior=LESSER, sendHeaders=CACHE_CONTROL` | essl §6、api §6 | 双头策略（`s-maxage` vs `max-age`）+ Response Headers Policy | ✅ | part2 T14 |
| B9 | Cookie Cache Key（www/m: currency/group_id/abTest；api: customer_group/currency）| essl §7、api §6 | CloudFront Function 规范化 → `x-cookie-cachekey` header 入 CachePolicy | ✅ | part2 T16 |
| B10 | Query EXCLUDE 34 参数（www/m 列表&详情）| essl §7 | CachePolicy `QueryStringBehavior=allExcept` + items 34 个 | ✅ | part2 T15 |
| B11 | `utm_source=google/facebook.com/tiktok` 进 cache key | essl §7 | Function 重写为 `__utm_whitelisted`，Policy INCLUDE 它 | ✅ | part2 T15 |
| B12 | api cacheKeyQueryParams IGNORE 20+ 广告参数 | api §6 | api 侧独立 CachePolicy 的 allExcept list | ✅ | part2 T15 |
| B13 | `cacheId=INCLUDE_ALL_QUERY_PARAMS` for Images | essl §6 | CachePolicy QueryStringBehavior=`all` | ✅ | part2 T14 |
| B14 | **`/static/*` 特殊 query token `LT1RVf0XvMD1A78LUGJ2JvcSkHTKq8vb` (optional=true) 分版本** | essl §7 | Function 检测该 token，注入 `__static_ver` 入 cache key | ✅ (customer T5 2026-04-22) | part2 T15（N1） |
| B15 | **`Image and Video Manager (IVM)`** 图像处理 | essl §6 | AWS 无原生；CloudFront + Lambda@Edge 或 CloudFront Image Optimizer (2024) | 🟡→delivery Known Gaps | wrapup T26 |
| B16 | Cache Tags (`bf-all`, `bf-home`, `bf-blog`, `bf-listinfo`, `bf-activity`) | essl §7 | `Surrogate-Key` 响应头 + CloudFront Invalidation for Distribution Tenant (2024) | ✅ | part5 T22 |

## C. Redirect / 请求改写

| # | Akamai 特性 | 源 | CloudFront 对应 | 状态 | 归属 plan |
|---|---|---|---|---|---|
| C1 | HTTP → HTTPS 301 | essl §12、api §11 | viewer_protocol_policy=redirect-to-https | ✅ | phase0 T05 |
| C2 | PC → Mobile 302 | essl §12 | CloudFront Function viewer-request | ✅ | part1 T12 |
| C3 | Mobile → PC 302 | essl §12 | 同上 | ✅ | part1 T12 |
| C4 | UA 白名单 `LqPassWaf/851.3` + Categraf | essl §12 | Function 常量 UA_WHITELIST | ✅ | part1 T12 |
| C5 | Apple Pay `.well-known` 路径白名单 | essl §12 | Function APPLE_PAY_PATH | ✅ | part1 T12 |
| C6 | `js/css` 扩展名白名单 | essl §12 | Function EXT_WHITELIST | ✅ | part1 T12 |
| C7 | `?akaCache=nce` 全局 backdoor | essl §7 | Function 注入 `__cfbust` + `X-Aka-Bypass` | ✅ | part1 T13 |
| C8 | `deviceCharacteristic[IS_MOBILE]` 精度 | essl §12 | UA 正则；Akamai 内置设备库不等价 | 🟡→delivery §2.3 | part1 T12 |

## D. Response / Headers

| # | Akamai 特性 | 源 | CloudFront 对应 | 状态 | 归属 plan |
|---|---|---|---|---|---|
| D1 | 删 `X-Powered-By` / `Server` | essl §9、api §9 | Response Headers Policy `remove_headers_config` | ✅ | part3 T17 |
| D2 | HSTS 2 年（preload：Akamai staging v63/v11 已准备但生产 v62/v10 未启用）| essl §0 note、api §0 note | Response Headers Policy: `max-age=63072000 + includeSubDomains`；**preload=false**（客户 T12 2026-04-22 决定 POC 不加，对齐 Akamai 生产） | ✅ (customer T12) | part3 T17 |
| D3 | True-Client-IP 透传 | essl §14、api §13 | Function 派生 | ✅ | part3 T17 |
| D4 | **`" x-authentic-ip"` 前导空格 bug 修正** | essl §14、api §13 | 用正确头名 `x-authentic-ip` | ✅ | part3 T17 |
| D5 | **`Timing-Allow-Origin: *`** 响应头（给 mPulse RUM）| essl §17、api §14 | Response Headers Policy custom_headers_config | ✅ | part3 T17（C7） |
| D6 | 图片响应头 `Cache-Control` 365d | essl §19 | ch04 TTL 矩阵已覆盖 | ✅ | part2 T14 |
| D7 | **`modifyOutgoingRequestHeader` 指定回源请求头** | essl §17、api §14 | 2026-04-22 从 raw JSON 提取：**`Source-Auth: akamai-lqhair`**（essl 与 api 同值）。POC 保留原值迁移无感 | ✅ (read from raw, T7) | part3 T17（I6） |
| D8 | **"Js tag" 真相**（read raw: 不是 JS 注入，是给 `.js` 打 cacheTag）| essl §11 | 归并到 ch12 Tag Invalidation：`.js` 按 host 输出 `bf-www-js`/`bf-m-js` Surrogate-Key；无需 viewer-response Function | ✅ (no JS needed, T6) | part5 T22.1 |
| D9 | **`SEO tuning` / `PMUSER_TRIGGERED_RULES`** —— WAF 触发规则号回传源站 | essl §15 | AWS WAF labels → rule_label + custom_request_handling insert header `X-WAF-Rules-Triggered`；mock 侧读 header 产出 `<meta robots=noindex,nofollow>` 做 SEO 降级 demo | ✅ (customer T9 2026-04-22: 日志+SEO 降级) | part4 T19 |

## E. WAF

| # | Akamai 特性 | 源 | CloudFront 对应 | 状态 | 归属 plan |
|---|---|---|---|---|---|
| E1 | Security Config 89613 v145 | waf §1 | 3 个 Web ACL（deny/alert/api）| ✅ | phase0 T06、part4 T18 |
| E2 | 3 Policies (Deny qik1_201886 / Alert 1218_239915 / Api 0124_243504) | waf §2 | 对应 3 个 Web ACL | ✅ | part4 T18 |
| E3 | 3 Match Targets (website / filePaths=["/*"]) | waf §3 | CloudFront Distribution 按 host 隔离 | ✅ | part4 T18 |
| E4 | **Application Layer Controls (OWASP / Core Rule Set)** | waf §4 `effectiveSecurityControls.Application=✅` | **6 MRG 全启用（customer T8 2026-04-22）**：`CommonRuleSet + SQLi + KnownBadInputs + Linux + Unix + PHP`；打包成独立 `aws_wafv2_rule_group` 以规避 ACL WCU 上限 | ✅ (customer T8) | part4 T18（C4） |
| E5 | Bot Manager | waf §4 | **customer G6 2026-04-22**：按 path 同时演示 Common（公开页）+ Targeted（`/api/v1/order`、`/cart`、`/checkout`、`/payment`、`/user`） | ✅ (customer G6) | part4 T20 |
| E6 | Network Layer Controls (IP/Geo/ASN) | waf §4 | Custom Rule + `geo_match_statement` / `asn_match_statement` / IP set | ✅ | part4 T19 |
| E7 | Rate Controls (5 Policies) | waf §0、ops §6.3 | `rate_based_statement` × 5 | ✅ | part4 T20 |
| E8 | Slow POST Protection | waf §4 | AWS 无原生；**客户 G7 决策**：用 Rate-Based Rule（POST 3/5 rpm，已在 5 条 Rate）+ CloudFront read timeout 30s + ALB idle timeout 60s 共同覆盖 | ✅ replaced by rate+timeout (customer G7 2026-04-22) | part4 T20 |
| E9 | Account Protection / URL Protection | waf §4（两者均关）| 不需要迁移 | ➖ | N/A |
| E10 | 19 Custom Rules (含 bypass/deny UA/TLS fingerprint/Monitor/GeoDeny/ASN) | ops §6.3 | Custom Rule 翻译 | ✅ | part4 T19 |
| E11 | **TLS Fingerprint 系列（Client TLS Fingerprint）** | ops §6.3 | AWS WAF 不原生支持 JA3/JA4；**Bot Control Targeted（G6 已启用）内置设备指纹机制**，是超集替代 | 🟡 (customer G5 2026-04-22: POC 不加；待 Keith 确认"WAF SDK 方案"后客户再定) | part4 T19 |
| E12 | Custom Rule 60383229（ASN 202425 + host=www）| waf §1 | 同等 Custom Rule with AND statements | ✅ | part4 T19 |
| E13 | Bypass Network List 146351（elementCount=0，空）| waf §3 | **不迁移** | ✅ spec §1.2 明示 | N/A |

## F. 可用性 / 可靠性

| # | Akamai 特性 | 源 | CloudFront 对应 | 状态 | 归属 plan |
|---|---|---|---|---|---|
| F1 | Site Failover disabled（两边）| essl §10、api §10 | CloudFront 同样不启用 | ✅ | delivery 一句话说明 |
| F2 | **`breakConnection: enabled=true`（api）** 故障注入 | api §10 | **不迁**（演练残留，迁移后主动移除） | ✅ opted-out (customer T10 2026-04-22) | part4 T20 |

## G. 可观测（Logs / RUM）

| # | Akamai 特性 | 源 | CloudFront 对应 | 状态 | 归属 plan |
|---|---|---|---|---|---|
| G1 | DataStream (DS2) | essl §16、api §14 | CloudFront Real-time Logs | ✅ | part5 T21 |
| G2 | 消费到 Doris 单机 | 客户现状 | KDS → Python consumer → Doris on EC2 | ✅ | part5 T21 |
| G3 | `Augment insights` / 日志增强 / mPulse | essl §5-note、api §5 | AWS 无原生 mPulse；CloudWatch RUM 是可选替代 | 🟡→delivery Known Gaps | wrapup T26 |
| G4 | api `fingerprint cookie` | api §5 | 客户自有业务逻辑，保持 origin 侧处理；CloudFront 无特别关系 | ➖ N/A | N/A |

## H. CloudFront 迁移红利（Akamai 无原生）

| # | AWS 特性 | Akamai 等价 | 状态 | 归属 plan |
|---|---|---|---|---|
| H1 | Continuous Deployment（primary+staging+CDP 灰度）| **无**；Akamai 通过 version staging 切换较笨重 | ✅ | part5 T22 |
| H2 | Tag-Based Invalidation (Surrogate-Key) | Akamai `cacheTag` + Fast Purge by Tag 等价 | ✅ | part5 T22 |
| H3 | WAF Labels（规则命中后打标签，下游消费）| Akamai 仅 `PMUSER_TRIGGERED_RULES` 有限 | ✅（C6 补齐后）| part4 T19 |

## I. 其他

| # | Akamai 特性 | 源 | CloudFront 对应 | 状态 | 归属 plan |
|---|---|---|---|---|---|
| I1 | **Advanced XML metadata（essl §18 黑盒）** | essl §18 | 未解析 | 🟡→spec §1.2 + delivery §1.5 明示 | ✅ spec 已声明 |
| I2 | SureRoute Test Object `/akamai/sureroute...` | essl §13 | 迁移后不需要 | ➖ delivery 一句话说明 | delivery/01 |

---

## 统计（2026-04-22 客户两轮回复后更新）

| 状态 | 初版 review | 第 1 轮回复 | 第 2 轮回复 |
|---|---|---|---|
| ✅ Done | 38 | 50 | **57** |
| 🟡 Gap-declared（含未完全解释的项）| 10 | 11 | **4** |
| 🔴 Todo | 13 | 0 | 0 |
| ➖ N/A | 5 | 5 | 5 |
| **合计** | **66** | **66** | **66** |

## 客户 2026-04-22 第 2 轮回复确认项（9 条新 ✅）

- **A7** Origin Shield opted-out（T2：北美客户群 Edge 直连足够）
- **A10** SureRoute opted-out（G2：同上）
- **A11** Adaptive Acceleration opted-out（G3：无关 WAF；前端加 preconnect 替代）
- **B4** prefreshCache opted-out（T3：客户独立预热方案）
- **D2** HSTS preload=false（T12：对齐 Akamai 生产 v62 未启用）
- **D9** X-WAF-Rules-Triggered 做（T9：日志+SEO 降级）
- **E8** Slow POST 替代方案（G7：Rate Rule + timeout）
- **F2** breakConnection 不迁（T10：演练残留）
- **A4/A7/B3/B4/B5/B7/B14/D5/D7/D8/E4/E5** 已在第 1 轮确认

## 仍待 Keith 澄清后客户可能改变决定（🟡）

| # | 项 | 状态 |
|---|---|---|
| E11 / G5 | TLS Fingerprint 规则 | 客户 POC 暂不加；**待 Keith 澄清"WAF SDK"含义**（实际上 Bot Control Targeted 内置设备指纹机制） |

## 其他保持 🟡 的项（基线迁移缺口，不需客户决定）

- A5 (Origin SNI/HTTPS-to-origin：POC 简化为 HTTP 回源)
- A8 (HTTP/3 主动放弃换 CICD)
- B15 (IVM：客户 G4 不需要)
- C8 (Mobile UA 检测精度)
- G3 (mPulse：客户自决)
- I1 (Advanced XML metadata：人工审阅)

## 维护约定

- 本文件是**持续演化**的"真相源"。spec 或 plan 有改动 → 更新本矩阵。
- 客户评审时，本文件作为"迁移完备性说明"的直接依据。
- 每个 🔴 转 ✅ 都必须在对应 plan 新增一个 sub-task；不能只口头解决。
