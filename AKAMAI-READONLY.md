# Akamai Access — READ-ONLY Guard-Rail

> Project-level hard constraint. Applies to **every** tool, script, agent, and human operator working in this repository.

## Scope

本项目通过 `/root/.edgerc` (sections `[default]`, `[papi]`, `[appsec]`) 访问客户 **许昌龙麒电子商务** (`act_F-AC-4891758`) 的 Akamai 账号。该凭据由客户授权给 Keith，**仅允许只读用途**。

## Allowed

| API / Command | Purpose |
|---|---|
| `GET /papi/v1/**` | Read contracts, groups, properties, versions, rules, hostnames |
| `GET /appsec/v1/**` | Read Security Configuration, policies, match-targets, custom rules, rate policies |
| `GET /network-list/v2/**` | Read Network Lists (including the empty Bypass list) |
| `GET /datastream-config-api/**` | Read DataStream configuration (log sampling) |
| `akamai pm list-*` / `akamai pm get-*` | Property Manager CLI read subcommands |
| `akamai appsec list-*` / `akamai appsec get-*` | AppSec CLI read subcommands |
| `akamai network-lists list-*` | Network Lists read |

## Forbidden

| API / Command | Why |
|---|---|
| `POST/PUT/PATCH/DELETE` to any Akamai endpoint | Any mutation is out of scope |
| `akamai pm activate` / `akamai pm new-property` / `akamai pm update-rules` | Activation / creation / modification |
| `akamai appsec modify-*` / `akamai appsec activate-*` | AppSec mutations |
| `akamai network-lists update-*` / `akamai network-lists activate-*` | Network List mutations |
| Anything that sends `Content-Length > 0` to Akamai with a write-class method | Catch-all |

## Why

1. 凭据是客户生产账号的授权 API client，任何变更操作会直接影响生产流量
2. 本项目的验证策略是 "Akamai 只读基线 + CloudFront 侧实测"，不需要对 Akamai 做任何改动
3. 破坏性测试场景（rate limit / WAF block / Bot）全部在 CloudFront 侧自测，不在 Akamai 侧触发

## Enforcement

- 测试脚本 (`Cloudfront/test-harness/baseline/`) 在代码层 assert HTTP method ∈ {GET, HEAD}
- baseline 请求 User-Agent 固定为 `Keithyu-Akamai-Baseline/1.0 (read-only)` 便于客户 SRE 在 DataStream 中识别
- baseline 对客户生产域名限速 ≤ 10 req/hour，仅在夜间窗口（00:00-06:00 CST）运行
- 任何 PR 修改涉及 Akamai 调用都必须通过 code review

## Incident Response

若不慎触发了 write 操作：
1. 立即停止脚本 / 回滚本地分支
2. 通过 `akamai pm activations` / `akamai appsec ... activations` 核对 Akamai 侧是否生成了新版本
3. 联系 Keith + 客户运维负责人（weina.shi@jinmuinfo.com）
4. 在本文件 "Incident Log" 区追加记录

## Incident Log

（暂无记录）
