# 查询命令参考

> 重现本次调研 / Team Agent 继续深挖的 CLI 和 API 命令集。

## 前置：凭据

`/root/.edgerc` 内置三节（`default`、`papi`、`appsec`）同一套 key。

```ini
[default]
client_secret = 1rNcDeJWFvInSW+rS4YEJSsX54HgFvCG2nEXYG1InBs=
host = akab-cy5rj3csv3v7dn24-d3vlgpdgxrfscikd.luna.akamaiapis.net
access_token = akab-wreeb2qdtwedjpl3-4edtwmulhcgd4ali
client_token = akab-25vbjix7hlb7mvdq-5i3asijmzu47elt5

[papi]
（同上）

[appsec]
（同上）
```

**当前 API client 缺失 grant：**`POST /papi/v1/search/find-by-value`，所以基于搜索的 CLI 命令（`pm search` / `pm lph`）会 403。绕路：先 `pm list-properties` 拿 Property ID，再显式按 ID 查。

## 常用 CLI 命令

### Property Manager

```bash
# 账号信息
akamai pm list-contracts
akamai pm list-groups

# Property 列表（必须带 contract + group）
akamai pm list-properties -c ctr_V-4GARL4E -g grp_230665

# Rule tree（推荐用 Python edgegrid 直连，CLI 下面命令在本权限下可能触发 find-by-value）
akamai pm sr -p beautyforever.com_essl --propver 62
akamai pm sr -p api.beautyforever.com --propver 10
```

### Application Security（WAF）

```bash
# 所有 security configs
akamai appsec configs --json

# config version 元数据
akamai appsec version --config-id 89613 --version 145 --json

# 所有 policies
akamai appsec policies --config-id 89613 --version 145 --json

# match-targets（hostname → policy 映射）
akamai appsec match-targets --config-id 89613 --version 145 --json

# hostname 覆盖度
akamai appsec hostname-coverage --json

# —— 下面几组 Team Agent 可接着挖 ——

# 某 policy 的 selected hostnames
akamai appsec selected-hostnames --config-id 89613 --version 145 --policy-id qik1_201886 --json

# Custom Rules
akamai appsec custom-rules --config-id 89613 --json
akamai appsec custom-rules --config-id 89613 --version 145 --json

# Attack Group 规则动作（每个 policy 单独拉）
akamai appsec attack-group --config-id 89613 --version 145 --policy-id qik1_201886 --json   # Policy Deny
akamai appsec attack-group --config-id 89613 --version 145 --policy-id 1218_239915 --json   # Policy Alert
akamai appsec attack-group --config-id 89613 --version 145 --policy-id 0124_243504 --json   # Policy Api

# Rate 限流
akamai appsec rate-policies --config-id 89613 --version 145 --json

# Slow POST 防护
akamai appsec slow-post --config-id 89613 --version 145 --policy-id qik1_201886 --json

# Bot Manager
akamai appsec bot-category-action --config-id 89613 --version 145 --policy-id qik1_201886 --json
akamai appsec bot-detection --config-id 89613 --version 145 --json
akamai appsec custom-bot-category --config-id 89613 --version 145 --json

# Reputation
akamai appsec reputation-profile --config-id 89613 --version 145 --json

# Network Lists（Bypass 白名单等）—— 需要 network-lists CLI
akamai install network-lists
akamai network-lists list --json | jq '.networkLists[] | select(.uniqueId=="146351_SECURITYBYPASSLIST")'
```

## 直调 PAPI（绕开 CLI 的 find-by-value 限制）

使用 Python `akamai.edgegrid`：

```python
import os, requests
from akamai.edgegrid import EdgeGridAuth, EdgeRc
from urllib.parse import urljoin

rc = EdgeRc(os.path.expanduser("~/.edgerc"))
sec = "default"
base = f"https://{rc.get(sec,'host')}"
s = requests.Session()
s.auth = EdgeGridAuth.from_edgerc(rc, sec)

CONTRACT = "ctr_V-4GARL4E"
GROUP    = "grp_230665"

def get(path, **params):
    params.update(contractId=CONTRACT, groupId=GROUP)
    return s.get(urljoin(base, path), params=params).json() if 'json' in s.get(urljoin(base, path), params=params).headers.get('content-type','') else s.get(urljoin(base, path), params=params).text

# Hostnames
get("/papi/v1/properties/prp_910841/versions/62/hostnames")
get("/papi/v1/properties/prp_956325/versions/10/hostnames")

# Rule tree
get("/papi/v1/properties/prp_910841/versions/62/rules")
get("/papi/v1/properties/prp_956325/versions/10/rules")

# Edge Hostnames 详情
get("/papi/v1/edgehostnames/ehn_5327863")
get("/papi/v1/edgehostnames/ehn_5406989")

# Activations 历史
get("/papi/v1/properties/prp_910841/activations")
get("/papi/v1/properties/prp_956325/activations")

# CP Codes
get("/papi/v1/cpcodes")
```

> 本地已有现成脚本：`/tmp/akamai_query.py`，命令行：
> ```bash
> python3 /tmp/akamai_query.py hostnames prp_910841 62
> python3 /tmp/akamai_query.py rules     prp_910841 62
> ```

## 原始响应已保存

本目录 [raw/](../raw/) 已包含（采集时间 2026-04-21）：

| 文件 | 内容 |
|---|---|
| `essl_hostnames.json` | `beautyforever.com_essl` v62 的 hostnames |
| `essl_rules.json` | `beautyforever.com_essl` v62 的完整 rule tree |
| `api_hostnames.json` | `api.beautyforever.com` v10 的 hostnames |
| `api_rules.json` | `api.beautyforever.com` v10 的完整 rule tree |
| `waf_version.json` | 安全配置 v145 元数据 |
| `waf_policies.json` | 3 条 security policies |
| `waf_match_targets.json` | hostname → policy 映射 |
| `waf_hostname_coverage.json` | 全账号 hostname WAF 覆盖度 |

可以直接 `cat` / `jq` 离线分析，不需要再打 Akamai API。

## 快速验证（活体）

```bash
# 看 Akamai 边缘返回头（X-Cache / X-True-Cache-Key）
curl -sI 'https://www.beautyforever.com/' | head -30
curl -sI 'https://m.beautyforever.com/'   | head -30
curl -sI 'https://api.beautyforever.com/' | head -30

# 强制绕过缓存
curl -sI 'https://www.beautyforever.com/?akaCache=nce' | grep -i cache

# 看边缘 DNS 解析（确认落点）
dig +short www.beautyforever.com
dig +short beautyforever.com.edgekey.net
dig +short api.beautyforever.com
dig +short api.beautyforever.com.edgekey.net
```

## 重要 ID 速查

| 资源 | ID |
|---|---|
| Account | `act_F-AC-4891758` |
| Contract | `ctr_V-4GARL4E` |
| Group | `grp_230665` |
| Property `beautyforever.com_essl` | `prp_910841` / Asset `aid_11153387` |
| Property `api.beautyforever.com` | `prp_956325` / Asset `aid_11208151` |
| Edge Hostname `beautyforever.com.edgekey.net` | `ehn_5327863` |
| Edge Hostname `api.beautyforever.com.edgekey.net` | `ehn_5406989` |
| CP Code www/m | `1435979` |
| WAF Config | `89613` / v145 |
| WAF Policy Deny | `qik1_201886` |
| WAF Policy Alert | `1218_239915` |
| WAF Policy Api | `0124_243504` |
| WAF Bypass Network List | `146351_SECURITYBYPASSLIST` |
| Match Target (www+m) | `5789054` |
| Match Target (tapi) | `8996562` |
| Match Target (api) | `7384226` |
