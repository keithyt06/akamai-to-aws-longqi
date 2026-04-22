# 域名视图：`www.beautyforever.com`

> 本文件是**单域名**的穿透视图，把 CDN + WAF + 动静态分析串起来。
> 详细配置见：[10-property-beautyforever-essl.md](10-property-beautyforever-essl.md)、[20-waf-security-configuration.md](20-waf-security-configuration.md)

## 1. DNS / TLS 入口

| 字段 | 值 |
|---|---|
| Hostname | `www.beautyforever.com` |
| CNAME 到 Edge Hostname | **`beautyforever.com.edgekey.net`** |
| TLS 类型 | Enhanced TLS（ESSL） |
| 证书 | CPS-Managed（Akamai 托管） |
| Edge Hostname ID | `ehn_5327863` |

## 2. 所属 Property（CDN）

| 字段 | 值 |
|---|---|
| Property | `beautyforever.com_essl` |
| Property ID | `prp_910841` |
| Production Version | **62** |
| Product | Fresca (Ion) |
| 与同 Property 共享的域名 | `m.beautyforever.com`（两者共享同一套规则）|

## 3. 回源

- **Origin：** `lq-bf-nuxt-1212474737.us-east-2.elb.amazonaws.com`（AWS ALB，us-east-2）
- 后端：Nuxt.js SSR
- 透传 Host 头、Origin SNI、HTTPS 443
- True-Client-IP：`True-Client-IP` 响应给源站

## 4. 缓存策略（www 专属生效）

| 路径 / 扩展 | TTL | Cache Tag | Cache Key 构成 |
|---|---|---|---|
| `/`（首页） | **6h** | `bf-all` + `bf-home` | host + path + cookies(currency, group_id, abTest) |
| HTML 列表/详情页（非 `/activity/*`） | **6h** | `bf-all` + `bf-listinfo` | host + path + cookies + **除 34 个追踪参数外的所有 query**（EXCLUDE）|
| `/blog/*` | **365d** | `bf-blog` | host + path + cookies + query `page` |
| `/activity/*`、`/activity-*` | **6h** | `bf-all` + `bf-activity` | host + path + cookies |
| `/static/*` | **1d** | — | 仅 path（若带 `?LT1RVf0...=X` token 则拆版本，optional）|
| `ext=css/js` | **365d** | — | query `v` 作版本号 |
| `ext=jpg/png/webp/gif/...` | **365d** | — | 含所有 query 参数；响应头 `Cache-Control: public, max-age=31536000` |
| `ext=woff/woff2/otf/ttf/eot` | **365d** | — | — |
| 其它 HTML（`.htm/.php/.jsp/.aspx`） | `NO_STORE` | — | — |
| **任意带 `?akaCache=nce`** | `NO_STORE`（绕过） | — | — |
| 默认行为 | `NO_STORE`（运维口径 "ttl=0"）| — | — |

**列表&详情页的 34 个追踪参数 EXCLUDE 列表（不进 cache key）：**

```
gad_source, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
utm_expid, utm_referrer, gclid, cx, ie, cof, siteurl, aid, campaign_id,
fbclid, rfsn, subid, msclkid, fclid, rlid, sscid, track_xid, wtbap,
tagtag_uid, spm, wtbae, message_id, mobile, firstname, lastname, crm_spm,
srsltid, brid, afsrc
```

> 当 `utm_source=google/facebook.com/tiktok` 时**例外**：这三个值会进 cache key 拆版本，用于独立评估广告来源的命中率。

## 5. 跳转 & 分流规则

- HTTP → HTTPS 301
- PC UA 访问 www → 301 到 `m.beautyforever.com`（走移动）
- Mobile UA 访问 m → 301 到 `www.beautyforever.com`（走 PC）

## 6. 加速能力

- SureRoute（PERFORMANCE，仅 www + m）
- Tiered Distribution
- HTTP/2、HTTP/3
- Adaptive Acceleration（Preconnect / Push / Preload，源数据 mPulse）
- Prefetch、DNS Async Refresh
- gzip ALWAYS

## 7. 安全（WAF）

| 字段 | 值 |
|---|---|
| WAF Config | `Security Configuration` (id 89613) v145 |
| Match Target | sequence 1 (id 5789054) |
| **Policy** | **`Policy Deny` (`qik1_201886`)** |
| Bypass Network List | `146351_SECURITYBYPASSLIST`（**2026-04-21 审计为空 `elementCount=0`**，无实际白名单 IP）|
| 启用控件 | WAF rules、Bot Manager、Network Layer、Rate Control、Slow POST |
| 当天变更 | 2026-04-21 新增：**ASN 202425 + `www.beautyforever.com` 直接拦截**（Custom Rule id `60383229`，operation=AND、hostMatch+asNumberMatch 双正向匹配） |
| Property staging 待上线 | v63 HSTS（maxAge=TWO_YEARS, preload+includeSubDomains）**尚未到生产** |

## 8. CDN 层响应头修改

- 删除：`X-Powered-By`、`Server`（防后端指纹泄露）
- 添加：`Timing-Allow-Origin: *`（给 mPulse RUM 用）

## 9. 回源请求头（Edge → Origin）

- 透传 `True-Client-IP`
- `modifyOutgoingRequestHeader` 自定义头（"指定回源请求头" 子规则，值见 raw JSON）
- Nuxt 回源侧可从 `PMUSER_TRIGGERED_RULES` 获取 WAF 触发的规则号

## 10. 动静态判定

**类型：混合偏动态**。详见 [90-dynamic-static-analysis.md](90-dynamic-static-analysis.md)。

- HTML 来自 Nuxt SSR（动态渲染）
- 首页/列表/详情/博客/活动页 在边缘按 cookie 分版本缓存 6h–365d（**动态内容被边缘部分静态化**）
- CSS/JS/字体/图片 365d 长缓存
- 个性化请求（登录、购物车、搜索、结算、带 `?akaCache=nce` 的所有路径）走 NO_STORE 回源

## 11. Team Agent 后续可挖

1. raw/essl_rules.json 中的 **`Advanced`** 节点（自定义 XML metadata）
2. `Js tag` 注入的具体 JS 内容和触发条件
3. 每个页面缓存子规则的 **完整 query-param 白名单**（详情页 utm/gclid/fbclid/... 列表很长）
4. Bypass Network List `146351_SECURITYBYPASSLIST` 的 IP 列表 —— ✅ 2026-04-21 已查：`elementCount=0`，空列表
5. WAF `Policy Deny` 的具体规则动作、自定义规则、Rate Policy
6. 今天刚加的 ASN 202425 拦截落在哪个子结构，规则格式 —— ✅ 2026-04-21 已定位：Custom Rule id `60383229`，hostMatch+asNumberMatch AND（见 §7）
