# Cloudfront / test-harness

> 行为对比测试框架。**一键**产出 `delivery/NN-*.html §NN.4 验证证据` 所需的 diff 矩阵。

## 核心原则

- **Akamai 侧只读**：`baseline/probe.py` 启动时 assert `method in {"GET", "HEAD"}`，硬编码 User-Agent `Keithyu-Akamai-Baseline/1.0 (read-only)`，限速 ≤ 10 req/hour，运行窗口 00:00-06:00 CST
- **CloudFront 侧全场景**：`probe/probe.py` 允许破坏性用例（rate limit / WAF block / Bot）
- **YAML 驱动**：每章一个 YAML，人读可审；新增用例不改代码
- **离线可跑**：产出是 JSON + HTML，不依赖运行时服务

## 结构（待实现）

```
test-harness/
├── cases/                          # 人读的测试用例
│   ├── 01-distribution.yaml
│   ├── 02-redirect.yaml
│   ├── 03-akacache-backdoor.yaml
│   ├── 04-ttl-matrix.yaml
│   ├── 05-query-normalize.yaml
│   ├── 06-cookie-cache-key.yaml
│   ├── 07-headers-hsts.yaml
│   ├── 08-waf-policy-framework.yaml
│   ├── 09-custom-rules-asn.yaml
│   ├── 10-rate-slowpost-bot.yaml
│   ├── 11-realtime-logs.yaml
│   └── 12-tag-cd.yaml
│
├── baseline/                       # Akamai 只读
│   ├── probe.py                    # 核心：硬编码 GET-only + 限速 + UA
│   ├── guards.py                   # 硬栅栏：method / host / window
│   └── artifacts/YYYY-MM-DD/       # .gitignore 排除
│       └── NN-<chapter>.json
│
├── probe/                          # CloudFront 侧
│   ├── probe.py                    # 全场景
│   └── artifacts/YYYY-MM-DD/       # .gitignore 排除
│       └── NN-<chapter>.json
│
├── report/
│   ├── compare.py                  # diff baseline + probe，产出矩阵
│   ├── templates/
│   │   ├── chapter-matrix.html.j2
│   │   └── all-summary.html.j2
│   └── out/                        # .gitignore 排除
│       ├── NN-*-matrix.html
│       └── all-summary.html
│
├── requirements.txt                # httpx + pyyaml + jinja2 + pydantic
├── Makefile
└── README.md
```

## Makefile 主要 target

```
make baseline         # 跑 baseline/probe.py 对所有 cases/*.yaml
make probe            # 跑 probe/probe.py（全场景）
make report           # compare + 生成 HTML
make all              # baseline + probe + report
make smoke            # 只跑 smoke 用例（ch01 首页 200 OK）
```

## YAML 用例格式（规范）

```yaml
chapter: NN-<topic>
cases:
  - id: <snake-case-unique-id>
    description: "人话一句描述"
    request:
      url: "https://{host}/path?query=x"
      method: GET                  # 默认 GET，baseline 只允许 GET/HEAD
      headers:                     # 可选
        User-Agent: "..."
        Cookie: "key=value"
    expectations:
      status: 200                  # 可选：期望状态码
      status_in: [200, 302]        # 可选：期望落在集合
      location_regex: "^https://..."  # 可选：期望 Location 头匹配
      header_equals:               # 可选：期望响应头精确值
        Cache-Control: "max-age=21600"
      header_contains:             # 可选：期望响应头包含
        Surrogate-Key: "bf-all"
      body_contains: "..."         # 可选：期望 body 包含字符串
    hosts:                         # 必需：指定 baseline 和 probe 打哪个 host
      akamai: www.beautyforever.com          # 生产域名（只打读取类）
      cloudfront: www.beautyforever.keithyu.cloud
    tags:                          # 可选：用于筛选
      - destructive                # 会打破坏性流量，baseline 永远不跑
      - smoke                      # smoke 测试集
```

## 产出：diff 矩阵

每章一张表：

| Case | Akamai 实测 | CloudFront 实测 | 一致？ | 备注 |
|---|---|---|---|---|
| pc-ua-to-m-302 | 302 → m.beautyforever.com | 302 → m.beautyforever.keithyu.cloud | ✅ | 域名不同但结构一致 |
| lqpasswaf-ua-no-redirect | 200 | 200 | ✅ | |
| rate-limit-page-view | (跳过：destructive) | 429 (满足 Akamai 阈值 15/25) | 🟡 rule-tree 推导 | |

## 章节对应

详见 [`docs/superpowers/specs/2026-04-22-akamai-to-aws-longqi-design.md`](../../docs/superpowers/specs/2026-04-22-akamai-to-aws-longqi-design.md) §6。
