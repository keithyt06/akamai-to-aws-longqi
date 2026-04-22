# Cloudfront / terraform

> 可交接给客户的 IaC。**单 `terraform apply`** 从零拉起 POC 环境。

## 目标

30 分钟内在新 AWS 账号 `apply` 成功，启动完整 POC：
- Route53 记录 + ACM 证书（`us-east-1`）
- 1 EC2 + 1 ALB（源站）
- 2 CloudFront Distribution（essl + api）
- 3 AWS WAF Web ACL（`us-east-1`）
- 12 个 CloudFront Functions（cookie cache key、redirect、query normalize、backdoor、surrogate-key）
- Response Headers Policy、Cache Policy、Origin Request Policy
- Kinesis Data Stream + Python consumer + Doris on EC2
- Continuous Deployment Policy（ch12）

## 结构（待实现）

```
terraform/
├── main.tf                  # providers (ap-northeast-1, us-east-1), backend
├── variables.tf
├── outputs.tf
├── terraform.tfvars.example
│
├── modules/
│   ├── acm/                 # us-east-1 证书 × 3
│   ├── route53/             # 3 子域记录
│   ├── origin-ec2/          # 1 EC2 + 1 ALB + 3 host-based rules + TG + SG
│   ├── cloudfront-www/      # essl 等价 (www + m)
│   ├── cloudfront-api/      # api 等价
│   ├── cloudfront-functions/ # 章节 02/03/04/05/06/07 的 CF Functions
│   ├── waf/                 # 3 Web ACL + Custom Rules + Rate + Bot
│   ├── realtime-logs/       # Kinesis + IAM + Kinesis Firehose (到 Doris consumer EC2)
│   ├── doris/               # Doris 单机 EC2 + systemd
│   └── log-consumer/        # Python consumer EC2 + systemd
│
└── environments/
    └── poc/
        ├── backend.tf       # S3 + DynamoDB lock
        ├── main.tf          # 组合 modules
        ├── variables.tf
        └── terraform.tfvars # 实际值（.gitignore 已排除，使用 .example 作模板）
```

## Provider 配置

两个 region：
- `ap-northeast-1`（主）：EC2 / ALB / Route53 / Kinesis / Doris
- `us-east-1`（aliased）：CloudFront 所需的 ACM、AWS WAF Web ACL

## 关键约束

1. **HTTP/2 only** — `HttpVersion = "http2"` 在 `cloudfront-www` 和 `cloudfront-api` 模块里硬编码（ch12 CICD 要求），不暴露为 variable
2. **Real-time Logs 必须接 Doris** — 不替换为 S3+Athena（对齐客户现状）
3. **单 EC2 源站** — `origin-ec2` 模块默认 `instance_count = 1`，不要求多可用区
4. **只读访问** — 不创建任何 Akamai 相关资源；不调用 Akamai API

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
