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

## Task 14：ch04 · Cache Policy + TTL 矩阵

**目标**：为 www/m Distribution 配 6 条 ordered_cache_behavior（首页/列表/博客/活动/static/静态资源），每条独立 CachePolicy；api Distribution 保持 default Managed-CachingDisabled。

**TTL 矩阵（对齐 Akamai）**

| path_pattern | TTL | Akamai 依据 |
|---|---|---|
| `/` （根路径，精确） | 6h | essl v62 §7 首页 |
| `*.html`（其他 HTML 列表/详情） | 6h | essl §7 列表&详情页 |
| `/blog` + `/blog/*` | 365d | essl §7 |
| `/activity/*` + `/activity-*.html` | 6h | essl §7 活动页 |
| `/static/*` | 1d | essl §7 |
| `*.css` / `*.js` / `*.woff*` / 图片扩展 | 365d | essl §6 |

### Sub-tasks (skeleton)

- [ ] **14.1 建 `cache-policies` module**：为每个 path pattern 创建 `aws_cloudfront_cache_policy`，`min_ttl/default_ttl/max_ttl` 按上表。**先不带 cookie/query**（ch05/06 会扩）。
- [ ] **14.2 修 `cloudfront-www/main.tf`**：追加 6 条 `ordered_cache_behavior`，`path_pattern` 按顺序从精确到通配。`target_origin_id = "alb-origin"`，`cache_policy_id` 引用对应 policy，`viewer_protocol_policy = "redirect-to-https"`，attach viewer-request Function。
- [ ] **14.3 修 `cloudfront-api/main.tf`**：api 保持 default no-cache，不新增 behavior。
- [ ] **14.4 修 beautyforever mock**：为不同路径输出不同 `Cache-Control`（双头策略：`s-maxage` 给 edge、`max-age=0` 给浏览器）：
  ```javascript
  // example in www.js
  router.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 's-maxage=21600, max-age=0');  // 6h edge, 0 viewer
    res.type('text/html').send(...);
  });
  router.get('/blog', (_req, res) => {
    res.setHeader('Cache-Control', 's-maxage=31536000, max-age=0');
    res.type('text/html').send(...);
  });
  ```
- [ ] **14.5 `terraform apply` + smoke**：curl 连打 2 次 `https://www.../blog`，第二次应 `X-Cache: Hit from cloudfront`。
- [ ] **14.6 test-harness 用例**：10 条（每个 path pattern 2 条：第一次 MISS、第二次 HIT；以及 `/` 首次/二次、`/blog` 首次/二次、`/static/foo` 首次/二次、`/x.css` 首次/二次、`/activity-spring.html` 首次/二次）。
- [ ] **14.7 hands-on md + delivery md**：用 TTL 矩阵对照表 + Akamai path 截图 + AWS Console 路径对齐。
- [ ] **14.8 commit**：`ch04: 6 cache behaviors + ttl matrix + cache-control double-header + 10 tests`

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

- [ ] **15.1 扩展 `viewer-request.js`**：
  - 对 www/m host：把 `utm_source` 值归一化——如果 `∈ {google, facebook.com, tiktok}` 则保留，否则剥离
  - 对 api host：按 IGNORE 列表剔除参数
  - 把规范化后的 "cache-key signature" 写入请求头 `X-QS-Signature`
  - 34 参数 EXCLUDE 通过 CachePolicy 的 `QueryStringsConfig.QueryStringBehavior = "allExcept"` + items 列 34 参数；**但** `utm_source` 不能简单列入 EXCLUDE（因为三值白名单要进 cache key）→ 复合实现：规范化在 Function 里做（把 `utm_source=google/facebook/tiktok` 重写为 `__utm_whitelisted=<val>`，其他 `utm_source=*` 剥离），然后 Policy EXCLUDE 所有 34 个，额外 INCLUDE `__utm_whitelisted`
- [ ] **15.2 扩展 cache-policies module**：
  - 对 www/m 的 `*.html` 和 `/` 的 CachePolicy：`QueryStringsConfig = { QueryStringBehavior = "allExcept", items = [34 参数, 不含 __utm_whitelisted] }`
  - 对 api 的 default CachePolicy：`QueryStringBehavior = "allExcept", items = [IGNORE 列表]`
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
- [ ] **15.4 hands-on + delivery md**：对照表 "Akamai `EXCLUDE_QUERY_PARAMS 34 项`" vs "CloudFront CachePolicy QueryString allExcept + Function 白名单"
- [ ] **15.5 commit**：`ch05: query normalize - 34 excludes + utm whitelist for www/m, 20 ignore for api + 8 tests`

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
