# 动静态请求分析（核心结论）

> 问题：**`www.beautyforever.com`、`m.beautyforever.com`、`api.beautyforever.com` 这三个域名是否都是动态请求？**
>
> 判断依据：Akamai Property Manager 规则树中的 `caching` behavior、`cacheId`、`cacheKeyQueryParams`、`downstreamCache` 组合，以及源站架构（ALB 名称、路径模式）。

## 一句话答案

**不完全是。`api.beautyforever.com` 是纯动态；`www` / `m.beautyforever.com` 是"动静混合、偏动态"** —— HTML 页面来自 Nuxt SSR，但部分路径（首页 / 列表 / 详情 / 博客 / 活动）在边缘按 cookie 分版本缓存 6h–365d；静态资源（css/js/字体/图片）长缓存 365d。

## 判定矩阵

| 域名 | 默认 caching 行为 | HTML 是否缓存 | 静态资源是否缓存 | 动静态判定 |
|---|---|---|---|---|
| `www.beautyforever.com` | `NO_STORE`（但被 Page Caching 覆盖）| **部分路径缓存 6h–365d** | 365d | **混合偏动态** |
| `m.beautyforever.com` | 同上（共享 Property） | 同上 | 同上 | **混合偏动态** |
| `api.beautyforever.com` | **`NO_STORE`**（Sureroute&Caching 再次兜底）| 1d（几乎不命中）| 30d–365d（几乎不命中）| **纯动态** |

## 详细推导

### ① `www` / `m.beautyforever.com` —— 混合偏动态

**源站架构信号：**
- Origin hostname 含 `nuxt` → **Nuxt.js SSR 框架**（Vue 服务端渲染）
- 每个 HTML 请求理论上都会渲染、不是静态导出

**Akamai 规则信号：**

| 信号 | 含义 |
|---|---|
| `Offload origin / HTML pages: caching=NO_STORE` | Akamai 侧**默认不缓存 HTML** |
| `Cache Tag & Page Caching` 节点覆盖首页 / 列表 / 详情 / 博客 / 活动页 | **关键路径被边缘缓存化** |
| `cacheId` 含 cookie `currency`、`group_id`、`abTest` | **按用户群体 × 货币 × AB 实验拆版本** |
| `?akaCache=nce` 一律强制 `NO_STORE` | 绕缓存 backdoor（调试）|
| HTML 默认路径（`.htm/.php/.jsp/.aspx`）NO_STORE | 非预设路径走动态 |
| 个性化路径（登录、购物车、搜索、结算）——配置里没有显式 cache 规则 | 走默认 NO_STORE |
| 静态资源 css/js/字体/图片 365d | 纯静态长缓存 |
| `/static/*` 含版本 token | 静态资产长缓存 |

**结论：**
- **动态部分（走源站）**：
  - 用户态接口（登录、购物车、账户、搜索结果、结算、支付回调）
  - 所有带 `?akaCache=nce` 的请求
  - 非预设路径（`.htm/.php/.jsp/.aspx` 和其他自定义路由）
  - `currency / group_id / abTest` 冷门组合（cache miss 后首次请求）
- **静态部分（边缘缓存）**：
  - 首页 `/`：6h
  - HTML 列表 / 详情：6h
  - `/blog/*`：365d
  - `/activity/*`：6h
  - `/static/*`：1d
  - CSS/JS：365d
  - 图片：365d
  - 字体：365d

**这不是"静态网站"——这是"带边缘页面缓存的 SSR 动态站"**。Nuxt 渲染的 HTML 在边缘被按（host, path, cookies, 指定 query）分版本缓存；一旦 TTL 到期或 cookie 组合冷门，依然要回 origin 做 SSR。

### ② `api.beautyforever.com` —— 纯动态

**源站架构信号：**
- Origin hostname 含 `api` → API 服务
- 典型 REST / JSON API，per-user per-request 逻辑

**Akamai 规则信号：**

| 信号 | 含义 |
|---|---|
| `Offload origin`: caching=**`NO_STORE`** | 默认不缓存 |
| `Sureroute&Caching`: caching=**`NO_STORE`**（又一次）| 兜底防止意外继承 |
| 所有扩展名分桶规则 | 对 API 路径几乎不命中 |
| `cacheId` 含 cookie `customer_group`、`currency` | 即使源站说可缓存，也按用户组 + 货币拆版本 → 命中率天然低 |
| `cacheKeyQueryParams=IGNORE` 列表含 20+ 广告追踪参数 | 防止追踪参数把缓存键污染成无限版本（说明**实际有缓存需求的 GET API 存在**，但占比很小）|
| `breakConnection: enabled=true` | 故障注入逻辑在线（不影响缓存判定，但说明 API 层上线策略比较积极）|

**结论：**
- **动态部分（走源站）**：**≥ 99% 的 API 请求**。所有业务 API（商品、购物车、用户、结算）默认都是回源。
- **可能缓存部分**：仅限源站明确返回 `Cache-Control: public, max-age=…` 的 GET 接口（如商品分类树、CMS 配置）。若存在，会按 `customer_group + currency` 拆版本。

**判定：API 域名是纯动态。** 任何迁移方案都要按"每次请求都回源"假设做容量、延迟、成本测算。

## 对 AWS 迁移方案的影响

| 域名 | 迁移到 CloudFront / ALB 的关注点 |
|---|---|
| `www` / `m.beautyforever.com` | **必须复刻 cookie-based cache key**（`currency / group_id / abTest`），原生 CloudFront 不支持任意 cookie 进缓存键 → 需要 **CloudFront Functions / Lambda@Edge** 规范化。保留 `?akaCache=nce` bypass backdoor。按路径复刻 TTL 矩阵（`/blog/*=365d`、`/=6h`、`/activity/*=6h`、`/static/*=1d`、静态资源 365d）。|
| `api.beautyforever.com` | **容量规划要按"100% 回源"算**（默认 NO_STORE，极少命中）。保留 `customer_group + currency` cookie-based cache key 以防丢少量已缓存接口的命中率。剔除广告追踪参数（`utm_* / gclid / fbclid / ...`）出缓存键。修 `" x-authentic-ip"` 前导空格 bug。决定是否保留 `breakConnection` 故障注入。|

## 验证建议（Team Agent）

若要对以上判定做一手验证：

1. **抓 cache hit ratio**：
   - 从 Akamai DataStream（已启用）拉 `www.beautyforever.com` 和 `api.beautyforever.com` 的 24h `offload rate`
   - 预期：www/m 40–80%（静态资源拉高），api < 10%
2. **抓响应头验证**：
   ```
   curl -sI 'https://www.beautyforever.com/' | grep -Ei 'cache|x-cache|x-akamai'
   curl -sI 'https://www.beautyforever.com/blog/foo' | grep -Ei 'cache|x-akamai'
   curl -sI 'https://api.beautyforever.com/v1/products' | grep -Ei 'cache|x-akamai'
   ```
   看 `X-Cache:` / `X-Cache-Key:` / `Cache-Control:` 分布。
3. **走 `?akaCache=nce`** 验证 backdoor：
   ```
   curl -sI 'https://www.beautyforever.com/?akaCache=nce' | grep -Ei 'cache'
   ```
   应该一定 MISS。

---

**核心回答**：三个域名中，**只有 `api.beautyforever.com` 是纯动态**；`www.beautyforever.com` 和 `m.beautyforever.com` 是**"SSR 动态 + 边缘页面缓存"的混合型**——HTML 部分页面在边缘缓存 6h–365d，但源站仍是 Nuxt SSR，热点路径之外都要回源。
