# Akamai → AWS CloudFront 迁移 POC · Plan 索引

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each plan task-by-task.

**Goal:** Migrate Longqi / beautyforever.com CDN+WAF from Akamai to AWS CloudFront+WAF, with POC code, IaC, and customer-facing delivery docs by 2026-05-22.

**Architecture:** Monorepo under `/root/keith-space/2026-project/akamai-to-aws-longqi/`. Spec drives 7 sequentially-chained plans. Phase 0 is prerequisite; Parts 1-5 have intra-Part serial dependencies but Parts can partially parallelize via Team Agents.

**Tech Stack:** Terraform ≥ 1.5 · CloudFront + AWS WAF · Node.js ≥ 20 · Python 3.11 (httpx/pyyaml/jinja2) · Doris single-node · Kinesis Data Streams · ACM · Route53

**Source spec:** [`../specs/2026-04-22-akamai-to-aws-longqi-design.md`](../specs/2026-04-22-akamai-to-aws-longqi-design.md)

**Akamai → CloudFront 行为对照矩阵:** [`../specs/coverage-matrix.md`](../specs/coverage-matrix.md) — 66 条行为逐条对照，持续演化的"真相源"；每次改 spec / plan 都同步更新。

---

## Plan 清单

| 序 | Plan 文件 | 阶段 | 估计 PD | 状态 |
|---|---|---|---|---|
| 1 | [`2026-04-22-akamai-to-aws-longqi-phase0-foundation.md`](./2026-04-22-akamai-to-aws-longqi-phase0-foundation.md) | Phase 0 基建 | 5 PD | ✅ 完整详细 |
| 2 | [`2026-04-22-akamai-to-aws-longqi-part1-entry.md`](./2026-04-22-akamai-to-aws-longqi-part1-entry.md) | Part 1: ch01-03 流量入口 | 3.5 PD | ✅ 完整详细 |
| 3 | [`2026-04-22-akamai-to-aws-longqi-part2-cache.md`](./2026-04-22-akamai-to-aws-longqi-part2-cache.md) | Part 2: ch04-06 缓存行为 | 4.5 PD | ⚠ Skeleton |
| 4 | [`2026-04-22-akamai-to-aws-longqi-part3-response.md`](./2026-04-22-akamai-to-aws-longqi-part3-response.md) | Part 3: ch07 Response | 1 PD | ⚠ Skeleton |
| 5 | [`2026-04-22-akamai-to-aws-longqi-part4-waf.md`](./2026-04-22-akamai-to-aws-longqi-part4-waf.md) | Part 4: ch08-10 WAF | 4.5 PD | ⚠ Skeleton |
| 6 | [`2026-04-22-akamai-to-aws-longqi-part5-observability-cd.md`](./2026-04-22-akamai-to-aws-longqi-part5-observability-cd.md) | Part 5: ch11-12 可观测 + 红利 | 2 PD | ⚠ Skeleton |
| 7 | [`2026-04-22-akamai-to-aws-longqi-wrapup.md`](./2026-04-22-akamai-to-aws-longqi-wrapup.md) | 收尾 & 评审 | 2 PD | ⚠ Skeleton |
| | | **合计** | **22.5 PD** | |

**Skeleton** = task 级别设计到位（files、核心代码片段、验证命令），但 2-5 分钟 sub-step 级别未展开。进入该 Part 前用 `/superpowers:writing-plans` 再细化。

## 依赖关系

```
phase0-foundation  （前置：必须完成）
      │
      ├─ part1-entry  （依赖 phase0）
      │       │
      │       └─ part2-cache  （依赖 part1 的 ch01 Distribution）
      │               │
      │               └─ part3-response  （依赖 part2 的 cache 结构）
      │
      ├─ part4-waf  （依赖 phase0；与 part1-3 并行）
      │
      ├─ part5-observability-cd  （依赖 phase0；与其他 Part 并行）
      │
      └─ wrapup  （依赖全部 Part）
```

## 总体里程碑（对齐 spec §7）

| 日期 | 里程碑 | 对应 plan |
|---|---|---|
| 2026-04-29 | Phase 0 完成 | phase0-foundation |
| 2026-05-06 | Part 1 全完 | part1-entry |
| 2026-05-13 | Part 2 + Part 3 全完 | part2-cache + part3-response |
| 2026-05-20 | Part 4 + Part 5 全完 | part4-waf + part5-observability-cd |
| 2026-05-22 | 交付日 | wrapup |

## 执行约定

1. **每份 plan 独立可执行**：按 plan 顺序推进；完成 phase0 立即启动 part1，完成后再启动 part2，依此类推
2. **Skeleton plan 进入前先细化**：part2-5 + wrapup 在对应时间点到来时，用 `/superpowers:writing-plans` 基于当时的实际情况细化
3. **每 task 独立 commit**：遵守 spec CLAUDE.md §Commit Convention
4. **Akamai 访问铁律**：Akamai 侧只读，所有 task 禁止 Akamai mutation（见 [AKAMAI-READONLY.md](../../../AKAMAI-READONLY.md)）
5. **验证优先级**：terraform → `terraform validate` + `terraform plan`；mock server → `curl` + `pytest`；test-harness → 对应 YAML 用例跑通

## 状态跟踪

按 plan 文件内部的 `- [ ]` 复选框跟踪 task 进度。完成一份 plan 后在本索引更新状态列（ ✅ 完整详细 → ✅ 已完成 ）。
