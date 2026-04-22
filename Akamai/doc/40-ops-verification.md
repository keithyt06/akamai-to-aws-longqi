# 运维交叉比对记录（Ops Verification）

> 日期：**2026-04-21**
> 依据：运维截图反馈 × `raw/essl_rules.json` 活体原始配置
> 验证脚本：`/tmp/verify.py`（已留存，可重跑）
> 目的：把运维的 4 条口头/截图反馈逐条对到 raw JSON，并记录我初版文档的差错，供 Team Agent 审计使用。

## 1. 运维原话复述（反馈源）

1. `.js .css` 缓存 365 天；字体（常用后缀 woff/woff2/ttf/otf/eot）缓存 365 天；`.jpg .webp` 等图片缓存 365 天
2. PC 站和 M 站 **ALB 通过域名区分 + 有优先级规则**
3. 设备间识别跳转走 **UA 头**；满足 `LqPassWaf/851.3` 不跳转；Mobile 访问 `/.well-known/apple-developer-merchantid-domain-association.txt`（Apple Pay 域名验证）不跳转
4. `www.beautyforever.com` **首页 6h**，**默认 TTL = 0**（运维口径 = NO_STORE）；**`/blog` 或 `/blog*`** 智能精确匹配子路径

## 2. 逐条核对

| # | 运维陈述 | raw JSON 实际 | 我初版文档 | 状态 |
|---|---|---|---|---|
| ①a | js/css 缓存 365d | `Offload origin / CSS and JavaScript: caching MAX_AGE 365d` ✅ | 已写 365d | ✅ 一致 |
| ①b | 字体 365d | `Fonts: ext=eot/woff/woff2/otf/ttf, caching MAX_AGE 365d` ✅ | 已写 365d | ✅ 一致 |
| ①c | 图片 365d | `Images: ext=jpg/jpeg/png/gif/webp/..., caching MAX_AGE 365d, cacheId=INCLUDE_ALL_QUERY_PARAMS` ✅ | 已写 365d | ✅ 一致 |
| ② | PC/M 通过域名区分 ALB | `Hostnames` 父规则下 2 个 children：`host=www` 分支与 `host=m` 分支各有独立 **`origin` + `cpCode`**（www→CP 1435977，m→CP 1435979）✅ | 初版写成"顶层共用一套 origin"，**遗漏 Hostnames 分支的 origin 覆盖** | ⚠ 已修正（10-property §4 CP Code 表 + 31-domain §2） |
| ③a | UA `LqPassWaf/851.3` 不跳转 | PC→M 规则 CRIT: `userAgent IS_NOT_ONE_OF ["LqPassWaf/851.3", "LqPassWaf/851.3 (it; Categraf)"]` ✅ | **初版完全漏掉** | ❌ 已修正（10-property §12 + 30/31 §5）|
| ③b | Apple Pay 路径不跳转 | M→PC 规则 CRIT: `path DOES_NOT_MATCH_ONE_OF ["/.well-known/apple-developer-merchantid-domain-association.txt"]` ✅ | **初版完全漏掉** | ❌ 已修正 |
| ③c | 跳转响应码 | `redirect` behavior `responseCode=302`（不是 301）✅ | 初版写 301 | ❌ 已修正 |
| ③d | js/css 扩展名不跳转 | 两条跳转规则 CRIT 都有 `fileExtension IS_NOT_ONE_OF ["js", "css"]` ✅ | **初版完全漏掉** | ❌ 已修正 |
| ④a | 首页 6h | `Cache Tag & Page Caching / 首页: caching MAX_AGE=6h, cacheTag=bf-all+bf-home` ✅ | 已写 6h，但**漏掉 cacheTag** | ⚠ 已修正（补齐 Cache Tags 列）|
| ④b | 默认 TTL=0 | Offload origin 顶层 `caching behavior=NO_STORE`；HTML pages 子规则也是 `NO_STORE`；Cache Tag & Page Caching 节点覆盖首页/列表/详情/博客/活动页 ✅ | 已写 NO_STORE（等价于"运维口径 ttl=0"）| ✅ 一致 |
| ④c | `/blog` 智能精确匹配 | `/blog/*` path 匹配（`path MATCHES_ONE_OF ["/blog/*"]`）✅ | 已写 `/blog/*` 365d | ✅ 一致 |

## 3. 我初版文档的 4 个错误（复盘）

| 错误 | 影响范围 | 根因 |
|---|---|---|
| **redirect 301 → 实际 302** | 10-property §12、30/31 §5 | 只看了 behavior 名字 `redirect`，没看 `options.responseCode` 字段 |
| **漏 `LqPassWaf` UA 白名单** | 所有 redirect 描述 | criteria 数组只粗略看了头两个，没扫完 |
| **漏 Apple Pay `.well-known` 路径白名单** | M→PC 分支 | 同上，没把 criteria 跑完 |
| **漏 js/css 扩展名白名单** | 两条 redirect | 同上，`fileExtension IS_NOT_ONE_OF` 是第三个 criteria |
| **漏 Hostnames 分支 origin+CP Code 覆盖** | 10-property §3/§4、PC/M ALB 分流 | 只看了顶层 default 的 origin，没递归进 `Hostnames` 父规则 |
| **列表&详情页 cacheId 描述含糊** | 10-property §7、30 §4 | 初版没写清是 **`EXCLUDE_QUERY_PARAMS` + 34 个追踪参数**，改后明确 |
| **Cache Tags 完全没提** | 所有缓存表 | 把 `cacheTag` behavior 当成元数据忽略，没意识到运维是靠 tag 做 Fast Purge |

## 4. 验证脚本保留

- **本地脚本**：`/tmp/verify.py`（重启后会丢，可从本文件复制）
- **原始 JSON**：`raw/essl_rules.json`、`raw/essl_hostnames.json` 永久保存
- **重跑**：
  ```bash
  python3 /tmp/verify.py > /tmp/verify-out.txt
  less /tmp/verify-out.txt
  ```
  输出分 7 段：顶层 caching、Redirect 分支、Hostnames 分支、列表&详情页 cacheId、/static/ cacheId、Cache Tag 标签值、活动页 TTL。

## 5. 修正后文档状态快照

| 文件 | 是否已反映运维反馈 | 关键更新位置 |
|---|---|---|
| [10-property-beautyforever-essl.md](10-property-beautyforever-essl.md) | ✅ | §4 CP Code 表、§7 Cache Tag & Page Caching 表（4 列 + 34 参数 EXCLUDE）、§12 Redirect（302 + 全量白名单） |
| [30-domain-www-beautyforever-com.md](30-domain-www-beautyforever-com.md) | ✅ | §4 缓存策略表扩成 4 列（加 Cache Tag 和 Cache Key 构成）|
| [31-domain-m-beautyforever-com.md](31-domain-m-beautyforever-com.md) | ✅ | §2 CP Code `1435979`、§4 同 www 的 4 列表、§5 Desktop→PC 白名单 |
| [32-domain-api-beautyforever-com.md](32-domain-api-beautyforever-com.md) | N/A（api 不涉及 PC/M 跳转和页面缓存）| — |

## 6. 2026-04-21 Live CLI Audit（补充核对）

> 日期：**2026-04-21**
> 工具：`akamai pm list-properties`、PAPI `/properties/{pid}/versions/{v}/rules`、AppSec `/configs/{id}/versions/{v}`、Network-List API、property `activations` 端点
> 目的：`doc/` 成稿后再用 CLI 对照一次生产现状，捕捉 raw JSON 快照之后的漂移。

### 6.1 核心版本号（通过 API 实时核对）

| 对象 | 生产 | staging/latest | 与 raw / doc 是否一致 |
|---|---|---|---|
| Property `beautyforever.com_essl` (prp_910841) | **v62** | v63 | ✅ raw=v62 字节级一致（`diff` 为空） |
| Property `api.beautyforever.com` (prp_956325) | **v10** | v11 | ✅ raw=v10 字节级一致 |
| Security Configuration 89613 | **v145** | v145 | ✅ 全网段统一 |

### 6.2 新发现（文档原本没写）

1. **双 property 均有 staging-only HSTS 改动，尚未上生产**
   - 激活时间：2026-01-06 08:35 UTC（STAGING）
   - 备注："配置 HSTS 两年"
   - 变更内容：`httpStrictTransportSecurity` behavior
     - `enable=true`
     - `maxAge=TWO_YEARS`
     - `includeSubDomains=true`
     - `preload=true`
     - `redirect=false`
   - PAPI 返回 validation 告警："Enabling preload makes future downgrade to HTTP difficult."
   - 影响：迁移到 CloudFront 时须同步在 Response Headers Policy 配置等效 HSTS，并提前评估 preload 不可逆风险。

2. **Network List `146351_SECURITYBYPASSLIST` 实际是空列表** 🔴
   - `elementCount = 0`, `networkList = null`, 最后更新 2023-02-16
   - Akamai 默认创建的空 bypass list，业务上**并无白名单 IP 生效**
   - 原文档（20/30/31/99/40）都暗示它是有内容的 IP 白名单，迁移时需要排掉这个"包袱"
   - 已在 20-waf §3 Target #1、30-domain-www §7、31-domain-m §7 备注纠正

3. **ASN 202425 拦截规则定位**
   - Custom Rule id `60383229`，name `Deny asnumber  202425 for  www.beautyforever.com`
   - conditions = `hostMatch(www.beautyforever.com)` **AND** `asNumberMatch(202425, useXForwardForHeaders=false)`，双 positiveMatch=true
   - operation = `AND`，tag = `["as-number"]`，ruleActivated = true
   - 不在 Network List / Penalty Box，是共享 WAF 配置下的独立 Custom Rule，hostMatch 限定只对 www 生效
   - 已在 20-waf §1、30-domain-www §7 备注规则号和条件结构

4. **同账号其他 `*beautyforever*` property**（已在 00-account-overview §2 列出；此处标注是否影响迁移）
   - `beautyforever.com` (prp_883650) v36 —— 从未 production，疑似历史残留
   - `beautyforever.com_akamai_test` (prp_899790) v9 —— 测试 property
   - `dev-beautyforever.com` (prp_923813) v51 —— 开发环境
   - `sapi.beautyforever.com` (prp_1093527) v6 —— staging API（WAF `Policy Api-Evaluation`，未正式 enforce）
   - 对生产流量迁移无直接影响，但告警：**若客户要求整体搬迁账号，这几条也要入范围**

### 6.3 WAF v145 其他盘点（无需文档改动，仅备案）

- **Custom Rules 激活 19 条**（见 20-waf §... 或 `raw` 侧写）：bypass test agent、Deny UA、Deny Client TLS Fingerprint 系列、Monitor vcdn.nadula.com、GeoDeny beautyforever/nadula/unice、ASnumber8075 四站、deny referer eslq=seeds、11-21 Attack Deny、Deny asnumber 202425 —— tag 使用规范，都可 1:1 翻译到 AWS WAF Custom Rules。
- **Rate Policies 5 条**：Origin Error (5/8 rpm/path/IP)、Page View Requests (15/25)、POST Page Requests (3/5)、API Page View Requests (13/20)、Static resource (13/20)，全部 `clientIdentifier=ip`。
- **Security Policies 3 条**：`Policy Deny` (qik1_201886)、`Policy Alert` (1218_239915)、`Policy Api` (0124_243504) —— 与 Match Target 映射一致。

### 6.4 重跑命令

```bash
# 实时对比 raw JSON 与当前生产版本
python3 /tmp/akamai_query.py rules prp_910841 62 | tail -n +2 > /tmp/essl-v62.json
diff <(jq -S . raw/essl_rules.json) <(jq -S . /tmp/essl-v62.json)   # 应当为空

# staging v63/v11 拉取
python3 /tmp/akamai_query.py rules prp_910841 63 | tail -n +2 > /tmp/essl-v63.json
python3 /tmp/akamai_query.py rules prp_956325 11 | tail -n +2 > /tmp/api-v11.json

# activation 历史
python3 /tmp/akamai_activations.py prp_910841
python3 /tmp/akamai_activations.py prp_956325

# Bypass Network List
python3 /tmp/akamai_netlist.py 146351_SECURITYBYPASSLIST
```

## 7. Team Agent 继续可挖的点

1. 顶层 `Hostnames` 父规则下两个分支的**完整 origin / cpCode / 其他 behavior 差异**（我只确认了 origin + cpCode，可能还覆盖了 sureRoute、deviceCharacteristic 等）
2. `Advanced` 行为里的 XML metadata —— 运维可能在里面藏了手写规则
3. Bypass Network List `146351_SECURITYBYPASSLIST` 的 **实际 IP 列表**（`akamai network-lists list --list-id 146351_SECURITYBYPASSLIST --json`）
4. Rate Policy / Slow POST / Bot Manager 的具体触发阈值（见 [99-queries.md](99-queries.md) §Application Security）
5. 对 `utm_source=google/facebook.com/tiktok` 进 cacheKey 的**命中率真实度** —— 可以从 DataStream 拉 24h offload rate 对比
