# 域名视图：`m.beautyforever.com`

> 本文件是**单域名**的穿透视图。`m.beautyforever.com` 与 `www.beautyforever.com` **共享同一个 Property**，规则完全一致，差异仅在 UA 触发的 PC/M 互跳。
> 详细配置见：[10-property-beautyforever-essl.md](10-property-beautyforever-essl.md)、[20-waf-security-configuration.md](20-waf-security-configuration.md)
> 同源视图：[30-domain-www-beautyforever-com.md](30-domain-www-beautyforever-com.md)

## 1. DNS / TLS 入口

| 字段 | 值 |
|---|---|
| Hostname | `m.beautyforever.com` |
| CNAME 到 Edge Hostname | **`beautyforever.com.edgekey.net`**（与 www 共用） |
| TLS 类型 | Enhanced TLS（ESSL） |
| 证书 | CPS-Managed |
| Edge Hostname ID | `ehn_5327863` |

## 2. 所属 Property（CDN）

| 字段 | 值 |
|---|---|
| Property | `beautyforever.com_essl` |
| Property ID | `prp_910841` |
| Production Version | **62** |
| Product | Fresca (Ion) |
| 与同 Property 共享的域名 | `www.beautyforever.com` |
| **CP Code（m 专属）** | **`1435979`**（`m.beautyforever.com-Ion`）—— 通过 `Hostnames` 父规则下 m 分支覆盖顶层默认 |

> **关键事实：** 配置 100% 共享。任何对 m 的规则调整也会同时影响 www，反之亦然。

## 3. 回源

- **Origin：** `lq-bf-nuxt-1212474737.us-east-2.elb.amazonaws.com`（AWS ALB，us-east-2；Nuxt SSR）
- 透传 Host 头 → 源站通过 Host 判定渲染 PC 或 M 版（Nuxt 侧根据 host 决定模板）

## 4. 缓存策略

**与 www 完全一致**（缓存 Key 里 `hostname` 会把 m 和 www 自然拆成两份；CP Code 区分：m = `1435979`、www = `1435977`）：

| 路径 / 扩展 | TTL | Cache Tag | Cache Key 构成 |
|---|---|---|---|
| `/`（首页） | **6h** | `bf-all` + `bf-home` | host + path + cookies(currency, group_id, abTest) |
| HTML 列表/详情页（非 `/activity/*`） | **6h** | `bf-all` + `bf-listinfo` | host + path + cookies + **除 34 个追踪参数外的所有 query**（EXCLUDE）|
| `/blog/*` | **365d** | `bf-blog` | host + path + cookies + query `page` |
| `/activity/*`、`/activity-*` | **6h** | `bf-all` + `bf-activity` | host + path + cookies |
| `/static/*` | **1d** | — | 仅 path（若带 `?LT1RVf0...=X` token 则拆版本，optional）|
| `ext=css/js` | **365d** | — | query `v` 作版本号 |
| `ext=jpg/png/webp/gif/...` | **365d** | — | 含所有 query 参数 |
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

> `utm_source=google/facebook.com/tiktok` 三个值会进 cache key 拆版本（用于独立评估广告来源命中率）。

## 5. 跳转 & 分流规则

- HTTP → HTTPS **301**
- **Desktop UA 访问 m → 302 回 `www.beautyforever.com`**（强制 PC 用户到 PC 站）
- Mobile UA 访问 www → **302** 到 m（反向）

**Desktop→PC（m → www）跳转白名单（满足任一则不跳）：**

1. UA ∈ `["LqPassWaf/851.3", "LqPassWaf/851.3 (it; Categraf)"]` —— 内部 WAF/健康检查/Categraf 采集
2. path = `/.well-known/apple-developer-merchantid-domain-association.txt` —— **Apple Pay 域名注册校验**（必须保留 m 域名 200 响应，不可重定向）
3. `ext ∈ ["js", "css"]` —— 静态资源不参与 UA 判定
4. `deviceCharacteristic[IS_MOBILE]` 判定仍为 true 时不触发（继续停留在 m）

## 6. 加速能力

- 与 www 同：SureRoute、Tiered Distribution、HTTP/2 & HTTP/3、Adaptive Acceleration、Prefetch、gzip ALWAYS。

## 7. 安全（WAF）

| 字段 | 值 |
|---|---|
| WAF Config | `Security Configuration` (id 89613) v145 |
| Match Target | sequence 1 (id 5789054) —— 与 www 同一个 match target |
| **Policy** | **`Policy Deny` (`qik1_201886`)** |
| Bypass Network List | `146351_SECURITYBYPASSLIST`（**2026-04-21 审计为空 `elementCount=0`**）|
| 启用控件 | WAF、Bot Manager、Network、Rate、Slow POST |
| 当天变更 | 2026-04-21 新增的 ASN 202425 拦截规则（Custom Rule id `60383229`）**仅匹配 `www.beautyforever.com`，不影响 m** |
| Property staging 待上线 | 与 www 共享 essl v63 HSTS 改动（未上生产） |

## 8. CDN 层响应头修改

- 删 `X-Powered-By`、`Server`
- 加 `Timing-Allow-Origin: *`

## 9. 回源请求头

- 透传 `True-Client-IP`
- `modifyOutgoingRequestHeader` 自定义头（与 www 相同）

## 10. 动静态判定

**类型：混合偏动态**（与 www 相同结论）。详见 [90-dynamic-static-analysis.md](90-dynamic-static-analysis.md)。

m 站的所有动态逻辑与 www 共享：HTML 由 Nuxt SSR 渲染，部分热点路径边缘按 cookie 拆版缓存，静态资源 365d。

## 11. Team Agent 后续可挖

1. 与 www 相同的挖掘列表（见 [30-domain-www-beautyforever-com.md](30-domain-www-beautyforever-com.md) §11）
2. **m 专属的移动端请求 patterns**：
   - Is SEO-indexed（ext=html 的 6h 缓存是否真命中？）
   - Mobile UA 检测逻辑（Akamai 内置 `User-Agent Device Class` 判断）
3. Hostname 分支子规则（`Hostnames` 父规则下 2 个 children，raw JSON 里细看）—— 是否对 m 做了 UA / 路径差异处理
