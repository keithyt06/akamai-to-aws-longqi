# Cloudfront / hands-on

> AWS Console 手动配置手册（12 章，逐章交付）。

## 用途

用于**亲手在 AWS Console 操作**时的分步指南：带截图位、关键配置项、对应 `terraform/modules/NN-*/` 的引用。客户评审 / 内部培训 / 复现验证都用这个。

## 每章文件命名

```
NN-<topic>.md
```

其中 `NN` 为 01..12，对应 [`docs/superpowers/specs/2026-04-22-akamai-to-aws-longqi-design.md`](../../docs/superpowers/specs/2026-04-22-akamai-to-aws-longqi-design.md) §5.1 章节地图。

## 每章统一结构

1. Akamai 现状摘录（引用 `Akamai/doc/` 的锚点）
2. CloudFront / WAF 等价做法（Console 步骤 + 截图位）
3. 关键配置项截图/表格
4. 与 `terraform/modules/NN-*/` 的对应关系
5. 验证方法（指向 `test-harness/cases/NN-*.yaml`）

## 进度

- [ ] 01 Distribution + Origin 分流
- [ ] 02 PC ↔ M 跳转 + UA / 路径白名单
- [ ] 03 ?akaCache=nce 全局缓存 Backdoor
- [ ] 04 Cache Policy + TTL 矩阵
- [ ] 05 Query String 规范化
- [ ] 06 Cookie Cache Key
- [ ] 07 Headers + HSTS + True-Client-IP + XFF 修复
- [ ] 08 WAF 框架：Match Targets + 3 Policy
- [ ] 09 Custom Rules + ASN 202425
- [ ] 10 Rate Policy + Bot Control (Common + Targeted by path)
- [ ] 11 Real-time Logs → Kinesis → Python → Doris
- [ ] 12 Tag-Based Invalidation + Continuous Deployment
