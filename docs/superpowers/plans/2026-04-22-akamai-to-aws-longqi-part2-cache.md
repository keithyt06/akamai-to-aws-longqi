# Part 2 · 缓存行为实施计划（ch04-06）· Skeleton

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

> **⚠ 本 plan 为 Skeleton**：task 级别清晰，进入 Part 2 前用 `/superpowers:writing-plans` 基于 Phase 0 + Part 1 实测结果细化到 2-5 分钟 sub-step 粒度。

**Goal:** 对齐 Akamai essl v62 §7 + api v10 §6 的缓存行为——(ch04) TTL 矩阵（首页 6h / 列表 6h / 博客 365d / 活动 6h / `/static/` 1d / CSS+JS+字体+图片 365d；api 默认 NO_STORE）；(ch05) Query String 规范化（列表&详情 EXCLUDE 34 参数、api IGNORE 20+ 广告参数、`utm_source=google/facebook/tiktok` 进 cache key）；(ch06) Cookie Cache Key（www/m: `currency/group_id/abTest`；api: `customer_group/currency`）。

**Architecture:** 每个 path pattern 一条 CloudFront Cache Behavior，各配独立 CachePolicy + OriginRequestPolicy。Query/Cookie 规范化由 CloudFront Function（viewer-request）完成：把 cookie 值规范化后写入自定义 header（如 `X-Cookie-CacheKey`），再在 CachePolicy 里把这个 header 列入 cache key。34 参数 EXCLUDE 通过 CachePolicy 的 `QueryStringsConfig.QueryStringBehavior = "allExcept"` 实现。Cookie 需要通过 header 桥接是因为 CloudFront CachePolicy 的 cookies 维度不支持任意 cookie 的规范化（大小写、默认值、集合归并）。

**Tech Stack:** CloudFront CachePolicy / OriginRequestPolicy / ResponseHeadersPolicy · CloudFront Function · Terraform

**Spec reference:** [`../specs/2026-04-22-akamai-to-aws-longqi-design.md`](../specs/2026-04-22-akamai-to-aws-longqi-design.md) §5.1 Part 2

**Prerequisite:** Part 1 已完成（Task 13 完成，3 个 matrix 全绿）。

---

## 文件结构（Part 2 完成后新增/修改）

```
Cloudfront/
├── terraform/modules/
│   ├── cloudfront-functions/src/
│   │   └── viewer-request.js       ← 扩展：cookie 规范化 + query 规范化
│   ├── cloudfront-www/main.tf      ← 扩展：多条 ordered_cache_behavior
│   │                                  + Cache Policies + OriginRequest Policies
│   ├── cloudfront-api/main.tf      ← 扩展：多条 ordered_cache_behavior
│   └── cache-policies/              ← 新增 module，集中定义复用 CachePolicy
│       ├── main.tf
│       ├── variables.tf
│       └── outputs.tf
│
├── beautyforever/routes/
│   ├── www.js / m.js               ← 加 Cache-Control 响应头（双头策略）
│   └── api.js                      ← 保持 no-store
│
├── hands-on/
│   ├── 04-cache-policy-ttl.md
│   ├── 05-query-normalize.md
│   └── 06-cookie-cache-key.md
│
├── delivery/
│   ├── 04-cache-policy-ttl.md + .html
│   ├── 05-query-normalize.md + .html
│   └── 06-cookie-cache-key.md + .html
│
└── test-harness/cases/
    ├── 04-ttl-matrix.yaml           (10 条用例)
    ├── 05-query-normalize.yaml      (8 条用例)
    └── 06-cookie-cache-key.yaml     (8 条用例)
```

---

## Task 14：ch04 · Cache Policy + TTL 矩阵 + Path Pattern 优先级

**目标**：为 www/m Distribution 配 **10 条** `ordered_cache_behavior`（按客户 2026-04-22 原图补齐 3 处遗漏），每条独立 CachePolicy；api Distribution 保持 default Managed-CachingDisabled + 扩展名分桶。

### ⚠ Path Pattern 优先级原则

CloudFront `ordered_cache_behavior` 按**定义顺序从前往后匹配**，第一个 path_pattern 命中则生效，后面的跳过。必须**最精确 → 最宽泛**排列。下表顺序就是 `ordered_cache_behavior` 数组的实际声明顺序。

### www + m Distribution 完整 Path 优先级表（客户原图 2984.png 驱动）

| 顺序 | path_pattern | TTL | Cache Tag (Surrogate-Key) | Cache Key 构成 | 客户图依据 |
|---|---|---|---|---|---|
| 1 | `/static/*` | 1d | — | **仅路径**（不加 cookie/query）| §5 纯静态 |
| 2 | `*.css` | 365d | — | cookie + `cacheKeyQueryParams=ALL` | §6 静态资源 |
| 3 | `*.js` | 365d | `bf-www-js` / `bf-m-js`（by host）| 同上 | §6 + Akamai Js tag（ch07 归并） |
| 4 | `*.woff` / `*.woff2` / `*.otf` / `*.ttf` / `*.eot` | 365d | — | 同上 | §6 字体 |
| 5 | `*.jpg` / `*.jpeg` / `*.png` / `*.gif` / `*.webp` / `*.svg` / `*.ico` | 365d | — | path + **INCLUDE_ALL_QUERY_PARAMS** | §6 图片 `Cache-Control: public, max-age=31536000` |
| 6 | `/activity/*` | 6h | `bf-all bf-activity` | cookie + utm_source 白名单（其他 34 个追踪参数剥离）| §4.a + §4.b |
| 7 | `/activity-*` | 6h | `bf-all bf-activity` | 同上 | §4 客户图另一种活动页形式 `/activity-spring-sale.html` |
| 8 | `/blog` | **365d** | `bf-blog` | cookie + **`page` 参数**（分页）+ utm_source 白名单 | §3.a + **§3.b（L1：page 进 cache key）** + §3.c |
| 9 | `/blog/*` | **365d** | `bf-blog` | 同 `/blog` | §3（**L2：必须拆分，因为 `/blog/*` 不匹配 `/blog` 本身**） |
| 10 | `*.html` | 6h | `bf-all bf-listInfo` | cookie + utm_source 白名单（34 参数 EXCLUDE）| §2.a + §2.c |
| — (default) | `/`（根路径 + 兜底） | 6h | `bf-all bf-home` | cookie + utm_source 白名单 | §1.a + §1.c |

### 3 个**重要**的优先级陷阱

1. **`*.html` 必须放在第 10**：晚于 `/blog/*`（顺序 9）和 `/activity-*`（顺序 7）。否则 `/blog/foo.html` 会错误命中 `*.html` 规则（6h 而非 365d）
2. **`/blog` 和 `/blog/*` 必须分 2 条**（L2 遗漏补发）：CloudFront glob `/blog/*` **不匹配** `/blog` 本身（需要尾 slash 或后缀）
3. **`/activity/*` 和 `/activity-*` 必须分 2 条**（L3 遗漏补发）：客户生产有两种 URL 形式——`/activity/spring-sale`（子路径）和 `/activity-spring-sale.html`（短横杠变体）

### L1 遗漏：博客 `page` 参数必须进 cache key

客户图 §3.b：**"带指定的查询参数（分页参数 `page`）缓存，其他参数不关心"**。这意味着博客页的 cache key 构成独特：
- **进 cache key**：`page` 参数（分页）+ `__utm_whitelisted`（当 utm_source 命中白名单）+ cookie
- **剥离（不进 cache key）**：34 个追踪参数（含 `utm_source` 原名）
- **其他 query 参数**：不关心 —— 实现上把非 `page` / 非 `__utm_whitelisted` 的 query 也剥离（减少 cache key 空间）

对应 CloudFront 实现：`/blog` 和 `/blog/*` 这两条 behavior 绑定专用 CachePolicy `bf-blog-policy`：
```hcl
parameters_in_cache_key_and_forwarded_to_origin {
  query_strings_config {
    query_string_behavior = "whitelist"       # 只有白名单里的进 cache key
    query_strings {
      items = ["page", "__utm_whitelisted"]   # 保留分页 + utm 白名单
    }
  }
  # ... cookies_config, headers_config
}
```

其他 path pattern（首页、列表、活动）用 `"allExcept"` 排除 34 个追踪参数即可。

### Sub-tasks (skeleton)

- [ ] **14.1 建 `cache-policies` module**：按上面 10 条 path 优先级表，为每种类型创建专用 CachePolicy。合并策略（避免建 10 个 policy）：`bf-static-only-path` / `bf-assets-365d`（css/js/font/image）/ `bf-activity-6h` / `bf-blog-365d`（**特殊**：whitelist `page` + `__utm_whitelisted`）/ `bf-listinfo-6h` / `bf-home-6h`（default behavior 用）。每个 policy 的 `min_ttl / default_ttl / max_ttl` 按上表，**cookie + query 维度在 ch05/06 最终版才接入**（本 task 先建 policy 骨架，cookie 先不进 cache key）。
- [ ] **14.2 修 `cloudfront-www/main.tf`**：追加 **10 条** `ordered_cache_behavior`，**顺序严格按上表 1-10**。每条：`target_origin_id = "alb-origin"`，`cache_policy_id` 引用对应 policy，`viewer_protocol_policy = "redirect-to-https"`，attach viewer-request Function（已在 phase0 Task 05.0.1 创建）。`/`（根路径）不用 ordered_cache_behavior，而是用 Distribution 的 **`default_cache_behavior`** 作为首页 + 兜底（TTL 6h，对齐客户图 §1）。
- [ ] **14.3 修 `cloudfront-api/main.tf` —— api 扩展名分桶（coverage B3 / I8）**：对齐 Akamai api v10 §6 扩展名分桶，api Distribution 也加 ordered_cache_behavior：

  | path_pattern | TTL | Akamai 依据 |
  |---|---|---|
  | `*.css` / `*.js` | 365d | api §6 CSS and JavaScript |
  | `*.woff` / `*.woff2` / `*.otf` / `*.ttf` / `*.eot` | 365d | api §6 Fonts |
  | `*.jpg` / `*.jpeg` / `*.png` / `*.gif` / `*.webp` / `*.svg` | 30d | api §6 Images（注意：api 侧 30d，不是 www 的 365d）|
  | `*.pdf` / `*.doc` / `*.docx` / `*.odt` | 7d | api §6 Files |
  | `*.html` / `*.htm` | 1d | api §6 HTML pages（默认仍 NO_STORE） |

  api Distribution 的 `default_cache_behavior` 继续 `Managed-CachingDisabled`（对齐 NO_STORE）。

- [ ] **14.4 修 beautyforever mock —— Cache-Control 双头策略**（客户 2026-04-22 T3 确认）：

  **客户决策**：
  - **stale-while-revalidate（SWR）**：**不做**。客户后续有**独立预热方案**（业务侧定时 warm-up 关键路径），不依赖 CDN 自动后台刷。spec §8.4 coverage B4 迁移缺口
  - **stale-if-error（SIE）**：**保留 60s**。对齐 Akamai `cacheError preserveStale=true`。**SIE 无额外成本**：源站 5xx 时 CloudFront 直接返回已缓存内容，**不产生额外回源请求**（相反是省钱）

  ```javascript
  // example in www.js
  router.get('/', (_req, res) => {
    // s-maxage=6h 给 edge；max-age=0 给浏览器；
    // stale-if-error=60 对齐 Akamai cacheError preserveStale=true（源站 5xx 时返回 stale）
    res.setHeader('Cache-Control', 's-maxage=21600, stale-if-error=60, max-age=0');
    res.type('text/html').send(...);
  });
  router.get('/blog', (_req, res) => {
    res.setHeader('Cache-Control', 's-maxage=31536000, stale-if-error=60, max-age=0');
    res.type('text/html').send(...);
  });
  ```

  **迁移缺口登记**：Akamai `prefreshCache=90%` 的 CDN 自动预刷功能**放弃**；客户独立预热方案覆盖该职责。delivery §4.3 明示。

- [ ] **14.5 Custom Error Responses（coverage B5 / I1 配套）**：`cloudfront-www` 和 `cloudfront-api` 各自加 `custom_error_response` 块，5xx 短缓存：

  ```hcl
  custom_error_response { error_code = 502  error_caching_min_ttl = 10 }
  custom_error_response { error_code = 503  error_caching_min_ttl = 10 }
  custom_error_response { error_code = 504  error_caching_min_ttl = 10 }
  ```

- [ ] **14.6 `terraform apply` + smoke**：curl 连打 2 次 `https://www.../blog`，第二次应 `X-Cache: Hit from cloudfront`。手工验证 `Cache-Control` 响应头含 `stale-if-error=60`（不含 `stale-while-revalidate`）。
- [ ] **14.7 test-harness 用例（扩展到 12 条）**：原 10 条 MISS/HIT 矩阵 + 2 条新增：
  - `stale-if-error-present`：HEAD 响应含 `stale-if-error=`
  - `api-css-cached-365d`：api.*.css 响应 `Cache-Control` 含 `max-age=31536000`
- [ ] **14.8 hands-on md + delivery md**：TTL 矩阵对照表 + `cacheError→stale-if-error` 对照 + api 扩展名分桶表。delivery §4.3 trade-off：
  - "AWS 无精确等价 `prefreshCache 90%`（客户决策不迁；业务侧独立预热方案覆盖）"
  - "`stale-if-error=60s` 对齐 `cacheError preserveStale=true`，源站 5xx 时返回 stale 缓存，**无额外成本**"
- [ ] **14.9 commit**：`ch04: 6 cache behaviors + ttl matrix + sie (no swr) + api ext buckets + 12 tests`

**验收信号**：
- `terraform validate + plan + apply` 无错
- test-harness `04-ttl-matrix.yaml` 全绿（10 条）
- `curl -sI https://www.beautyforever.keithyu.cloud/blog` 返回 `Cache-Control: s-maxage=31536000, max-age=0`
- `curl -sI https://www.beautyforever.keithyu.cloud/blog` 第二次返回 `X-Cache: Hit from cloudfront`

---

## Task 15：ch05 · Query String 规范化

**目标**：www/m 列表&详情 EXCLUDE 34 个追踪参数（不进 cache key），但 `utm_source=google/facebook.com/tiktok` 进 cache key（cacheable 白名单）；api IGNORE 20+ 广告追踪参数。

**34 参数白名单（EXCLUDE）**（来自 Akamai essl §7）:
```
gad_source, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
utm_expid, utm_referrer, gclid, cx, ie, cof, siteurl, aid, campaign_id,
fbclid, rfsn, subid, msclkid, fclid, rlid, sscid, track_xid, wtbap,
tagtag_uid, spm, wtbae, message_id, mobile, firstname, lastname, crm_spm,
srsltid, brid, afsrc
```

**api IGNORE 列表**（来自 api §6 cacheKeyQueryParams）：20+ 广告参数。

### Sub-tasks (skeleton)

### utm_source 白名单 —— 数据流图

对齐客户原图 2984.png 四类页面的 (c) 条：

```
  浏览器请求
  /?utm_source=XXX&fbclid=Y&page=2
         │
         ▼
┌─────────────────────────────────────────────────┐
│ CloudFront Function (viewer-request)             │
│   if utm_source.value ∈ {google, facebook.com,   │
│                          tiktok}:                 │
│       qs['__utm_whitelisted'] = utm_source.value │  ← 注入伪参数
│   delete qs['utm_source']                        │  ← 剥离原始
│   for p in 33 tracking params: delete qs[p]      │  ← 剥 fbclid 等
└─────────────────────┬───────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────┐
│ CloudFront CachePolicy (对应 path 的 policy)     │
│  · 首页 / 列表 / 活动：                           │
│      QueryStringBehavior = "allExcept"           │
│      items = [34 个追踪参数列表]                 │
│      → utm_source 不进，__utm_whitelisted 进     │
│  · 博客 /blog + /blog/*:                         │
│      QueryStringBehavior = "whitelist"           │
│      items = ["page", "__utm_whitelisted"]       │
│      → 只有这两个参数进 cache key                │
│  · 静态 /static/*:                               │
│      QueryStringBehavior = "none"（路径即 key）  │
└─────────────────────┬───────────────────────────┘
                      ▼
               Final Cache Key
```

**验证用例**：

| 请求 URL | Function 处理后的 qs | 最终 cache key（`/abc.html` 举例）|
|---|---|---|
| `/abc.html?utm_source=google` | `{__utm_whitelisted=google}` | path + cookie + `__utm_whitelisted=google` |
| `/abc.html?utm_source=bing` | `{}` | path + cookie（和裸 `/abc.html` 同 key → HIT）|
| `/abc.html?fbclid=xyz` | `{}` | 同上 |
| `/blog/2?page=2&utm_source=facebook.com` | `{page=2, __utm_whitelisted=facebook.com}` | path + cookie + `page=2` + `__utm_whitelisted=facebook.com` |
| `/blog/2?page=2&other=x` | `{page=2, other=x}` | **注意**：博客 whitelist 模式下 `other` **不会进** cache key（whitelist 外的 param 被 CachePolicy 丢弃） |

### Sub-tasks

- [ ] **15.1 扩展 `viewer-request.js`**（对齐上面数据流图）：

  ```javascript
  var UTM_WHITELIST = ['google', 'facebook.com', 'tiktok'];
  var TRACKING_PARAMS = [ /* 上面列出的 34 个 */ ];

  // ---- utm_source whitelist (runs BEFORE generic stripping)
  if (req.querystring.utm_source) {
    var val = req.querystring.utm_source.value.toLowerCase();
    if (UTM_WHITELIST.indexOf(val) >= 0) {
      req.querystring['__utm_whitelisted'] = { value: val };
    }
  }

  // ---- Strip all 34 tracking params (including utm_source itself)
  for (var i = 0; i < TRACKING_PARAMS.length; i++) {
    delete req.querystring[TRACKING_PARAMS[i]];
  }
  ```

  **对 api host 的额外处理**：api §6 `cacheKeyQueryParams IGNORE` 列表里的 20+ 广告参数已经包含在 `TRACKING_PARAMS` 34 个里（子集），所以同一套逻辑覆盖 api；api Distribution 的 CachePolicy 单独调参。

- [ ] **15.2 扩展 cache-policies module**（分 path 精细化）：

  | CachePolicy | QueryStringBehavior | items | 使用它的 behavior |
  |---|---|---|---|
  | `bf-home-6h` | `allExcept` | 34 tracking params | default behavior (首页) |
  | `bf-listinfo-6h` | `allExcept` | 34 tracking params | `*.html`（顺序 10）|
  | `bf-activity-6h` | `allExcept` | 34 tracking params | `/activity/*` + `/activity-*`（顺序 6-7）|
  | `bf-blog-365d` | **`whitelist`** | **`page`** + `__utm_whitelisted` | `/blog` + `/blog/*`（顺序 8-9）|
  | `bf-assets-365d` | `all` | — | `*.css / *.js / 字体 / 图片`（顺序 2-5）|
  | `bf-static-only-path` | `none` | — | `/static/*`（顺序 1）|
  | `bf-api-default` (api) | `allExcept` | 20+ 广告参数 | api default |
- [ ] **15.3 test-harness 用例（8 条）**：
  ```yaml
  - id: utm-google-enters-cache-key
    description: "utm_source=google 进 cache key（两次请求 GET 均 HIT 同一 key）"
    ...
  - id: utm-other-excluded
    description: "utm_source=xxx 被剥离，第二次 HIT"
    ...
  - id: fbclid-excluded
    ...
  - id: api-gclid-ignored
    ...
  # 等等
  ```
- [ ] **15.4 `/static/*` 特殊 token 分版本（coverage B14 / N1）**：对齐 Akamai essl §7 `optional=true` token `LT1RVf0XvMD1A78LUGJ2JvcSkHTKq8vb` —— 带此 token 的 `/static/*` 请求按 token 值拆 cache 版本，不带则用默认 cache key：

  ```javascript
  // in viewer-request.js
  var STATIC_VERSION_TOKEN = 'LT1RVf0XvMD1A78LUGJ2JvcSkHTKq8vb';

  if (req.uri.indexOf('/static/') === 0) {
    var tokenVal = qsobj[STATIC_VERSION_TOKEN];
    if (tokenVal) {
      // Write the token presence into a cache-key dimension
      req.headers['x-static-ver'] = { value: tokenVal.value };
    }
  }
  ```

  对应 `/static/*` 路径的 CachePolicy headers_config 加入 `x-static-ver` 作为 cache key 维度。

  **test case**：
  ```yaml
  - id: static-with-token-separate-key
    description: "/static/foo.bin 带特殊 token 和不带，是不同 cache key"
    ...
  ```

- [ ] **15.5 hands-on + delivery md**：对照表 "Akamai `EXCLUDE_QUERY_PARAMS 34 项`" vs "CloudFront CachePolicy QueryString allExcept + Function 白名单" + `/static/` token 特殊处理说明
- [ ] **15.6 commit**：`ch05: query normalize - 34 excludes + utm whitelist + /static token versioning + 9 tests`

**验收信号**：
- `curl 'https://www.beautyforever.keithyu.cloud/abc.html?fbclid=xyz'` 两次请求第二次 HIT
- `curl 'https://www.beautyforever.keithyu.cloud/?utm_source=google'` 的 cache key 和 `?utm_source=google&otherparam=x` 一致（HIT）
- `curl 'https://www.beautyforever.keithyu.cloud/?utm_source=google'` 和 `?utm_source=bing` 的 cache key 不一致（后者剥离 utm_source，可能和 `/` 本身等价）

---

## Task 16：ch06 · Cookie Cache Key

**目标**：www/m 的 cache key 含 cookie `currency`、`group_id`、`abTest`；api 含 `customer_group`、`currency`。CloudFront CachePolicy 支持的 Cookies 维度只能列 cookie 名并"整值进入 cache key"——我们需要**规范化**（小写化、默认值、过滤恶意值）。方案是 CloudFront Function 把规范化后的组合值写入请求头 `X-Cookie-Cachekey`，CachePolicy 只把这个单 header 列入 cache key。

### Sub-tasks (skeleton)

- [ ] **16.1 扩展 `viewer-request.js`**，加入 cookie 解析和规范化：

  ```javascript
  // ---- ch06 cookie cache key
  function parseCookies(cookieHeader) {
    var out = {};
    if (!cookieHeader) return out;
    cookieHeader.split(';').forEach(function(p){
      var idx = p.indexOf('=');
      if (idx < 0) return;
      var k = p.slice(0, idx).trim();
      var v = p.slice(idx + 1).trim();
      out[k] = v;
    });
    return out;
  }

  function normalizeCookies(host, cookieHeader) {
    var c = parseCookies(cookieHeader);
    var parts;
    if (host.indexOf('api.') === 0) {
      // api: customer_group + currency
      parts = [
        'cg=' + (c.customer_group || 'default').toLowerCase(),
        'cur=' + (c.currency || 'USD').toUpperCase()
      ];
    } else {
      // www/m: currency + group_id + abTest
      parts = [
        'cur=' + (c.currency || 'USD').toUpperCase(),
        'gid=' + (c.group_id || '0'),
        'ab=' + (c.abTest || 'none').toLowerCase()
      ];
    }
    return parts.join('|');
  }
  ```

  在 handler 里 attach：

  ```javascript
  var cookieHeader = req.headers.cookie ? req.headers.cookie.value : '';
  req.headers['x-cookie-cachekey'] = { value: normalizeCookies(host, cookieHeader) };
  ```

- [ ] **16.2 扩展 CachePolicy**：www/m 和 api 的所有 path-level CachePolicy 都把 `HeadersConfig` 加上 `x-cookie-cachekey`：

  ```hcl
  parameters_in_cache_key_and_forwarded_to_origin {
    # ...
    headers_config {
      header_behavior = "whitelist"
      headers { items = ["x-cookie-cachekey"] }
    }
  }
  ```

- [ ] **16.3 beautyforever mock**：接受 cookie 输入并在响应里回显 `X-Seen-Cookie-Key: <normalized>`，便于测试断言 cache key 是否按 cookie 分版本。

- [ ] **16.4 test-harness 用例（8 条）**：
  ```yaml
  - id: www-currency-usd-vs-eur-different-key
    description: "同 URL 不同 currency cookie → cache key 不同（首次都 MISS，后续各自 HIT）"
    ...
  - id: www-currency-case-insensitive
    description: "Cookie currency=usd 和 currency=USD 规范化后落在同一 cache key"
    ...
  - id: api-customer-group-split
    description: "api 的 customer_group 不同值进入不同 cache key"
    ...
  ```
- [ ] **16.5 hands-on + delivery md**：重点讲"为什么不直接用 CloudFront CachePolicy 的 Cookies 维度，而要用 Function + Header"：
  - CachePolicy Cookies 维度不支持值的规范化（大小写/默认值/集合）
  - Cookie 值如果直接进 cache key，恶意 cookie 值可能膨胀 key space（DoS cache）
- [ ] **16.6 commit**：`ch06: cookie-based cache key via viewer-request function + X-Cookie-Cachekey header + 8 tests`

**验收信号**：
- `curl -H 'Cookie: currency=USD; group_id=1' ...` 和 `-H 'Cookie: currency=EUR; group_id=1' ...` 的 `X-Cache` 第二次请求各自 HIT，但不互相 HIT
- `curl -H 'Cookie: currency=usd'` 和 `-H 'Cookie: currency=USD'` 第二次都 HIT（大小写归一）

---

## Part 2 完成里程碑

**日期**：2026-05-13（与 Part 3 同节点）

- [ ] Task 14: ch04 TTL 矩阵 · 6 cache behavior · 10 test 绿
- [ ] Task 15: ch05 Query 规范化 · 34 EXCLUDE + utm 白名单 · 8 test 绿
- [ ] Task 16: ch06 Cookie Cache Key · Function+Header 桥接 · 8 test 绿

## 更新 index
把 index plan 里 part2 状态改为 `✅ 已完成`。

## 下一步
执行 [`2026-04-22-akamai-to-aws-longqi-part3-response.md`](./2026-04-22-akamai-to-aws-longqi-part3-response.md)（skeleton，先细化）。
