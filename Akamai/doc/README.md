# Akamai 配置调研 — Longqi / beautyforever.com

> 采集日期：**2026-04-21**
> 采集方式：Akamai CLI (`property-manager`、`appsec`) + PAPI 直调（`edgegrid-python`）
> 调研范围：`www.beautyforever.com`、`m.beautyforever.com`、`api.beautyforever.com` 三个域名的 CDN（Property Manager）与 WAF（Application Security）配置

## 目录导航

| 文件 | 说明 |
|---|---|
| [00-account-overview.md](00-account-overview.md) | 账号 / Contract / Group / API Client 权限说明 |
| [10-property-beautyforever-essl.md](10-property-beautyforever-essl.md) | Property **`beautyforever.com_essl`**（承载 www + m） v62 完整配置 |
| [11-property-api-beautyforever.md](11-property-api-beautyforever.md) | Property **`api.beautyforever.com`** v10 完整配置 |
| [20-waf-security-configuration.md](20-waf-security-configuration.md) | WAF 配置 `Security Configuration` (id 89613) v145 |
| [30-domain-www-beautyforever-com.md](30-domain-www-beautyforever-com.md) | 域名维度：`www.beautyforever.com` |
| [31-domain-m-beautyforever-com.md](31-domain-m-beautyforever-com.md) | 域名维度：`m.beautyforever.com` |
| [32-domain-api-beautyforever-com.md](32-domain-api-beautyforever-com.md) | 域名维度：`api.beautyforever.com` |
| [40-ops-verification.md](40-ops-verification.md) | **运维交叉比对记录**（4 条运维反馈 × raw JSON 核对 + 初版错误复盘）|
| [90-dynamic-static-analysis.md](90-dynamic-static-analysis.md) | **动静态请求分析（核心结论）** |
| [99-queries.md](99-queries.md) | 重现本次调研的 CLI / API 命令 |
| [raw/](../raw/) | 原始 JSON 响应（rule tree、hostnames、WAF match-targets 等）|

## 一句话结论

| 域名 | Property | WAF Policy | 动静态判定 |
|---|---|---|---|
| **www.beautyforever.com** | `beautyforever.com_essl` v62 | `Policy Deny` (qik1_201886) | 混合偏动态（Nuxt SSR + 页面缓存 6h–365d）|
| **m.beautyforever.com** | 同上（共享 Property） | `Policy Deny` | 混合偏动态 |
| **api.beautyforever.com** | `api.beautyforever.com` v10 | `Policy Api` (0124_243504) | **纯动态**（default=NO_STORE）|

详见 [90-dynamic-static-analysis.md](90-dynamic-static-analysis.md)。

## 账号与账号级资源

- Account: **`act_F-AC-4891758`**（Xuchang Longqi E-Commerce Co., Ltd. / 许昌龙麒）
- Contract: **`ctr_V-4GARL4E`**（INDIRECT_CUSTOMER）
- Group: **`grp_230665`**
- 同组内相关品牌：`beautyforever.com`、`unice.com`、`juliahair.com`、`nadula.com`、`velvethairextension.com`
