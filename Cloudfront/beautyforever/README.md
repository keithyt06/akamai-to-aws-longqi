# Cloudfront / beautyforever

> 极简 Node.js mock 源站，部署在**单台 EC2** 上，作为 CloudFront 的回源。

## 目标

用最少的代码模拟 Akamai 调研文档中要求的**所有可验证响应特征**：
- Set-Cookie（`currency`、`group_id`、`abTest`、`customer_group`）
- Cache-Control（`s-maxage` vs `max-age`，双头策略）
- User-Agent 判断（PC ↔ M 跳转分支）
- Vary（api 侧保留）
- 34 个追踪参数的原样回显（用于验证 EXCLUDE 是否生效）
- `Surrogate-Key` 响应头（ch12 tag invalidation）
- 各路径的 HTML/JSON 内容（首页/列表/详情/博客/活动/`/static/`；api JSON）

**非目标**：真实电商业务逻辑（购物车/支付/订单）。

## 结构（待实现）

```
beautyforever/
├── server.js                # 单进程入口，按 X-Viewer-Host 分流（fallback Host）
├── package.json             # Express 4.x（ESM）
├── .gitignore
├── routes/
│   ├── www.js               # www 域名路由（首页/列表/博客/活动/静态）
│   ├── m.js                 # m 域名路由（同上，Mobile 变体）
│   └── api.js               # api 域名路由（/ping + /v1/* JSON mocks）
├── middleware/              # 按 chapter 逐章扩展（phase0 先空）
│   └── waf-labels.js        # ch09 读 X-BF-WAF-Labels，做 SEO 降级（part4 T19）
└── test/
    └── smoke.test.js        # phase0 本地 smoke（4 tests via node --test）
```

**Note**：不使用 docker-compose；本地开发直接 `npm install && node server.js`。生产由 EC2 user-data 的 systemd service `bfmock.service` 拉起（terraform 模块 `origin-ec2/user-data.sh` 管理）。

## 运行方式

### 本地开发

```bash
npm install
node server.js
# smoke test:  npm test
```

### 生产（POC）部署

由 `terraform/modules/origin-ec2/` 的 user-data 在 EC2（`t3.xlarge`，customer T3 U2 确认）启动时 `git clone` + `npm install` 拉起；systemd 守护。

## 监听方式

单进程 Node.js 按 **`X-Viewer-Host` header** 分流（**不是** Host header，**不是**按端口）：
- `X-Viewer-Host: www.beautyforever.keithyu.cloud` → `routes/www.js`
- `X-Viewer-Host: m.beautyforever.keithyu.cloud` → `routes/m.js`
- `X-Viewer-Host: api.beautyforever.keithyu.cloud` → `routes/api.js`

**为什么不是 Host header**：CloudFront 不允许透传 viewer 原始 Host（总是把 Origin 配置的 domain 作为 Host 发给 origin）。Phase 0 的 CloudFront Function (viewer-request) 把原始 Host 注入 `X-Viewer-Host`；ALB 的 3 条 listener rule 用 `http_header` 按 `X-Viewer-Host` 匹配，分派到同一 EC2 target group（单 target，单端口 8080）。

对齐 Akamai essl §3 `forwardHostHeader = REQUEST_HOST_HEADER` 语义；详见 coverage-matrix A4（customer T1 2026-04-22 确认）。

## 章节对应

每章节扩展相关路由/中间件。详见 [`docs/superpowers/specs/2026-04-22-akamai-to-aws-longqi-design.md`](../../docs/superpowers/specs/2026-04-22-akamai-to-aws-longqi-design.md) §5.5 每章交付模板。
