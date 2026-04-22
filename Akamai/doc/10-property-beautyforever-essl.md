# Property：`beautyforever.com_essl` v62

> 承载域名：**`www.beautyforever.com`**、**`m.beautyforever.com`**
> 原始 JSON：[raw/essl_rules.json](../raw/essl_rules.json)、[raw/essl_hostnames.json](../raw/essl_hostnames.json)

> **2026-04-21 Live Audit**：Production 仍为 **v62**，与 `raw/essl_rules.json` 字节级一致 ✅。
> Staging/Latest 已是 **v63**（2026-01-06 激活到 STAGING，备注"配置 HSTS 两年"），**尚未上生产**。
> v63 新增一条 `HSTS` 子规则，behavior = `httpStrictTransportSecurity`，options：
> `enable=true`, `maxAge=TWO_YEARS`, `includeSubDomains=true`, `preload=true`, `redirect=false`。
> PAPI validation 告警："Enabling preload makes future downgrade to HTTP difficult."
> → 迁移到 CloudFront 时若打算带上同一策略，需在 CloudFront Response Headers Policy 里配置等效的 `Strict-Transport-Security` 并同时评估 preload 的不可逆性。

## 1. 基本信息

| 字段 | 值 |
|---|---|
| Property Name | `beautyforever.com_essl` |
| Property ID | `prp_910841` |
| Asset ID | `aid_11153387` |
| Account / Contract / Group | `act_F-AC-4891758` / `ctr_V-4GARL4E` / `grp_230665` |
| Production Version | **62** |
| Latest Version | 63 |
| Staging Version | 63 |
| Product | **Fresca (Ion)** |
| `is_secure` | **true**（Enhanced TLS / ESSL） |
| Rule Format | `latest` |

## 2. Hostnames（Property 绑定的客户域名）

| CNAME From | CNAME To (Edge Hostname) | Edge Hostname ID | Cert Provisioning |
|---|---|---|---|
| `www.beautyforever.com` | `beautyforever.com.edgekey.net` | `ehn_5327863` | `CPS_MANAGED` |
| `m.beautyforever.com`   | `beautyforever.com.edgekey.net` | `ehn_5327863` | `CPS_MANAGED` |

> **证书**由 Akamai CPS（Certificate Provisioning System）管理；两个 hostname 共用同一个 Enhanced TLS Edge Hostname。

## 3. 回源（Default Rule · origin 行为）

| 字段 | 值 |
|---|---|
| originType | `CUSTOMER` |
| **origin hostname** | **`lq-bf-nuxt-1212474737.us-east-2.elb.amazonaws.com`** |
| HTTP 端口 | 80 |
| HTTPS 端口 | 443 |
| Origin SNI | ✅ |
| verificationMode | `CUSTOM`（客户自定义证书校验链） |
| forwardHostHeader | `REQUEST_HOST_HEADER`（透传客户 Host）|
| cacheKeyHostname | `REQUEST_HOST_HEADER` |
| enableTrueClientIp | ✅ |
| trueClientIpHeader | `True-Client-IP` |
| compress（回源压缩）| ✅ |

**源站判定：** AWS Application Load Balancer（`*.us-east-2.elb.amazonaws.com`），区域 **us-east-2**（俄亥俄），后端跑 **Nuxt**（Vue SSR 框架，从 ALB 名称 `lq-bf-nuxt-*` 推断）。

## 4. CP Code（按 hostname 分）

顶层 default 规则的 CP Code 会被 `Hostnames` 父规则下的两个分支**按 host 覆盖**：

| 作用范围 | CP Code ID | Name | Products |
|---|---|---|---|
| 顶层 default | `1435979` | m.beautyforever.com-Ion | Fresca |
| `Hostnames / www.beautyforever.com` | **`1435977`** | **www.beautyforever.com-Ion** | Fresca |
| `Hostnames / m.beautyforever.com` | `1435979` | m.beautyforever.com-Ion | Fresca |

> 实际计费和日志维度按这两个 CP Code 分开统计。迁移到 CloudFront 时对应到**两个分开的 Distribution** 或同一 Distribution + Logging 分组。

## 5. Rule Tree 顶层（19 个子规则）

```
default (root)
├── Augment insights            （2 children · 日志 + 变量提取）
├── Accelerate delivery         （4 children · HTTP/2 · HTTP/3 · Adaptive Acceleration）
├── Offload origin              （caching/tieredDistribution/... + 8 children）
├── Strengthen security         （3 children · allowPost · 删响应头）
├── Increase availability       （2 children · Site Failover 关闭）
├── Minimize payload            （1 child · gzip ALWAYS）
├── Hostnames                   （2 children · PC/Mobile 分支）
├── Redirect                    （3 children · HTTPS · PC↔Mobile）
├── SureRoute                   （hostname=www+m → sureRoute PERFORMANCE）
├── Cache Tag & Page Caching    （hostname=www+m · 5 children）
├── Js tag                      （2 children · 注入 JS）
├── ADV                         （autoDomainValidation）
├── XFF                         （2 children · PMUSER_CLIENT_IP 变量）
├── SEO tuning                  （setVariable PMUSER_TRIGGERED_RULES）
├── timing-allow-origin         （modifyOutgoingResponseHeader）
├── Add DS2                     （datastream）
├── 指定回源请求头              （modifyOutgoingRequestHeader）
├── 图片响应头                   （jpg/png/webp/... downstreamCache 365d）
└── Advanced                    （advanced XML metadata）
```

## 6. Offload Origin（缓存主干）

**顶层默认行为**（Default · Offload origin 节点）

| behavior | 配置 |
|---|---|
| `caching` | **`NO_STORE`**（默认不缓存；必须由子规则显式开启） |
| `tieredDistribution` | **enabled=true**（启用 Tier 2 回源聚合） |
| `validateEntityTag` | false |
| `removeVary` | true |
| `cacheError` | enabled=true, ttl=**10s**, preserveStale=true |
| `cacheKeyQueryParams` | `IGNORE_ALL`（忽略所有 query string） |
| `prefreshCache` | enabled=true, prefreshval=90（缓存剩余 10% 即预热） |
| `downstreamCache` | allowBehavior=LESSER, behavior=ALLOW, sendHeaders=CACHE_CONTROL, sendPrivate=false |

**Offload origin 子规则**（按扩展名/路径分桶）

| 子规则 | 匹配 | `caching` TTL | 备注 |
|---|---|---|---|
| CSS and JavaScript | `ext=css/js` | **365d** | `cacheId` 含 query `v` 作版本号 |
| Fonts | `ext=eot/woff/woff2/otf/ttf` | **365d** | |
| Images | `ext=jpg/jpeg/png/gif/webp/jp2/ico/svg/svgz` | **365d** | `cacheId=INCLUDE_ALL_QUERY_PARAMS` |
| Image and Video Manager (Images) | `ext=jpg/gif/jpeg/png/imviewer` + `host=www/m` | 365d | 走 IVM 处理 |
| HTML pages | `ext=html/htm/php/jsp/aspx/EMPTY` | **`NO_STORE`** | 但被 `Cache Tag & Page Caching` 覆盖 |
| Uncacheable objects | `cacheability IS_NOT …` | downstreamCache=BUST | |

## 7. Cache Tag & Page Caching（www + m 专用页面缓存）

**仅对 `hostname IN [www.beautyforever.com, m.beautyforever.com]` 生效。**
**所有页面缓存都会在响应里打 Cache Tag 标签（用于 Fast Purge by Tag 失效刷新）。**

| 子规则 | 匹配 | TTL | Cache Tag | Cache ID 构成 |
|---|---|---|---|---|
| **首页** | `path=/` | **6h** | `bf-all` + `bf-home` | cookies(currency, group_id, abTest) |
| ├─ 带指定参数不缓存 | `?akaCache=nce` | `NO_STORE` | — | — |
| └─ utm_source 缓存 | `?utm_source=google/facebook.com/tiktok` | 6h | `bf-all` + `bf-home` | cookies + query `utm_source` |
| **列表 & 详情页** | `ext=html` 且 path ∉ `/activity/*` | **6h** | `bf-all` + `bf-listinfo` | cookies + **`EXCLUDE_QUERY_PARAMS`**（34 个追踪参数外的其他所有 query）⚠ |
| ├─ 带指定参数不缓存 | `?akaCache=nce` | `NO_STORE` | — | — |
| └─ utm_source 缓存 | `ext=html` + `utm_source=google/facebook.com/tiktok` | 6h | `bf-all` + `bf-listinfo` | cookies + query `utm_source` |
| **博客页面** | `path=/blog/*` | **365d** | `bf-blog` | cookies + query `page` |
| ├─ 带指定参数不缓存 | `?akaCache=nce` | `NO_STORE` | — | — |
| └─ utm_source 缓存 | `?utm_source=google/facebook.com/tiktok` | 365d | `bf-blog` | cookies + query `page` + `utm_source` |
| **活动页** | `path=/activity/* 或 /activity-*` | **6h** | `bf-all` + `bf-activity` | cookies |
| ├─ 带指定参数不缓存 | `?akaCache=nce` | `NO_STORE` | — | — |
| └─ utm_source 缓存 | `?utm_source=google/facebook.com/tiktok` | 6h | `bf-all` + `bf-activity` | cookies + `utm_source` |
| **/static/** | `path=/static/*` | **1d** | — | 普通请求**只按 path**；若带 query `LT1RVf0XvMD1A78LUGJ2JvcSkHTKq8vb` 则拆版本（optional=true） |

> `?akaCache=nce` 是全局**绕过缓存**的 backdoor —— 调试或手动刷新时可用。

### 列表&详情页 cacheId 的 EXCLUDE 列表（34 个追踪参数）

这些参数**不会**进入 cache key（命中同一缓存版本），防止追踪参数污染缓存：

```
gad_source, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
utm_expid, utm_referrer, gclid, cx, ie, cof, siteurl, aid, campaign_id,
fbclid, rfsn, subid, msclkid, fclid, rlid, sscid, track_xid, wtbap,
tagtag_uid, spm, wtbae, message_id, mobile, firstname, lastname, crm_spm,
srsltid, brid, afsrc
```

> **注意** cookie（currency, group_id, abTest）和"utm_source=google/facebook/tiktok 子分支"是**并列**的两套 cacheId 附加；当 utm_source 命中白名单时，会同时参与拆版本。

## 8. Accelerate delivery

- HTTP/2：启用
- HTTP/3：启用（`enhancedAkamaiProtocol`）
- Adaptive Acceleration（MPulse 数据驱动）：Push / Preconnect / Preload 开；A/B Logic 关闭
- Prefetch / DNS Async Refresh：启用

## 9. Strengthen security（CDN 层）

> 注：**WAF / Bot** 的实际规则由独立的 Application Security 配置 `Security Configuration` (id 89613) 管理，本 Property 仅做 CDN 层的基础头处理。详见 [20-waf-security-configuration.md](20-waf-security-configuration.md)。

| 子规则 | 行为 |
|---|---|
| Allowed methods / POST | `allowPost: enabled=true, allowWithoutContentLength=false` |
| Obfuscate backend info | 删响应头 `X-Powered-By`、`Server` |

## 10. Increase availability

- Site Failover：**enabled=false**（未启用失败切源） → 源站故障时 CDN 不做兜底。

## 11. Minimize payload

- `gzipResponse: behavior=ALWAYS` → 对所有响应始终压缩（满足 Cache-Control 的前提下）

## 12. Redirect（3 条）

### ① Redirect to HTTPS（301）

```
proto=HTTP AND requestType=CLIENT_REQ
→ 301 HTTPS://SAME_HOST/SAME_PATH（query APPEND）
```

### ② Default PC → Mobile（302）

```
host = www.beautyforever.com
AND deviceCharacteristic[IS_MOBILE] = true            ← Akamai 内置 UA/device 判定
AND UA NOT IN [
      "LqPassWaf/851.3",
      "LqPassWaf/851.3 (it; Categraf)"                ← 内部 WAF 放行 UA，不跳转
    ]
AND ext NOT IN ["js", "css"]                          ← 静态资源不跳转
→ 302 https://m.beautyforever.com/SAME_PATH （query APPEND）
```

### ③ Default Mobile → PC（302）

```
host = m.beautyforever.com
AND deviceCharacteristic[IS_MOBILE] = false           ← UA 被判定为 PC
AND UA NOT IN [
      "LqPassWaf/851.3",
      "LqPassWaf/851.3 (it; Categraf)"
    ]
AND path NOT MATCHES [                                ← 苹果支付通道验证不跳转
      "/.well-known/apple-developer-merchantid-domain-association.txt"
    ]
AND ext NOT IN ["js", "css"]
→ 302 https://www.beautyforever.com/SAME_PATH （query APPEND）
```

**关键点（迁移必保留）：**
1. **302（不是 301）** —— 便于 UA/设备判定变化时 SEO/浏览器快速回退
2. **`LqPassWaf/851.3` UA 白名单** —— 用于内部 WAF/健康检查/性能采集（含 Categraf 变体），不跳转避免影响探测
3. **`/.well-known/apple-developer-merchantid-domain-association.txt` 路径白名单** —— 苹果 Apple Pay 域名注册校验，必须能在 m 域名直接返回 200，不可被重定向
4. **`js/css` 扩展名白名单** —— 静态资源走 UA 判定会错判，不跳转

## 13. SureRoute

- 启用（仅 `hostname=www/m`）
- `type=PERFORMANCE`（动态优化路由）
- `toHostStatus=INCOMING_HH`（使用 incoming host header）
- `raceStatTtl=30m`
- `forceSslForward=false`
- Test Object 路径：`/akamai/sureroute...` （完整值见 raw JSON）

## 14. XFF 链路（客户端真实 IP）

- `PMUSER_CLIENT_IP` 变量：
  - Edge 节点：`{{builtin.AK_CLIENT_REAL_IP}}`
  - Parent 节点：从请求头 `x-authentic-ip` 提取
- 用于回源时携带可信的原始客户端 IP（防 L7 代理丢失）

## 15. SEO tuning

- `PMUSER_TRIGGERED_RULES = {{builtin.AK_FIREWALL_TRIGGERED_RULES}}` —— 把 WAF 触发规则号暴露给 Nuxt 回源，业务侧可基于此做 SEO 降级。

## 16. DataStream（DS2 日志）

- 启用 `datastream` 行为（Add DS2 分支）
- 配合 `Augment insights` 的日志子规则，原始请求 + 响应明细会写到 Akamai DataStream

## 17. 自定义头

- **指定回源请求头**：`modifyOutgoingRequestHeader` 给源站加自定义头（具体值在 raw JSON 的 `options`）
- **timing-allow-origin**：响应加 `Timing-Allow-Origin: *`（给 mPulse RUM 跨域采集用）
- **图片响应头**：图片扩展名响应加 `Cache-Control` 头，downstream TTL 365d

## 18. Advanced

- 末尾含 `advanced` 行为（自定义 XML metadata）——未解析，视为"黑盒"扩展。迁移时需要取出 XML 源码核对；raw JSON 内可查。

## 19. 值得留意 / 风险点

1. **HTML 默认 NO_STORE，但页面缓存 override 了首页/列表/详情/博客/活动** —— 迁移 AWS 时需要逐路径复刻 TTL 矩阵，不能只按扩展名判定。
2. **Cache Key 含 cookie（currency/group_id/abTest）** —— 如果换成 CloudFront，需要用 CloudFront Functions 或 Lambda@Edge 规范化 cookie 后作为缓存键的一部分；原生 CloudFront 不能直接拿任意 Cookie 入缓存键。
3. **`?akaCache=nce` 绕过缓存是 Akamai 专用约定**，迁移后需要在新 CDN 保留等价 backdoor。
4. **Site Failover 关闭** —— 源站挂掉会直接 502，业务层未做兜底。
5. **Advanced XML** —— 未解析，迁移前必须人工审阅。
