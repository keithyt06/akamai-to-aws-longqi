# Property：`api.beautyforever.com` v10

> 承载域名：**`api.beautyforever.com`**
> 原始 JSON：[raw/api_rules.json](../raw/api_rules.json)、[raw/api_hostnames.json](../raw/api_hostnames.json)

> **2026-04-21 Live Audit**：Production 仍为 **v10**，与 `raw/api_rules.json` 字节级一致 ✅。
> Staging/Latest 已是 **v11**（2026-01-06 激活到 STAGING，备注"配置 HSTS 两年"），**尚未上生产**。
> v11 唯一变更：default rule 下 `httpStrictTransportSecurity` 从 `enable=false` 改为
> `enable=true`, `maxAge=TWO_YEARS`, `includeSubDomains=true`, `preload=true`, `redirect=false`。
> 与 `beautyforever.com_essl` v63 的 HSTS 改动一致，属于 essl+api 两个 property 同批次的全局加固。

## 1. 基本信息

| 字段 | 值 |
|---|---|
| Property Name | `api.beautyforever.com` |
| Property ID | `prp_956325` |
| Asset ID | `aid_11208151` |
| Account / Contract / Group | `act_F-AC-4891758` / `ctr_V-4GARL4E` / `grp_230665` |
| Production Version | **10** |
| Latest Version | 11 |
| Staging Version | 11 |
| Product | **Fresca (Ion)** |
| `is_secure` | **true**（Enhanced TLS） |
| Rule Format | `latest` |

## 2. Hostnames

| CNAME From | CNAME To | Edge Hostname ID | Cert |
|---|---|---|---|
| `api.beautyforever.com` | `api.beautyforever.com.edgekey.net` | `ehn_5406989` | `CPS_MANAGED` |

## 3. 回源（Default Rule · origin 行为）

| 字段 | 值 |
|---|---|
| originType | `CUSTOMER` |
| **origin hostname** | **`lq-bf-api-1432573287.us-east-2.elb.amazonaws.com`** |
| HTTP 端口 | 80 |
| HTTPS 端口 | 443 |
| Origin SNI | ✅ |
| verificationMode | `CUSTOM` |
| forwardHostHeader | `REQUEST_HOST_HEADER` |
| cacheKeyHostname | `REQUEST_HOST_HEADER` |
| enableTrueClientIp | ✅ |
| trueClientIpHeader | `True-Client-IP` |
| compress | ✅ |

**源站判定：** AWS ALB（`*.us-east-2.elb.amazonaws.com`），区域 **us-east-2**，后端是 **API 服务**（从 ALB 名 `lq-bf-api-*` 推断；与 www/m 的 Nuxt ALB 解耦）。

## 4. 顶层 default 额外行为

- `autoDomainValidation`（ADV）：`autodv: ""` —— 启用自动域名校验（CPS 证书自动续签 DCV）

## 5. Rule Tree 顶层（12 个子规则）

```
default (root)
├── Augment insights            （4 children · 日志 + mPulse + fingerprint cookie）
├── Accelerate delivery         （4 children · HTTP/2/3 · Adaptive Acceleration）
├── Offload origin              （caching/tieredDistribution/... + 7 children）
├── Strengthen security         （4 children · allowPost · 删响应头 · …）
├── Increase availability       （4 children · Site Failover 关 · breakConnection 开）
├── Redirect to HTTPS           （HTTP + CLIENT_REQ → 301）
├── Minimize payload            （1 child · gzip ALWAYS）
├── Sureroute&Caching           （sureRoute PERFORMANCE + caching NO_STORE）
├── XFF                         （PMUSER_CLIENT_IP 变量）
├── 指定回源请求头              （modifyOutgoingRequestHeader）
├── Timing-Allow-Origin         （响应头 `*`）
└── DS2                         （datastream）
```

## 6. Offload Origin（API 场景默认不缓存）

**顶层默认行为：**

| behavior | 配置 |
|---|---|
| `caching` | **`NO_STORE`**（API 默认不缓存） |
| `tieredDistribution` | **enabled=true** |
| `validateEntityTag` | false |
| `removeVary` | **false**（保留 Vary 头，API 需要） |
| `cacheError` | enabled=true, ttl=10s, preserveStale=true |
| `cacheKeyQueryParams` | `IGNORE` 指定列表：`gclid`、`utm_*`、`msclkid`、`fbclid`、`fclid`、`rlid`、`rfsn`、`subid`、`sscid`、`utm_expid`、`utm_referrer`、`mc_cid`、`mc_eid`、`wbraid`、`gbraid`、`irclickid`、`irpid`、`irmpname`、`cjevent`、…（广告追踪参数全部剔除出 cache key） |
| `prefreshCache` | enabled=true, prefreshval=90 |
| `downstreamCache` | allowBehavior=LESSER, behavior=ALLOW, sendHeaders=CACHE_CONTROL, sendPrivate=false |
| `cacheId` | **INCLUDE_COOKIES**: `customer_group`、`currency` —— 若某个 API 响应被允许缓存，会按 用户组 + 货币 分版本 |

**Offload origin 子规则：**

| 子规则 | 匹配 | `caching` TTL |
|---|---|---|
| CSS and JavaScript | `ext=css/js` | 365d |
| Fonts | `ext=eot/woff/woff2/otf/ttf` | 365d |
| Images | `ext=jpg/jpeg/png/gif/webp/jp2/ico/svg/svgz` | **30d**（比 www/m 的 365d 短）|
| Files | `ext=pdf/doc/docx/odt` | 7d |
| Other static objects | 大量扩展名（aif/avi/mp3/swf/zip/…）| 7d |
| HTML pages | `ext=html/htm/php/jsp/aspx/EMPTY` | **1d** ⚠ |
| Uncacheable objects | `cacheability IS_NOT …` | downstreamCache=BUST |

> 对 API 域名而言，上述扩展名绝大多数不会命中，**默认行为是 NO_STORE**。

## 7. Sureroute&Caching

- `sureRoute: enabled=true, type=PERFORMANCE`
- `caching: NO_STORE`（**再次强制 NO_STORE**，兜底防止继承意外）

## 8. Accelerate delivery

- HTTP/2、HTTP/3 启用
- **Adaptive Acceleration**：`source=MPULSE`，`enablePush=true`、`enablePreconnect=true`、`preloadEnable=true`、`enableRo=false`、`abLogic=DISABLED`

## 9. Strengthen security

- `allowPost: enabled=true, allowWithoutContentLength=false`
- 删响应头：`X-Powered-By`、`Server`
- （还有 2 条未抽出的子规则，见 raw JSON —— 建议 Team Agent 深挖）

## 10. Increase availability

- Site Failover：**enabled=false**
- **`breakConnection: enabled=true`**（`Simulate failover` 分支）⚠
  > 这是 Akamai 提供的**故障演练**行为：满足特定条件时主动断开连接。生产版本 v10 里是开的，**需要确认是演练残留还是刻意保留**。

## 11. Redirect

| 规则 | 条件 | 目标 |
|---|---|---|
| Redirect to HTTPS | `requestProtocol=HTTP` & `requestType=CLIENT_REQ` | 301 → `HTTPS://SAME_HOST/SAME_PATH` |

> API 通常只允许 HTTPS，这条是硬性兜底。

## 12. Minimize payload

- `gzipResponse: behavior=ALWAYS`

## 13. XFF

- `PMUSER_CLIENT_IP`：
  - Edge 节点：`{{builtin.AK_CLIENT_REAL_IP}}`
  - Parent 节点：从请求头 **` x-authentic-ip`** 提取 ⚠（**注意 header 名前有一个空格**，HTTP 规范不允许 header name 前导空白，**极可能是 bug** —— 这里取值会失败；迁移时顺手修掉）

## 14. 自定义头

- **指定回源请求头**：`modifyOutgoingRequestHeader`（加回源头，值见 raw JSON）
- **Timing-Allow-Origin**：响应加 `Timing-Allow-Origin: *`
- **DS2**：`datastream` 行为，写 Akamai DataStream 日志

## 15. 值得留意 / 风险点

1. **顶层 + Sureroute&Caching 双重 NO_STORE**：强意图——**api.beautyforever.com 是纯动态域名**，任何缓存必须由源站 Cache-Control 显式开启，否则全部回源。
2. **cacheId 含 cookie `customer_group`、`currency`**：源站如果返回可缓存响应，会按这两个 cookie 分版本。迁移到 CloudFront 需要额外用 CloudFront Functions 规范化这两个 cookie 进缓存键。
3. **XFF header 名 `" x-authentic-ip"`** 带前导空格 —— 几乎必然是 bug，`PMUSER_CLIENT_IP` 在 Parent 层永远取不到值。
4. **`breakConnection: enabled=true`** —— 生产上开着故障注入，确认是否有意。
5. **`cacheKeyQueryParams IGNORE` 列表** 枚举了 20+ 个广告追踪参数 —— 迁移时必须搬过来，否则缓存命中率会暴跌。
6. **广告/追踪参数白名单**与 www/m 的 `INCLUDE_ALL_QUERY_PARAMS` 策略不同，说明 api 路径对 query string 更敏感、要主动屏蔽广告追踪参数污染缓存键。
