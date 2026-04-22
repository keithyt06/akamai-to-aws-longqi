# Part 5 · 可观测 + 迁移红利实施计划（ch11-12）· Skeleton

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

> **⚠ 本 plan 为 Skeleton**：task 级别清晰，进入 Part 5 前用 `/superpowers:writing-plans` 细化到 2-5 分钟 sub-step 粒度。

**Goal:** (ch11) 把 CloudFront Real-time Logs 打通到 Kinesis Data Stream → Python consumer → Doris（对齐客户生产链路）。(ch12) 实现 Tag-Based Invalidation（Surrogate-Key + invalidation-for-distribution-tenant API）+ Continuous Deployment（primary + staging + CDP 蓝绿灰度）——两项都是 CloudFront 2024-2025 相对 Akamai 的新能力。

**Architecture:** ch11 在 Phase 0 基础上把 Real-time Logs Config 创建并挂到 2 个 Distribution；Python consumer 从 KDS 读记录、解析、写入 Doris 表（`cf_access_log`）；提供 SQL dashboard 样例。ch12 在 mock 源站输出 `Surrogate-Key`响应头（ch04 已经输出 Cache-Control，ch12 补 Surrogate-Key），写一个 shell 脚本用 `aws cloudfront` CLI 按 key 失效；再为 2 个 Distribution 启用 CloudFront Continuous Deployment 创建 staging Distribution + CDP。

**Tech Stack:** CloudFront Real-time Logs · Kinesis Data Stream · Python + boto3 + pymysql · Doris · CloudFront CD Policy · Surrogate-Key / Tag-Based Invalidation API (2024)

**Spec reference:** [`../specs/2026-04-22-akamai-to-aws-longqi-design.md`](../specs/2026-04-22-akamai-to-aws-longqi-design.md) §5.1 Part 5

**Prerequisite:** Phase 0 完成（Kinesis + Doris + log-consumer 骨架已在）。Part 5 可与 Part 1-4 并行，但 ch12 的 CD 依赖 ch01 Distribution 配置已稳定。

---

## 文件结构

```
Cloudfront/
├── terraform/modules/
│   ├── realtime-logs/                 ← 扩展：加 LogDeliveryConfig 挂 Distribution
│   ├── log-consumer/                  ← 扩展：真实 Python consumer 代码
│   ├── cloudfront-www/main.tf         ← 加 realtime_log_config_arn
│   ├── cloudfront-api/main.tf         ← 加 realtime_log_config_arn
│   └── continuous-deployment/         ← 新增 module
│       ├── main.tf
│       ├── variables.tf
│       └── outputs.tf
│
├── log-consumer/                      ← 新增独立目录（源码 cloned to EC2）
│   ├── consumer.py
│   ├── schema.sql
│   ├── requirements.txt
│   └── README.md
│
├── beautyforever/routes/
│   ├── www.js / m.js                  ← 加 Surrogate-Key 响应头
│   └── api.js                         ← 同上
│
├── scripts/
│   └── invalidate-by-tag.sh           ← 新增：按 Surrogate-Key 调 invalidation API
│
├── hands-on/
│   ├── 11-realtime-logs-doris.md
│   └── 12-tag-invalidation-cd.md
│
├── delivery/
│   ├── 11-realtime-logs-doris.md + .html
│   └── 12-tag-invalidation-cd.md + .html
│
└── test-harness/cases/
    ├── 11-realtime-logs.yaml
    └── 12-tag-cd.yaml
```

---

## Task 21：ch11 · Real-time Logs → Kinesis → Python → Doris

### Sub-tasks (skeleton)

- [ ] **21.1 写 Doris schema `log-consumer/schema.sql`**：

  ```sql
  CREATE DATABASE IF NOT EXISTS bf_cdn;
  USE bf_cdn;

  CREATE TABLE IF NOT EXISTS cf_access_log (
    ts               DATETIME,
    request_id       VARCHAR(64),
    distribution_id  VARCHAR(32),
    edge_location    VARCHAR(16),
    host             VARCHAR(128),
    method           VARCHAR(8),
    uri              VARCHAR(2048),
    status           INT,
    bytes_sent       BIGINT,
    client_ip        VARCHAR(64),
    ua_sample        VARCHAR(512),
    referer          VARCHAR(1024),
    cache_status     VARCHAR(16),
    surrogate_keys   VARCHAR(1024)
  )
  DUPLICATE KEY(ts, request_id)
  DISTRIBUTED BY HASH(request_id) BUCKETS 4
  PROPERTIES ("replication_num" = "1");
  ```

- [ ] **21.2 写 Python consumer `log-consumer/consumer.py`**：

  ```python
  """Consumes CloudFront Real-time Logs from Kinesis, writes to Doris."""
  import os, time, json, base64
  import boto3
  import pymysql

  STREAM_NAME = os.environ['KINESIS_STREAM_NAME']
  DORIS_HOST  = os.environ['DORIS_HOST']
  DORIS_USER  = os.environ.get('DORIS_USER', 'root')
  DORIS_PWD   = os.environ.get('DORIS_PWD', '')

  FIELDS = [
      'timestamp', 'c-ip', 'cs-method', 'cs-uri-stem',
      'sc-status', 'sc-bytes', 'cs-user-agent', 'cs-referer',
      'x-edge-location', 'x-edge-request-id',
      'x-host-header', 'x-edge-response-result-type',
      'cs-uri-query'
  ]

  def parse_record(line: str) -> dict:
      parts = line.rstrip('\n').split('\t')
      rec = dict(zip(FIELDS, parts))
      return {
          'ts':              rec.get('timestamp'),
          'request_id':      rec.get('x-edge-request-id'),
          'edge_location':   rec.get('x-edge-location'),
          'host':            rec.get('x-host-header'),
          'method':          rec.get('cs-method'),
          'uri':             rec.get('cs-uri-stem') + ('?' + rec.get('cs-uri-query', '') if rec.get('cs-uri-query') else ''),
          'status':          int(rec.get('sc-status', 0)),
          'bytes_sent':      int(rec.get('sc-bytes', 0)),
          'client_ip':       rec.get('c-ip'),
          'ua_sample':       rec.get('cs-user-agent', '')[:500],
          'referer':         rec.get('cs-referer', ''),
          'cache_status':    rec.get('x-edge-response-result-type', ''),
          'surrogate_keys':  '',  # fill from response log fields if configured
      }

  def main():
      kinesis = boto3.client('kinesis')
      shards = kinesis.describe_stream(StreamName=STREAM_NAME)['StreamDescription']['Shards']
      iterators = {
          s['ShardId']: kinesis.get_shard_iterator(
              StreamName=STREAM_NAME, ShardId=s['ShardId'],
              ShardIteratorType='LATEST'
          )['ShardIterator']
          for s in shards
      }

      conn = pymysql.connect(host=DORIS_HOST, port=9030, user=DORIS_USER, password=DORIS_PWD,
                              database='bf_cdn', autocommit=True)

      while True:
          for shard_id, it in list(iterators.items()):
              resp = kinesis.get_records(ShardIterator=it, Limit=500)
              records = resp['Records']
              for r in records:
                  payload = r['Data'].decode('utf-8') if isinstance(r['Data'], bytes) else r['Data']
                  for line in payload.split('\n'):
                      if not line.strip(): continue
                      row = parse_record(line)
                      with conn.cursor() as cur:
                          cur.execute("""
                            INSERT INTO cf_access_log (ts, request_id, edge_location, host, method, uri,
                                                      status, bytes_sent, client_ip, ua_sample, referer,
                                                      cache_status, surrogate_keys)
                            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                          """, tuple(row.values()))
              iterators[shard_id] = resp['NextShardIterator']
          time.sleep(1)

  if __name__ == '__main__':
      main()
  ```

  `requirements.txt`:
  ```
  boto3==1.35.0
  pymysql==1.1.1
  ```

- [ ] **21.3 扩展 `realtime-logs` module**：创建 `aws_cloudfront_realtime_log_config`，字段选上面 parser 需要的 13 项。

  ```hcl
  resource "aws_cloudfront_realtime_log_config" "this" {
    name          = "${var.project_name}-cf-realtime"
    sampling_rate = 100

    fields = [
      "timestamp", "c-ip", "cs-method", "cs-uri-stem", "sc-status", "sc-bytes",
      "cs-user-agent", "cs-referer", "x-edge-location", "x-edge-request-id",
      "x-host-header", "x-edge-response-result-type", "cs-uri-query"
    ]

    endpoint {
      stream_type = "Kinesis"
      kinesis_stream_config {
        role_arn   = aws_iam_role.realtime_logs.arn
        stream_arn = aws_kinesis_stream.cf_logs.arn
      }
    }
  }

  output "log_config_arn" { value = aws_cloudfront_realtime_log_config.this.arn }
  ```

- [ ] **21.4 把 log_config attach 到 Distribution**：
  `cloudfront-www/variables.tf`、`main.tf` 加 `realtime_log_config_arn`；在 `default_cache_behavior` 里设 `realtime_log_config_arn = var.realtime_log_config_arn`。root 传值。cloudfront-api 同理。

- [ ] **21.5 把 consumer 部署上 log-consumer EC2**：替换 Phase 0 的 placeholder systemd service，改为 `ExecStart=/usr/bin/python3.11 /home/ec2-user/repo/Cloudfront/log-consumer/consumer.py`，并传 env var（`KINESIS_STREAM_NAME`、`DORIS_HOST`）。

- [ ] **21.6 对应 Doris 初始化**：在 user-data 里 `mysql -uroot -h$DORIS_HOST -P9030 < /repo/log-consumer/schema.sql`。

- [ ] **21.7 test-harness 用例（5 条）**：
  - 打一次 `curl https://www.beautyforever.keithyu.cloud/` 后等 60 秒，查询 Doris `SELECT COUNT(*) FROM cf_access_log WHERE host='www.beautyforever.keithyu.cloud' AND ts > NOW() - INTERVAL 2 MINUTE` > 0
  - 打带 `?akaCache=nce` 的请求，验证 `cache_status = Miss` 入库
  - ...

- [ ] **21.8 delivery md**：对照表

  | Akamai DataStream | AWS 对应 |
  |---|---|
  | DataStream v2 | CloudFront Real-time Logs |
  | Edge 侧缓冲输出 | Kinesis Data Stream 1 shard (on-demand) |
  | 消费到内部系统 | Python consumer on EC2 |
  | 客户生产用 Doris 存储 | **同** Doris（对齐现状） |
  | 可视化 / 告警 | Doris + MySQL client 或 Grafana/Superset（客户侧已有） |

  Akamai 现状调研里提到 DataStream 已启用（essl §16），我们的 consumer 结构和客户已有管道对齐，迁移成本极低。

- [ ] **21.9 commit**：`ch11: realtime logs config + kds + python consumer + doris schema + 5 tests`

**验收信号**：
- 访问 3 个演示域名后，Doris 里 1 分钟内能查到对应记录
- `SELECT status, count(*) FROM cf_access_log GROUP BY status` 有合理分布

---

## Task 22：ch12 · Tag-Based Invalidation + Continuous Deployment

### Sub-tasks (skeleton)

- [ ] **22.1 mock 输出 Surrogate-Key 头**：

  **Surrogate-Key mapping**（对齐 Akamai cacheTag，**含 ch07 Js tag 归并过来的 `bf-www-js` / `bf-m-js`**）：

  | 路径 | www host 的 Surrogate-Key | m host 的 Surrogate-Key | Akamai 依据 |
  |---|---|---|---|
  | `/` | `bf-all bf-home` | 同 | essl §7 首页 |
  | `/blog` (列表) | `bf-blog bf-blog-list` | 同 | essl §7 博客 |
  | `/blog/:slug` | `bf-blog bf-blog-<slug>` | 同 | essl §7 博客详情 |
  | `/activity*` | `bf-all bf-activity` | 同 | essl §7 活动 |
  | `*.html`（其他）| `bf-all bf-listinfo` | 同 | essl §7 列表&详情 |
  | **`*.js`（静态）** | **`bf-www-js`** | **`bf-m-js`** | essl §11 Js tag（ch07 归并） |

  ```javascript
  // www.js
  router.get('/', (_req, res) => {
    res.setHeader('Surrogate-Key', 'bf-all bf-home');
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=2160, stale-if-error=60, max-age=0');
    res.type('text/html').send(...);
  });

  router.get('/blog', (_req, res) => {
    res.setHeader('Surrogate-Key', 'bf-blog bf-blog-list');
    res.setHeader('Cache-Control', 's-maxage=31536000, stale-while-revalidate=86400, stale-if-error=60, max-age=0');
    res.type('text/html').send(...);
  });

  router.get('/blog/:slug', (req, res) => {
    res.setHeader('Surrogate-Key', `bf-blog bf-blog-${req.params.slug}`);
    res.setHeader('Cache-Control', 's-maxage=31536000, stale-while-revalidate=86400, stale-if-error=60, max-age=0');
    res.type('text/html').send(...);
  });

  router.get(/^\/activity(?:-|\/).*$/, (req, res) => {
    res.setHeader('Surrogate-Key', 'bf-all bf-activity');
    res.type('text/html').send(...);
  });

  router.get(/\.html$/, (req, res) => {
    res.setHeader('Surrogate-Key', 'bf-all bf-listinfo');
    res.type('text/html').send(...);
  });

  // New: Js tag mapped from Akamai essl §11 (confirmed 2026-04-22 via raw JSON)
  router.get(/\.js$/, (req, res) => {
    res.setHeader('Surrogate-Key', 'bf-www-js');
    res.setHeader('Cache-Control', 's-maxage=31536000, stale-while-revalidate=86400, max-age=31536000');
    res.type('application/javascript').send('// bf-www-js asset');
  });
  ```

  `m.js` 对应的 `.js` route Surrogate-Key 值改为 `bf-m-js`。

  5 个标签对齐 Akamai：`bf-all / bf-home / bf-blog (+slug) / bf-listinfo / bf-activity`

- [ ] **22.2 写 `scripts/invalidate-by-tag.sh`**：
  ```bash
  #!/bin/bash
  set -eux
  : ${DIST_ID:?required}
  : ${TAG:?required}

  aws --profile default --region us-east-1 cloudfront create-invalidation-for-distribution-tenant \
    --distribution-tenant-id "$DIST_ID" \
    --invalidation-batch "Paths={Quantity=1,Items=[\"*\"]},CallerReference=$(date +%s),InvalidationScope={ItemType=SURROGATE_KEY,ItemValue=\"$TAG\"}"
  ```

  **注意**：API 名和参数在 AWS SDK 2025 年变动过，Part 5 开始前先 `aws cloudfront help` 确认最新。如果本 POC 演示时 API 还在 Preview，fallback 到 path-based invalidation `aws cloudfront create-invalidation --distribution-id $DIST --paths "/blog/*"`，delivery 说明"Tag-based 和 path-based 等效演示"。

- [ ] **22.3 CloudFront Continuous Deployment**：

  `terraform/modules/continuous-deployment/main.tf`:

  ```hcl
  variable "primary_distribution_ids" {
    type = map(string)  # { www = "EXXX", api = "EYYY" }
  }

  resource "aws_cloudfront_distribution" "staging" {
    # Clone of primary, with staging = true
    for_each = var.primary_distribution_ids
    # ... (copy primary config, set staging = true)
  }

  resource "aws_cloudfront_continuous_deployment_policy" "this" {
    for_each = var.primary_distribution_ids
    enabled  = var.enable_cd

    staging_distribution_dns_names {
      quantity = 1
      items    = [aws_cloudfront_distribution.staging[each.key].domain_name]
    }

    traffic_config {
      type = "SingleWeight"
      single_weight_config {
        weight = 0.05   # 5% to staging
      }
    }
  }
  ```

  **Terraform 限制**：CD Policy 需要和 primary distribution 的 `continuous_deployment_policy_id` 两者相互引用——按 AWS 文档，先建 primary (无 CDP)、再建 staging、再建 CDP、再 modify primary 挂 CDP。这在 Terraform 里是多阶段 apply。用 `var.enable_continuous_deployment = false` 作为默认，两阶段 apply。

- [ ] **22.4 手工验证 CD**：`aws cloudfront get-continuous-deployment-policy --id $CDP_ID`；用 `Cloudfront-Viewer-TLS` header 强制走 staging。

- [ ] **22.5 test-harness 用例（5 条）**：
  ```yaml
  - id: surrogate-key-on-home
    description: "首页响应含 Surrogate-Key: bf-all bf-home"
    expectations: { header_contains: { Surrogate-Key: "bf-home" } }
  - id: surrogate-key-on-blog
    ...
  - id: invalidate-by-tag-works
    description: "运行 invalidate-by-tag.sh 后 /blog 响应 X-Cache: Miss"
    # 特殊逻辑：probe.py 里运行子脚本再请求
  - id: cd-staging-distribution-present
    description: "CDP enabled 后 staging distribution ID 存在"
  ```

- [ ] **22.6 delivery md**：这一章是"迁移红利"：
  - Tag Invalidation 等价 Akamai Fast Purge by Tag（`cacheTag` + `Edge-Cache-Tag` / Surrogate-Key）
  - CD 是 Akamai 无原生等价的能力；客户迁移后可以在 primary/staging 间灰度（0-15% 权重）做 **蓝绿发布**

- [ ] **22.7 commit**：`ch12: surrogate-key via mock + invalidate-by-tag script + continuous deployment + 5 tests`

**验收信号**：
- `curl -sI https://www.beautyforever.keithyu.cloud/` 返回 `Surrogate-Key: bf-all bf-home`
- 运行 `DIST_ID=... TAG=bf-blog ./scripts/invalidate-by-tag.sh` 后再打 `/blog/*` 第一次 MISS
- `aws cloudfront get-continuous-deployment-policy` 看到启用状态

---

## Part 5 完成里程碑

**日期**：2026-05-20

- [ ] Task 21: ch11 Real-time Logs → Doris · 日志能查到
- [ ] Task 22: ch12 Tag Invalidation + CD · 两个新能力演示可跑

## 更新 index
把 part5 状态改为 `✅ 已完成`。

## 下一步
执行 [`2026-04-22-akamai-to-aws-longqi-wrapup.md`](./2026-04-22-akamai-to-aws-longqi-wrapup.md)（skeleton）。
