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
├── server.js                # 单进程入口，按 Host header 分流
├── package.json
├── routes/
│   ├── www.js               # www 域名路由
│   ├── m.js                 # m 域名路由
│   └── api.js               # api 域名路由
├── middleware/
│   ├── cookie-inject.js     # Set-Cookie 注入
│   ├── ua-detect.js         # UA 判断（PC / M / LqPassWaf）
│   ├── cache-headers.js     # Cache-Control 双头输出
│   └── surrogate-key.js     # ch12 tag 响应头
├── views/                   # 模板（Nuxt-like 伪 SSR）
├── public/                  # 静态资源（css/js/字体/图片）
├── docker-compose.yml       # 本地开发用
└── deploy/
    ├── ec2-user-data.sh     # EC2 启动脚本（由 terraform 调用）
    └── systemd.service      # 系统服务
```

## 运行方式

### 本地开发

```bash
docker compose up
# 或
node server.js
```

### 生产（POC）部署

由 `terraform/modules/origin-ec2/` 的 user-data 自动拉起；systemd 守护。

## 监听方式

单进程 Node.js 按 **Host header** 分流（不是按端口）：
- `Host: www.beautyforever.keithyu.cloud` → `routes/www.js`
- `Host: m.beautyforever.keithyu.cloud` → `routes/m.js`
- `Host: api.beautyforever.keithyu.cloud` → `routes/api.js`

ALB 端通过 3 条 host-based listener rule 把流量转到同一 EC2 target group（单 target，单端口）。

## 章节对应

每章节扩展相关路由/中间件。详见 [`docs/superpowers/specs/2026-04-22-akamai-to-aws-longqi-design.md`](../../docs/superpowers/specs/2026-04-22-akamai-to-aws-longqi-design.md) §5.5 每章交付模板。
