# Phase 0 基建实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭起整个 POC 的基础设施骨架——tfstate、Route53、ACM、源站 EC2+ALB、Node.js mock、两个 CloudFront Distribution、三个空 WAF Web ACL、Doris 单机、Kinesis Data Stream + Python consumer、test-harness 骨架、delivery 骨架。完成后 `terraform apply` 零错误、3 个演示域名能 HTTPS 访问 mock 的 "Hello from mock" 首页。

**Architecture:** Terraform monorepo（`environments/poc/` 组装 modules），Provider 双区（`ap-northeast-1` 主 + `us-east-1` aliased 用于 ACM 和 CloudFront WAF）。源站单 EC2（t3.small），Node.js 单进程按 Host header 分流。CloudFront 2 个 Distribution（www/m 共用一个，api 一个），`HttpVersion = http2` 硬编码。WAF 3 个空 Web ACL associate 到 Distribution。Doris 单机 EC2（t3.xlarge），Kinesis + Python consumer 骨架。

**Tech Stack:** Terraform ≥ 1.5 · AWS Provider ≥ 5.0 · Node.js ≥ 20 · Express · Python 3.11 + httpx + pyyaml + jinja2 · Doris 2.1（单机模式）

**Spec reference:** [`../specs/2026-04-22-akamai-to-aws-longqi-design.md`](../specs/2026-04-22-akamai-to-aws-longqi-design.md) §4

---

## 前置假设（执行 Task 01 前必须确认）

| # | 项 | 如何获取 |
|---|---|---|
| P1 | AWS 账号 ID | `aws sts get-caller-identity --query Account --output text` |
| P2 | AWS profile 名 | `~/.aws/credentials` 里配好的 profile；默认 `default` |
| P3 | `keithyu.cloud` hosted zone 在 Route53 | `aws route53 list-hosted-zones --query "HostedZones[?Name=='keithyu.cloud.'].Id"` |
| P4 | `/root/.edgerc` 存在并可读 | `ls -l /root/.edgerc` |

如果 P3 返回空，说明 hosted zone 不在 AWS Route53，需要先迁移或修改 spec 切换到别的 DNS provider。本 plan 假设 P3 已满足。

---

## 文件结构（Phase 0 完成后的状态）

```
Cloudfront/terraform/
├── main.tf                            # root: providers、locals、共享数据源
├── variables.tf                       # root 变量（account_id / region / project_name / …）
├── outputs.tf                         # root 输出（3 域名 DNS、CloudFront Domain、Distribution IDs）
├── terraform.tfvars.example           # 公开模板
├── environments/poc/
│   ├── backend.tf                     # S3+DynamoDB backend
│   ├── main.tf                        # 组装 modules
│   ├── variables.tf
│   └── terraform.tfvars.example
└── modules/
    ├── acm/                           # 3 证书 us-east-1
    ├── route53/                       # 3 A record（alias to CloudFront）
    ├── origin-ec2/                    # EC2 + ALB + SG + TG + listener rules
    ├── cloudfront-www/                # www + m 共用一个 Distribution
    ├── cloudfront-api/                # api 独立
    ├── waf/                           # 3 空 Web ACL（us-east-1，scope CLOUDFRONT）
    ├── doris/                         # Doris 单机 EC2
    ├── realtime-logs/                 # Kinesis Data Stream + IAM
    └── log-consumer/                  # Python consumer EC2

Cloudfront/beautyforever/
├── server.js                          # Express app，按 Host header 分流
├── package.json
├── routes/
│   ├── www.js
│   ├── m.js
│   └── api.js
├── middleware/                        # Phase 0 只建空目录
└── deploy/
    └── ec2-user-data.sh               # terraform 调用

Cloudfront/test-harness/
├── cases/
│   └── 00-smoke.yaml                  # Phase 0 只放 smoke 用例
├── baseline/
│   ├── probe.py
│   └── guards.py
├── probe/probe.py
├── report/
│   ├── compare.py
│   └── templates/chapter-matrix.html.j2
├── requirements.txt
├── Makefile
└── pyproject.toml

Cloudfront/delivery/
├── index.html                         # 入口 + 12 章节占位导航
├── assets/
│   ├── style.css                      # 深色 AWS 主题
│   └── app.js                         # 空骨架
└── 01..12 章节 md 占位（内容 "Pending Part N"）
```

---

## Task 01：Terraform 仓库结构 & Backend 初始化

**目标**：建立 Terraform root 模块、双 provider（`ap-northeast-1` + `us-east-1` alias）、S3+DynamoDB backend。`terraform init` 能通。

**Files:**
- Create: `Cloudfront/terraform/main.tf`
- Create: `Cloudfront/terraform/variables.tf`
- Create: `Cloudfront/terraform/outputs.tf`
- Create: `Cloudfront/terraform/terraform.tfvars.example`
- Create: `Cloudfront/terraform/environments/poc/backend.tf`
- Create: `Cloudfront/terraform/environments/poc/main.tf`
- Create: `Cloudfront/terraform/environments/poc/variables.tf`
- Create: `Cloudfront/terraform/environments/poc/terraform.tfvars.example`

### Steps

- [ ] **Step 1.1：手动创建 tfstate backend**（AWS CLI，不在 Terraform 里）

    用户需要先跑一次（这是 chicken-and-egg 问题，backend 必须先存在）：

    ```bash
    AWS_PROFILE=default
    AWS_REGION=ap-northeast-1
    ACCOUNT_ID=$(aws --profile $AWS_PROFILE sts get-caller-identity --query Account --output text)
    BUCKET_NAME="tfstate-akamai-to-aws-longqi-${ACCOUNT_ID}"
    LOCK_TABLE="tfstate-lock-akamai-to-aws-longqi"

    aws --profile $AWS_PROFILE --region $AWS_REGION s3api create-bucket \
      --bucket $BUCKET_NAME \
      --create-bucket-configuration LocationConstraint=$AWS_REGION

    aws --profile $AWS_PROFILE --region $AWS_REGION s3api put-bucket-versioning \
      --bucket $BUCKET_NAME --versioning-configuration Status=Enabled

    aws --profile $AWS_PROFILE --region $AWS_REGION s3api put-bucket-encryption \
      --bucket $BUCKET_NAME --server-side-encryption-configuration \
      '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

    aws --profile $AWS_PROFILE --region $AWS_REGION dynamodb create-table \
      --table-name $LOCK_TABLE \
      --attribute-definitions AttributeName=LockID,AttributeType=S \
      --key-schema AttributeName=LockID,KeyType=HASH \
      --billing-mode PAY_PER_REQUEST

    echo "BUCKET=$BUCKET_NAME"
    echo "LOCK=$LOCK_TABLE"
    ```

    **预期输出**：bucket + table 创建成功，最后两行输出供 Step 1.3 填入。

- [ ] **Step 1.2：写 root providers**

    `Cloudfront/terraform/main.tf`:

    ```hcl
    terraform {
      required_version = ">= 1.5"
      required_providers {
        aws = {
          source  = "hashicorp/aws"
          version = ">= 5.30"
        }
      }
    }

    provider "aws" {
      region  = var.region_primary
      profile = var.aws_profile
      default_tags {
        tags = {
          Project   = var.project_name
          ManagedBy = "terraform"
          Owner     = "keithyu"
        }
      }
    }

    provider "aws" {
      alias   = "us_east_1"
      region  = "us-east-1"
      profile = var.aws_profile
      default_tags {
        tags = {
          Project   = var.project_name
          ManagedBy = "terraform"
          Owner     = "keithyu"
        }
      }
    }

    data "aws_route53_zone" "keithyu_cloud" {
      name         = "keithyu.cloud."
      private_zone = false
    }

    locals {
      hosts = {
        www = "www.beautyforever.keithyu.cloud"
        m   = "m.beautyforever.keithyu.cloud"
        api = "api.beautyforever.keithyu.cloud"
      }
    }
    ```

- [ ] **Step 1.3：写 backend.tf**

    `Cloudfront/terraform/environments/poc/backend.tf`（**Step 1.1 拿到的值填进去**）:

    ```hcl
    terraform {
      backend "s3" {
        bucket         = "tfstate-akamai-to-aws-longqi-<ACCOUNT_ID>"
        key            = "poc/terraform.tfstate"
        region         = "ap-northeast-1"
        dynamodb_table = "tfstate-lock-akamai-to-aws-longqi"
        encrypt        = true
      }
    }
    ```

- [ ] **Step 1.4：写 variables.tf**

    `Cloudfront/terraform/variables.tf`:

    ```hcl
    variable "project_name" {
      type        = string
      default     = "akamai-to-aws-longqi"
      description = "Project tag value"
    }

    variable "aws_profile" {
      type        = string
      default     = "default"
      description = "Local AWS CLI profile name"
    }

    variable "region_primary" {
      type        = string
      default     = "ap-northeast-1"
      description = "Primary region for EC2/ALB/Route53"
    }

    variable "root_domain" {
      type        = string
      default     = "beautyforever.keithyu.cloud"
      description = "Root demo domain"
    }
    ```

    `Cloudfront/terraform/environments/poc/variables.tf`:

    ```hcl
    variable "aws_profile" {
      type    = string
      default = "default"
    }

    variable "region_primary" {
      type    = string
      default = "ap-northeast-1"
    }
    ```

- [ ] **Step 1.5：写 terraform.tfvars.example**

    `Cloudfront/terraform/environments/poc/terraform.tfvars.example`:

    ```hcl
    # Copy to terraform.tfvars (gitignored) and fill in real values.
    aws_profile    = "default"
    region_primary = "ap-northeast-1"
    ```

- [ ] **Step 1.6：最小 main.tf 占位**

    `Cloudfront/terraform/environments/poc/main.tf`:

    ```hcl
    module "root" {
      source = "../.."

      aws_profile    = var.aws_profile
      region_primary = var.region_primary
    }
    ```

    `Cloudfront/terraform/outputs.tf`：空文件（`# outputs will be filled in subsequent tasks`）。

- [ ] **Step 1.7：terraform init + validate**

    ```bash
    cd Cloudfront/terraform/environments/poc
    cp terraform.tfvars.example terraform.tfvars
    terraform init
    terraform validate
    ```

    **预期输出**：`Terraform has been successfully initialized!` + `Success! The configuration is valid.`

- [ ] **Step 1.8：commit**

    ```bash
    git add Cloudfront/terraform/
    git commit -m "phase0(terraform): root module + poc environment + s3 backend"
    ```

---

## Task 02：ACM 证书模块（3 证书，us-east-1）

**目标**：在 `us-east-1` 为 3 个演示域名各申请一张 ACM 证书，DNS 验证自动添加到 Route53，状态 `ISSUED`。

**Files:**
- Create: `Cloudfront/terraform/modules/acm/main.tf`
- Create: `Cloudfront/terraform/modules/acm/variables.tf`
- Create: `Cloudfront/terraform/modules/acm/outputs.tf`
- Modify: `Cloudfront/terraform/main.tf`（补 `module "acm"` 调用）
- Modify: `Cloudfront/terraform/outputs.tf`（暴露 ACM ARN）

### Steps

- [ ] **Step 2.1：写 ACM module**

    `Cloudfront/terraform/modules/acm/variables.tf`:

    ```hcl
    variable "hosts" {
      type        = map(string)
      description = "Map of alias => FQDN"
    }

    variable "hosted_zone_id" {
      type = string
    }
    ```

    `Cloudfront/terraform/modules/acm/main.tf`:

    ```hcl
    terraform {
      required_providers {
        aws = {
          source                = "hashicorp/aws"
          version               = ">= 5.30"
          configuration_aliases = [aws.us_east_1]
        }
      }
    }

    resource "aws_acm_certificate" "this" {
      for_each = var.hosts
      provider = aws.us_east_1

      domain_name       = each.value
      validation_method = "DNS"

      lifecycle {
        create_before_destroy = true
      }
    }

    resource "aws_route53_record" "validation" {
      for_each = {
        for alias, cert in aws_acm_certificate.this :
        alias => tolist(cert.domain_validation_options)[0]
      }

      zone_id = var.hosted_zone_id
      name    = each.value.resource_record_name
      type    = each.value.resource_record_type
      ttl     = 60
      records = [each.value.resource_record_value]

      allow_overwrite = true
    }

    resource "aws_acm_certificate_validation" "this" {
      for_each = aws_acm_certificate.this
      provider = aws.us_east_1

      certificate_arn = each.value.arn
      validation_record_fqdns = [
        aws_route53_record.validation[each.key].fqdn,
      ]
    }
    ```

    `Cloudfront/terraform/modules/acm/outputs.tf`:

    ```hcl
    output "certificate_arns" {
      value = {
        for alias, cert in aws_acm_certificate_validation.this :
        alias => cert.certificate_arn
      }
    }
    ```

- [ ] **Step 2.2：在 root 调用 module**

    `Cloudfront/terraform/main.tf` 追加：

    ```hcl
    module "acm" {
      source = "./modules/acm"
      providers = {
        aws.us_east_1 = aws.us_east_1
      }

      hosts          = local.hosts
      hosted_zone_id = data.aws_route53_zone.keithyu_cloud.zone_id
    }
    ```

    `Cloudfront/terraform/outputs.tf` 追加：

    ```hcl
    output "certificate_arns" {
      value = module.acm.certificate_arns
    }
    ```

- [ ] **Step 2.3：plan**

    ```bash
    cd Cloudfront/terraform/environments/poc
    terraform plan -out=phase0-task02.tfplan
    ```

    **预期**：`Plan: 9 to add, 0 to change, 0 to destroy.`（3 certificate + 3 validation record + 3 certificate_validation = 9）。

- [ ] **Step 2.4：apply**

    ```bash
    terraform apply phase0-task02.tfplan
    ```

    **预期耗时**：约 2-3 分钟（DNS 验证）。若 5 分钟内仍 `PENDING_VALIDATION`，检查 Route53 记录是否成功写入。

- [ ] **Step 2.5：验证**

    ```bash
    terraform output -json certificate_arns | jq
    aws --profile default --region us-east-1 acm list-certificates \
      --query "CertificateSummaryList[?contains(DomainName, 'beautyforever.keithyu.cloud')]"
    ```

    **预期**：3 个 ARN，`Status: ISSUED`。

- [ ] **Step 2.6：commit**

    ```bash
    git add Cloudfront/terraform/
    git commit -m "phase0(acm): 3 ACM certs in us-east-1 with DNS validation"
    ```

---

## Task 03：Origin EC2 + ALB 模块

**目标**：1 台 EC2（**t3.xlarge**，Amazon Linux 2023，`ap-northeast-1a`）跑 Node.js mock；1 ALB 公网可达，3 条 listener rule 按 **`X-Viewer-Host` 自定义 header**（**不是 Host header**）把 `www/m/api.*` 路由到同一个 target group。

> **⚠ 重要设计决策（对齐 coverage-matrix A4：Akamai `forwardHostHeader = REQUEST_HOST_HEADER`）：**
> CloudFront 不允许把 viewer 的原始 Host header 直接透传到 origin（CloudFront 强制把 Origin 配置的 domain name 作为 Host 发给 origin）。因此 ALB 必须按 **自定义 header** 分流，而非 Host header。
>
> 流程：
> 1. viewer 请求到达 CloudFront，Host = `www.beautyforever.keithyu.cloud`
> 2. CloudFront Function (viewer-request) 把原始 Host 值写入 `X-Viewer-Host` 自定义 header（在 Task 05 引入）
> 3. CloudFront 转发到 ALB，Host = ALB DNS；`X-Viewer-Host` = 原始 Host
> 4. ALB listener rule 按 `X-Viewer-Host` 匹配路由到同一 target group（mock EC2）
> 5. mock Node.js 读 `X-Viewer-Host` 作为 "effective host" 来分路由
>
> Task 03 只建 ALB + listener rule（按自定义 header）；Task 05 引入 CloudFront Function 做注入；Task 04 扩展 mock 读 `X-Viewer-Host`。

**Files:**
- Create: `Cloudfront/terraform/modules/origin-ec2/main.tf`
- Create: `Cloudfront/terraform/modules/origin-ec2/variables.tf`
- Create: `Cloudfront/terraform/modules/origin-ec2/outputs.tf`
- Create: `Cloudfront/terraform/modules/origin-ec2/user-data.sh`
- Modify: root `main.tf`、`outputs.tf`

### Steps

- [ ] **Step 3.1：user-data 脚本**

    `Cloudfront/terraform/modules/origin-ec2/user-data.sh`:

    ```bash
    #!/bin/bash
    set -eux
    dnf update -y
    dnf install -y git nodejs20 nodejs20-npm
    alternatives --set node /usr/bin/node-20

    useradd -r -m -d /var/lib/bfmock bfmock || true
    mkdir -p /opt/bfmock

    cat > /opt/bfmock/server.js <<'NODE_EOF'
    // PLACEHOLDER server — real code deployed in Task 04 via git pull
    const http = require('http');
    http.createServer((req, res) => {
      const host = req.headers.host || 'unknown';
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`Hello from mock · Host=${host} · Path=${req.url}\n`);
    }).listen(8080, '0.0.0.0');
    console.log('bfmock listening on :8080');
    NODE_EOF

    cat > /etc/systemd/system/bfmock.service <<'SVC_EOF'
    [Unit]
    Description=Beautyforever Mock Server
    After=network.target

    [Service]
    Type=simple
    User=bfmock
    WorkingDirectory=/opt/bfmock
    ExecStart=/usr/bin/node /opt/bfmock/server.js
    Restart=always
    RestartSec=3

    [Install]
    WantedBy=multi-user.target
    SVC_EOF

    systemctl daemon-reload
    systemctl enable --now bfmock.service
    ```

- [ ] **Step 3.2：module variables + main**

    `Cloudfront/terraform/modules/origin-ec2/variables.tf`:

    ```hcl
    variable "project_name" { type = string }
    variable "region"       { type = string }
    variable "vpc_id"       { type = string }
    variable "public_subnet_ids" {
      type        = list(string)
      description = "At least 2 public subnets for ALB"
    }
    variable "instance_subnet_id" {
      type        = string
      description = "Single public subnet where EC2 instance is placed"
    }
    variable "hosts" { type = map(string) }
    ```

    `Cloudfront/terraform/modules/origin-ec2/main.tf`:

    ```hcl
    data "aws_ami" "al2023" {
      most_recent = true
      owners      = ["amazon"]
      filter {
        name   = "name"
        values = ["al2023-ami-*-x86_64"]
      }
    }

    resource "aws_security_group" "ec2" {
      name_prefix = "${var.project_name}-origin-ec2-"
      vpc_id      = var.vpc_id

      ingress {
        from_port       = 8080
        to_port         = 8080
        protocol        = "tcp"
        security_groups = [aws_security_group.alb.id]
      }

      egress {
        from_port   = 0
        to_port     = 0
        protocol    = "-1"
        cidr_blocks = ["0.0.0.0/0"]
      }
    }

    resource "aws_security_group" "alb" {
      name_prefix = "${var.project_name}-origin-alb-"
      vpc_id      = var.vpc_id

      ingress {
        from_port   = 443
        to_port     = 443
        protocol    = "tcp"
        cidr_blocks = ["0.0.0.0/0"]
      }
      ingress {
        from_port   = 80
        to_port     = 80
        protocol    = "tcp"
        cidr_blocks = ["0.0.0.0/0"]
      }

      egress {
        from_port   = 0
        to_port     = 0
        protocol    = "-1"
        cidr_blocks = ["0.0.0.0/0"]
      }
    }

    resource "aws_instance" "origin" {
      ami                    = data.aws_ami.al2023.id
      instance_type          = "t3.xlarge"  # confirmed by customer 2026-04-22 (spec §8.2 U2)
      subnet_id              = var.instance_subnet_id
      vpc_security_group_ids = [aws_security_group.ec2.id]

      associate_public_ip_address = true
      user_data                   = file("${path.module}/user-data.sh")
      user_data_replace_on_change = true

      tags = { Name = "${var.project_name}-origin" }
    }

    resource "aws_lb" "origin" {
      name_prefix        = "bfog-"
      internal           = false
      load_balancer_type = "application"
      security_groups    = [aws_security_group.alb.id]
      subnets            = var.public_subnet_ids
    }

    resource "aws_lb_target_group" "origin" {
      name_prefix = "bfog-"
      port        = 8080
      protocol    = "HTTP"
      vpc_id      = var.vpc_id
      target_type = "instance"

      health_check {
        path                = "/healthz"
        matcher             = "200-399"
        interval            = 15
        timeout             = 5
        healthy_threshold   = 2
        unhealthy_threshold = 3
      }
    }

    resource "aws_lb_target_group_attachment" "origin" {
      target_group_arn = aws_lb_target_group.origin.arn
      target_id        = aws_instance.origin.id
      port             = 8080
    }

    # Phase 0 不搞 HTTPS on ALB（CloudFront → ALB HTTP 即可）
    resource "aws_lb_listener" "http" {
      load_balancer_arn = aws_lb.origin.arn
      port              = 80
      protocol          = "HTTP"

      default_action {
        type = "fixed-response"
        fixed_response {
          content_type = "text/plain"
          message_body = "host not routed"
          status_code  = "404"
        }
      }
    }

    # NOTE: ALB condition uses `http_header` (X-Viewer-Host), NOT `host_header`.
    # Reason: CloudFront does not forward viewer's original Host to origin.
    # A CloudFront Function (see Task 05) injects X-Viewer-Host on viewer-request.
    resource "aws_lb_listener_rule" "host_routing" {
      for_each = var.hosts

      listener_arn = aws_lb_listener.http.arn
      priority     = index(keys(var.hosts), each.key) + 100

      action {
        type             = "forward"
        target_group_arn = aws_lb_target_group.origin.arn
      }

      condition {
        http_header {
          http_header_name = "X-Viewer-Host"
          values           = [each.value]
        }
      }
    }
    ```

    `Cloudfront/terraform/modules/origin-ec2/outputs.tf`:

    ```hcl
    output "alb_dns_name"  { value = aws_lb.origin.dns_name }
    output "alb_zone_id"   { value = aws_lb.origin.zone_id }
    output "alb_arn"       { value = aws_lb.origin.arn }
    output "instance_id"   { value = aws_instance.origin.id }
    output "instance_public_ip" { value = aws_instance.origin.public_ip }
    ```

- [ ] **Step 3.3：在 root 调用，暴露 VPC 信息**

    为避免建新 VPC，Phase 0 用 `default` VPC。`Cloudfront/terraform/main.tf` 追加：

    ```hcl
    data "aws_vpc" "default" {
      default = true
    }

    data "aws_subnets" "default_public" {
      filter {
        name   = "vpc-id"
        values = [data.aws_vpc.default.id]
      }
      filter {
        name   = "default-for-az"
        values = ["true"]
      }
    }

    module "origin" {
      source = "./modules/origin-ec2"

      project_name       = var.project_name
      region             = var.region_primary
      vpc_id             = data.aws_vpc.default.id
      public_subnet_ids  = data.aws_subnets.default_public.ids
      instance_subnet_id = data.aws_subnets.default_public.ids[0]
      hosts              = local.hosts
    }
    ```

    `Cloudfront/terraform/outputs.tf` 追加：

    ```hcl
    output "alb_dns_name" { value = module.origin.alb_dns_name }
    ```

- [ ] **Step 3.4：plan + apply**

    ```bash
    terraform plan -out=phase0-task03.tfplan
    # 预期 Plan: ~12 to add
    terraform apply phase0-task03.tfplan
    # 预期耗时：约 4-5 分钟（ALB 起比较慢）
    ```

- [ ] **Step 3.5：验证 EC2 mock 能通（用 `X-Viewer-Host` 模拟 CloudFront 后的流量）**

    ```bash
    ALB=$(terraform output -raw alb_dns_name)
    # 等 1-2 分钟让 target 变 healthy
    curl -H 'X-Viewer-Host: www.beautyforever.keithyu.cloud' http://$ALB/
    # 预期：Hello from mock · Host=<alb-dns> · Path=/
    # （Host header 是 ALB 本身 DNS；mock 实际路由逻辑在 Task 04 扩展后会改读 X-Viewer-Host）
    curl -H 'X-Viewer-Host: api.beautyforever.keithyu.cloud' http://$ALB/ping
    # 预期：200，命中 listener rule 并转到 target group
    curl http://$ALB/   # 不带 X-Viewer-Host
    # 预期：host not routed（default action）
    ```

    **注意**：Task 03 阶段 Node.js mock 还是 user-data placeholder（不区分 host），只要 listener rule 能正确路由到 target group 返回 200 即可。真正按 `X-Viewer-Host` 分业务路由在 Task 04 实现。

- [ ] **Step 3.6：commit**

    ```bash
    git add Cloudfront/terraform/
    git commit -m "phase0(origin): EC2 t3.small + ALB + 3 host-based listener rules"
    ```

---

## Task 04：Node.js mock 骨架（真实代码，取代 user-data placeholder）

**目标**：写真正的 `beautyforever/server.js`（Express + Host 分流路由），打成 systemd 能拉起的目录结构。Phase 0 只实现 3 个端点：`/`、`/healthz`、`/ping`。后续章节按章扩展。

**Files:**
- Create: `Cloudfront/beautyforever/package.json`
- Create: `Cloudfront/beautyforever/server.js`
- Create: `Cloudfront/beautyforever/routes/www.js`
- Create: `Cloudfront/beautyforever/routes/m.js`
- Create: `Cloudfront/beautyforever/routes/api.js`
- Create: `Cloudfront/beautyforever/test/smoke.test.js`
- Create: `Cloudfront/beautyforever/.gitignore`
- Create: `Cloudfront/beautyforever/deploy/ec2-user-data.sh`
- Modify: `Cloudfront/terraform/modules/origin-ec2/user-data.sh`（改为 git clone + npm install）

### Steps

- [ ] **Step 4.1：package.json**

    `Cloudfront/beautyforever/package.json`:

    ```json
    {
      "name": "beautyforever-mock",
      "version": "0.1.0",
      "type": "module",
      "private": true,
      "scripts": {
        "start": "node server.js",
        "test": "node --test test/"
      },
      "dependencies": {
        "express": "^4.19.2"
      }
    }
    ```

    `Cloudfront/beautyforever/.gitignore`:

    ```
    node_modules/
    package-lock.json
    *.log
    ```

- [ ] **Step 4.2：写 smoke 测试（先失败）**

    `Cloudfront/beautyforever/test/smoke.test.js`:

    ```javascript
    import { test } from 'node:test';
    import assert from 'node:assert/strict';

    const BASE = process.env.BFMOCK_BASE || 'http://127.0.0.1:8080';

    async function fetchWithHost(path, host) {
      const res = await fetch(`${BASE}${path}`, { headers: { Host: host } });
      const text = await res.text();
      return { status: res.status, text };
    }

    test('GET / with www host returns pc mock html', async () => {
      const { status, text } = await fetchWithHost('/', 'www.beautyforever.keithyu.cloud');
      assert.equal(status, 200);
      assert.match(text, /<!-- pc mock -->/);
    });

    test('GET / with m host returns mobile mock html', async () => {
      const { status, text } = await fetchWithHost('/', 'm.beautyforever.keithyu.cloud');
      assert.equal(status, 200);
      assert.match(text, /<!-- m mock -->/);
    });

    test('GET /ping with api host returns json', async () => {
      const { status, text } = await fetchWithHost('/ping', 'api.beautyforever.keithyu.cloud');
      assert.equal(status, 200);
      const body = JSON.parse(text);
      assert.equal(body.ok, true);
    });

    test('GET /healthz returns 200', async () => {
      const { status, text } = await fetchWithHost('/healthz', 'any');
      assert.equal(status, 200);
      assert.equal(text.trim(), 'ok');
    });

    test('GET / with unknown host returns 404', async () => {
      const { status } = await fetchWithHost('/', 'unknown.example');
      assert.equal(status, 404);
    });
    ```

- [ ] **Step 4.3：启动空 server 让测试失败**

    ```bash
    cd Cloudfront/beautyforever
    npm install
    # 不实现 server.js，先跑测试看失败
    echo 'console.log("empty")' > server.js
    node server.js &
    SERVER_PID=$!
    sleep 1
    npm test
    # 预期：5 个 test 全 FAIL（fetch ECONNREFUSED）
    kill $SERVER_PID 2>/dev/null || true
    ```

- [ ] **Step 4.4：写 server.js**

    `Cloudfront/beautyforever/server.js`:

    ```javascript
    import express from 'express';
    import wwwRouter from './routes/www.js';
    import mRouter from './routes/m.js';
    import apiRouter from './routes/api.js';

    const app = express();

    // Pure health check (bypass host routing)
    app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));

    // Host-based dispatch
    // Reads X-Viewer-Host (injected by CloudFront Function in Task 05);
    // falls back to Host header for direct-to-ALB testing (Task 03).
    app.use((req, res, next) => {
      const effectiveHost = (
        req.headers['x-viewer-host'] ||
        req.headers.host ||
        ''
      ).toLowerCase().split(':')[0];
      if (effectiveHost === 'www.beautyforever.keithyu.cloud') return wwwRouter(req, res, next);
      if (effectiveHost === 'm.beautyforever.keithyu.cloud')   return mRouter(req, res, next);
      if (effectiveHost === 'api.beautyforever.keithyu.cloud') return apiRouter(req, res, next);
      return res.status(404).type('text/plain').send('host not routed');
    });

    const PORT = process.env.PORT || 8080;
    app.listen(PORT, '0.0.0.0', () => console.log(`bfmock on :${PORT}`));
    ```

- [ ] **Step 4.5：写 routes/www.js**

    `Cloudfront/beautyforever/routes/www.js`:

    ```javascript
    import express from 'express';
    const router = express.Router();

    router.get('/', (_req, res) => {
      res.type('text/html').send('<!DOCTYPE html><html><!-- pc mock --><body>BF PC Home</body></html>');
    });

    export default router;
    ```

    `Cloudfront/beautyforever/routes/m.js`:

    ```javascript
    import express from 'express';
    const router = express.Router();

    router.get('/', (_req, res) => {
      res.type('text/html').send('<!DOCTYPE html><html><!-- m mock --><body>BF Mobile Home</body></html>');
    });

    export default router;
    ```

    `Cloudfront/beautyforever/routes/api.js`:

    ```javascript
    import express from 'express';
    const router = express.Router();

    router.get('/ping', (_req, res) => {
      res.json({ ok: true, service: 'api.beautyforever', ts: Date.now() });
    });

    export default router;
    ```

- [ ] **Step 4.6：测试通过**

    ```bash
    cd Cloudfront/beautyforever
    node server.js &
    SERVER_PID=$!
    sleep 1
    npm test
    # 预期：5 tests pass
    kill $SERVER_PID
    ```

- [ ] **Step 4.7：改造 user-data 改成 git-clone 模式**

    `Cloudfront/terraform/modules/origin-ec2/user-data.sh` 替换为：

    ```bash
    #!/bin/bash
    set -eux
    dnf update -y
    dnf install -y git nodejs20 nodejs20-npm
    alternatives --set node /usr/bin/node-20

    useradd -r -m -d /var/lib/bfmock bfmock || true

    # Clone the repo at first boot; subsequent updates happen via SSM/codedeploy/手动
    sudo -u bfmock git clone https://github.com/keithyt06/akamai-to-aws-longqi.git /var/lib/bfmock/repo
    cd /var/lib/bfmock/repo/Cloudfront/beautyforever
    sudo -u bfmock npm install --omit=dev

    cat > /etc/systemd/system/bfmock.service <<'SVC_EOF'
    [Unit]
    Description=Beautyforever Mock Server
    After=network.target

    [Service]
    Type=simple
    User=bfmock
    WorkingDirectory=/var/lib/bfmock/repo/Cloudfront/beautyforever
    Environment=NODE_ENV=production
    ExecStart=/usr/bin/node server.js
    Restart=always
    RestartSec=3

    [Install]
    WantedBy=multi-user.target
    SVC_EOF

    systemctl daemon-reload
    systemctl enable --now bfmock.service
    ```

- [ ] **Step 4.8：重新 apply EC2（user-data 改变会 replace）**

    ```bash
    cd Cloudfront/terraform/environments/poc
    terraform plan -out=phase0-task04.tfplan
    terraform apply phase0-task04.tfplan
    # EC2 会重建（user_data_replace_on_change = true）
    ```

- [ ] **Step 4.9：验证（注意用 `X-Viewer-Host` 头触发 ALB listener rule）**

    ```bash
    ALB=$(terraform output -raw alb_dns_name)
    sleep 90  # 等 EC2 user-data 跑完（npm install 慢）

    curl -H 'X-Viewer-Host: www.beautyforever.keithyu.cloud' -s http://$ALB/ | grep 'pc mock'
    curl -H 'X-Viewer-Host: m.beautyforever.keithyu.cloud'   -s http://$ALB/ | grep 'm mock'
    curl -H 'X-Viewer-Host: api.beautyforever.keithyu.cloud' -s http://$ALB/ping | jq .ok
    curl -s http://$ALB/healthz
    # 预期：每条匹配正常输出
    # 注意：CloudFront 接入后（Task 05），浏览器访问 https://www.beautyforever.keithyu.cloud/
    #       会由 CloudFront Function 自动注入 X-Viewer-Host；这里模拟的是同一效果。
    ```

- [ ] **Step 4.10：commit**

    ```bash
    git add Cloudfront/beautyforever/ Cloudfront/terraform/modules/origin-ec2/user-data.sh
    git commit -m "phase0(beautyforever): express-based mock with host-based routing + 5 smoke tests"
    ```

---

## Task 05：CloudFront 骨架 × 2 + 前置 viewer-request Function（含 Origin Shield）

**目标**：为 `www+m`（共用 Distribution）和 `api` 各起一个 CloudFront Distribution，origin 指向 Task 03 的 ALB，`HttpVersion = http2`，无 cache policy（全默认 Managed-CachingDisabled），ACM 证书接 Task 02 的。

**同步解决 2 个 coverage-matrix Todo：**
- **A4（C1 Host 透传修复）**：引入 phase0 级别的 CloudFront Function（viewer-request）注入 `X-Viewer-Host` header；2 个 Distribution 都绑定
- **A7（C2 Origin Shield）**：2 个 Distribution 都启用 Origin Shield（区域 `ap-northeast-1`，与主区一致）

**Files:**
- Create: `Cloudfront/terraform/modules/cloudfront-functions/main.tf`
- Create: `Cloudfront/terraform/modules/cloudfront-functions/variables.tf`
- Create: `Cloudfront/terraform/modules/cloudfront-functions/outputs.tf`
- Create: `Cloudfront/terraform/modules/cloudfront-functions/src/viewer-request.js`
- Create: `Cloudfront/terraform/modules/cloudfront-www/main.tf`
- Create: `Cloudfront/terraform/modules/cloudfront-www/variables.tf`
- Create: `Cloudfront/terraform/modules/cloudfront-www/outputs.tf`
- Create: `Cloudfront/terraform/modules/cloudfront-api/*`
- Create: `Cloudfront/terraform/modules/route53/*`
- Modify: root `main.tf`、`outputs.tf`

### Steps - Prelude：创建 CloudFront Function（骨架版）

- [ ] **Step 5.0.1：viewer-request Function 骨架源码**

    `Cloudfront/terraform/modules/cloudfront-functions/src/viewer-request.js`（**phase0 骨架版**，ch02/ch03 会扩展成完整版）:

    ```javascript
    // CloudFront viewer-request Function (Phase 0 skeleton)
    // Responsibilities (will grow):
    //   - [phase0] Inject X-Viewer-Host so ALB listener rules can dispatch by original Host
    //   - [ch02]   PC↔M redirect with UA/path/ext whitelists (added in Part 1)
    //   - [ch03]   ?akaCache=nce cache-bust (added in Part 1)
    //   - [ch05]   Query normalize (added in Part 2)
    //   - [ch06]   Cookie cache key derivation (added in Part 2)
    //   - [ch07]   True-Client-IP / X-Authentic-IP (added in Part 3)

    function handler(event) {
      var req = event.request;

      // Phase 0: propagate viewer's original Host to origin (ALB dispatches on this)
      if (req.headers.host) {
        req.headers['x-viewer-host'] = { value: req.headers.host.value };
      }

      return req;
    }
    ```

- [ ] **Step 5.0.2：module 文件**

    `Cloudfront/terraform/modules/cloudfront-functions/variables.tf`:

    ```hcl
    variable "project_name" { type = string }
    ```

    `Cloudfront/terraform/modules/cloudfront-functions/main.tf`:

    ```hcl
    resource "aws_cloudfront_function" "viewer_request" {
      name    = "${var.project_name}-viewer-request"
      runtime = "cloudfront-js-2.0"
      comment = "Phase 0 skeleton: inject X-Viewer-Host; extended by Parts 1-3"
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

- [ ] **Step 5.0.3：root 调用**

    `Cloudfront/terraform/main.tf` 追加：

    ```hcl
    module "cloudfront_functions" {
      source       = "./modules/cloudfront-functions"
      project_name = var.project_name
    }
    ```

### Steps - cloudfront-www / cloudfront-api / route53

### Steps

- [ ] **Step 5.1：cloudfront-www module**

    `Cloudfront/terraform/modules/cloudfront-www/variables.tf`:

    ```hcl
    variable "project_name" { type = string }
    variable "aliases" {
      type        = list(string)
      description = "CNAMEs on this distribution (www + m)"
    }
    variable "certificate_arn"     { type = string }
    variable "origin_alb_dns"      { type = string }
    variable "viewer_request_fn_arn" {
      type        = string
      description = "ARN of the phase0 viewer-request Function (X-Viewer-Host injection)"
    }
    variable "origin_shield_region" {
      type        = string
      default     = "ap-northeast-1"
      description = "Origin Shield region — equivalent of Akamai tieredDistribution"
    }
    ```

    `Cloudfront/terraform/modules/cloudfront-www/main.tf`:

    ```hcl
    # Managed policy IDs (AWS-provided)
    data "aws_cloudfront_cache_policy" "caching_disabled" {
      name = "Managed-CachingDisabled"
    }

    # AllViewer forwards all headers/cookies/query strings except Host
    # (CloudFront always replaces Host with origin domain regardless).
    # Our phase0 Function writes X-Viewer-Host to carry original Host to ALB.
    data "aws_cloudfront_origin_request_policy" "all_viewer" {
      name = "Managed-AllViewer"
    }

    resource "aws_cloudfront_distribution" "www" {
      enabled         = true
      is_ipv6_enabled = true
      http_version    = "http2"  # HARDCODED — CICD requires http2
      comment         = "${var.project_name} :: www + m"

      aliases = var.aliases

      origin {
        domain_name = var.origin_alb_dns
        origin_id   = "alb-origin"
        custom_origin_config {
          http_port              = 80
          https_port             = 443
          origin_protocol_policy = "http-only"
          origin_ssl_protocols   = ["TLSv1.2"]
        }

        # Origin Shield = Akamai tieredDistribution equivalent
        origin_shield {
          enabled              = true
          origin_shield_region = var.origin_shield_region
        }
      }

      default_cache_behavior {
        target_origin_id         = "alb-origin"
        viewer_protocol_policy   = "redirect-to-https"
        allowed_methods          = ["GET", "HEAD", "OPTIONS"]
        cached_methods           = ["GET", "HEAD"]
        cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
        origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
        compress                 = true

        function_association {
          event_type   = "viewer-request"
          function_arn = var.viewer_request_fn_arn
        }
      }

      restrictions {
        geo_restriction { restriction_type = "none" }
      }

      viewer_certificate {
        acm_certificate_arn      = var.certificate_arn
        ssl_support_method       = "sni-only"
        minimum_protocol_version = "TLSv1.2_2021"
      }

      price_class = "PriceClass_200"
    }
    ```

    `Cloudfront/terraform/modules/cloudfront-www/outputs.tf`:

    ```hcl
    output "distribution_id"     { value = aws_cloudfront_distribution.www.id }
    output "distribution_arn"    { value = aws_cloudfront_distribution.www.arn }
    output "distribution_domain" { value = aws_cloudfront_distribution.www.domain_name }
    output "distribution_zone"   { value = aws_cloudfront_distribution.www.hosted_zone_id }
    ```

- [ ] **Step 5.2：cloudfront-api module（结构相同，单域名）**

    `Cloudfront/terraform/modules/cloudfront-api/main.tf` —— 和 `cloudfront-www` 完全一致的结构，但 `aliases` 只有 1 个（`api.beautyforever.keithyu.cloud`），`comment` 改为 `api`。复制文件，改以下字段：

    ```
    resource name: aws_cloudfront_distribution.api
    comment: "${var.project_name} :: api"
    ```

    **Rationale:** 和 www/m 行为一致但独立 Distribution，后续章节在各自模块里独立演化（api 有不同的 cache policy、default NO_STORE 等）。

    （variables.tf、outputs.tf 和 cloudfront-www 相同字段）

- [ ] **Step 5.3：route53 module（alias 到 CloudFront）**

    `Cloudfront/terraform/modules/route53/variables.tf`:

    ```hcl
    variable "hosted_zone_id" { type = string }
    variable "records" {
      type = map(object({
        name    = string
        target  = string
        zone_id = string
      }))
      description = "Map of alias => { name, CloudFront domain, CloudFront zone }"
    }
    ```

    `Cloudfront/terraform/modules/route53/main.tf`:

    ```hcl
    resource "aws_route53_record" "this" {
      for_each = var.records

      zone_id = var.hosted_zone_id
      name    = each.value.name
      type    = "A"

      alias {
        name                   = each.value.target
        zone_id                = each.value.zone_id
        evaluate_target_health = false
      }
    }
    ```

- [ ] **Step 5.4：在 root 调用**

    `Cloudfront/terraform/main.tf` 追加：

    ```hcl
    module "cf_www" {
      source = "./modules/cloudfront-www"

      project_name           = var.project_name
      aliases                = [local.hosts.www, local.hosts.m]
      certificate_arn        = module.acm.certificate_arns.www
      origin_alb_dns         = module.origin.alb_dns_name
      viewer_request_fn_arn  = module.cloudfront_functions.function_arns.viewer_request
      origin_shield_region   = var.region_primary
    }

    module "cf_api" {
      source = "./modules/cloudfront-api"

      project_name           = var.project_name
      aliases                = [local.hosts.api]
      certificate_arn        = module.acm.certificate_arns.api
      origin_alb_dns         = module.origin.alb_dns_name
      viewer_request_fn_arn  = module.cloudfront_functions.function_arns.viewer_request
      origin_shield_region   = var.region_primary
    }

    module "dns" {
      source = "./modules/route53"

      hosted_zone_id = data.aws_route53_zone.keithyu_cloud.zone_id
      records = {
        www = { name = local.hosts.www, target = module.cf_www.distribution_domain, zone_id = module.cf_www.distribution_zone }
        m   = { name = local.hosts.m,   target = module.cf_www.distribution_domain, zone_id = module.cf_www.distribution_zone }
        api = { name = local.hosts.api, target = module.cf_api.distribution_domain, zone_id = module.cf_api.distribution_zone }
      }
    }
    ```

    **注意**：`cloudfront-api` 模块的 `variables.tf` 和 `main.tf` 也需要加入与 `cloudfront-www` 相同的 `viewer_request_fn_arn` + `origin_shield_region` + `function_association` + `origin_shield` 块（Step 5.2 的"完全一致的结构，但 aliases 改 api"这句话覆盖它们；实际复制粘贴时一并包含这些字段）。

    **关键**：`m` 的 ACM 证书在 `module.acm.certificate_arns.m` 里创建了，但 `cf_www` 用了 `www` 的 cert。由于 CloudFront 在 `aliases` 里支持多个 CNAME + 单证书（要求证书 SAN 覆盖），这里 `cf_www` 要用**含 SAN 的单证书**。**调整 Task 02**：让 `www` 证书的 `subject_alternative_names = [m.host]`。

- [ ] **Step 5.5：修正 ACM 证书的 SAN（回到 Task 02 的 module）**

    `Cloudfront/terraform/modules/acm/main.tf` 的 `aws_acm_certificate "this"` 增加逻辑：

    ```hcl
    variable "sans" {
      type    = map(list(string))
      default = {}
      description = "Optional map of alias => list of SANs"
    }

    resource "aws_acm_certificate" "this" {
      for_each = var.hosts
      provider = aws.us_east_1

      domain_name               = each.value
      subject_alternative_names = lookup(var.sans, each.key, [])
      validation_method         = "DNS"

      lifecycle { create_before_destroy = true }
    }
    ```

    DNS 验证 record 需要覆盖所有 SAN：把 `aws_route53_record.validation` 改为嵌套 for_each（每个 cert × 每个 validation option）：

    ```hcl
    locals {
      validation_records = merge([
        for alias, cert in aws_acm_certificate.this : {
          for opt in cert.domain_validation_options :
          "${alias}-${opt.domain_name}" => {
            alias   = alias
            name    = opt.resource_record_name
            type    = opt.resource_record_type
            value   = opt.resource_record_value
          }
        }
      ]...)
    }

    resource "aws_route53_record" "validation" {
      for_each = local.validation_records
      zone_id  = var.hosted_zone_id
      name     = each.value.name
      type     = each.value.type
      ttl      = 60
      records  = [each.value.value]
      allow_overwrite = true
    }

    resource "aws_acm_certificate_validation" "this" {
      for_each = aws_acm_certificate.this
      provider = aws.us_east_1

      certificate_arn = each.value.arn
      validation_record_fqdns = [
        for k, rec in aws_route53_record.validation :
        rec.fqdn if rec.name != "" && startswith(k, each.key)
      ]
    }
    ```

    root `main.tf` 里 acm 调用加入 `sans`：

    ```hcl
    module "acm" {
      source = "./modules/acm"
      providers = { aws.us_east_1 = aws.us_east_1 }

      hosts          = { www = local.hosts.www, api = local.hosts.api }   # 去掉独立 m
      sans           = { www = [local.hosts.m] }                           # m 作为 www 的 SAN
      hosted_zone_id = data.aws_route53_zone.keithyu_cloud.zone_id
    }
    ```

- [ ] **Step 5.6：plan + apply（分两步，证书可能需要 destroy+create）**

    ```bash
    cd Cloudfront/terraform/environments/poc
    terraform plan -out=phase0-task05.tfplan
    # 预期：acm 3 replace (DNS + cert)、cloudfront 新增 2、route53 新增 3；约 15 resources
    terraform apply phase0-task05.tfplan
    # CloudFront deploy 需要 5-10 分钟（`In Progress` → `Deployed`）
    ```

- [ ] **Step 5.7：验证**

    ```bash
    curl -sv https://www.beautyforever.keithyu.cloud/ 2>&1 | grep -E '^(<|>) '
    curl -s  https://m.beautyforever.keithyu.cloud/ | grep 'm mock'
    curl -s  https://api.beautyforever.keithyu.cloud/ping | jq .ok
    ```

    **预期**：www/m 返回 html 含 "pc mock"/"m mock"；api 返回 `{"ok": true}`；`curl -v` 显示 TLS 握手走 ACM 证书 + `HTTP/2`。

- [ ] **Step 5.8：commit**

    ```bash
    git add Cloudfront/terraform/
    git commit -m "phase0(cloudfront): 2 Distributions (www+m, api) + route53 aliases, HTTP/2-only"
    ```

---

## Task 06：WAF 骨架 × 3（3 个空 Web ACL）

**目标**：在 `us-east-1`（scope CLOUDFRONT）建 3 个 WAF Web ACL，对齐 Akamai 的 3 个 Policy（Deny / Alert / Api）。Phase 0 规则空，只有默认 action = `Allow`。Association 到 Distribution：`acl-www-m-deny` 到 www Distribution，`acl-api` 到 api Distribution，`acl-alert` 先不 associate（没有对应 tapi demo 域名）。

**Files:**
- Create: `Cloudfront/terraform/modules/waf/main.tf`
- Create: `Cloudfront/terraform/modules/waf/variables.tf`
- Create: `Cloudfront/terraform/modules/waf/outputs.tf`
- Modify: root `main.tf`、`cloudfront-www` + `cloudfront-api` 加入 `web_acl_id` 参数

### Steps

- [ ] **Step 6.1：waf module**

    `Cloudfront/terraform/modules/waf/variables.tf`:

    ```hcl
    variable "project_name" { type = string }
    variable "acls" {
      type = map(object({
        description = string
      }))
      description = "Map of acl_key => { description }"
    }
    ```

    `Cloudfront/terraform/modules/waf/main.tf`:

    ```hcl
    terraform {
      required_providers {
        aws = {
          source                = "hashicorp/aws"
          version               = ">= 5.30"
          configuration_aliases = [aws.us_east_1]
        }
      }
    }

    resource "aws_wafv2_web_acl" "this" {
      for_each = var.acls
      provider = aws.us_east_1

      name        = "${var.project_name}-${each.key}"
      description = each.value.description
      scope       = "CLOUDFRONT"

      default_action { allow {} }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${var.project_name}-${each.key}"
        sampled_requests_enabled   = true
      }

      # Phase 0: no rules. Chapters 08/09/10 will add rules.
    }
    ```

    `Cloudfront/terraform/modules/waf/outputs.tf`:

    ```hcl
    output "web_acl_arns" {
      value = { for k, acl in aws_wafv2_web_acl.this : k => acl.arn }
    }

    output "web_acl_ids" {
      value = { for k, acl in aws_wafv2_web_acl.this : k => acl.id }
    }
    ```

- [ ] **Step 6.2：在 root 调用**

    `Cloudfront/terraform/main.tf` 追加：

    ```hcl
    module "waf" {
      source = "./modules/waf"
      providers = { aws.us_east_1 = aws.us_east_1 }

      project_name = var.project_name
      acls = {
        deny  = { description = "Akamai Policy Deny equivalent (www + m)" }
        alert = { description = "Akamai Policy Alert equivalent (tapi; no cloudfront assoc in POC)" }
        api   = { description = "Akamai Policy Api equivalent (api)" }
      }
    }
    ```

- [ ] **Step 6.3：把 web_acl_id 接进 Distribution**

    `Cloudfront/terraform/modules/cloudfront-www/variables.tf` 加：

    ```hcl
    variable "web_acl_arn" {
      type    = string
      default = null
    }
    ```

    `.../cloudfront-www/main.tf` 的 `aws_cloudfront_distribution.www` 内加：

    ```hcl
    web_acl_id = var.web_acl_arn
    ```

    `cloudfront-api` 同理。

    root `main.tf` 传入：

    ```hcl
    module "cf_www" {
      # ... 原有参数
      web_acl_arn = module.waf.web_acl_arns.deny
    }

    module "cf_api" {
      # ... 原有参数
      web_acl_arn = module.waf.web_acl_arns.api
    }
    ```

- [ ] **Step 6.4：plan + apply**

    ```bash
    terraform plan -out=phase0-task06.tfplan
    # 预期：3 WebACL 新增；2 Distribution modify (associate WAF)
    terraform apply phase0-task06.tfplan
    # CloudFront distribution 更新需要 5-10 分钟
    ```

- [ ] **Step 6.5：验证**

    ```bash
    aws --profile default --region us-east-1 wafv2 list-web-acls --scope CLOUDFRONT \
      --query "WebACLs[?starts_with(Name, 'akamai-to-aws-longqi-')]"
    # 预期：3 条

    aws --profile default --region us-east-1 cloudfront get-distribution --id $(terraform output -raw cf_www_distribution_id 2>/dev/null || echo noop) \
      --query "Distribution.DistributionConfig.WebACLId"
    # 预期：返回 WAF ACL ARN
    ```

- [ ] **Step 6.6：commit**

    ```bash
    git add Cloudfront/terraform/
    git commit -m "phase0(waf): 3 empty Web ACLs (deny/alert/api) + attach to cloudfront"
    ```

---

## Task 07：Doris 单机 + Kinesis + Python consumer 骨架

**目标**：Doris FE+BE 单机跑在一台 `t3.xlarge` EC2 上（内网）；Kinesis Data Stream 1 shard；Python consumer EC2（`t3.small`）占位，先只跑一个 dummy script 写 log 到 stdout（真实 consumer 代码在 ch11 的 plan 里写）。

**Files:**
- Create: `Cloudfront/terraform/modules/doris/main.tf`、`variables.tf`、`outputs.tf`、`user-data.sh`
- Create: `Cloudfront/terraform/modules/realtime-logs/main.tf`、`variables.tf`、`outputs.tf`
- Create: `Cloudfront/terraform/modules/log-consumer/main.tf`、`variables.tf`、`outputs.tf`、`user-data.sh`
- Modify: root `main.tf`

### Steps

- [ ] **Step 7.1：Doris user-data（参考 `longqi-cloudfront/doris-单机部署.sh`）**

    `Cloudfront/terraform/modules/doris/user-data.sh`:

    ```bash
    #!/bin/bash
    set -eux
    dnf update -y
    dnf install -y java-17-amazon-corretto-headless wget unzip mysql

    mkdir -p /opt/doris && cd /opt/doris
    DORIS_VER=2.1.5
    wget -q https://apache-doris-releases.oss-accelerate.aliyuncs.com/apache-doris-${DORIS_VER}-bin-x64.tar.gz
    tar xzf apache-doris-${DORIS_VER}-bin-x64.tar.gz
    ln -s apache-doris-${DORIS_VER}-bin-x64 current

    # System limits (Doris requires)
    echo "* soft nofile 65536" >> /etc/security/limits.conf
    echo "* hard nofile 65536" >> /etc/security/limits.conf
    sysctl -w vm.max_map_count=2000000
    echo "vm.max_map_count=2000000" >> /etc/sysctl.conf

    PRIV_IP=$(curl -s http://169.254.169.254/latest/meta-data/local-ipv4)

    # FE
    sed -i "s/#priority_networks.*/priority_networks = ${PRIV_IP}\\/32/" /opt/doris/current/fe/conf/fe.conf
    /opt/doris/current/fe/bin/start_fe.sh --daemon
    sleep 15

    # Register BE
    mysql -uroot -h127.0.0.1 -P9030 -e "ALTER SYSTEM ADD BACKEND '${PRIV_IP}:9050';"

    # BE
    sed -i "s/#priority_networks.*/priority_networks = ${PRIV_IP}\\/32/" /opt/doris/current/be/conf/be.conf
    /opt/doris/current/be/bin/start_be.sh --daemon
    sleep 10

    # Smoke
    mysql -uroot -h127.0.0.1 -P9030 -e "SHOW BACKENDS;"
    ```

    **注意**：Doris 启动脚本开机后跑；确保 EC2 Security Group 允许从 log-consumer EC2 访问 9030 (MySQL protocol)。

- [ ] **Step 7.2：doris module main.tf**

    `Cloudfront/terraform/modules/doris/variables.tf`:

    ```hcl
    variable "project_name" { type = string }
    variable "vpc_id"       { type = string }
    variable "subnet_id"    { type = string }
    variable "consumer_sg_id" { type = string }
    ```

    `Cloudfront/terraform/modules/doris/main.tf`:

    ```hcl
    data "aws_ami" "al2023" {
      most_recent = true
      owners      = ["amazon"]
      filter { name = "name" values = ["al2023-ami-*-x86_64"] }
    }

    resource "aws_security_group" "doris" {
      name_prefix = "${var.project_name}-doris-"
      vpc_id      = var.vpc_id

      ingress {
        description     = "MySQL protocol from log-consumer"
        from_port       = 9030
        to_port         = 9030
        protocol        = "tcp"
        security_groups = [var.consumer_sg_id]
      }

      ingress {
        description = "Inter-node (single-node no-op but open LAN range)"
        from_port   = 0
        to_port     = 65535
        protocol    = "tcp"
        self        = true
      }

      egress {
        from_port = 0 to_port = 0 protocol = "-1" cidr_blocks = ["0.0.0.0/0"]
      }
    }

    resource "aws_instance" "doris" {
      ami                    = data.aws_ami.al2023.id
      instance_type          = "t3.xlarge"
      subnet_id              = var.subnet_id
      vpc_security_group_ids = [aws_security_group.doris.id]
      user_data              = file("${path.module}/user-data.sh")

      root_block_device {
        volume_size = 100
        volume_type = "gp3"
      }

      tags = { Name = "${var.project_name}-doris-fe-be" }
    }
    ```

    `outputs.tf`:

    ```hcl
    output "private_ip" { value = aws_instance.doris.private_ip }
    output "sg_id"      { value = aws_security_group.doris.id }
    output "instance_id"{ value = aws_instance.doris.id }
    ```

- [ ] **Step 7.3：realtime-logs module（Kinesis Data Stream）**

    `Cloudfront/terraform/modules/realtime-logs/main.tf`:

    ```hcl
    variable "project_name" { type = string }

    resource "aws_kinesis_stream" "cf_logs" {
      name             = "${var.project_name}-cf-realtime-logs"
      retention_period = 24
      stream_mode_details { stream_mode = "ON_DEMAND" }
    }

    resource "aws_iam_role" "realtime_logs" {
      name = "${var.project_name}-cf-realtime-logs"
      assume_role_policy = jsonencode({
        Version = "2012-10-17"
        Statement = [{
          Effect    = "Allow"
          Principal = { Service = "cloudfront.amazonaws.com" }
          Action    = "sts:AssumeRole"
        }]
      })
    }

    resource "aws_iam_role_policy" "realtime_logs" {
      role = aws_iam_role.realtime_logs.id
      policy = jsonencode({
        Version = "2012-10-17"
        Statement = [{
          Effect   = "Allow"
          Action   = ["kinesis:PutRecord*"]
          Resource = aws_kinesis_stream.cf_logs.arn
        }]
      })
    }

    output "stream_arn"  { value = aws_kinesis_stream.cf_logs.arn }
    output "stream_name" { value = aws_kinesis_stream.cf_logs.name }
    output "role_arn"    { value = aws_iam_role.realtime_logs.arn }
    ```

    **注意**：Phase 0 不把 Real-time Logs Config 挂 Distribution——ch11 的 plan 才做，因为 real-time-log-config 需要指定 fields，ch11 会定字段 schema。

- [ ] **Step 7.4：log-consumer module 骨架**

    `Cloudfront/terraform/modules/log-consumer/user-data.sh`:

    ```bash
    #!/bin/bash
    set -eux
    dnf install -y git python3.11 python3.11-pip mysql

    sudo -u ec2-user git clone https://github.com/keithyt06/akamai-to-aws-longqi.git /home/ec2-user/repo
    cd /home/ec2-user/repo/Cloudfront/log-consumer
    sudo -u ec2-user python3.11 -m pip install --user -r requirements.txt || true

    cat > /etc/systemd/system/bflog-consumer.service <<'SVC_EOF'
    [Unit]
    Description=Beautyforever CF realtime log consumer (placeholder)
    After=network.target

    [Service]
    Type=simple
    User=ec2-user
    WorkingDirectory=/home/ec2-user/repo/Cloudfront/log-consumer
    ExecStart=/usr/bin/python3.11 -c "import time, sys; sys.stdout.write('placeholder consumer\\n'); sys.stdout.flush(); time.sleep(3600)"
    Restart=always

    [Install]
    WantedBy=multi-user.target
    SVC_EOF

    systemctl daemon-reload
    systemctl enable --now bflog-consumer.service
    ```

    `main.tf`、`variables.tf`（略，结构与 doris 类似但 t3.small，SG 有出站到 Doris 9030 + Kinesis 端点 VPC endpoint；Phase 0 用 `0.0.0.0/0` 出站 + IAM role 读取 Kinesis 即可）:

    ```hcl
    variable "project_name"    { type = string }
    variable "vpc_id"          { type = string }
    variable "subnet_id"       { type = string }
    variable "kinesis_arn"     { type = string }
    variable "doris_sg_id"     { type = string }

    data "aws_ami" "al2023" {
      most_recent = true owners = ["amazon"]
      filter { name = "name" values = ["al2023-ami-*-x86_64"] }
    }

    resource "aws_security_group" "consumer" {
      name_prefix = "${var.project_name}-log-consumer-"
      vpc_id      = var.vpc_id
      egress { from_port = 0 to_port = 0 protocol = "-1" cidr_blocks = ["0.0.0.0/0"] }
    }

    resource "aws_iam_role" "consumer" {
      name = "${var.project_name}-log-consumer"
      assume_role_policy = jsonencode({
        Version = "2012-10-17"
        Statement = [{
          Effect = "Allow"
          Principal = { Service = "ec2.amazonaws.com" }
          Action = "sts:AssumeRole"
        }]
      })
    }

    resource "aws_iam_role_policy" "consumer" {
      role = aws_iam_role.consumer.id
      policy = jsonencode({
        Version = "2012-10-17"
        Statement = [{
          Effect = "Allow"
          Action = ["kinesis:GetRecords","kinesis:GetShardIterator","kinesis:DescribeStream","kinesis:ListShards"]
          Resource = var.kinesis_arn
        }]
      })
    }

    resource "aws_iam_instance_profile" "consumer" {
      name = "${var.project_name}-log-consumer"
      role = aws_iam_role.consumer.name
    }

    resource "aws_instance" "consumer" {
      ami                    = data.aws_ami.al2023.id
      instance_type          = "t3.small"
      subnet_id              = var.subnet_id
      vpc_security_group_ids = [aws_security_group.consumer.id]
      iam_instance_profile   = aws_iam_instance_profile.consumer.name
      user_data              = file("${path.module}/user-data.sh")
      tags = { Name = "${var.project_name}-log-consumer" }
    }

    output "sg_id"       { value = aws_security_group.consumer.id }
    output "instance_id" { value = aws_instance.consumer.id }
    ```

- [ ] **Step 7.5：root 里调用 realtime-logs、doris、log-consumer（顺序）**

    ```hcl
    module "realtime_logs" {
      source       = "./modules/realtime-logs"
      project_name = var.project_name
    }

    module "log_consumer" {
      source       = "./modules/log-consumer"
      project_name = var.project_name
      vpc_id       = data.aws_vpc.default.id
      subnet_id    = data.aws_subnets.default_public.ids[0]
      kinesis_arn  = module.realtime_logs.stream_arn
      doris_sg_id  = module.doris.sg_id
    }

    module "doris" {
      source         = "./modules/doris"
      project_name   = var.project_name
      vpc_id         = data.aws_vpc.default.id
      subnet_id      = data.aws_subnets.default_public.ids[0]
      consumer_sg_id = module.log_consumer.sg_id
    }
    ```

    **循环依赖 workaround**：`doris.consumer_sg_id` 依赖 log-consumer SG；`log-consumer.doris_sg_id` 依赖 doris SG。用**单独 `aws_security_group_rule`** 打破：

    ```hcl
    # 在 root main.tf 里
    resource "aws_security_group_rule" "consumer_to_doris" {
      type                     = "egress"
      from_port                = 9030
      to_port                  = 9030
      protocol                 = "tcp"
      security_group_id        = module.log_consumer.sg_id
      source_security_group_id = module.doris.sg_id
    }
    ```

    并把 doris module 里 `consumer_sg_id` 参数改为 log_consumer 的 SG id：两个 module 只引用对方一次（log_consumer 不需要在定义时引用 doris SG，用 root 顶层 `aws_security_group_rule` 加就行）。

    简化：doris module 内部 SG 只有 self + consumer SG 的 ingress 不分两个模块互相引用。实际代码里按 **先 log_consumer，再 doris** 顺序，doris 定义时 `consumer_sg_id = module.log_consumer.sg_id` OK；log_consumer 不反引 doris。

- [ ] **Step 7.6：plan + apply**

    ```bash
    terraform plan -out=phase0-task07.tfplan
    # 预期：3 EC2 + 2 SG + 1 Kinesis + IAM roles/policies + 1 rule; ~15 resources
    terraform apply phase0-task07.tfplan
    # 耗时约 5-8 分钟
    ```

- [ ] **Step 7.7：Doris smoke**

    ```bash
    # SSH 进 log-consumer（via SSM Session Manager）
    CONSUMER=$(terraform output -raw log_consumer_instance_id 2>/dev/null || aws ec2 describe-instances --filters "Name=tag:Name,Values=akamai-to-aws-longqi-log-consumer" --query 'Reservations[0].Instances[0].InstanceId' --output text)
    aws --profile default ssm start-session --target $CONSUMER
    # 在 session 内:
    mysql -uroot -h<doris-private-ip> -P9030 -e "SHOW BACKENDS;"
    # 预期：BE alive = true
    ```

    若 Doris 未起全：查看 EC2 instance `/opt/doris/current/fe/log/fe.log` 和 `be.log`。

- [ ] **Step 7.8：commit**

    ```bash
    git add Cloudfront/terraform/
    git commit -m "phase0(observability): doris single-node + kinesis stream + log-consumer skeleton"
    ```

---

## Task 08：test-harness 骨架

**目标**：Python 项目结构、Makefile、baseline 硬栅栏、smoke YAML 用例能跑通（一条：`https://www.beautyforever.keithyu.cloud/` 返回 200 含 "pc mock"）。

**Files:**
- Create: `Cloudfront/test-harness/pyproject.toml`
- Create: `Cloudfront/test-harness/requirements.txt`
- Create: `Cloudfront/test-harness/Makefile`
- Create: `Cloudfront/test-harness/baseline/guards.py`
- Create: `Cloudfront/test-harness/baseline/probe.py`
- Create: `Cloudfront/test-harness/probe/probe.py`
- Create: `Cloudfront/test-harness/report/compare.py`
- Create: `Cloudfront/test-harness/report/templates/chapter-matrix.html.j2`
- Create: `Cloudfront/test-harness/cases/00-smoke.yaml`
- Create: `Cloudfront/test-harness/test/test_guards.py`

### Steps

- [ ] **Step 8.1：pyproject + requirements**

    `requirements.txt`:

    ```
    httpx==0.27.2
    pyyaml==6.0.2
    jinja2==3.1.4
    pydantic==2.8.2
    pytest==8.3.3
    ```

    `pyproject.toml`:

    ```toml
    [project]
    name = "bf-test-harness"
    version = "0.1.0"
    requires-python = ">=3.11"

    [tool.pytest.ini_options]
    testpaths = ["test"]
    ```

- [ ] **Step 8.2：guards.py（硬栅栏 + TDD）**

    `test-harness/baseline/guards.py`:

    ```python
    """Baseline guard-rails for Akamai read-only access."""
    from __future__ import annotations
    from datetime import datetime, timezone, timedelta

    ALLOWED_METHODS = {"GET", "HEAD"}
    ALLOWED_AKAMAI_HOSTS = {
        "www.beautyforever.com",
        "m.beautyforever.com",
        "api.beautyforever.com",
    }
    BASELINE_UA = "Keithyu-Akamai-Baseline/1.0 (read-only)"
    # Per spec §8.2 U4 (confirmed 2026-04-22): baseline is one-shot post-deploy
    # comparison, NOT recurring. No hourly/rate/time-window limit. Only hard
    # guards remain: READ-ONLY method, host whitelist, fixed UA.


    class GuardViolation(RuntimeError):
        pass


    def assert_method(method: str) -> None:
        if method.upper() not in ALLOWED_METHODS:
            raise GuardViolation(f"Baseline only allows {ALLOWED_METHODS}, got {method!r}")


    def assert_host(host: str) -> None:
        if host not in ALLOWED_AKAMAI_HOSTS:
            raise GuardViolation(f"Baseline host {host!r} not in whitelist {ALLOWED_AKAMAI_HOSTS}")
    ```

    `test-harness/test/test_guards.py`（TDD 先写测试）:

    ```python
    import pytest
    from baseline.guards import (
        assert_method, assert_host, GuardViolation,
    )

    def test_method_get_allowed():
        assert_method("GET")
        assert_method("head")  # case-insensitive

    def test_method_post_rejected():
        with pytest.raises(GuardViolation):
            assert_method("POST")

    def test_host_whitelisted():
        assert_host("www.beautyforever.com")

    def test_host_rejected():
        with pytest.raises(GuardViolation):
            assert_host("sapi.beautyforever.com")
    ```

    **运行**：

    ```bash
    cd Cloudfront/test-harness
    python3.11 -m venv .venv
    . .venv/bin/activate
    pip install -r requirements.txt
    PYTHONPATH=. pytest test/test_guards.py -v
    # 预期：4 pass
    ```

- [ ] **Step 8.3：probe.py（baseline + probe 共享核心）**

    `test-harness/baseline/probe.py`:

    ```python
    """Akamai baseline probe — READ-ONLY."""
    from __future__ import annotations
    import json
    import os
    import time
    import sys
    from pathlib import Path
    from datetime import datetime, timezone
    import httpx
    import yaml
    from baseline.guards import assert_method, assert_host, BASELINE_UA, GuardViolation


    def run_case(case: dict, akamai_host: str) -> dict:
        method = case["request"].get("method", "GET")
        assert_method(method)
        assert_host(akamai_host)

        url = case["request"]["url"].replace("{host}", akamai_host)
        headers = dict(case["request"].get("headers", {}))
        headers["User-Agent"] = BASELINE_UA
        headers["Host"] = akamai_host

        resp = httpx.request(method, url, headers=headers, follow_redirects=False, timeout=10.0)
        return {
            "case_id": case["id"],
            "url": url,
            "status": resp.status_code,
            "headers": dict(resp.headers),
            "body_sample": resp.text[:2048],
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }


    def main():
        case_file = Path(sys.argv[1])
        # No time-window check (spec §8.2 U4: one-shot baseline, unrestricted)

        chapter = yaml.safe_load(case_file.read_text())
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        out_dir = Path(__file__).parent / "artifacts" / day
        out_dir.mkdir(parents=True, exist_ok=True)

        results = []
        for case in chapter["cases"]:
            if "destructive" in case.get("tags", []):
                results.append({"case_id": case["id"], "skipped": "destructive"})
                continue
            akamai_host = case["hosts"]["akamai"]
            results.append(run_case(case, akamai_host))
            time.sleep(6)  # <= 10 req/min well below 10/hour budget

        out_file = out_dir / f"{chapter['chapter']}.json"
        out_file.write_text(json.dumps(results, indent=2, ensure_ascii=False))
        print(f"Wrote {out_file}")


    if __name__ == "__main__":
        main()
    ```

    `test-harness/probe/probe.py` —— 类似，但没 guards：

    ```python
    """CloudFront probe — full scenarios."""
    from __future__ import annotations
    import json
    import sys
    from pathlib import Path
    from datetime import datetime, timezone
    import httpx
    import yaml


    def run_case(case: dict, cf_host: str) -> dict:
        method = case["request"].get("method", "GET")
        url = case["request"]["url"].replace("{host}", cf_host)
        headers = dict(case["request"].get("headers", {}))
        headers.setdefault("Host", cf_host)

        resp = httpx.request(method, url, headers=headers, follow_redirects=False, timeout=10.0)
        return {
            "case_id": case["id"],
            "url": url,
            "status": resp.status_code,
            "headers": dict(resp.headers),
            "body_sample": resp.text[:2048],
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }


    def main():
        case_file = Path(sys.argv[1])
        chapter = yaml.safe_load(case_file.read_text())
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        out_dir = Path(__file__).parent / "artifacts" / day
        out_dir.mkdir(parents=True, exist_ok=True)

        results = []
        for case in chapter["cases"]:
            cf_host = case["hosts"]["cloudfront"]
            results.append(run_case(case, cf_host))

        out_file = out_dir / f"{chapter['chapter']}.json"
        out_file.write_text(json.dumps(results, indent=2, ensure_ascii=False))
        print(f"Wrote {out_file}")


    if __name__ == "__main__":
        main()
    ```

- [ ] **Step 8.4：compare.py + HTML 模板**

    `test-harness/report/compare.py`:

    ```python
    """Diff baseline + probe artifacts, render HTML matrix."""
    from __future__ import annotations
    import json
    import sys
    from pathlib import Path
    from datetime import datetime, timezone
    import yaml
    from jinja2 import Environment, FileSystemLoader, select_autoescape


    def load_latest(root: Path, chapter: str) -> list[dict]:
        # Pick the latest YYYY-MM-DD folder containing chapter json
        days = sorted([p.name for p in (root / "artifacts").glob("*") if p.is_dir()], reverse=True)
        for d in days:
            f = root / "artifacts" / d / f"{chapter}.json"
            if f.exists():
                return json.loads(f.read_text())
        return []


    def match_expectation(case: dict, actual: dict) -> tuple[bool, str]:
        if "skipped" in actual:
            return False, f"skipped ({actual['skipped']})"
        exp = case.get("expectations", {})
        if "status" in exp and actual["status"] != exp["status"]:
            return False, f"status mismatch: want {exp['status']} got {actual['status']}"
        if "status_in" in exp and actual["status"] not in exp["status_in"]:
            return False, f"status not in {exp['status_in']}: got {actual['status']}"
        # header checks
        for k, want in (exp.get("header_equals") or {}).items():
            got = actual["headers"].get(k, "")
            if got != want:
                return False, f"header {k}: want {want!r} got {got!r}"
        for k, substr in (exp.get("header_contains") or {}).items():
            got = actual["headers"].get(k, "")
            if substr not in got:
                return False, f"header {k}: does not contain {substr!r}"
        if "body_contains" in exp and exp["body_contains"] not in actual.get("body_sample", ""):
            return False, f"body does not contain {exp['body_contains']!r}"
        return True, "ok"


    def main():
        case_file = Path(sys.argv[1])
        chapter = yaml.safe_load(case_file.read_text())
        chap_id = chapter["chapter"]

        root = Path(__file__).resolve().parents[1]
        baseline = load_latest(root / "baseline", chap_id)
        probe = load_latest(root / "probe", chap_id)

        rows = []
        for case in chapter["cases"]:
            b = next((x for x in baseline if x.get("case_id") == case["id"]), {})
            p = next((x for x in probe if x.get("case_id") == case["id"]), {})
            b_ok, b_msg = match_expectation(case, b)
            p_ok, p_msg = match_expectation(case, p)
            rows.append({
                "id":          case["id"],
                "desc":        case.get("description", ""),
                "baseline":    b,
                "probe":       p,
                "baseline_ok": b_ok,
                "probe_ok":    p_ok,
                "baseline_msg": b_msg,
                "probe_msg":    p_msg,
                "match":       b_ok and p_ok,
            })

        env = Environment(
            loader=FileSystemLoader(root / "report" / "templates"),
            autoescape=select_autoescape(),
        )
        html = env.get_template("chapter-matrix.html.j2").render(
            chapter=chap_id, rows=rows, generated_at=datetime.now(timezone.utc).isoformat()
        )
        out_dir = root / "report" / "out"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_file = out_dir / f"{chap_id}-matrix.html"
        out_file.write_text(html)
        print(f"Wrote {out_file}")


    if __name__ == "__main__":
        main()
    ```

    `test-harness/report/templates/chapter-matrix.html.j2`:

    ```jinja
    <!DOCTYPE html>
    <html lang="zh">
    <head>
      <meta charset="UTF-8">
      <title>{{ chapter }} · comparison matrix</title>
      <style>
        body { background:#232f3e; color:#eee; font-family: system-ui, sans-serif; padding: 24px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #555; padding: 6px 10px; vertical-align: top; }
        th { background:#111; text-align:left; }
        .ok { color:#6cf; }
        .bad { color:#f66; }
      </style>
    </head>
    <body>
      <h1>{{ chapter }}</h1>
      <p>Generated at {{ generated_at }}</p>
      <table>
        <thead>
          <tr>
            <th>Case</th><th>Description</th>
            <th>Akamai</th><th>CloudFront</th><th>Match</th>
          </tr>
        </thead>
        <tbody>
        {% for r in rows %}
          <tr>
            <td><code>{{ r.id }}</code></td>
            <td>{{ r.desc }}</td>
            <td class="{{ 'ok' if r.baseline_ok else 'bad' }}">{{ r.baseline.status or '-' }} · {{ r.baseline_msg }}</td>
            <td class="{{ 'ok' if r.probe_ok else 'bad' }}">{{ r.probe.status or '-' }} · {{ r.probe_msg }}</td>
            <td>{{ '✅' if r.match else '❌' }}</td>
          </tr>
        {% endfor %}
        </tbody>
      </table>
    </body>
    </html>
    ```

- [ ] **Step 8.5：smoke YAML**

    `test-harness/cases/00-smoke.yaml`:

    ```yaml
    chapter: 00-smoke
    cases:
      - id: cf-www-home-200
        description: "CloudFront www 首页返回 200 且含 pc mock 标记"
        request:
          url: "https://{host}/"
          method: GET
        expectations:
          status: 200
          body_contains: "<!-- pc mock -->"
        hosts:
          akamai: www.beautyforever.com           # baseline 跑只读，CSTInjection 窗口决定是否实际触发
          cloudfront: www.beautyforever.keithyu.cloud
    ```

- [ ] **Step 8.6：Makefile**

    `test-harness/Makefile`:

    ```makefile
    VENV := .venv
    PY := $(VENV)/bin/python

    setup:
    	python3.11 -m venv $(VENV)
    	$(VENV)/bin/pip install -r requirements.txt

    test-guards:
    	PYTHONPATH=. $(VENV)/bin/pytest test/test_guards.py -v

    smoke-probe:
    	PYTHONPATH=. $(PY) probe/probe.py cases/00-smoke.yaml

    smoke-report:
    	PYTHONPATH=. $(PY) report/compare.py cases/00-smoke.yaml

    smoke: smoke-probe smoke-report
    	@echo "Open report/out/00-smoke-matrix.html"

    baseline-%:
    	PYTHONPATH=. $(PY) baseline/probe.py cases/$*.yaml

    probe-%:
    	PYTHONPATH=. $(PY) probe/probe.py cases/$*.yaml

    report-%:
    	PYTHONPATH=. $(PY) report/compare.py cases/$*.yaml

    .PHONY: setup test-guards smoke smoke-probe smoke-report
    ```

- [ ] **Step 8.7：跑 smoke**

    ```bash
    cd Cloudfront/test-harness
    make setup
    make test-guards  # 6 pass
    make smoke-probe
    make smoke-report
    # 预期：report/out/00-smoke-matrix.html 生成；probe 列 ✅；baseline 列 "-" 或 skipped（没跑）
    ```

- [ ] **Step 8.8：commit**

    ```bash
    git add Cloudfront/test-harness/
    git commit -m "phase0(test-harness): guards + probe + report scaffolding; 00-smoke passes on probe side"
    ```

---

## Task 09：delivery 骨架

**目标**：`index.html` 入口 + 12 章节占位 md + 深色 AWS 主题 CSS。可以本地浏览器直开。

**Files:**
- Create: `Cloudfront/delivery/index.html`
- Create: `Cloudfront/delivery/assets/style.css`
- Create: `Cloudfront/delivery/assets/app.js`
- Create: 12 份 `Cloudfront/delivery/NN-<topic>.md`（占位）

### Steps

- [ ] **Step 9.1：style.css**

    `Cloudfront/delivery/assets/style.css`:

    ```css
    :root {
      --bg: #232f3e;
      --bg-alt: #1a2332;
      --fg: #eaeded;
      --fg-dim: #9ba7b4;
      --accent: #ec7211;
      --accent-dim: #a85419;
      --border: #3a4759;
      --ok: #6cf;
      --bad: #f66;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      padding: 0;
      font-family: "Amazon Ember", -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;
      background: var(--bg);
      color: var(--fg);
      line-height: 1.6;
    }

    header.site {
      background: var(--bg-alt);
      border-bottom: 2px solid var(--accent);
      padding: 16px 32px;
    }

    header.site h1 { margin: 0; color: var(--accent); font-size: 20px; }

    main { max-width: 1100px; margin: 24px auto; padding: 0 24px; }

    .chapter-card {
      background: var(--bg-alt);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 16px 20px;
      margin-bottom: 12px;
    }

    .chapter-card h2 {
      margin: 0 0 4px;
      font-size: 16px;
      color: var(--accent);
    }

    .chapter-card .meta { color: var(--fg-dim); font-size: 13px; }

    .chapter-card a {
      color: var(--accent);
      text-decoration: none;
      border-bottom: 1px dotted var(--accent-dim);
    }

    .chapter-card a:hover { color: var(--fg); border-color: var(--fg); }

    code, pre {
      font-family: "SF Mono", Consolas, monospace;
      font-size: 13px;
    }

    pre {
      background: #111;
      border: 1px solid var(--border);
      padding: 12px;
      overflow-x: auto;
      border-radius: 4px;
    }

    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid var(--border); padding: 8px 12px; text-align: left; }
    th { background: var(--bg-alt); color: var(--fg); }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      margin-left: 6px;
    }
    .badge.pending { background: var(--border); color: var(--fg-dim); }
    .badge.done { background: var(--ok); color: #000; }
    ```

- [ ] **Step 9.2：index.html**

    `Cloudfront/delivery/index.html`:

    ```html
    <!DOCTYPE html>
    <html lang="zh">
    <head>
      <meta charset="UTF-8">
      <title>Akamai → AWS CloudFront 迁移评审 · beautyforever.com</title>
      <link rel="stylesheet" href="assets/style.css">
    </head>
    <body>
    <header class="site">
      <h1>Akamai → AWS CloudFront 迁移评审 · beautyforever.com</h1>
      <p class="meta">许昌龙麒电子商务 · 基于 2026-04-21 Akamai live audit · 交付日 2026-05-22</p>
    </header>
    <main>
      <h2>章节导航</h2>

      <h3>Part 1 · 流量入口</h3>
      <div class="chapter-card"><h2>01 Distribution + Origin 分流 <span class="badge pending">Pending</span></h2><p class="meta">HTTP/2-only · 2 Distribution · Host-based ALB routing</p><a href="01-distribution-behaviors.html">→ 阅读</a></div>
      <div class="chapter-card"><h2>02 PC ↔ M 跳转 + UA/路径白名单 <span class="badge pending">Pending</span></h2><p class="meta">302 + LqPassWaf UA + Apple Pay + js/css 不跳转</p><a href="02-redirect-whitelist.html">→ 阅读</a></div>
      <div class="chapter-card"><h2>03 ?akaCache=nce 全局缓存 Backdoor <span class="badge pending">Pending</span></h2><a href="03-akacache-backdoor.html">→ 阅读</a></div>

      <h3>Part 2 · 缓存行为</h3>
      <div class="chapter-card"><h2>04 Cache Policy + TTL 矩阵 <span class="badge pending">Pending</span></h2><a href="04-cache-policy-ttl.html">→ 阅读</a></div>
      <div class="chapter-card"><h2>05 Query String 规范化 <span class="badge pending">Pending</span></h2><a href="05-query-normalize.html">→ 阅读</a></div>
      <div class="chapter-card"><h2>06 Cookie Cache Key <span class="badge pending">Pending</span></h2><a href="06-cookie-cache-key.html">→ 阅读</a></div>

      <h3>Part 3 · Response</h3>
      <div class="chapter-card"><h2>07 Headers + HSTS + True-Client-IP <span class="badge pending">Pending</span></h2><a href="07-headers-hsts-xff.html">→ 阅读</a></div>

      <h3>Part 4 · WAF</h3>
      <div class="chapter-card"><h2>08 WAF 框架：Match Targets + 3 Policy <span class="badge pending">Pending</span></h2><a href="08-waf-policy-framework.html">→ 阅读</a></div>
      <div class="chapter-card"><h2>09 Custom Rules + ASN 202425 <span class="badge pending">Pending</span></h2><a href="09-custom-rules-asn.html">→ 阅读</a></div>
      <div class="chapter-card"><h2>10 Rate + Slow POST + Bot Manager <span class="badge pending">Pending</span></h2><a href="10-rate-slowpost-bot.html">→ 阅读</a></div>

      <h3>Part 5 · 可观测 + 迁移红利</h3>
      <div class="chapter-card"><h2>11 Real-time Logs → Kinesis → Python → Doris <span class="badge pending">Pending</span></h2><a href="11-realtime-logs-doris.html">→ 阅读</a></div>
      <div class="chapter-card"><h2>12 Tag-Based Invalidation + Continuous Deployment <span class="badge pending">Pending</span></h2><a href="12-tag-invalidation-cd.html">→ 阅读</a></div>

      <h3>汇总</h3>
      <div class="chapter-card"><h2>99 对比测试总览矩阵 <span class="badge pending">Pending</span></h2><a href="99-comparison-matrix.html">→ 阅读</a></div>
    </main>
    </body>
    </html>
    ```

- [ ] **Step 9.3：12 份 md 占位**

    用 shell 一次生成：

    ```bash
    cd Cloudfront/delivery
    cat > app.js.tmpl <<'EOF'
    // placeholder
    EOF
    mv app.js.tmpl assets/app.js

    for f in \
      01-distribution-behaviors 02-redirect-whitelist 03-akacache-backdoor \
      04-cache-policy-ttl 05-query-normalize 06-cookie-cache-key \
      07-headers-hsts-xff \
      08-waf-policy-framework 09-custom-rules-asn 10-rate-slowpost-bot \
      11-realtime-logs-doris 12-tag-invalidation-cd; do
      cat > "$f.md" <<EOF
    # $f

    > **状态**: Pending. 将由对应 Part 的 plan 填充。

    ## §N.1 问题陈述（Akamai 原做法）

    _Pending_

    ## §N.2 CloudFront 对应方案

    _Pending_

    ## §N.3 差异与 trade-off

    _Pending_

    ## §N.4 验证证据

    _Pending_

    ## §N.5 客户确认项

    - [ ] _Pending_
    EOF
    done
    ```

- [ ] **Step 9.4：本地预览**

    ```bash
    cd Cloudfront/delivery
    python3 -m http.server 8000 &
    SERVER_PID=$!
    sleep 1
    curl -s http://localhost:8000/index.html | grep -c 'chapter-card'
    # 预期：12
    kill $SERVER_PID
    ```

- [ ] **Step 9.5：commit**

    ```bash
    git add Cloudfront/delivery/
    git commit -m "phase0(delivery): index.html + dark AWS theme CSS + 12 chapter placeholders"
    ```

---

## Task 10：Phase 0 端到端 smoke + 里程碑验证

**目标**：所有模块 apply 一次彻底通过；三个演示域名 HTTPS 能回 mock；test-harness smoke 在 probe 侧绿；delivery index.html 在浏览器能访问到。里程碑 **2026-04-29 Phase 0 完成** 达成。

### Steps

- [ ] **Step 10.1：从零 apply 一次（可选，适用于干净账号）**

    ```bash
    cd Cloudfront/terraform/environments/poc
    terraform destroy -auto-approve  # 只在你确认没重要资源时执行
    terraform apply -auto-approve
    # 总耗时约 15-20 分钟（CloudFront 最慢）
    ```

- [ ] **Step 10.2：端到端 smoke**

    ```bash
    for HOST in www m api; do
      echo "=== ${HOST}.beautyforever.keithyu.cloud ==="
      curl -s -o /dev/null -w "status=%{http_code} time=%{time_total}s\n" \
        https://${HOST}.beautyforever.keithyu.cloud/
    done
    curl -s https://www.beautyforever.keithyu.cloud/ | grep 'pc mock'
    curl -s https://m.beautyforever.keithyu.cloud/   | grep 'm mock'
    curl -s https://api.beautyforever.keithyu.cloud/ping | jq .ok
    ```

    **预期**：全部非空匹配，HTTP 200，time_total < 2s。

- [ ] **Step 10.3：test-harness smoke 绿**

    ```bash
    cd Cloudfront/test-harness
    make smoke
    open report/out/00-smoke-matrix.html  # macOS；Linux 用浏览器打开
    # 预期：probe 列 ✅ ；baseline 列 "-"（未在窗口内跑）
    ```

- [ ] **Step 10.4：WAF 请求计入 CloudWatch**

    ```bash
    aws --profile default --region us-east-1 cloudwatch get-metric-statistics \
      --namespace AWS/WAFV2 \
      --metric-name AllowedRequests \
      --start-time "$(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S)" \
      --end-time   "$(date -u +%Y-%m-%dT%H:%M:%S)" \
      --period 60 --statistics Sum \
      --dimensions Name=WebACL,Value=akamai-to-aws-longqi-deny Name=Region,Value=CLOUDFRONT
    # 预期：Datapoints 非空（因为 step 10.2 刚刚触发了 www 请求）
    ```

- [ ] **Step 10.5：Doris 可连**

    （通过 SSM 到 log-consumer EC2，再 mysql 到 Doris）

    ```bash
    CONSUMER=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=akamai-to-aws-longqi-log-consumer" --query 'Reservations[0].Instances[0].InstanceId' --output text)
    DORIS_IP=$(terraform -chdir=Cloudfront/terraform/environments/poc output -raw doris_private_ip)
    aws --profile default ssm start-session --target $CONSUMER \
      --document-name AWS-StartNonInteractiveCommand \
      --parameters command="mysql -uroot -h$DORIS_IP -P9030 -e 'SHOW BACKENDS;'"
    # 预期：BE 行 Alive=true
    ```

    _Note: 如果 SSM non-interactive 不行，用 `aws ssm start-session --target $CONSUMER` 交互式 shell 跑 mysql 命令。_

- [ ] **Step 10.6：更新 index 文件中 phase0 状态**

    修改 `docs/superpowers/plans/2026-04-22-akamai-to-aws-longqi-index.md`，把 phase0 行的状态改为 `✅ 已完成`。

- [ ] **Step 10.7：commit + push**

    ```bash
    git add docs/superpowers/plans/2026-04-22-akamai-to-aws-longqi-index.md
    git commit -m "phase0: end-to-end smoke passing · milestone 2026-04-29 achieved"
    git push origin main
    ```

---

## Phase 0 完成清单

- [ ] Task 01: Terraform root + backend
- [ ] Task 02: ACM 证书 × 3（SAN 含 `m`）
- [ ] Task 03: Origin EC2 + ALB
- [ ] Task 04: Node.js mock（5 smoke test 绿）
- [ ] Task 05: 2 CloudFront Distribution（HTTP/2-only）
- [ ] Task 06: 3 空 WAF Web ACL
- [ ] Task 07: Doris + Kinesis + log-consumer 骨架
- [ ] Task 08: test-harness 骨架（4 guard test 绿）
- [ ] Task 09: delivery index + 12 占位
- [ ] Task 10: 端到端 smoke · 里程碑达成

**下一步**：执行 [`2026-04-22-akamai-to-aws-longqi-part1-entry.md`](./2026-04-22-akamai-to-aws-longqi-part1-entry.md)。
