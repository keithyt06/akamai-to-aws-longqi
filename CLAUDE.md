# Project Rules — akamai-to-aws-longqi

> This file is loaded by Claude Code into every session that works in this repository. Rules here **override** global defaults.

## Project Context

AWS solution architect POC that proves **CloudFront + AWS WAF** can equivalently replace the customer's Akamai configuration for `beautyforever.com` (Xuchang Longqi E-Commerce Co., Ltd.). Output: runnable POC + handover-grade code + customer-facing delivery documents, target delivery **2026-05-22**.

Ground truth for the Akamai side lives in `Akamai/doc/` (live audit performed 2026-04-21). AWS side is built from scratch under `Cloudfront/`.

## Hard Rules

### 1. Akamai is READ-ONLY

See [AKAMAI-READONLY.md](./AKAMAI-READONLY.md). **No mutations** to the customer's Akamai account. Ever. Any script that calls Akamai must assert HTTP method ∈ {GET, HEAD}.

### 2. No references to / copies from the old project

`/root/keith-space/2026-project/longqi-cloudfront/` is a separate project. This project is independent. **Do not** import files, reuse assets, or cite it as dependency. The user chose "平行独立" (parallel independent). OK to consult the old project when brainstorming, but never when writing this project's files.

### 3. HTTP/2 only on CloudFront (no HTTP/3)

CloudFront Continuous Deployment requires `HttpVersion = http2`. Since Chapter 12 delivers CICD as a migration upgrade, all Distributions are locked to HTTP/2. This is a documented trade-off — the Akamai side had HTTP/3 enabled. Explain this to the customer in delivery §01.3.

### 4. Real-time Logs must target Doris on EC2

Customer's current stack: CloudFront Real-time Logs → Kinesis Data Stream → Python consumer → **Doris single-node on EC2**. Chapter 11 follows this architecture exactly — do not substitute with S3 + Athena or OpenSearch unless the customer explicitly asks.

### 5. Origin is a single EC2

Phase 0 stands up **one** EC2 instance (not three). A single Node.js process listens on three ports (or uses Host-based virtual hosts); one ALB with three Host-based listener rules routes `www / m / api.beautyforever.keithyu.cloud` to that EC2. The point is cheap demo, not production fidelity.

### 6. Verification is one-sided

Akamai side: baseline only (read GET, no writes). CloudFront side: full testing including destructive scenarios (rate limit / WAF block / Bot). "Equivalence" is proven by: (Akamai rule tree + customer DataStream samples) vs (CloudFront live test matrix). Do **not** send destructive traffic to the customer's Akamai production.

## Implementation Priorities

| Priority | Scope |
|---|---|
| P0 (必须) | Chapters 01–10. Cache / redirects / WAF basics. If this doesn't work the migration story falls apart. |
| P1 (强烈推荐) | Chapter 11 (Real-time Logs → Doris), Chapter 12 (Tag-Based Invalidation + CICD). Migration value-adds. |
| P2 (可延后) | Akamai `Advanced` XML metadata replication. Declare as unparsed in delivery §01.5. |

## Commit Convention

- Commits in English; docs in Chinese
- Subject line imperative, ≤ 72 chars
- Body explains **why**, not **what** (the diff shows what)
- Trailer: `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` on Claude-assisted commits
- Never skip hooks (`--no-verify`) unless the user explicitly asks

## Repository Layout

See [README.md](./README.md) and [docs/superpowers/specs/2026-04-22-akamai-to-aws-longqi-design.md](./docs/superpowers/specs/2026-04-22-akamai-to-aws-longqi-design.md).

## Available Skills

All gstack skills inherited from `/root/CLAUDE.md` remain available: `/browse`, `/qa`, `/ship`, `/review`, `/cso`, etc. For planning work on this project prefer `/superpowers:brainstorming` and `/superpowers:writing-plans`.
