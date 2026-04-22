# 域名视图：`api.beautyforever.com`

> 本文件是**单域名**的穿透视图。
> 详细配置见：[11-property-api-beautyforever.md](11-property-api-beautyforever.md)、[20-waf-security-configuration.md](20-waf-security-configuration.md)

## 1. DNS / TLS 入口

| 字段 | 值 |
|---|---|
| Hostname | `api.beautyforever.com` |
| CNAME 到 Edge Hostname | **`api.beautyforever.com.edgekey.net`** |
| TLS 类型 | Enhanced TLS（ESSL） |
| 证书 | CPS-Managed |
| Edge Hostname ID | `ehn_5406989` |

## 2. 所属 Property（CDN）

| 字段 | 值 |
|---|---|
| Property | `api.beautyforever.com` |
| Property ID | `prp_956325` |
| Production Version | **10** |
| Product | Fresca (Ion) |
| Hostnames on Property | 仅 `api.beautyforever.com`（独占一个 Property） |

## 3. 回源

- **Origin：** `lq-bf-api-1432573287.us-east-2.elb.amazonaws.com`（AWS ALB，us-east-2）
- 后端：API 服务（与 www/m 的 Nuxt ALB 解耦）
- 透传 Host 头、Origin SNI、HTTPS 443
- True-Client-IP：`True-Client-IP`

## 4. 缓存策略

**默认 NO_STORE**（API 场景），且 **Sureroute&Caching 子规则再次强制 NO_STORE** 兜底。

| 情形 | TTL |
|---|---|
| **默认** | **NO_STORE** |
| `ext=css/js` | 365d |
| `ext=jpg/png/webp/gif/svg/...` | **30d**（比主站短） |
| `ext=woff/woff2/otf/ttf/eot` | 365d |
| `ext=pdf/doc/docx/odt` | 7d |
| `ext=avi/mp3/swf/zip/...` | 7d |
| `ext=html/.htm/.php/.jsp/.aspx` | 1d |
| `Uncacheable objects` | downstreamCache=BUST |

> 以上扩展名规则对 API 请求**几乎全部不命中**；实际运行时就是走默认 NO_STORE 回源。

**若有 API 响应被源站标记为 cacheable（如商品目录接口），Cache Key 额外包含：**
- Cookie：`customer_group`、`currency`
- Query string：剔除广告追踪参数 `gclid`、`utm_*`、`msclkid`、`fbclid`、`fclid`、`rlid`、`rfsn`、`subid`、`sscid`、`utm_expid`、`utm_referrer`、`mc_cid`、`mc_eid`、`wbraid`、`gbraid`、`irclickid`、`irpid`、`irmpname`、`cjevent`、…（完整列表见 raw JSON）

## 5. 跳转规则

- HTTP → HTTPS 301（仅 `requestType=CLIENT_REQ`）
- 无 PC/Mobile 互跳（API 不涉及）

## 6. 加速能力

- SureRoute（PERFORMANCE）
- Tiered Distribution
- HTTP/2、HTTP/3
- Adaptive Acceleration（Push / Preconnect / Preload，源 mPulse）
- gzip ALWAYS

## 7. 可用性（⚠ 故障注入）

- Site Failover：**关闭**
- **`breakConnection: enabled=true`**（`Simulate failover` 分支）——**生产版本里开着**故障演练行为 ⚠
  - 满足特定条件时 Edge 会主动断开客户端连接
  - 需要业务侧确认是演练残留还是刻意保留；迁移时建议先关闭或定义清楚触发条件

## 8. 安全（WAF）

| 字段 | 值 |
|---|---|
| WAF Config | `Security Configuration` (id 89613) v145 |
| Match Target | sequence 3 (id 7384226) |
| **Policy** | **`Policy Api` (`0124_243504`)** |
| Bypass Network List | 无 |
| 启用控件 | WAF rules、Bot Manager、Network、Rate Control、Slow POST |
| Property staging 待上线 | v11 新增 HSTS（maxAge=TWO_YEARS, includeSubDomains/preload=true）**尚未到生产** |

> API 策略与 Web（Policy Deny）不同；通常 API 策略更倾向于：JSON/XML schema validation、rate control、abuse detection。具体规则差异需要 Team Agent 用 `akamai appsec attack-group --policy-id 0124_243504` 继续拉。

## 9. CDN 层响应头修改

- 删响应头：`X-Powered-By`、`Server`
- 加：`Timing-Allow-Origin: *`

## 10. 回源请求头

- 透传 `True-Client-IP`
- **⚠ 注意** `PMUSER_CLIENT_IP` 的 Parent 层 extract 指定从请求头 `" x-authentic-ip"`（**前导空格**）提取 —— HTTP 规范不允许 header name 有前导空白，**几乎必然是 bug**，取值永远为空。迁移时顺手修成 `x-authentic-ip`。
- `modifyOutgoingRequestHeader` 自定义头（值见 raw JSON）

## 11. 动静态判定

**类型：纯动态**。详见 [90-dynamic-static-analysis.md](90-dynamic-static-analysis.md)。

- 默认 NO_STORE + Sureroute&Caching 双重 NO_STORE → **所有 API 请求默认回源**
- 缓存仅在源站 `Cache-Control: public, max-age=…` 明确允许时才生效
- 即便可缓存，也按 `customer_group`、`currency` cookie 拆版本 → 缓存命中率天然受限
- 广告追踪参数已剔除出 cache key → 拆版本污染被最小化

## 12. Team Agent 后续可挖

1. 源站 API 响应的 Cache-Control 头分布：是否有 `public` 的 GET 接口（商品列表、分类树等）
2. raw/api_rules.json 中 `Strengthen security` 的 4 条子规则（除 allowPost/删 header 外还有 2 条未列）
3. raw/api_rules.json 中 `Augment insights` 的 4 条子规则（日志 & 变量）
4. `breakConnection: enabled=true` 的触发条件（Simulate failover 节点内的 criteria）
5. WAF `Policy Api` 的 attack group 配置、rate policies、bot categories
6. API 的限流策略（Rate Control 阈值）
7. **修 header bug：** `" x-authentic-ip"` → `"x-authentic-ip"`
