# 账号 / Contract / Group / API Client 权限

## 账号

| 字段 | 值 |
|---|---|
| Account Name | Xuchang Longqi E-Commerce Co., Ltd. （许昌龙麒电子商务） |
| Account ID | `act_F-AC-4891758` |
| Contract ID | `ctr_V-4GARL4E` |
| Contract Type | INDIRECT_CUSTOMER |
| Group Name | Xuchang Longqi E-Commerce Co., Ltd.-V-4GARL4E |
| Group ID | `grp_230665` |
| Parent Group | （无，顶级）|

## 同组内的 Property 一览

> **2026-04-21 Live Audit**：版本号已用 `akamai pm list-properties -c ctr_V-4GARL4E -g grp_230665` 实时核对，表格与 API 返回一致。
> 承载 `beautyforever.com` 业务流量的实为前 2 个（`beautyforever.com_essl` 和 `api.beautyforever.com`）；下面 4 个同前缀 property 属于同账号其他用途，**迁移范围请以实际 DNS/流量为准**：
> - `beautyforever.com` (prp_883650) v36 —— 从未激活生产，疑似历史残留
> - `beautyforever.com_akamai_test` (prp_899790) v9 —— Akamai 测试 property
> - `dev-beautyforever.com` (prp_923813) v51 —— 开发环境
> - `sapi.beautyforever.com` (prp_1093527) v6 —— staging API（WAF hostname coverage 标注为 `Policy Api-Evaluation`）

| Property Name | Property ID | Production Ver | Latest Ver | Staging Ver |
|---|---|---|---|---|
| **beautyforever.com_essl** | `prp_910841` | **62** | 63 ⚠ HSTS staging | 63 |
| beautyforever.com | `prp_883650` | — | 36 | — |
| beautyforever.com_akamai_test | `prp_899790` | — | 9 | — |
| dev-beautyforever.com | `prp_923813` | 51 | 51 | 51 |
| **api.beautyforever.com** | `prp_956325` | **10** | 11 ⚠ HSTS staging | 11 |
| sapi.beautyforever.com | `prp_1093527` | 6 | 6 | 6 |
| unice.com | `prp_1010833` | 175 | 175 | 175 |
| fr.unice.com | `prp_1198989` | 10 | 12 | 12 |
| sapi.unice.com | `prp_1093531` | 5 | 5 | 5 |
| tm.unice.com | `prp_1255583` | 7 | 8 | 8 |
| juliahair.com | `prp_1026538` | 6 | 6 | 6 |
| juliahair.com_new | `prp_1041097` | 38 | 40 | 35 |
| sapi.juliahair.com | `prp_1093535` | 6 | 6 | 6 |
| nadula.com | `prp_949019` | 46 | 47 | 47 |
| sapi.nadula.com | `prp_1093537` | 4 | 4 | 4 |
| dev-velvethairextension.com | `prp_931346` | 7 | 7 | 7 |

## API Client 权限

凭据文件：`/root/.edgerc`，包含 `[default] [papi] [appsec]` 三节（同一套 key）。

**已授予的 API 能力：**

| API Path | 可用？ | 说明 |
|---|:---:|---|
| `GET /papi/v1/contracts` | ✅ | |
| `GET /papi/v1/groups` | ✅ | |
| `GET /papi/v1/properties` | ✅ | 需带 contractId + groupId |
| `GET /papi/v1/properties/{pid}/versions/{v}/rules` | ✅ | **完整 rule tree** |
| `GET /papi/v1/properties/{pid}/versions/{v}/hostnames` | ✅ | |
| `POST /papi/v1/search/find-by-value` | ❌ 403 | 没有 grant，`pm search` / `pm lph` 会失败 |
| `GET /appsec/v1/configs` | ✅ | |
| `GET /appsec/v1/configs/{id}/versions/{v}` | ✅ | |
| `GET /appsec/v1/configs/{id}/versions/{v}/match-targets` | ✅ | |
| `GET /appsec/v1/configs/{id}/versions/{v}/security-policies` | ✅ | |
| `GET /appsec/v1/hostname-coverage` | ✅ | |

**影响：** 任何依赖 `find-by-value` 的「按 hostname 反查 property」命令都不可用，需要先 `list-properties` 拿到 Property ID，再用显式 ID 查 hostnames / rules。本次调研的所有输出都用这个路径拿到，数据是完整的。

## 采集工具

- **akamai CLI v2.0.3**（`/usr/local/bin/akamai`，下载自 [akamai/cli](https://github.com/akamai/cli/releases)）
- 安装包：
  - `akamai property-manager`（PAPI DevOps CLI）
  - `akamai appsec`（Application Security CLI）
- Python：`akamai.edgegrid`（官方 SDK）用于直接打 PAPI REST。
