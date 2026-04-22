# Part 4 · WAF 实施计划（ch08-10）· Skeleton

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

> **⚠ 本 plan 为 Skeleton**：task 级别清晰，进入 Part 4 前用 `/superpowers:writing-plans` 基于实际情况细化到 2-5 分钟 sub-step 粒度。

**Goal:** 等价复现 Akamai Security Configuration 89613 v145：(ch08) 3 个 Policy（Deny/Alert/Api）+ Match Targets 框架；(ch09) 19 条 Custom Rules + ASN 202425 拦截；(ch10) 5 条 Rate Policy + Slow POST + Bot Manager。

**Architecture:** Phase 0 已建 3 个空 WAF Web ACL（`akamai-to-aws-longqi-deny/alert/api`）。本 Part 往这 3 个 ACL 填规则：Custom Rule 用 `aws_wafv2_rule_group` 或直接在 ACL 内部 rule 写；Rate-Based Rule 独立；Bot Control 用 Managed Rule Group `AWSManagedRulesBotControlRuleSet`。`us-east-1` provider。

**Tech Stack:** AWS WAFv2 · Terraform · JSON policy statements

**Spec reference:** [`../specs/2026-04-22-akamai-to-aws-longqi-design.md`](../specs/2026-04-22-akamai-to-aws-longqi-design.md) §5.1 Part 4

**Prerequisite:** Phase 0 完成（WAF 骨架 × 3）。Part 4 可与 Part 1-3 并行，但建议先完成 Part 1-3 再做 Part 4（避免 WAF 误拦对其他测试造成噪音）。

---

## 文件结构

```
Cloudfront/
├── terraform/modules/waf/
│   ├── main.tf                       ← 大扩展：引用 rule-groups
│   ├── variables.tf
│   ├── outputs.tf
│   ├── rule-groups/
│   │   ├── custom-rules-www.tf       ← ch09 19 条 + ASN
│   │   ├── custom-rules-api.tf       ← api 侧独立 rule（如果有）
│   │   ├── rate-rules.tf             ← ch10 5 条 rate
│   │   ├── slow-post.tf              ← ch10
│   │   └── bot-control.tf            ← ch10 managed
│   └── data/
│       ├── custom-rules.yaml         ← 19 条 rule 的结构化定义（人读）
│       └── rate-policies.yaml        ← 5 条 rate
│
├── hands-on/
│   ├── 08-waf-policy-framework.md
│   ├── 09-custom-rules-asn.md
│   └── 10-rate-slowpost-bot.md
│
├── delivery/
│   ├── 08-waf-policy-framework.md + .html
│   ├── 09-custom-rules-asn.md + .html
│   └── 10-rate-slowpost-bot.md + .html
│
└── test-harness/cases/
    ├── 08-waf-policy-framework.yaml
    ├── 09-custom-rules-asn.yaml      (含 destructive tag — 仅 CloudFront 侧测)
    └── 10-rate-slowpost-bot.yaml     (含 destructive tag — 仅 CloudFront 侧)
```

---

## Task 18：ch08 · WAF 框架 Match Targets + 3 Policy

**目标**：确认 Phase 0 的 3 个空 WAF Web ACL 正确 associate 到 Distribution：`deny` → www Distribution（对齐 Akamai `Policy Deny`）；`api` → api Distribution（对齐 `Policy Api`）；`alert` 暂不 associate（Akamai `Policy Alert` 只对 `tapi.beautyforever.com`，POC 无对应域名）。文档化 Akamai Match Target → AWS Web ACL 的映射。

### Sub-tasks (skeleton)

- [ ] **18.1 确认 Web ACL 的默认 action = Allow**：Phase 0 已设；本 task 复核。
- [ ] **18.2 加 CloudWatch + Sampled Requests 观测**：Phase 0 已开 `visibility_config { cloudwatch_metrics_enabled = true, sampled_requests_enabled = true }`；本 task 确认 metrics 进 CloudWatch。
- [ ] **18.3 hands-on + delivery md**：对照表

  | Akamai 对象 | AWS 对应 |
  |---|---|
  | Security Configuration 89613 | 3 个 Web ACL 的集合（scope CLOUDFRONT） |
  | Policy `qik1_201886` Deny | `akamai-to-aws-longqi-deny` Web ACL |
  | Policy `1218_239915` Alert | `akamai-to-aws-longqi-alert`（POC 不 attach） |
  | Policy `0124_243504` Api | `akamai-to-aws-longqi-api` Web ACL |
  | Match Target Type=website filePaths=["/*"] | CloudFront Distribution association（整站保护，filter by host） |
  | Match Target 按 sequence 匹配 | AWS 侧 CloudFront 直接 attach 到对应 Distribution，host 天然隔离 |
  | effectiveSecurityControls: App/Bot/Network/Rate/SlowPost 开 | ch09/10 会分别实现 |

- [ ] **18.4 AWS Managed Rule Groups（OWASP / Core Rule Set）（coverage E4 / C4）**：对齐 Akamai Security Config §4 `Application Layer Controls` ✅。在 `deny` 和 `api` 两个 Web ACL 各加以下 managed rule groups：

  ```hcl
  rule {
    name     = "aws-common-crs"
    priority = 5

    override_action { none {} }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
        # 按客户需求 selectively count vs block；POC 阶段保持 block（即 none 不 override）
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "aws-common-crs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-sqli"
    priority = 6
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesSQLiRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "aws-sqli"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-known-bad-inputs"
    priority = 7
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "aws-known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }
  ```

  **WCU 预算**：`CommonRuleSet` 700 + `SQLi` 200 + `KnownBadInputs` 200 = 1100 WCU base；Custom Rules + Rate + Bot 需要紧扣剩余预算。若超 1500 → 拆 ACL。具体选哪几个 Managed Rule Group 依据 spec §8.3 T8 的客户确认。

- [ ] **18.5 test-harness 用例（4 条非破坏性 + 2 条破坏性）**：
  - `www` 普通请求返回 200（WAF 默认 Allow）
  - `api` 普通请求返回 200
  - CloudWatch `AllowedRequests` metric > 0
  - `crs-block-sql-injection`：带明显 SQL injection payload 的请求被 block（用 `' OR 1=1--` in query）
  - `crs-block-xss`：带 XSS payload 的请求被 block
  - `known-bad-inputs-block`：带 `../../etc/passwd` 路径遍历被 block

- [ ] **18.6 commit**：`ch08: waf framework + 3 managed rule groups (crs/sqli/kbi) + 6 tests`

**验收信号**：3 个 Web ACL 都 `attached` 或记为"POC 未挂载"，hands-on 对照表清晰。

---

## Task 19：ch09 · Custom Rules + ASN 202425

**目标**：把 Akamai 的 19 条 Custom Rules 翻译到 AWS WAF 的 Custom Rule statements。重点：ASN 202425 + hostMatch www.beautyforever.com 拦截（对应 Akamai Rule `60383229`）。

**19 条 Custom Rules 清单**（来自 [`Akamai/doc/40-ops-verification.md`](../../../Akamai/doc/40-ops-verification.md) §6.3）：
bypass test agent · Deny UA · Deny Client TLS Fingerprint 系列 · Monitor vcdn.nadula.com · GeoDeny beautyforever/nadula/unice · ASnumber8075 四站 · deny referer eslq=seeds · 11-21 Attack Deny · Deny asnumber 202425

### Sub-tasks (skeleton)

- [ ] **19.1 整理 `data/custom-rules.yaml`**：把 19 条 rule 用结构化 YAML 写出来，每条含 `name / priority / action / conditions`。用 Python 脚本把 YAML 生成 terraform HCL（或者直接用 `yamldecode()` 在 HCL 里读）。
- [ ] **19.2 写 `rule-groups/custom-rules-www.tf`**：为 deny Web ACL 加以下 rule 样例（ASN 202425）：

  ```hcl
  resource "aws_wafv2_web_acl" "deny" {
    # 从 Phase 0 的 main.tf 提出来独立定义，或直接在 main.tf 里加 rule 块
    # ...
    rule {
      name     = "deny-asn-202425-for-www"
      priority = 10

      action { block {} }

      statement {
        and_statement {
          statement {
            byte_match_statement {
              positional_constraint = "EXACTLY"
              search_string         = "www.beautyforever.keithyu.cloud"
              field_to_match { single_header { name = "host" } }
              text_transformation { priority = 0 type = "LOWERCASE" }
            }
          }
          statement {
            asn_match_statement {
              asn_list = [202425]
            }
          }
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "deny-asn-202425-www"
        sampled_requests_enabled   = true
      }
    }

    # 其余 18 条类似结构
  }
  ```

  **注意**：AWS WAF `asn_match_statement` 是 2024 年新加的，检查 AWS Provider version ≥ 5.60。

- [ ] **19.3 处理其他 18 条**：每条按以下模板翻译：
  - **Deny UA**: `byte_match_statement` on `single_header { name = "user-agent" }`
  - **Deny TLS Fingerprint**: AWS WAF 不原生支持 JA3/JA4 fingerprint → **标记为 unsupported**，在 delivery §9.3 明示 "迁移缺口"
  - **GeoDeny**: `geo_match_statement { country_codes = [...] }`
  - **deny referer**: `byte_match_statement` on `single_header { name = "referer" }`
  - **Monitor vcdn.nadula.com**: 不在本项目 host 范围，标记为"不适用本 POC"

- [ ] **19.4 WCU 预算检查**：跑 `aws wafv2 check-capacity`（或 terraform plan 后看 AWS console 的 WCU 读数）。Phase 0 估计 19 条 Custom + 5 Rate + Bot Control ≈ 800-1200 WCU，上限 1500。超限时拆 2 个 Web ACL。
- [ ] **19.5 test-harness 用例（CloudFront 侧 destructive）**：
  ```yaml
  - id: asn-202425-blocked
    description: "从 ASN 202425 的请求（或用 AWS WAF IP set 模拟）被 block"
    tags: ["destructive"]
    # 只有 cloudfront host 侧跑；Akamai 侧标记为 rule-tree 推导
  - id: bad-ua-blocked
    description: "UA 含 specific bad-ua string 被 block"
    tags: ["destructive"]
  - id: cn-geo-allowed-but-others-logged
    description: "Geo 规则行为验证"
  ```
- [ ] **19.6 WAF Labels → `X-WAF-Rules-Triggered` 回源头（coverage D9 / C6）**：对齐 Akamai essl §15 `SEO tuning` 的 `PMUSER_TRIGGERED_RULES = {{builtin.AK_FIREWALL_TRIGGERED_RULES}}` —— 把本次请求命中的 WAF 规则号透传到源站。

  **实现路径**：
  1. 每条 Custom Rule 在 `visibility_config` 里已有 `metric_name`；AWS WAF 自动打 label `awswaf:<metric-name>`。也可以在 rule 里显式 `rule_label { name = "bf-ruleset-asn-202425" }`。
  2. CloudFront Function viewer-request **不能**读 WAF labels（labels 在 WAF evaluation 之后才产生）。需要改用 **Lambda@Edge origin-request** 或 **WAF custom response header**。
  3. **方案（POC 可行）**：用 WAF 的 `custom_response { response_header_name = "X-WAF-Rules-Triggered" ... }`，在 rule action 是 count 或 block 时注入响应头；但这只作用于 block 响应，其他场景需要 AWS WAF 的 `CustomRequestHandling`。
  4. **更简方案（推荐）**：定义一条 Custom Rule 组合 `rule_label` + 在 Count 动作下加 `custom_request_handling { insert_header { name = "X-WAF-Label-*" } }`，源站读这些 header 并组合成 `X-WAF-Rules-Triggered`（Node.js 侧处理）。

  **本 task 在 plan 中只建结构**：
  - 每条 Custom Rule 补 `rule_label { name = "bf:<rule-id>" }`
  - 在 `deny` 和 `api` Web ACL 新增一条 priority=1 的 "label-propagation rule"：统一把所有 labels 转成 `X-BF-WAF-Labels` 请求头
  - mock `beautyforever/server.js` 加 middleware：读 `X-BF-WAF-Labels`，暴露到 response header `X-WAF-Rules-Triggered`

  delivery §9.4 说明"POC 实现的是 label-to-header 桥接，业务侧可按此 header 做 SEO 降级；和 Akamai `PMUSER_TRIGGERED_RULES` 等价"。spec §8.3 T9 确认业务侧消费方式。

- [ ] **19.7 hands-on + delivery md**：19 条 rule 逐条对照表 + 2 条迁移缺口（TLS fingerprint、Monitor 域名）标红 + WAF Labels → `X-WAF-Rules-Triggered` 桥接说明
- [ ] **19.8 commit**：`ch09: 19 custom rules + ASN 202425 + WAF labels bridged to X-WAF-Rules-Triggered + TLS-fingerprint gap`

**验收信号**：
- `terraform apply` 无 WCU 超限错误
- ASN 202425 测试请求（模拟 IP 来自该 ASN）被 block
- delivery §9.3 明确列出 "TLS fingerprint 不等价支持" 作为迁移缺口

---

## Task 20：ch10 · Rate Policy + Slow POST + Bot Manager

**目标**：等价复现 Akamai 的 5 条 Rate Policy + Slow POST + Bot Manager。

**5 条 Rate Policy（Akamai 原）**：
- Origin Error: 5/8 rpm per path per IP
- Page View Requests: 15/25
- POST Page Requests: 3/5
- API Page View Requests: 13/20
- Static resource: 13/20

所有 Rate Policy 都是 `clientIdentifier=ip`。

### Sub-tasks (skeleton)

- [ ] **20.1 写 `rule-groups/rate-rules.tf`**，5 条 rate-based rule 样例：

  ```hcl
  rule {
    name     = "rate-page-view"
    priority = 50
    action   { block {} }
    statement {
      rate_based_statement {
        limit              = 25             # 25 / 5min window (Akamai 15/25 rpm ≈ AWS 75/125 per 5min)
        aggregate_key_type = "IP"
        scope_down_statement {
          byte_match_statement {
            # HTML paths only
            positional_constraint = "ENDS_WITH"
            search_string         = ".html"
            field_to_match { uri_path {} }
            text_transformation { priority = 0 type = "LOWERCASE" }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "rate-page-view"
      sampled_requests_enabled   = true
    }
  }
  ```

  **换算**：Akamai 的 rpm (request per minute) vs AWS 的 5-min sliding window。AWS WAF rate window 固定 5 min，所以 Akamai 15 rpm → 75 / 5-min；25 rpm → 125 / 5-min。在 delivery §10.3 解释换算。

- [ ] **20.2 Slow POST**：AWS WAF 原生支持 `size_constraint_statement`，对 body 大小设上限可以 partial 模拟 Slow POST。或在 CloudFront 层配 request timeout。**标注为 partial equivalence**。
- [ ] **20.3 Bot Manager**：启用 AWS Managed Rule Group `AWSManagedRulesBotControlRuleSet`：

  ```hcl
  rule {
    name     = "bot-control"
    priority = 100
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesBotControlRuleSet"
        managed_rule_group_configs {
          aws_managed_rules_bot_control_rule_set {
            inspection_level = "COMMON"  # or TARGETED (higher WCU cost)
          }
        }
      }
    }
    visibility_config { ... }
  }
  ```

  Akamai Bot Manager 规则细节在 Akamai 调研没完全抽出，这里用 AWS Common level 兜底。delivery §10.3 说明"非 1:1 等价，是尽力而为"。

- [ ] **20.4 WCU 预算重测**：Bot Control COMMON 占 50 WCU，TARGETED 占 1500（独占）。如果 COMMON + 其他 rule 仍超 1500，拆 Web ACL。
- [ ] **20.5 test-harness 用例（CloudFront 侧 destructive）**：
  ```yaml
  - id: rate-page-view-trigger-block
    description: "5 秒内打 50 次 /*.html，第 N+1 次应 block"
    tags: ["destructive", "rate-test"]
    # 特殊测试逻辑：在 probe.py 里加循环发送
  - id: bot-ua-default-blocked
    description: "典型爬虫 UA 被 AWS Bot Control Common 识别（Count 或 Block 看客户策略）"
    tags: ["destructive"]
  ```

  对 rate test 需要扩展 probe.py 支持 `repeat: N` 和 `delay_ms: X` 字段。

- [ ] **20.6 `breakConnection` 处理（coverage F2 / I5）**：对齐 Akamai api v10 §10 `breakConnection: enabled=true`（"Simulate failover"分支）。

  **本 task 的动作**：
  1. 向客户确认（spec §8.3 T10）—— 是演练残留还是生产上刻意保留？
  2. **若保留**：AWS 无原生等价；用 AWS WAF custom rule + 条件表达式模拟（命中条件时返回特定 status code，使 CloudFront 视为 origin 故障）：

     ```hcl
     rule {
       name     = "simulate-failover-${each.key}"
       priority = 200
       action {
         block {
           custom_response {
             response_code = 503
             custom_response_body_key = "failover-simulation"
           }
         }
       }
       statement {
         # TODO: fill in the Akamai breakConnection's original condition
         # (from raw JSON's Increase availability / breakConnection criteria)
         byte_match_statement {
           positional_constraint = "EXACTLY"
           search_string         = "true"
           field_to_match { single_header { name = "x-simulate-failover" } }
           text_transformation { priority = 0 type = "NONE" }
         }
       }
       visibility_config { ... }
     }
     ```

  3. **若不保留（推荐）**：在 delivery §10.4 明示 "迁移时主动删除故障注入 —— Akamai 生产上开着 `breakConnection` 大概率是演练残留"，并建议客户确认。

  **默认决策**：POC 阶段不实现，delivery 明示客户确认项；客户选保留后再补。

- [ ] **20.7 hands-on + delivery md**：
  - Akamai rate policy → AWS WAF rate-based rule 的换算表
  - Bot Manager → Bot Control 非精确映射声明
  - Slow POST partial equivalence 说明
  - `breakConnection` 去留说明 + 客户确认项

- [ ] **20.8 commit**：`ch10: 5 rate rules + slow-post partial + bot control common + breakConnection confirm placeholder + destructive tests`

**验收信号**：
- 连打 150 次 `/*.html` 触发 rate block（HTTP 403）
- 爬虫 UA 被 Bot Control 标记
- CloudWatch `BlockedRequests` metric 看到刚测试的 block 事件

---

## Part 4 完成里程碑

**日期**：2026-05-20

- [ ] Task 18: ch08 WAF 框架 · 3 test 绿
- [ ] Task 19: ch09 19 条 Custom Rules + ASN · destructive test 绿（CloudFront 侧）
- [ ] Task 20: ch10 5 条 Rate + Slow POST + Bot · destructive test 绿

## WCU 总预算登记

在 delivery §10.4 里登记最终 WCU 消耗（来自 `aws wafv2 get-web-acl`），供客户容量规划参考。

## 更新 index
把 part4 状态改为 `✅ 已完成`。

## 下一步
执行 [`2026-04-22-akamai-to-aws-longqi-part5-observability-cd.md`](./2026-04-22-akamai-to-aws-longqi-part5-observability-cd.md)（skeleton）。
