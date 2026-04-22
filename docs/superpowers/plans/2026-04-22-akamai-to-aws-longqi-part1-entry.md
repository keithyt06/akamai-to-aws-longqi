# Part 1 · 流量入口实施计划（ch01-03）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把请求进入 CDN 的前三件事做完：(ch01) Distribution + Origin 分流在 POC 环境落地并验证（HTTP/2-only 与 Akamai essl v62 Hostnames 父规则对齐）；(ch02) PC↔M 设备跳转含 LqPassWaf UA 白名单、Apple Pay 路径白名单、`js/css` 扩展不跳转；(ch03) `?akaCache=nce` 全局缓存 backdoor。

**Architecture:** ch01 主要补齐 Phase 0 已经搭起的 Distribution 的**分流语义**和**文档化**——本章只新增 mock 路由扩展，不新增 AWS 资源。ch02 和 ch03 通过 **CloudFront Functions（viewer-request）** 实现，两个 Function 都 attach 到 `cloudfront-www` 的 default behavior（api Distribution 不需要这些）。

**Tech Stack:** Terraform · CloudFront Function（JavaScript runtime 2.0） · Node.js Express · httpx + pyyaml（test-harness）

**Spec reference:** [`../specs/2026-04-22-akamai-to-aws-longqi-design.md`](../specs/2026-04-22-akamai-to-aws-longqi-design.md) §5.1 Part 1

**Prerequisite:** Phase 0 已完成（[`phase0-foundation.md`](./2026-04-22-akamai-to-aws-longqi-phase0-foundation.md) Task 10 里程碑达成）。

---

## 文件结构（Part 1 完成后新增/修改）

```
Cloudfront/
├── beautyforever/
│   ├── routes/
│   │   ├── www.js               ← 扩展（首页/列表/详情/博客/活动）
│   │   ├── m.js                 ← 扩展（同上 + 轻量 mobile 标识）
│   │   └── api.js               ← 扩展（/v1/products 等 mock）
│   └── middleware/
│       └── ua.js                ← 新增（UA 检测辅助，mock 侧不判 UA 跳转，跳转由 CF Function 负责）
│
├── terraform/modules/
│   ├── cloudfront-functions/     ← 新增 module
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── src/
│   │       ├── redirect-pc-m.js  ← ch02
│   │       └── akacache-nce.js   ← ch03
│   └── cloudfront-www/main.tf    ← 修改，把 Function attach 到 viewer-request
│
├── hands-on/
│   ├── 01-distribution-origin-split.md
│   ├── 02-redirect-whitelist.md
│   └── 03-akacache-backdoor.md
│
├── delivery/
│   ├── 01-distribution-behaviors.md + .html
│   ├── 02-redirect-whitelist.md + .html
│   └── 03-akacache-backdoor.md + .html
│
└── test-harness/
    └── cases/
        ├── 01-distribution.yaml
        ├── 02-redirect.yaml
        └── 03-akacache-backdoor.yaml
```

---

## Task 11：ch01 · 补齐 Distribution 分流语义（无新 AWS 资源）

**目标**：确认 Phase 0 已建的 2 个 CloudFront Distribution **语义对齐** Akamai essl v62 的 "Hostnames" 分支规则——即 `www + m` 共用同一 Distribution（对应 Akamai 同 Property，不同 CP Code），`api` 独立。写章节文档；mock 端按 host 分化响应（带 CP Code 等价 header 便于日志识别）；通过 test-harness 验证。

**Files:**
- Modify: `Cloudfront/beautyforever/server.js`
- Modify: `Cloudfront/beautyforever/routes/www.js`、`m.js`、`api.js`
- Create: `Cloudfront/hands-on/01-distribution-origin-split.md`
- Create: `Cloudfront/delivery/01-distribution-behaviors.md`
- Create: `Cloudfront/test-harness/cases/01-distribution.yaml`
- Modify: `Cloudfront/delivery/01-distribution-behaviors.md`（覆盖 Phase 0 占位）

### Steps

- [ ] **Step 11.1：mock 加 CP Code 模拟头**

    参考 Akamai 调研（[`Akamai/doc/10-property-beautyforever-essl.md`](../../../Akamai/doc/10-property-beautyforever-essl.md) §4），www 的 CP Code 是 `1435977`、m 的 `1435979`、api 的（从 api Property）对应另一套。在 mock 侧注入**等价响应头**以便日志链路能区分。

    `Cloudfront/beautyforever/server.js` 替换 host dispatch 块：

    ```javascript
    const CP_CODES = {
      'www.beautyforever.keithyu.cloud': 'bf-www-1435977',
      'm.beautyforever.keithyu.cloud':   'bf-m-1435979',
      'api.beautyforever.keithyu.cloud': 'bf-api',
    };

    app.use((req, res, next) => {
      const host = (req.headers.host || '').toLowerCase().split(':')[0];
      const cp = CP_CODES[host];
      if (cp) res.setHeader('X-Origin-CPCode', cp);  // diagnostic header
      if (host === 'www.beautyforever.keithyu.cloud') return wwwRouter(req, res, next);
      if (host === 'm.beautyforever.keithyu.cloud')   return mRouter(req, res, next);
      if (host === 'api.beautyforever.keithyu.cloud') return apiRouter(req, res, next);
      return res.status(404).type('text/plain').send('host not routed');
    });
    ```

- [ ] **Step 11.2：扩展 www.js 提供 Akamai 同款路径集**

    `Cloudfront/beautyforever/routes/www.js` 全量替换：

    ```javascript
    import express from 'express';
    const router = express.Router();

    const html = (title, marker='pc mock') =>
      `<!DOCTYPE html><html><head><title>${title}</title></head><!-- ${marker} --><body><h1>${title}</h1></body></html>`;

    router.get('/', (_req, res) => res.type('text/html').send(html('BF PC Home')));
    router.get('/blog', (_req, res) => res.type('text/html').send(html('BF Blog Index', 'pc mock:blog-index')));
    router.get('/blog/:slug', (req, res) => res.type('text/html').send(html(`BF Blog: ${req.params.slug}`, 'pc mock:blog-detail')));
    router.get(/^\/activity(?:-|\/).*$/, (req, res) => res.type('text/html').send(html(`BF Activity ${req.path}`, 'pc mock:activity')));
    router.get(/\.html$/, (req, res) => res.type('text/html').send(html(`BF List ${req.path}`, 'pc mock:list')));

    // static fake assets (fast-path for 365d caching tests later)
    router.get('/static/:file', (req, res) => res.type('application/octet-stream').send(`static ${req.params.file}`));

    // Apple Pay well-known path (required to not redirect when on www; see ch02)
    router.get('/.well-known/apple-developer-merchantid-domain-association.txt', (_req, res) =>
      res.type('text/plain').send('apple-developer-merchantid-domain-association'));

    export default router;
    ```

- [ ] **Step 11.3：扩展 m.js 为 mobile 变体**

    `Cloudfront/beautyforever/routes/m.js`:

    ```javascript
    import express from 'express';
    const router = express.Router();

    const html = (title, marker='m mock') =>
      `<!DOCTYPE html><html><head><title>${title}</title></head><!-- ${marker} --><body class="m"><h1>${title}</h1></body></html>`;

    router.get('/', (_req, res) => res.type('text/html').send(html('BF Mobile Home')));
    router.get('/blog', (_req, res) => res.type('text/html').send(html('BF Mobile Blog Index', 'm mock:blog-index')));
    router.get('/blog/:slug', (req, res) => res.type('text/html').send(html(`BF Mobile Blog: ${req.params.slug}`, 'm mock:blog-detail')));
    router.get(/^\/activity(?:-|\/).*$/, (req, res) => res.type('text/html').send(html(`BF Mobile Activity ${req.path}`, 'm mock:activity')));
    router.get(/\.html$/, (req, res) => res.type('text/html').send(html(`BF Mobile List ${req.path}`, 'm mock:list')));
    router.get('/static/:file', (req, res) => res.type('application/octet-stream').send(`static ${req.params.file}`));

    router.get('/.well-known/apple-developer-merchantid-domain-association.txt', (_req, res) =>
      res.type('text/plain').send('apple-developer-merchantid-domain-association'));

    export default router;
    ```

- [ ] **Step 11.4：扩展 api.js 为 JSON API 变体**

    `Cloudfront/beautyforever/routes/api.js`:

    ```javascript
    import express from 'express';
    const router = express.Router();

    router.get('/ping', (_req, res) => res.json({ ok: true, service: 'api', ts: Date.now() }));

    router.get('/v1/products', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');  // api 默认 NO_STORE 对齐 Akamai
      res.json({ items: [{ id: 1, name: 'demo-wig-001' }] });
    });

    router.get('/v1/products/:id', (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ id: req.params.id, name: `demo-wig-${req.params.id}` });
    });

    export default router;
    ```

- [ ] **Step 11.5：run existing smoke tests**

    ```bash
    cd Cloudfront/beautyforever
    node server.js &
    SERVER_PID=$!
    sleep 1
    npm test
    # 预期：Phase 0 的 5 个 test 仍然 pass
    kill $SERVER_PID
    ```

- [ ] **Step 11.6：部署 mock 新代码到 EC2**

    mock 代码通过 EC2 user-data 的 `git clone` 拉取。POC 阶段最简单：
    ```bash
    git add Cloudfront/beautyforever/
    git commit -m "ch01: extend mock routes (blog/activity/list/static) + CP Code diagnostic header"
    git push

    # 然后 SSM 到 EC2 拉最新
    ORIGIN_INST=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=akamai-to-aws-longqi-origin" --query 'Reservations[0].Instances[0].InstanceId' --output text)
    aws --profile default ssm send-command --document-name "AWS-RunShellScript" \
      --instance-ids $ORIGIN_INST \
      --parameters commands='["cd /var/lib/bfmock/repo && sudo -u bfmock git pull && sudo systemctl restart bfmock"]'
    ```

- [ ] **Step 11.7：hands-on 文档**

    `Cloudfront/hands-on/01-distribution-origin-split.md`:

    ```markdown
    # ch01 · Distribution + Origin 分流（AWS Console 手册）

    ## Akamai 现状摘录

    - Property `beautyforever.com_essl` v62 承载 `www` + `m`，顶层 Hostnames 父规则按 host 分支覆盖独立的 `origin` + `cpCode`（参考：[Akamai/doc/10-property-beautyforever-essl.md](../../Akamai/doc/10-property-beautyforever-essl.md) §3、§4）
    - Property `api.beautyforever.com` v10 是独立 property
    - 两个 property 在 Akamai 平台里都**启用了 HTTP/3**（`enhancedAkamaiProtocol` 启用）

    ## CloudFront 等价做法

    | Akamai 对象 | CloudFront 对应 | Console 路径 |
    |---|---|---|
    | Property `beautyforever.com_essl` | Distribution for `www + m` | CloudFront → Distributions → 找 comment 含 `www + m` |
    | Property `api.beautyforever.com` | Distribution for `api` | 同上，comment 含 `api` |
    | `cpCode 1435977` / `1435979` | diagnostic header `X-Origin-CPCode`（来自 mock）| 查看 CloudFront Real-time Logs |
    | `HTTP/3 enabled` | **禁用**（HTTP/2 only） | Distribution → General → HTTP versions → 取消 HTTP/3 |

    ## 为什么取消 HTTP/3

    CloudFront Continuous Deployment 要求 primary 和 staging distribution `HttpVersion = http2`。本项目 ch12 会启用 CICD，因此 Distribution 锁 HTTP/2。**这是明确的 trade-off**：客户在 Akamai 上有 HTTP/3，迁到 CloudFront 会失去；换来的是蓝绿灰度能力。

    ## Console 步骤（Phase 0 terraform 已做，这里是手动复核方式）

    1. 登录 AWS Console → CloudFront
    2. 找到两个 Distribution：comment 含 `www + m` 和 `api`
    3. 选中 Distribution → General → Edit
       - 确认 `HTTP versions = HTTP/2`（**未勾选 HTTP/3**）
       - 确认 `SSL/TLS certificate` 指向 ACM 证书（3 个 ARN 之一）
       - 确认 `Alternate domain names (CNAMEs)` 正确
    4. Origins 标签 → 确认 Origin DNS 指向 ALB 的 DNS
    5. Behaviors 标签 → Phase 0 只有 default behavior，使用 `Managed-CachingDisabled`

    ## 对应 terraform 模块

    - [`terraform/modules/cloudfront-www/`](../terraform/modules/cloudfront-www/)
    - [`terraform/modules/cloudfront-api/`](../terraform/modules/cloudfront-api/)

    ## 验证

    跑 [`test-harness/cases/01-distribution.yaml`](../test-harness/cases/01-distribution.yaml)，查看 `report/out/01-distribution-matrix.html`。
    ```

- [ ] **Step 11.8：delivery md**

    `Cloudfront/delivery/01-distribution-behaviors.md` 全量替换占位：

    ```markdown
    # §1 · Distribution + Origin 分流

    ## §1.1 问题陈述（Akamai 原做法）

    Akamai 用单个 property `beautyforever.com_essl` v62 同时承载 `www.beautyforever.com` 和 `m.beautyforever.com`，在 rule tree 的 `Hostnames` 父规则下按 host 分两个子分支，各自覆盖 `origin` 和 `cpCode`；`api.beautyforever.com` 则由独立的 property `api.beautyforever.com` v10 承载。两个 property 都启用了 HTTP/3。

    数据源：
    - [`Akamai/doc/10-property-beautyforever-essl.md`](../Akamai/doc/10-property-beautyforever-essl.md) §3 origin、§4 CP Code
    - [`Akamai/doc/11-property-api-beautyforever.md`](../Akamai/doc/11-property-api-beautyforever.md)

    ## §1.2 CloudFront 对应方案

    | Akamai 对象 | AWS 对应 | 备注 |
    |---|---|---|
    | Property `beautyforever.com_essl` | CloudFront Distribution（2 个 CNAME `www` + `m`） | 共用一个 Distribution，和 Akamai 同 property 一致 |
    | Hostnames 分支按 host 覆盖 origin/cpCode | 回源 ALB host-based listener rule | ALB 按 Host header 路由到同一 EC2 |
    | CP Code 1435977 / 1435979 | `X-Origin-CPCode` 响应头（mock 注入，日志可识别） | Real-time Logs 可按此分组（ch11） |
    | Property `api.beautyforever.com` | 独立 CloudFront Distribution | 业务上完全隔离，便于未来独立演化 |
    | HTTP/3 | **关闭**（HTTP/2 only） | CICD 要求，见 §1.3 |

    ## §1.3 差异与 trade-off

    **HTTP/3 不启用**。理由：CloudFront Continuous Deployment（ch12）需要 primary + staging distribution 都是 HTTP/2。得失：
    - 得：蓝绿灰度发布能力（Akamai 无等价原生能力）
    - 失：HTTP/3（QUIC）的连接迁移和 0-RTT 优势

    若客户决定不启用 CICD，可以切回 HTTP/3；两者在 CloudFront 是互斥的。

    ## §1.4 验证证据

    对比矩阵：[`01-distribution-matrix.html`](../test-harness/report/out/01-distribution-matrix.html)

    关键断言：
    - `www` / `m` / `api` 三个演示域名都能 HTTPS 访问并返回 `200`
    - `www` 和 `m` 回源走同一 ALB target group（共享 Distribution）
    - `api` 返回 `Cache-Control: no-store`（对齐 Akamai api v10 默认 NO_STORE）
    - TLS 握手后的 HTTP version 为 `HTTP/2`（`curl -v` 可验证）

    ## §1.5 客户确认项

    - [ ] 接受 `www + m` 共用单 Distribution（等价 Akamai 单 property）
    - [ ] 接受 `api` 独立 Distribution
    - [ ] 接受 HTTP/2-only（为 CICD 做准备）
    - [ ] 说明：Akamai `Advanced` XML metadata（essl §18）是黑盒，迁移前需人工审阅
    ```

- [ ] **Step 11.9：test-harness YAML**

    `Cloudfront/test-harness/cases/01-distribution.yaml`:

    ```yaml
    chapter: 01-distribution
    cases:
      - id: www-home-200
        description: "www 首页返回 200 + pc mock 标记"
        request: { url: "https://{host}/", method: GET }
        expectations:
          status: 200
          body_contains: "pc mock"
        hosts: { akamai: www.beautyforever.com, cloudfront: www.beautyforever.keithyu.cloud }

      - id: m-home-200
        description: "m 首页返回 200 + m mock 标记（CloudFront 侧；Akamai 侧只对比 200）"
        request: { url: "https://{host}/", method: GET }
        expectations:
          status: 200
        hosts: { akamai: m.beautyforever.com, cloudfront: m.beautyforever.keithyu.cloud }

      - id: api-ping-200
        description: "api /ping 返回 JSON"
        request: { url: "https://{host}/ping", method: GET }
        expectations:
          status: 200
          body_contains: "ok"
        hosts: { akamai: api.beautyforever.com, cloudfront: api.beautyforever.keithyu.cloud }

      - id: api-no-store
        description: "api 默认响应应带 Cache-Control: no-store（或 NO_STORE 等价）"
        request: { url: "https://{host}/v1/products", method: GET }
        expectations:
          status: 200
          header_contains: { Cache-Control: "no-store" }
        hosts: { akamai: api.beautyforever.com, cloudfront: api.beautyforever.keithyu.cloud }

      - id: http-version-h2
        description: "CloudFront 侧 HTTP/2（通过 curl --http2 独立验证，harness 不强制断言，仅记录）"
        request: { url: "https://{host}/", method: HEAD }
        expectations:
          status: 200
        hosts: { akamai: www.beautyforever.com, cloudfront: www.beautyforever.keithyu.cloud }
    ```

- [ ] **Step 11.10：跑 report**

    ```bash
    cd Cloudfront/test-harness
    make probe-01-distribution
    make report-01-distribution
    # 预期：report/out/01-distribution-matrix.html 生成，probe 列全 ✅
    ```

- [ ] **Step 11.11：commit**

    ```bash
    git add Cloudfront/hands-on/01-distribution-origin-split.md \
            Cloudfront/delivery/01-distribution-behaviors.md \
            Cloudfront/test-harness/cases/01-distribution.yaml
    git commit -m "ch01: distribution origin split docs + test cases"
    ```

---

## Task 12：ch02 · PC ↔ M 跳转（含 UA/路径白名单）

**目标**：CloudFront Function（viewer-request）实现 Akamai essl v62 §12 的三条 redirect 规则：
1. HTTP→HTTPS（Phase 0 Distribution viewer_protocol_policy = redirect-to-https 已处理）
2. PC host + Mobile UA → 302 到 m.*（不跳转条件：UA 白名单 `LqPassWaf/851.3` · 扩展名白名单 `js/css`）
3. M host + Desktop UA → 302 到 www.*（不跳转条件：UA 白名单 · 路径白名单 `/.well-known/apple-developer-merchantid-domain-association.txt` · 扩展名白名单 `js/css`）

**Files:**
- Create: `Cloudfront/terraform/modules/cloudfront-functions/main.tf`
- Create: `Cloudfront/terraform/modules/cloudfront-functions/variables.tf`
- Create: `Cloudfront/terraform/modules/cloudfront-functions/outputs.tf`
- Create: `Cloudfront/terraform/modules/cloudfront-functions/src/redirect-pc-m.js`
- Modify: `Cloudfront/terraform/modules/cloudfront-www/main.tf`（attach viewer-request association）
- Create: `Cloudfront/hands-on/02-redirect-whitelist.md`
- Create: `Cloudfront/delivery/02-redirect-whitelist.md`
- Create: `Cloudfront/test-harness/cases/02-redirect.yaml`

### Steps

- [ ] **Step 12.1：写 CloudFront Function 源码（TDD 思路：先写预期行为的测试再写实现）**

    Akamai 原规则关键点（从 [`Akamai/doc/10-property-beautyforever-essl.md`](../../../Akamai/doc/10-property-beautyforever-essl.md) §12 提炼）：

    - UA 白名单：`["LqPassWaf/851.3", "LqPassWaf/851.3 (it; Categraf)"]`（不跳转）
    - 扩展名白名单：`["js", "css"]`（不跳转）
    - 路径白名单（仅 M→PC）：`/.well-known/apple-developer-merchantid-domain-association.txt`
    - Mobile 检测：Akamai 用 `deviceCharacteristic[IS_MOBILE]`。CloudFront 侧我们用简单的 UA 字符串匹配（客户可后期升级为 CloudFront KVS + Bot 识别）

    `Cloudfront/terraform/modules/cloudfront-functions/src/redirect-pc-m.js`（CloudFront Function JS runtime 2.0）:

    ```javascript
    // CloudFront viewer-request Function
    // Equivalent of Akamai essl v62 §12 Redirect rules (302).

    var UA_WHITELIST = [
      'LqPassWaf/851.3',
      'LqPassWaf/851.3 (it; Categraf)'
    ];
    var APPLE_PAY_PATH = '/.well-known/apple-developer-merchantid-domain-association.txt';
    var EXT_WHITELIST = ['js', 'css'];

    // Mobile detection — simple UA substring. Akamai uses deviceCharacteristic[IS_MOBILE].
    // Patterns cover majority of mobile UAs; refine via CloudFront KVS if needed.
    var MOBILE_UA_RE = /(Mobile|iPhone|iPod|Android|BlackBerry|IEMobile|Opera Mini|Opera Mobi)/;

    function extOf(uri) {
      var dot = uri.lastIndexOf('.');
      if (dot < 0) return '';
      var rest = uri.slice(dot + 1);
      var q = rest.indexOf('?');
      return (q < 0 ? rest : rest.slice(0, q)).toLowerCase();
    }

    function isMobileUA(ua) { return ua && MOBILE_UA_RE.test(ua); }
    function isWhitelistedUA(ua) {
      for (var i = 0; i < UA_WHITELIST.length; i++) if (ua === UA_WHITELIST[i]) return true;
      return false;
    }

    function redirect(toHost, path, qs) {
      var loc = 'https://' + toHost + path + (qs ? '?' + qs : '');
      return {
        statusCode: 302,
        statusDescription: 'Found',
        headers: { location: { value: loc } }
      };
    }

    function handler(event) {
      var req = event.request;
      var host = req.headers.host ? req.headers.host.value.toLowerCase() : '';
      var ua   = req.headers['user-agent'] ? req.headers['user-agent'].value : '';
      var uri  = req.uri;
      var qs   = req.querystring ? Object.keys(req.querystring).map(function(k){
        var v = req.querystring[k].value;
        return encodeURIComponent(k) + (v ? '=' + encodeURIComponent(v) : '');
      }).join('&') : '';

      // Whitelist UA — never redirect
      if (isWhitelistedUA(ua)) return req;

      // Whitelist extension — never redirect
      var ext = extOf(uri);
      if (EXT_WHITELIST.indexOf(ext) >= 0) return req;

      // PC → M: host is www.* AND UA is mobile
      if (host.indexOf('www.') === 0 && isMobileUA(ua)) {
        return redirect(host.replace(/^www\./, 'm.'), uri, qs);
      }

      // M → PC: host is m.* AND UA is NOT mobile (desktop)
      if (host.indexOf('m.') === 0 && !isMobileUA(ua)) {
        // Apple Pay path whitelist
        if (uri === APPLE_PAY_PATH) return req;
        return redirect(host.replace(/^m\./, 'www.'), uri, qs);
      }

      return req;
    }
    ```

- [ ] **Step 12.2：module 定义**

    `Cloudfront/terraform/modules/cloudfront-functions/variables.tf`:

    ```hcl
    variable "project_name" { type = string }
    ```

    `Cloudfront/terraform/modules/cloudfront-functions/main.tf`:

    ```hcl
    resource "aws_cloudfront_function" "redirect_pc_m" {
      name    = "${var.project_name}-redirect-pc-m"
      runtime = "cloudfront-js-2.0"
      comment = "Akamai essl v62 §12 redirect equivalent (ch02)"
      publish = true
      code    = file("${path.module}/src/redirect-pc-m.js")
    }
    ```

    `outputs.tf`:

    ```hcl
    output "function_arns" {
      value = {
        redirect_pc_m = aws_cloudfront_function.redirect_pc_m.arn
      }
    }
    ```

- [ ] **Step 12.3：把 Function attach 到 `cloudfront-www`**

    `Cloudfront/terraform/modules/cloudfront-www/variables.tf` 加：

    ```hcl
    variable "function_associations" {
      type = list(object({
        event_type   = string
        function_arn = string
      }))
      default = []
    }
    ```

    `.../cloudfront-www/main.tf` 的 `default_cache_behavior` 块里加：

    ```hcl
    dynamic "function_association" {
      for_each = var.function_associations
      content {
        event_type   = function_association.value.event_type
        function_arn = function_association.value.function_arn
      }
    }
    ```

    root `main.tf` 追加：

    ```hcl
    module "cloudfront_functions" {
      source       = "./modules/cloudfront-functions"
      project_name = var.project_name
    }
    ```

    `cf_www` 模块调用改成：

    ```hcl
    module "cf_www" {
      source = "./modules/cloudfront-www"
      # ... 原有参数
      function_associations = [
        { event_type = "viewer-request", function_arn = module.cloudfront_functions.function_arns.redirect_pc_m }
      ]
    }
    ```

- [ ] **Step 12.4：plan + apply**

    ```bash
    cd Cloudfront/terraform/environments/poc
    terraform plan -out=ch02.tfplan
    terraform apply ch02.tfplan
    # CloudFront Distribution 更新约 5-10 分钟
    ```

- [ ] **Step 12.5：快速手工验证（curl）**

    ```bash
    # Mobile UA → PC host：302 到 m.*
    curl -s -o /dev/null -w "status=%{http_code} loc=%{redirect_url}\n" \
      -H 'User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15' \
      https://www.beautyforever.keithyu.cloud/
    # 预期：status=302 loc=https://m.beautyforever.keithyu.cloud/

    # Desktop UA → M host：302 到 www.*
    curl -s -o /dev/null -w "status=%{http_code} loc=%{redirect_url}\n" \
      -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 12_0) Chrome/120.0' \
      https://m.beautyforever.keithyu.cloud/
    # 预期：status=302 loc=https://www.beautyforever.keithyu.cloud/

    # UA 白名单 LqPassWaf → 200 不跳转
    curl -s -o /dev/null -w "status=%{http_code}\n" \
      -H 'User-Agent: LqPassWaf/851.3' \
      https://www.beautyforever.keithyu.cloud/
    # 预期：status=200

    # Apple Pay 路径 on m → 200 不跳转
    curl -s -o /dev/null -w "status=%{http_code}\n" \
      -H 'User-Agent: Mozilla/5.0 Chrome/120.0' \
      https://m.beautyforever.keithyu.cloud/.well-known/apple-developer-merchantid-domain-association.txt
    # 预期：status=200

    # js/css 扩展名 → 不跳转
    curl -s -o /dev/null -w "status=%{http_code}\n" \
      -H 'User-Agent: Mozilla/5.0 (iPhone)' \
      https://www.beautyforever.keithyu.cloud/static/app.js
    # 预期：status=200
    ```

- [ ] **Step 12.6：test-harness YAML**

    `Cloudfront/test-harness/cases/02-redirect.yaml`:

    ```yaml
    chapter: 02-redirect
    cases:
      - id: pc-to-m-mobile-ua
        description: "Mobile UA 访问 www → 302 到 m"
        request:
          url: "https://{host}/"
          headers: { User-Agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0) AppleWebKit/605.1.15" }
        expectations:
          status: 302
          header_contains: { Location: "https://m.beautyforever" }
        hosts: { akamai: www.beautyforever.com, cloudfront: www.beautyforever.keithyu.cloud }

      - id: m-to-pc-desktop-ua
        description: "Desktop UA 访问 m → 302 到 www"
        request:
          url: "https://{host}/"
          headers: { User-Agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 12_0) Chrome/120.0" }
        expectations:
          status: 302
          header_contains: { Location: "https://www.beautyforever" }
        hosts: { akamai: m.beautyforever.com, cloudfront: m.beautyforever.keithyu.cloud }

      - id: lqpasswaf-ua-no-redirect-pc
        description: "LqPassWaf UA 访问 www → 200 不跳转（即便 UA 不是 mobile）"
        request:
          url: "https://{host}/"
          headers: { User-Agent: "LqPassWaf/851.3" }
        expectations: { status: 200 }
        hosts: { akamai: www.beautyforever.com, cloudfront: www.beautyforever.keithyu.cloud }

      - id: lqpasswaf-ua-no-redirect-m
        description: "LqPassWaf UA 访问 m → 200 不跳转"
        request:
          url: "https://{host}/"
          headers: { User-Agent: "LqPassWaf/851.3" }
        expectations: { status: 200 }
        hosts: { akamai: m.beautyforever.com, cloudfront: m.beautyforever.keithyu.cloud }

      - id: apple-pay-no-redirect
        description: "Apple Pay .well-known 在 m 不跳转"
        request:
          url: "https://{host}/.well-known/apple-developer-merchantid-domain-association.txt"
          headers: { User-Agent: "Mozilla/5.0 (Macintosh) Chrome/120.0" }
        expectations: { status: 200 }
        hosts: { akamai: m.beautyforever.com, cloudfront: m.beautyforever.keithyu.cloud }

      - id: js-extension-no-redirect
        description: "js 扩展名在 www 上即便 mobile UA 也不跳转"
        request:
          url: "https://{host}/static/app.js"
          headers: { User-Agent: "Mozilla/5.0 (iPhone)" }
        expectations: { status: 200 }
        hosts: { akamai: www.beautyforever.com, cloudfront: www.beautyforever.keithyu.cloud }

      - id: css-extension-no-redirect
        description: "css 扩展名在 m 上即便 desktop UA 也不跳转"
        request:
          url: "https://{host}/static/app.css"
          headers: { User-Agent: "Mozilla/5.0 (Macintosh) Chrome" }
        expectations: { status: 200 }
        hosts: { akamai: m.beautyforever.com, cloudfront: m.beautyforever.keithyu.cloud }
    ```

- [ ] **Step 12.7：跑 report**

    ```bash
    cd Cloudfront/test-harness
    make probe-02-redirect
    make report-02-redirect
    # 预期：probe 列全 ✅
    ```

- [ ] **Step 12.8：hands-on 文档**

    `Cloudfront/hands-on/02-redirect-whitelist.md`:

    ```markdown
    # ch02 · PC↔M 跳转 + UA/路径白名单（AWS Console 手册）

    ## Akamai 现状摘录

    参考 [`Akamai/doc/10-property-beautyforever-essl.md`](../../Akamai/doc/10-property-beautyforever-essl.md) §12：
    - 302（非 301）跳转
    - UA 白名单：`LqPassWaf/851.3`、`LqPassWaf/851.3 (it; Categraf)`
    - 路径白名单（m→PC）：`/.well-known/apple-developer-merchantid-domain-association.txt`
    - 扩展名白名单：`js`、`css`

    ## CloudFront 对应

    **CloudFront Function (viewer-request)**，attach 到 www+m Distribution 的 default behavior。代码：[`terraform/modules/cloudfront-functions/src/redirect-pc-m.js`](../terraform/modules/cloudfront-functions/src/redirect-pc-m.js)

    ## Console 步骤（复核）

    1. CloudFront → Functions → 找 `akamai-to-aws-longqi-redirect-pc-m`
    2. Details → 查看 "Used by" 是否包含 www+m Distribution
    3. Code 标签 → 查看 Published version
    4. Test 标签 → 用以下输入测试（Console 内置 invoker）：
       - event_type: viewer-request
       - URI: `/`
       - Host: `www.beautyforever.keithyu.cloud`
       - User-Agent: `Mozilla/5.0 (iPhone)`
       - 预期输出：`statusCode=302, headers.location=https://m.beautyforever.keithyu.cloud/`

    ## 验证

    `test-harness/cases/02-redirect.yaml` 的 7 条用例应全 ✅。
    ```

- [ ] **Step 12.9：delivery md**

    `Cloudfront/delivery/02-redirect-whitelist.md`（覆盖占位）:

    ```markdown
    # §2 · PC↔M 跳转 + UA / 路径白名单

    ## §2.1 Akamai 现状

    参考 [`Akamai/doc/10-property-beautyforever-essl.md`](../Akamai/doc/10-property-beautyforever-essl.md) §12。关键：
    - **302**（不是 301）
    - UA 白名单 `LqPassWaf/851.3`（含 Categraf 变体）——内部 WAF 健康检查用
    - Apple Pay `.well-known` 路径白名单（m→PC 分支）——域名验证必需能在 m 直接 200
    - `js/css` 扩展名白名单——静态资源不跳转

    ## §2.2 CloudFront 对应

    | Akamai | AWS |
    |---|---|
    | rule tree redirect behavior | CloudFront Function viewer-request |
    | `deviceCharacteristic[IS_MOBILE]` | UA 正则 `/(Mobile\|iPhone\|Android\|...)/` |
    | 302 response code | `statusCode=302` |
    | UA 白名单 | `UA_WHITELIST` 常量数组 |
    | 路径白名单 | `APPLE_PAY_PATH` 常量 |
    | 扩展名白名单 | `EXT_WHITELIST = ['js', 'css']` |

    源码：[`terraform/modules/cloudfront-functions/src/redirect-pc-m.js`](../terraform/modules/cloudfront-functions/src/redirect-pc-m.js)

    ## §2.3 差异与 trade-off

    - **Mobile 检测精度**：Akamai `deviceCharacteristic` 基于其内部设备库（随 Akamai 云同步更新）；CloudFront Function 是静态 UA 正则。对绝大多数真实 UA 一致，但边角场景（如新设备、BotUA）可能不同。后续可以升级到 CloudFront KeyValueStore 按客户侧设备库同步。
    - **Function 执行限额**：CloudFront Function 最多 1ms CPU、10KB 代码。当前函数约 1KB，执行 < 0.1ms，无压力。

    ## §2.4 验证证据

    [`02-redirect-matrix.html`](../test-harness/report/out/02-redirect-matrix.html)，7 条用例覆盖：
    1. 正常 PC→M 跳转
    2. 正常 M→PC 跳转
    3. LqPassWaf UA 在 PC 不跳
    4. LqPassWaf UA 在 M 不跳
    5. Apple Pay 路径在 M 不跳
    6. js 扩展名在 PC 不跳
    7. css 扩展名在 M 不跳

    ## §2.5 客户确认项

    - [ ] 确认 302（非 301）
    - [ ] 确认 UA 白名单含 `LqPassWaf/851.3` + Categraf 变体
    - [ ] 确认 `/.well-known/apple-developer-merchantid-domain-association.txt` 白名单
    - [ ] 确认 `js/css` 扩展名白名单
    - [ ] 若将来要加新 UA / 路径白名单，告知以便 CloudFront Function 同步
    ```

- [ ] **Step 12.10：commit**

    ```bash
    git add Cloudfront/terraform/modules/cloudfront-functions/ \
            Cloudfront/terraform/modules/cloudfront-www/ \
            Cloudfront/terraform/main.tf \
            Cloudfront/hands-on/02-redirect-whitelist.md \
            Cloudfront/delivery/02-redirect-whitelist.md \
            Cloudfront/test-harness/cases/02-redirect.yaml
    git commit -m "ch02: pc<->m redirect via CloudFront Function + 7 test cases"
    ```

---

## Task 13：ch03 · `?akaCache=nce` 全局缓存 Backdoor

**目标**：当请求 query string 含 `akaCache=nce` 时，强制不缓存。在 Akamai 侧这是 rule tree 里所有 cacheable 分支都硬挂的一条 `if query akaCache=nce then caching=NO_STORE`。CloudFront 侧有两种实现方式：

- **方案 A**（推荐）：CloudFront Function（viewer-request）改写 `Cache-Control` 请求头为 `no-cache`，并在 query 含 `akaCache=nce` 时**重写 URI 加一个 `cache-bust` 参数**，让 CacheKey 永远不命中
- **方案 B**：再起一个 CloudFront Function（viewer-response）强制 `Cache-Control: no-store`——但这不影响 CloudFront 的 edge cache lookup，只影响 client

**我们选 A**。通过 CacheKey 污染实现真正绕过。

**Files:**
- Create: `Cloudfront/terraform/modules/cloudfront-functions/src/akacache-nce.js`
- Modify: `Cloudfront/terraform/modules/cloudfront-functions/main.tf`（新增 Function）
- Modify: `Cloudfront/terraform/main.tf`（cf_www + cf_api 都 attach 这个 Function）
- Modify: `Cloudfront/terraform/modules/cloudfront-api/main.tf`（加 function_associations）
- Create: `Cloudfront/hands-on/03-akacache-backdoor.md`
- Create: `Cloudfront/delivery/03-akacache-backdoor.md`
- Create: `Cloudfront/test-harness/cases/03-akacache-backdoor.yaml`

### Steps

- [ ] **Step 13.1：Function 源码**

    但是注意：ch02 的 redirect function 也是 viewer-request——CloudFront Function 一个 event type **只能绑一个 Function**。所以 ch02 + ch03 必须合并成一个 Function，或其中一个改成 Lambda@Edge。

    **决策：** 把 ch02 redirect + ch03 akacache 合并成一个 viewer-request Function。合理，因为都是"进入缓存前的请求改写"。

    删除 `redirect-pc-m.js` 独立状态，改造为 `viewer-request.js`：

    `Cloudfront/terraform/modules/cloudfront-functions/src/viewer-request.js`:

    ```javascript
    // Unified viewer-request handler
    // Combines:
    //   - ch02 PC<->M redirect (Akamai essl v62 §12)
    //   - ch03 ?akaCache=nce backdoor (Akamai global rule)

    // ---- ch02 tables
    var UA_WHITELIST = ['LqPassWaf/851.3', 'LqPassWaf/851.3 (it; Categraf)'];
    var APPLE_PAY_PATH = '/.well-known/apple-developer-merchantid-domain-association.txt';
    var EXT_WHITELIST = ['js', 'css'];
    var MOBILE_UA_RE = /(Mobile|iPhone|iPod|Android|BlackBerry|IEMobile|Opera Mini|Opera Mobi)/;

    // ---- ch03
    var AKA_CACHE_KEY = 'akaCache';
    var AKA_CACHE_VAL = 'nce';

    function extOf(uri) {
      var dot = uri.lastIndexOf('.');
      if (dot < 0) return '';
      var rest = uri.slice(dot + 1);
      var q = rest.indexOf('?');
      return (q < 0 ? rest : rest.slice(0, q)).toLowerCase();
    }

    function isMobileUA(ua) { return ua && MOBILE_UA_RE.test(ua); }
    function isWhitelistedUA(ua) {
      for (var i = 0; i < UA_WHITELIST.length; i++) if (ua === UA_WHITELIST[i]) return true;
      return false;
    }

    function qsToString(qs) {
      if (!qs) return '';
      var out = [];
      for (var k in qs) out.push(encodeURIComponent(k) + (qs[k].value ? '=' + encodeURIComponent(qs[k].value) : ''));
      return out.join('&');
    }

    function redirect(toHost, path, qs) {
      var loc = 'https://' + toHost + path + (qs ? '?' + qs : '');
      return { statusCode: 302, statusDescription: 'Found', headers: { location: { value: loc } } };
    }

    function handler(event) {
      var req = event.request;
      var host = req.headers.host ? req.headers.host.value.toLowerCase() : '';
      var ua   = req.headers['user-agent'] ? req.headers['user-agent'].value : '';
      var uri  = req.uri;
      var qsobj = req.querystring || {};

      // ---- ch03 akaCache=nce: poison cache key by injecting a per-request uuid
      // When this parameter is present, every request gets a unique query param,
      // which forces a cache miss. Also signals downstream via x-aka-bypass header.
      if (qsobj[AKA_CACHE_KEY] && qsobj[AKA_CACHE_KEY].value === AKA_CACHE_VAL) {
        // 32-bit random (enough for cache-busting on POC scale)
        var uniq = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        qsobj['__cfbust'] = { value: uniq };
        req.querystring = qsobj;
        req.headers['x-aka-bypass'] = { value: '1' };
        // Fall through to redirect logic — bypass applies regardless of redirect
      }

      // ---- ch02 redirect

      if (isWhitelistedUA(ua)) return req;
      if (EXT_WHITELIST.indexOf(extOf(uri)) >= 0) return req;

      if (host.indexOf('www.') === 0 && isMobileUA(ua)) {
        return redirect(host.replace(/^www\./, 'm.'), uri, qsToString(req.querystring));
      }

      if (host.indexOf('m.') === 0 && !isMobileUA(ua)) {
        if (uri === APPLE_PAY_PATH) return req;
        return redirect(host.replace(/^m\./, 'www.'), uri, qsToString(req.querystring));
      }

      return req;
    }
    ```

- [ ] **Step 13.2：修改 function module 只发布这一个 Function**

    `Cloudfront/terraform/modules/cloudfront-functions/main.tf` 替换为：

    ```hcl
    resource "aws_cloudfront_function" "viewer_request" {
      name    = "${var.project_name}-viewer-request"
      runtime = "cloudfront-js-2.0"
      comment = "Combined ch02 redirect + ch03 akaCache=nce backdoor"
      publish = true
      code    = file("${path.module}/src/viewer-request.js")
    }
    ```

    `outputs.tf`:

    ```hcl
    output "function_arns" {
      value = {
        viewer_request = aws_cloudfront_function.viewer_request.arn
      }
    }
    ```

    **删除** `src/redirect-pc-m.js`（被 `viewer-request.js` 合并）。

- [ ] **Step 13.3：修 cf_www 的 function association**

    root `main.tf` 里 `module "cf_www"` 的 `function_associations` 改为：

    ```hcl
    function_associations = [
      { event_type = "viewer-request", function_arn = module.cloudfront_functions.function_arns.viewer_request }
    ]
    ```

- [ ] **Step 13.4：cf_api 也 attach（ch03 对 api 同样生效）**

    `Cloudfront/terraform/modules/cloudfront-api/variables.tf` 加：

    ```hcl
    variable "function_associations" {
      type = list(object({
        event_type   = string
        function_arn = string
      }))
      default = []
    }
    ```

    `.../cloudfront-api/main.tf` 的 `default_cache_behavior` 块里加与 `cloudfront-www` 完全相同的 `dynamic "function_association"` 块：

    ```hcl
    dynamic "function_association" {
      for_each = var.function_associations
      content {
        event_type   = function_association.value.event_type
        function_arn = function_association.value.function_arn
      }
    }
    ```

    root `main.tf` 里 `module "cf_api"` 调用时传入：

    ```hcl
    function_associations = [
      { event_type = "viewer-request", function_arn = module.cloudfront_functions.function_arns.viewer_request }
    ]
    ```

- [ ] **Step 13.5：plan + apply**

    ```bash
    cd Cloudfront/terraform/environments/poc
    terraform plan -out=ch03.tfplan
    # 预期：1 Function replace（因为源码改了） + 2 Distribution modify
    terraform apply ch03.tfplan
    ```

- [ ] **Step 13.6：手工验证**

    ```bash
    # 正常请求：不带 akaCache，无 bypass 头
    curl -sv https://www.beautyforever.keithyu.cloud/ 2>&1 | grep -i 'x-cache'
    # 预期：X-Cache: Miss from cloudfront（首次）；再跑一次：Hit from cloudfront

    # Backdoor：每次都 miss
    curl -sv 'https://www.beautyforever.keithyu.cloud/?akaCache=nce' 2>&1 | grep -i 'x-cache'
    curl -sv 'https://www.beautyforever.keithyu.cloud/?akaCache=nce' 2>&1 | grep -i 'x-cache'
    # 预期：两次都是 Miss from cloudfront（因为每次注入了 __cfbust=xxxxx）

    # api 侧同样生效（但 api 默认就 no-store 不缓存，效果看不出来，但 header 会透传）
    curl -sv 'https://api.beautyforever.keithyu.cloud/ping?akaCache=nce' 2>&1 | grep -i 'x-aka-bypass'
    # 预期：（x-aka-bypass 是发给 origin 的请求头，CloudFront 响应里看不到；需要从 ALB access log 或 EC2 日志确认）
    ```

- [ ] **Step 13.7：test-harness YAML**

    `Cloudfront/test-harness/cases/03-akacache-backdoor.yaml`:

    ```yaml
    chapter: 03-akacache-backdoor
    cases:
      - id: normal-request-can-hit
        description: "无 akaCache 参数时，第二次请求应 CloudFront HIT"
        request:
          url: "https://{host}/"
          headers: { User-Agent: "Mozilla/5.0 (Macintosh) Chrome" }
        expectations:
          status: 200
        hosts: { akamai: www.beautyforever.com, cloudfront: www.beautyforever.keithyu.cloud }
        tags: ["probe-needs-double-fetch"]

      - id: akacache-nce-always-miss
        description: "带 akaCache=nce 的请求永远 MISS"
        request:
          url: "https://{host}/?akaCache=nce"
          headers: { User-Agent: "Mozilla/5.0 (Macintosh) Chrome" }
        expectations:
          status: 200
          header_contains: { X-Cache: "Miss" }
        hosts: { akamai: www.beautyforever.com, cloudfront: www.beautyforever.keithyu.cloud }
    ```

    **注意**：Akamai 的 X-Cache 头格式和 CloudFront 不一样（Akamai 是 `X-Cache: TCP_MISS from ...`，CloudFront 是 `X-Cache: Miss from cloudfront`）。用 `header_contains` 匹配子串 `Miss` 在两侧都能成立。

- [ ] **Step 13.8：跑 report**

    ```bash
    cd Cloudfront/test-harness
    make probe-03-akacache-backdoor
    make report-03-akacache-backdoor
    # 预期：probe 列全 ✅（akacache-nce-always-miss 的 X-Cache 含 Miss）
    ```

- [ ] **Step 13.9：hands-on + delivery md**

    `Cloudfront/hands-on/03-akacache-backdoor.md`（短）:

    ```markdown
    # ch03 · ?akaCache=nce 全局缓存 Backdoor

    ## Akamai 现状

    Akamai rule tree 里所有 cacheable 分支（首页、列表、详情、博客、活动）都硬挂一条 `if query akaCache=nce then caching=NO_STORE`。客户运维调试/手动刷新时常用。参考 [`Akamai/doc/10-property-beautyforever-essl.md`](../../Akamai/doc/10-property-beautyforever-essl.md) §7。

    ## CloudFront 实现

    CloudFront Function（viewer-request）检测到 `akaCache=nce` 时：
    1. 向 query 注入 `__cfbust=<random>` → cache key 永远不同 → 永远 MISS
    2. 向 origin 请求加 `X-Aka-Bypass: 1`（便于后端识别）

    代码：[`terraform/modules/cloudfront-functions/src/viewer-request.js`](../terraform/modules/cloudfront-functions/src/viewer-request.js) 中的第一段。

    ## Console 验证

    CloudFront → Functions → `akamai-to-aws-longqi-viewer-request` → Test 标签
    - URI: `/`
    - QueryString: `akaCache=nce`
    - 预期输出：querystring 增加 `__cfbust` 参数

    ## 测试

    `test-harness/cases/03-akacache-backdoor.yaml` 2 条用例。
    ```

    `Cloudfront/delivery/03-akacache-backdoor.md`（覆盖占位）:

    ```markdown
    # §3 · ?akaCache=nce 全局缓存 Backdoor

    ## §3.1 Akamai 现状

    参考 [`Akamai/doc/10-property-beautyforever-essl.md`](../Akamai/doc/10-property-beautyforever-essl.md) §7：所有可缓存页面分支都挂了 `if query akaCache=nce then caching=NO_STORE`。运维日常调试用。

    ## §3.2 CloudFront 对应

    | Akamai | AWS |
    |---|---|
    | rule 分支 `if query akaCache=nce → NO_STORE` | CloudFront Function 向 cache key 注入 `__cfbust=<random>` |
    | 无 | 追加请求头 `X-Aka-Bypass: 1` 发给 origin（便于后端识别并记录日志） |

    注意：和 ch02 合并在同一个 viewer-request Function 里。

    ## §3.3 差异与 trade-off

    - Akamai 是 "不缓存"；CloudFront 是 "总是 cache miss 导致每次回源"。效果等价。
    - CloudFront 会多一次 cache lookup 开销（但反正 miss），可忽略。
    - **优势**：CloudFront 侧 `X-Aka-Bypass: 1` 请求头让源站可以在 access log 标记"人工绕缓存"的请求量，帮助客户量化该 backdoor 的日常使用频率。

    ## §3.4 验证证据

    [`03-akacache-backdoor-matrix.html`](../test-harness/report/out/03-akacache-backdoor-matrix.html)

    ## §3.5 客户确认项

    - [ ] 保留 `?akaCache=nce` 作为 backdoor key
    - [ ] `X-Aka-Bypass: 1` 请求头作为新增能力，供后端日志识别
    ```

- [ ] **Step 13.10：commit**

    ```bash
    git add Cloudfront/terraform/modules/cloudfront-functions/ \
            Cloudfront/terraform/modules/cloudfront-api/ \
            Cloudfront/terraform/main.tf \
            Cloudfront/hands-on/03-akacache-backdoor.md \
            Cloudfront/delivery/03-akacache-backdoor.md \
            Cloudfront/test-harness/cases/03-akacache-backdoor.yaml
    git commit -m "ch03: unified viewer-request fn with akaCache=nce cache-bust + 2 test cases"
    ```

---

## Part 1 完成里程碑（对齐 spec §7）

**日期**：2026-05-06

- [ ] Task 11: ch01 Distribution 分流补齐 + 文档
- [ ] Task 12: ch02 PC↔M 跳转 + 7 test 绿
- [ ] Task 13: ch03 akaCache backdoor + 2 test 绿
- [ ] test-harness report/out 下有 3 个 HTML 矩阵（01/02/03），全绿

## 回归测试

```bash
cd Cloudfront/test-harness
make probe-01-distribution && make probe-02-redirect && make probe-03-akacache-backdoor
make report-01-distribution && make report-02-redirect && make report-03-akacache-backdoor
# 3 个 matrix 全绿
```

## 更新 plans index

修改 [`2026-04-22-akamai-to-aws-longqi-index.md`](./2026-04-22-akamai-to-aws-longqi-index.md) 把 part1 状态改为 `✅ 已完成`。

## 下一步

执行 [`2026-04-22-akamai-to-aws-longqi-part2-cache.md`](./2026-04-22-akamai-to-aws-longqi-part2-cache.md)（skeleton，需先用 `/superpowers:writing-plans` 细化）。
