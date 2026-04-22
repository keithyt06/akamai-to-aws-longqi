# Cloudfront / terraform

> 可交接给客户的 IaC。**单 `terraform apply`** 从零拉起 POC 环境。

## 目标

30 分钟内在新 AWS 账号 `apply` 成功，启动完整 POC（2026-04-22 客户 4 轮决策后最终形态）：
- Route53 记录（customer U6：`keithyu.cloud` hosted zone 已存在）
- ACM 证书（`us-east-1`，customer U6：已存在，用 `data "aws_acm_certificate"` 引用；SAN 覆盖 3 个域名）
- 1 EC2（`t3.xlarge`，customer U2）+ 1 ALB（按 `X-Viewer-Host` header 分流，非 Host header）
- **2 个** CloudFront Distribution（customer Q1 round-4）：`www + m` 共用 1 个（aliases 数组），`api` 独立 1 个
  - `HttpVersion = http2` 硬编码（CICD 前置）
  - Origin Shield **默认关闭**（customer T2，variable `origin_shield_enabled = false`）
- **3 个 AWS WAF Web ACL**（deny / alert / api）+ **1 个共享 Rule Group** 打包 6 个 Managed Rule Group（`CommonRuleSet / SQLiRuleSet / KnownBadInputsRuleSet / LinuxRuleSet / UnixRuleSet / PHPRuleSet`，customer T8）
- **2 个 CloudFront Functions**（单 viewer-request Function 合并 6 职责；viewer-response 按需）：
  - viewer-request：注入 `X-Viewer-Host` + ch02 PC↔M redirect + ch03 `?akaCache=nce` + ch05 query normalize（含 utm_source 白名单）+ ch06 cookie cache key + ch07 True-Client-IP
- **7 个 CachePolicy**（按 10 条 ordered_cache_behavior 分配）：home-6h / listinfo-6h / activity-6h / blog-365d (whitelist `page + __utm_whitelisted`) / assets-365d / static-only-path / api-default
- **2 个 Response Headers Policy**（www/m 删 Vary；api 保留 Vary；两者都加 HSTS `max-age=2y + includeSubDomains` 但**无 preload**，customer T12；加 `Timing-Allow-Origin: *`）
- Kinesis Data Stream + Python consumer（EC2）+ **Doris 单机**（`t3.xlarge`，customer U3）on EC2
- Continuous Deployment Policy（ch12 蓝绿灰度）

## 结构（待实现）

```
terraform/
├── main.tf                  # providers (ap-northeast-1, us-east-1), backend
├── variables.tf
├── outputs.tf
├── terraform.tfvars.example
│
├── modules/
│   ├── acm/                 # data source 引用已有证书（customer U6）
│   ├── route53/             # 3 子域 A 记录 (alias to CloudFront)
│   ├── origin-ec2/          # 1 EC2 t3.xlarge + 1 ALB + X-Viewer-Host listener rules + TG + SG
│   ├── cloudfront-www/      # essl 等价 (www + m aliases)
│   ├── cloudfront-api/      # api 等价
│   ├── cloudfront-functions/# 单 viewer-request Function (phase0 + ch02-07 合并)
│   ├── cache-policies/      # 7 个 CachePolicy 集中定义
│   ├── response-headers/    # 2 个 Response Headers Policy (www vs api)
│   ├── waf/                 # 3 Web ACL + Custom Rules + Rate + Bot Common/Targeted
│   ├── waf-managed-rules/   # 独立 Rule Group 打包 6 MRG (规避 WCU 超限)
│   ├── realtime-logs/       # Kinesis Data Stream + IAM + Real-time Log Config
│   ├── doris/               # Doris 单机 EC2 t3.xlarge + systemd
│   ├── log-consumer/        # Python consumer EC2 + systemd
│   └── continuous-deployment/ # ch12 primary+staging+CDP
│
└── environments/
    └── poc/
        ├── backend.tf       # S3 + DynamoDB lock
        ├── main.tf          # 组合 modules
        ├── variables.tf
        └── terraform.tfvars # 实际值（.gitignore 已排除；用 .example 作模板）
```

## Provider 配置

两个 region：
- `ap-northeast-1`（主）：EC2 / ALB / Route53 / Kinesis / Doris
- `us-east-1`（aliased）：CloudFront 所需的 ACM、AWS WAF Web ACL + Rule Group

## 关键约束

1. **HTTP/2 only** — `HttpVersion = "http2"` 在 `cloudfront-www` 和 `cloudfront-api` 模块里硬编码（ch12 CICD 要求），不暴露为 variable
2. **Real-time Logs 必须接 Doris** — 不替换为 S3+Athena（对齐客户现状 customer U3）
3. **单 EC2 源站 `t3.xlarge`** — `origin-ec2` 模块默认 `instance_count = 1, instance_type = "t3.xlarge"`
4. **ALB 按 `X-Viewer-Host` header 分流** — **不是** Host header（CloudFront 不透传 viewer Host）；viewer-request Function 注入此 header
5. **Distribution 数量 = 2** — `www + m` 共用，`api` 独立（customer Q1 round-4）；**不要拆成 3 个**
6. **Origin Shield 默认关闭** — `var.origin_shield_enabled = false`（customer T2）
7. **只读访问** — 不创建任何 Akamai 相关资源；不调用 Akamai API

## 状态管理

- Backend：S3 bucket + DynamoDB lock table（Phase 0 手动创建一次）
- `.tfstate` / `.tfplan` 在 `.gitignore` 中，**不入库**
- `terraform.tfvars`（含 AWS Account ID、敏感参数）**不入库**；使用 `terraform.tfvars.example` 作公开模板

## 快速开始（待完善）

```bash
cd environments/poc
cp terraform.tfvars.example terraform.tfvars
# 编辑 terraform.tfvars 填入账号和值
terraform init
terraform plan
terraform apply
```

## 章节对应

详见 [`docs/superpowers/specs/2026-04-22-akamai-to-aws-longqi-design.md`](../../docs/superpowers/specs/2026-04-22-akamai-to-aws-longqi-design.md) §5.5。
