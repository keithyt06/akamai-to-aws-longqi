# Part 3 · Response 实施计划（ch07）· Skeleton

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

> **⚠ 本 plan 为 Skeleton**：task 级别清晰，进入 Part 3 前用 `/superpowers:writing-plans` 基于实际情况细化到 2-5 分钟 sub-step 粒度。

**Goal:** 对齐 Akamai essl v62 §9 + api v10 §9 的响应阶段 header 处理：(ch07) 删 `X-Powered-By`、`Server` 响应头；加 HSTS 2 年 + preload（和 Akamai staging v63/v11 一致）；True-Client-IP 转发；修复 Akamai 侧 `" x-authentic-ip"` 前导空格 bug（迁移到 CloudFront 时顺手修正为 `x-authentic-ip`）。

**Architecture:** 用 **CloudFront Response Headers Policy** 加 HSTS + 删冗余头；用 **CloudFront Function（viewer-request 追加代码）** 把 `CloudFront-Viewer-Address` 规范化成 `True-Client-IP`、`X-Authentic-IP` 两个请求头发到 origin（无前导空格，修复 Akamai bug）。

**Tech Stack:** CloudFront Response Headers Policy · CloudFront Function · Terraform

**Spec reference:** [`../specs/2026-04-22-akamai-to-aws-longqi-design.md`](../specs/2026-04-22-akamai-to-aws-longqi-design.md) §5.1 Part 3

**Prerequisite:** Part 2 已完成。

---

## 文件结构（Part 3 完成后新增/修改）

```
Cloudfront/
├── terraform/modules/
│   ├── response-headers/              ← 新增 module
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── cloudfront-functions/src/
│   │   └── viewer-request.js          ← 扩展：True-Client-IP / X-Authentic-IP
│   ├── cloudfront-www/main.tf         ← 扩展：attach response_headers_policy_id
│   └── cloudfront-api/main.tf         ← 同上
│
├── beautyforever/routes/www.js,m.js,api.js
│                                      ← 加 X-Powered-By / Server 响应头（让删除可验证）
│                                      ← 加回显 True-Client-IP / X-Authentic-IP 端点 /whoami
│
├── hands-on/07-headers-hsts-xff.md
├── delivery/07-headers-hsts-xff.md + .html
└── test-harness/cases/07-headers-hsts.yaml   (6 条用例)
```

---

## Task 17：ch07 · Headers + HSTS + True-Client-IP + XFF 修复

### Sub-tasks (skeleton)

- [ ] **17.1 建 `response-headers` module**，输出 2 个 Response Headers Policy（www/m 一个、api 一个，api 版本不含 HSTS redirect）：

  ```hcl
  resource "aws_cloudfront_response_headers_policy" "bf_secure" {
    name = "${var.project_name}-bf-secure"

    security_headers_config {
      strict_transport_security {
        access_control_max_age_sec = 63072000  # 2 years
        include_subdomains         = true
        preload                    = true
        override                   = true
      }
      content_type_options { override = true }
    }

    remove_headers_config {
      items { header = "X-Powered-By" }
      items { header = "Server" }
    }
  }
  ```

  **注意**：`preload = true` 是**不可逆变更**（把域名提交到浏览器预加载列表后，退出流程复杂）。客户确认后再放行。

- [ ] **17.2 扩展 viewer-request Function**，把 viewer IP 规范化成两个请求头：

  ```javascript
  // ---- ch07 True-Client-IP / X-Authentic-IP
  // CloudFront provides viewer IP via event.viewer.ip (if enabled via header)
  // Simpler: use req.headers['cloudfront-viewer-address'] which is enabled via managed
  // OriginRequestPolicy. Format: "IP:PORT".
  if (req.headers['cloudfront-viewer-address']) {
    var addr = req.headers['cloudfront-viewer-address'].value;
    var ip = addr.split(':')[0];
    req.headers['true-client-ip']  = { value: ip };
    req.headers['x-authentic-ip']  = { value: ip };  // NOTE: no leading space, fixes Akamai bug
  }
  ```

  **重要**：需要在 OriginRequestPolicy 中启用 `Managed-AllViewer` 或包含 `CloudFront-Viewer-Address` header。Phase 0 用的是 `Managed-AllViewerExceptHostHeader`，包含了。

- [ ] **17.3 attach Response Headers Policy**：

  `cloudfront-www/variables.tf` 加：
  ```hcl
  variable "response_headers_policy_id" {
    type    = string
    default = null
  }
  ```
  main.tf 的 default_cache_behavior 和后续 ordered_cache_behavior 都要引用。root 传入。

- [ ] **17.4 beautyforever mock**：
  - 强制输出 `X-Powered-By: Express` 和 `Server: bfmock`（默认 Express 会加），以便验证 CloudFront 侧被删
  - 新增路由 `/whoami`：返回 `{ ip: <from request> }`，用于验证 True-Client-IP 到源站

  ```javascript
  router.get('/whoami', (req, res) => {
    res.json({
      trueClientIP: req.headers['true-client-ip'] || null,
      xAuthenticIP: req.headers['x-authentic-ip'] || null,
      xForwardedFor: req.headers['x-forwarded-for'] || null,
    });
  });
  ```

- [ ] **17.5 test-harness 用例（6 条）**：

  ```yaml
  chapter: 07-headers-hsts
  cases:
    - id: strict-transport-security-present
      description: "HSTS 2 年 preload"
      request: { url: "https://{host}/", method: HEAD }
      expectations:
        header_contains: { Strict-Transport-Security: "max-age=63072000" }
      hosts: ...
    - id: hsts-includes-preload
      description: "HSTS 含 preload 标记"
      request: { url: "https://{host}/", method: HEAD }
      expectations:
        header_contains: { Strict-Transport-Security: "preload" }
    - id: x-powered-by-stripped
      description: "X-Powered-By 被删除"
      # 断言 headers 里不含 x-powered-by —— 需要 compare.py 支持 header_absent
    - id: server-header-stripped
      description: "Server 头被删"
    - id: true-client-ip-propagated
      description: "源站 /whoami 能看到 True-Client-IP 和 X-Authentic-IP（无前导空格）"
      request: { url: "https://{host}/whoami", method: GET }
      expectations:
        body_contains: '"trueClientIP":'  # 非 null
    - id: x-authentic-ip-no-leading-space
      description: "X-Authentic-IP 头名无前导空格（修复 Akamai bug）"
      # 同上 /whoami 响应里应看到 xAuthenticIP: "<ip>" 而不是 null
  ```

  **注意**：`header_absent` 断言需要扩展 `compare.py` 的 `match_expectation`。加一个分支：
  ```python
  for k in exp.get("header_absent", []):
      if k in actual["headers"] or k.lower() in {h.lower() for h in actual["headers"]}:
          return False, f"header {k}: expected absent, got present"
  ```

- [ ] **17.6 hands-on + delivery md**：

  **重点强调**：
  - Akamai `" x-authentic-ip"`（前导空格）是 bug，新项目修正为 `x-authentic-ip`
  - HSTS preload 不可逆，客户确认后再 apply
  - `X-Powered-By` 和 `Server` 作为 response header 被删（防指纹）
  - True-Client-IP 通过 CloudFront Function 从 `CloudFront-Viewer-Address` 派生

- [ ] **17.7 commit**：`ch07: response headers policy + hsts 2y preload + true-client-ip via function + 6 tests`

**验收信号**：
- `curl -sI https://www.beautyforever.keithyu.cloud/` 返回 `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`；**不含** `X-Powered-By` 和 `Server`
- `curl https://www.beautyforever.keithyu.cloud/whoami | jq` 看到 `trueClientIP` 和 `xAuthenticIP` 非 null
- Part 3 test-harness `07-headers-hsts.yaml` 6 条全绿

---

## Part 3 完成里程碑

**日期**：2026-05-13（与 Part 2 同节点）

- [ ] Task 17: ch07 完成 · 6 test 绿

## 更新 index
把 index plan 里 part3 状态改为 `✅ 已完成`。

## 下一步
执行 [`2026-04-22-akamai-to-aws-longqi-part4-waf.md`](./2026-04-22-akamai-to-aws-longqi-part4-waf.md)（skeleton，先细化）。
