# WAF — `Security Configuration` (id 89613) v145

> 原始 JSON：
> - [raw/waf_version.json](../raw/waf_version.json)
> - [raw/waf_policies.json](../raw/waf_policies.json)
> - [raw/waf_match_targets.json](../raw/waf_match_targets.json)
> - [raw/waf_hostname_coverage.json](../raw/waf_hostname_coverage.json)

## 1. 基本信息

| 字段 | 值 |
|---|---|
| 名称 | `Security Configuration`（全账号只有这 1 个 config） |
| Config ID | **89613** |
| Production Version | **145** |
| Staging Version | 145 |
| File Type | `RBAC` |
| targetProduct | `WAP_AAG`（Web App Protector Advanced Application Gateway） |
| basedOn | v143 |
| 生产激活时间 | **2026-04-21 06:10:22 UTC** |
| Staging 激活时间 | 2026-04-21 01:42:06 UTC |
| 创建者 | `weina.shi@jinmuinfo.com` |
| 版本备注 | **「加一个拦截规则，asn 为 202425，并且请求域名为 www.beautyforever.com 的，直接拦截掉」** |

> **当天生产变更** —— 2026-04-21 当天才激活到生产，新增了针对 ASN `202425` + `www.beautyforever.com` 的拦截规则。
>
> **2026-04-21 Live Audit 定位到该规则**：
> Custom Rule id `60383229`，name `Deny asnumber  202425 for  www.beautyforever.com`，
> conditions = `hostMatch(www.beautyforever.com)` **AND** `asNumberMatch(202425, useXForwardForHeaders=false)`（均 positiveMatch=true），
> operation = AND、tag = `["as-number"]`、ruleActivated = true。
> 挂在 Custom Rules 而不是 Network List / Penalty Box，属于同 WAF 配置下所有站点共享的规则库，但 hostMatch 限制了只对 `www.beautyforever.com` 生效。

## 2. Security Policies（3 条）

| Policy Name | Policy ID | 覆盖的 beautyforever 域名 |
|---|---|---|
| **Policy Deny** | `qik1_201886` | `www.beautyforever.com`、`m.beautyforever.com` |
| **Policy Alert** | `1218_239915` | `tapi.beautyforever.com` |
| **Policy Api** | `0124_243504` | `api.beautyforever.com` |

> 另外 `sapi.beautyforever.com`、`sapi.unice.com` 等挂在 hostname-coverage 里的 "Policy Api-Evaluation"（评估中，未正式 enforce）。

## 3. Match Targets（hostname → policy 映射）

三个 website 类型 match target，`filePaths=["/*"]`（所有路径），按 sequence 顺序匹配：

### Target #1 — sequence 1（targetId `5789054`）
- **Policy：** `Policy Deny` (`qik1_201886`)
- **Hostnames：** `www.juliahair.com`、`m.nadula.com`、**`www.beautyforever.com`**、`www.nadula.com`、**`m.beautyforever.com`**、`mfr.unice.com`、`www.unice.com`、`m.unice.com`、`m.juliahair.com`、`fr.unice.com`
- **Bypass Network List：** `146351_SECURITYBYPASSLIST`（`Security Bypass List`）
  > **2026-04-21 Live Audit**：实际 `elementCount = 0`，`list = null`，最后更新 2023-02-16 —— 是 Akamai 默认创建的**空**列表，**没有任何 IP 白名单条目生效**。迁移到 AWS WAF 时无需为它准备迁移对象。
- effectiveSecurityControls：Application / Botman / Network / Rate / SlowPost **均开**；AccountProtection、UrlProtection 关

### Target #2 — sequence 2（targetId `8996562`）
- **Policy：** `Policy Alert` (`1218_239915`)
- **Hostnames：** `tapi.beautyforever.com`
- Bypass：无
- 控件同上

### Target #3 — sequence 3（targetId `7384226`）
- **Policy：** `Policy Api` (`0124_243504`)
- **Hostnames：** `capi.unice.com`、`api.nadula.com`、**`api.beautyforever.com`**、`api.juliahair.com`、`apifr.unice.com`
- Bypass：无
- 控件同上

## 4. 启用的安全控件（所有 policy 一致）

| Control | 状态 |
|---|:---:|
| Application Layer Controls (WAF rules) | ✅ |
| Bot Manager | ✅ |
| Network Layer Controls (IP/Geo/ASN) | ✅ |
| Rate Controls | ✅ |
| Slow POST Protection | ✅ |
| Account Protection | ❌ |
| URL Protection | ❌ |

## 5. Hostname Coverage 汇总

### 受 WAF 保护（covered）

| Hostname | Policy |
|---|---|
| `www.beautyforever.com` | Policy Deny |
| `m.beautyforever.com` | Policy Deny |
| `api.beautyforever.com` | Policy Api |
| `tapi.beautyforever.com` | Policy Alert |
| `sapi.beautyforever.com` | Policy Api-Evaluation |
| `www.unice.com` / `m.unice.com` / `mfr.unice.com` / `fr.unice.com` | Policy Deny |
| `capi.unice.com` / `apifr.unice.com` | Policy Api |
| `sapi.unice.com` | Policy Api-Evaluation |
| `www.nadula.com` / `m.nadula.com` | Policy Deny |
| `api.nadula.com` | Policy Api |
| `sapi.nadula.com` | Policy Api-Evaluation |
| `www.juliahair.com` / `m.juliahair.com` | Policy Deny |
| `api.juliahair.com` | Policy Api |
| `sapi.juliahair.com` | Policy Api-Evaluation |

### ❌ 未受 WAF 保护（not covered）

| Hostname |
|---|
| `tw.beautyforever.com` |
| `tm.beautyforever.com` |
| `tw.velvethairextension.com` |
| `tm.velvethairextension.com` |
| `tapi.velvethairextension.com` |
| `tm.juliahair.com` |
| `tw.juliahair.com` |
| `tm.unice.com` |

> CDN 里也没有这些域名的 Property。迁移时确认是否还在使用；如是"历史/测试"应显式下线。

## 6. 值得深挖（未在本文档展开，Team Agent 可继续）

1. **Custom Rules**：`akamai appsec custom-rules --config-id 89613`
2. **Attack Groups** / **Rule Actions**：`akamai appsec attack-group --config-id 89613 --version 145 --policy-id qik1_201886`
3. **Rate Policies**：`akamai appsec rate-policies --config-id 89613 --version 145`
4. **Bot Management**：
   - `akamai appsec bot-category-action`
   - `akamai appsec bot-detection`
   - `akamai appsec custom-bot-category`
5. **Network Lists**：`146351_SECURITYBYPASSLIST`（Bypass 白名单）内容 —— ✅ 2026-04-21 已查：`elementCount=0`，空列表
6. **刚加的 ASN 202425 拦截规则** —— ✅ 2026-04-21 已定位：Custom Rule id `60383229`，hostMatch+asNumberMatch AND（见 §1 备注）
7. **Slow POST、Rate Control** 阈值
8. **Reputation Profile**（`akamai appsec reputation-profile`）
