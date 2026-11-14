# 全站受保护 API 权限迁移清单（自动生成）

生成时间：2026-11-14T17:49:58.091Z

> 由 `scripts/tests/permissions-api-inventory.js` 静态扫描 `routes/*.js` 生成。
> 「Level 兼容层」接口同样有**真实后端鉴权**（Level >= 1 / Level 2），只是尚未细粒度化，不属于“前端隐藏、后端裸奔”。

## 统计

| 鉴权方式 | 接口数 |
|---|---|
| 细粒度权限（已迁移） | 107 |
| Level 兼容层（admin，Level >= 1） | 110 |
| Level 兼容层（superAdmin，Level 2） | 4 |
| 公开 | 155 |
| 登录用户（普通业务/用户自助） | 123 |
| 可选登录（公开） | 18 |
| 服务间/玩家令牌鉴权 | 15 |
| 处理函数内鉴权（服务间令牌/管理员） | 1 |
| 公开（仅限流） | 2 |
| **合计** | **535** |

## 细粒度权限（已迁移）（107）

| 文件 | 方法 | 路径 | 行号 | 细化权限 |
|---|---|---|---|---|
| admin.js | GET | `/users` | 11 | admin.users.view |
| admin.js | PUT | `/users/:id` | 59 | admin.users.edit |
| admin.js | PUT | `/users/:id/level` | 102 | admin.users.level |
| admin.js | GET | `/posts` | 147 | admin.posts.moderate |
| admin.js | PUT | `/posts/:id/pin` | 193 | admin.posts.moderate |
| admin.js | POST | `/announcements` | 228 | announcement.create |
| admin.js | PUT | `/announcements/:id` | 252 | announcement.edit |
| admin.js | DELETE | `/announcements/:id` | 277 | announcement.delete |
| admin.js | GET | `/statistics` | 291 | admin.statistics.view |
| admin.js | GET | `/dashboard` | 325 | admin.dashboard.view |
| admin.js | PUT | `/theme` | 412 | admin.theme.manage |
| contributions.js | POST | `/transfer` | 18 | economy.contribution_points.transfer |
| contributions.js | GET | `/logs` | 99 | economy.contribution_points.access |
| contributions.js | GET | `/all-logs` | 122 |  |
| contributions.js | GET | `/all-transfers` | 152 |  |
| contributions.js | PUT | `/admin/:userId` | 176 | economy.contribution_points.manage |
| gis.js | GET | `/admin/servers` | 104 |  |
| gis.js | POST | `/admin/servers` | 108 |  |
| gis.js | GET | `/admin/worlds` | 116 |  |
| gis.js | POST | `/admin/worlds` | 121 |  |
| gis.js | PUT | `/admin/worlds/:id` | 129 |  |
| gis.js | POST | `/admin/servers/:serverKey/archive-worlds` | 135 |  |
| gis.js | GET | `/admin/stats` | 142 |  |
| gis.js | GET | `/admin/audit` | 176 |  |
| gis.js | GET | `/client/bootstrap` | 188 |  |
| gis.js | POST | `/client/resolve-world` | 193 |  |
| gis.js | POST | `/client/chunks/plan` | 203 |  |
| gis.js | POST | `/client/chunks` | 241 |  |
| gis.js | GET | `/client/sync` | 263 |  |
| gis.js | GET | `/objects/:type/:id/revisions` | 307 |  |
| gis.js | GET | `/objects/:type/:id/revisions/:rev` | 314 |  |
| gis.js | POST | `/objects/:type/:id/publish` | 342 |  |
| gis.js | POST | `/objects/:type/:id/reject` | 347 |  |
| gis.js | POST | `/objects/:type/:id/rollback` | 352 |  |
| gis.js | DELETE | `/objects/:type/:id` | 359 |  |
| gis.js | GET | `/review/queue` | 373 |  |
| gis.js | POST | `/terrain/jobs` | 502 |  |
| gis.js | GET | `/jobs` | 516 |  |
| gis.js | GET | `/jobs/:id` | 520 |  |
| gis.js | POST | `/history/snapshots` | 533 |  |
| gis.js | GET | `/history/at` | 541 |  |
| gis.js | GET | `/history/diff` | 559 |  |
| gis.js | POST | `/history/archive` | 568 |  |
| gis.js | GET | `/places-refs` | 604 |  |
| gis.js | POST | `/places-refs` | 608 |  |
| gis.js | DELETE | `/places-refs/:externalSystem/:externalId` | 613 |  |
| gis.js | GET | `/audit/me` | 618 |  |
| market.js | GET | `/merchant/reviews` | 508 |  |
| market.js | POST | `/merchant/reviews/:id/reply` | 528 |  |
| market.js | POST | `/merchant/reviews/:id/status` | 554 |  |
| market.js | POST | `/merchant/stores` | 639 |  |
| market.js | GET | `/merchant/stores` | 717 |  |
| market.js | PUT | `/merchant/stores/:id` | 726 |  |
| market.js | POST | `/merchant/stores/:id/renew` | 759 |  |
| market.js | POST | `/merchant/stores/:id/status` | 805 |  |
| market.js | POST | `/merchant/stores/:id/locations` | 820 |  |
| market.js | PUT | `/merchant/locations/:id` | 841 |  |
| market.js | DELETE | `/merchant/locations/:id` | 873 |  |
| market.js | GET | `/merchant/products` | 886 |  |
| market.js | POST | `/merchant/products` | 901 |  |
| market.js | PUT | `/merchant/products/:id` | 934 |  |
| market.js | DELETE | `/merchant/products/:id` | 980 |  |
| market.js | GET | `/merchant/orders` | 995 |  |
| market.js | POST | `/merchant/verify` | 1018 |  |
| market.js | POST | `/merchant/orders/:id/deliver` | 1030 |  |
| market.js | POST | `/merchant/refunds/:id/:action` | 1043 |  |
| market.js | GET | `/merchant/finance` | 1074 |  |
| market.js | GET | `/admin/stores` | 1114 |  |
| market.js | POST | `/admin/stores/:id/review` | 1131 |  |
| market.js | POST | `/admin/stores/:id/status` | 1191 |  |
| market.js | GET | `/admin/config` | 1216 |  |
| market.js | PUT | `/admin/config` | 1223 |  |
| market.js | POST | `/admin/config/simulate` | 1230 |  |
| market.js | GET | `/admin/orders` | 1242 |  |
| market.js | POST | `/admin/orders/:id/refund` | 1269 |  |
| market.js | GET | `/admin/disputes` | 1310 |  |
| market.js | POST | `/admin/disputes/:id/resolve` | 1324 |  |
| market.js | GET | `/admin/finance` | 1336 |  |
| market.js | POST | `/admin/finance/adjust` | 1396 |  |
| market.js | GET | `/admin/archives` | 1432 |  |
| market.js | GET | `/admin/audit` | 1447 |  |
| market.js | POST | `/admin/categories` | 1461 |  |
| market.js | DELETE | `/admin/categories/:id` | 1472 |  |
| market.js | POST | `/admin/jobs/run` | 1480 |  |
| market.js | POST | `/admin/notify/dispatch` | 1487 |  |
| market.js | GET | `/admin/notify/events` | 1493 |  |
| market.js | GET | `/admin/reconcile` | 1507 |  |
| permissions.js | GET | `/users/:id/permissions` | 181 |  |
| permissions.js | GET | `/users/:id/roles` | 186 |  |
| wiki.js | GET | `/stats` | 159 | wiki.access |
| wiki.js | GET | `/admin/pages` | 168 | wiki.access |
| wiki.js | GET | `/admin/revisions` | 186 | wiki.access |
| wiki.js | POST | `/categories` | 307 | wiki.category.manage |
| wiki.js | PUT | `/categories/:id` | 317 | wiki.category.manage |
| wiki.js | DELETE | `/categories/:id` | 327 | wiki.category.delete |
| wiki.js | GET | `/review-config` | 337 | wiki.review.config |
| wiki.js | PUT | `/review-config` | 346 | wiki.review.config |
| wiki.js | POST | `/review-config/test` | 363 | wiki.review.config |
| wiki.js | DELETE | `/:id` | 413 | wiki.page.delete |
| wiki.js | POST | `/:id/publish` | 426 | wiki.page.review |
| wiki.js | POST | `/:id/archive` | 437 | wiki.page.review |
| wiki.js | POST | `/:id/restore` | 447 | wiki.page.review |
| wiki.js | POST | `/:id/revisions/:revisionId/restore` | 458 | wiki.revision.restore |
| wiki.js | GET | `/submissions/pending-count` | 631 | wiki.access |
| wiki.js | POST | `/submissions/:id/approve` | 679 | wiki.page.review |
| wiki.js | POST | `/submissions/:id/reward` | 700 | wiki.page.review |
| wiki.js | POST | `/submissions/:id/reject` | 718 | wiki.page.review |

## Level 兼容层（admin，Level >= 1）（110）

| 文件 | 方法 | 路径 | 行号 | 细化权限 |
|---|---|---|---|---|
| banners.js | GET | `/all` | 22 |  |
| banners.js | POST | `/` | 33 |  |
| banners.js | PUT | `/:id` | 54 |  |
| banners.js | DELETE | `/:id` | 77 |  |
| chat.js | GET | `/admin/bubbles` | 164 |  |
| chat.js | POST | `/admin/bubbles` | 173 |  |
| chat.js | PUT | `/admin/bubbles/:id` | 190 |  |
| chat.js | DELETE | `/admin/bubbles/:id` | 206 |  |
| chat.js | DELETE | `/admin/messages/:id` | 217 |  |
| chat.js | POST | `/admin/stickers` | 310 |  |
| chat.js | GET | `/admin/stickers` | 326 |  |
| chat.js | DELETE | `/admin/stickers/:id` | 333 |  |
| checkin.js | POST | `/rewards` | 388 |  |
| claims.js | PUT | `/:id/review` | 150 |  |
| contribution-conversion.js | GET | `/candidates` | 36 |  |
| contribution-conversion.js | POST | `/preview` | 58 |  |
| contribution-conversion.js | GET | `/list` | 95 |  |
| contribution-conversion.js | GET | `/:id` | 101 |  |
| contribution-conversion.js | POST | `/:id/apply` | 108 |  |
| contribution-conversion.js | POST | `/:id/revert` | 120 |  |
| contribution-conversion.js | DELETE | `/:id` | 126 |  |
| discipline.js | POST | `/` | 32 |  |
| discipline.js | POST | `/:id/revoke` | 136 |  |
| discipline.js | GET | `/list` | 205 |  |
| donation.js | GET | `/admin/search-users` | 85 |  |
| donation.js | POST | `/admin/materials` | 104 |  |
| donation.js | POST | `/admin/qr` | 133 |  |
| donation.js | POST | `/admin/entry` | 156 |  |
| donation.js | PUT | `/admin/entry/:id` | 168 |  |
| donation.js | DELETE | `/admin/entry/:id` | 180 |  |
| donation.js | GET | `/export/xlsx` | 193 |  |
| express-index.js | GET | `/settings` | 83 |  |
| express-index.js | PUT | `/settings` | 87 |  |
| express-index.js | POST | `/snapshot` | 109 |  |
| express-index.js | POST | `/settle` | 114 |  |
| express-index.js | GET | `/holdings/summary` | 123 |  |
| express-index.js | GET | `/stocks/:stockId/holdings` | 128 |  |
| faq.js | GET | `/admin/status` | 163 |  |
| faq.js | GET | `/admin/config` | 193 |  |
| faq.js | POST | `/admin/test/connectivity` | 295 |  |
| faq.js | POST | `/admin/test/ask` | 308 |  |
| faq.js | GET | `/admin/index` | 323 |  |
| faq.js | POST | `/admin/index/:pageId/rebuild` | 350 |  |
| faq.js | GET | `/admin/tasks` | 363 |  |
| faq.js | POST | `/admin/tasks/:id/retry` | 376 |  |
| faq.js | POST | `/admin/process-tasks` | 390 |  |
| faq.js | POST | `/admin/reconcile` | 400 |  |
| faq.js | GET | `/admin/rebuild/status` | 420 |  |
| faq.js | GET | `/admin/usage` | 437 |  |
| faq.js | GET | `/admin/logs` | 450 |  |
| faq.js | GET | `/admin/feedback` | 471 |  |
| faq.js | POST | `/admin/retrieve` | 496 |  |
| generations.js | POST | `/` | 42 |  |
| generations.js | PUT | `/:id` | 58 |  |
| generations.js | DELETE | `/:id` | 73 |  |
| generations.js | PUT | `/user/:userId` | 84 |  |
| mc.js | GET | `/status-detail` | 42 |  |
| mod.js | GET | `/servers` | 891 |  |
| mod.js | POST | `/servers` | 902 |  |
| mod.js | PUT | `/servers/:id` | 919 |  |
| mod.js | DELETE | `/servers/:id` | 935 |  |
| oauth.js | GET | `/clients` | 365 |  |
| oauth.js | POST | `/clients` | 388 |  |
| oauth.js | PUT | `/clients/:id` | 433 |  |
| oauth.js | POST | `/clients/:id/rotate-secret` | 456 |  |
| oauth.js | DELETE | `/clients/:id` | 466 |  |
| oauth.js | GET | `/audit` | 474 |  |
| pay-confirm.js | GET | `/admin/sites` | 117 |  |
| pay-confirm.js | POST | `/admin/link` | 128 |  |
| pay-confirm.js | GET | `/admin/orders` | 178 |  |
| pay.js | GET | `/admin/approvals` | 1264 |  |
| pay.js | POST | `/admin/approve/:id` | 1375 |  |
| pay.js | GET | `/admin/records` | 1390 |  |
| pay.js | GET | `/admin/summary` | 1483 |  |
| pay.js | GET | `/admin/settings` | 1493 |  |
| pay.js | PUT | `/admin/settings` | 1503 |  |
| paygate.js | GET | `/sites` | 90 |  |
| paygate.js | POST | `/sites` | 96 |  |
| paygate.js | PUT | `/sites/:id` | 116 |  |
| paygate.js | DELETE | `/sites/:id` | 129 |  |
| paygate.js | GET | `/admin/orders` | 139 |  |
| paygate.js | GET | `/admin/logs` | 155 |  |
| shop.js | GET | `/admin/items` | 69 |  |
| shop.js | POST | `/verify` | 254 |  |
| shop.js | POST | `/confirm` | 325 |  |
| shop.js | POST | `/items` | 400 |  |
| shop.js | PUT | `/items/:id` | 445 |  |
| shop.js | DELETE | `/items/:id` | 471 |  |
| shop.js | GET | `/admin/sales` | 492 |  |
| stock.js | GET | `/stocks/all` | 176 |  |
| stock.js | POST | `/stocks` | 523 |  |
| stock.js | PUT | `/stocks/:id` | 549 |  |
| stock.js | POST | `/trigger-update` | 566 |  |
| stock.js | POST | `/stocks/:id/restore` | 576 |  |
| stock.js | DELETE | `/stocks/:id` | 597 |  |
| tasks.js | POST | `/` | 233 |  |
| tasks.js | GET | `/admin/list` | 262 |  |
| tasks.js | PUT | `/:id` | 280 |  |
| tasks.js | GET | `/:id/claims` | 300 |  |
| team.js | GET | `/configs` | 419 |  |
| team.js | GET | `/configs/:id` | 433 |  |
| team.js | POST | `/configs` | 444 |  |
| team.js | PUT | `/configs/:id` | 457 |  |
| team.js | DELETE | `/configs/:id` | 473 |  |
| titles.js | GET | `/all` | 21 |  |
| titles.js | GET | `/user/:userId` | 60 |  |
| titles.js | POST | `/grant` | 87 |  |
| titles.js | POST | `/` | 210 |  |
| titles.js | PUT | `/:id` | 230 |  |
| titles.js | DELETE | `/:id` | 247 |  |

## Level 兼容层（superAdmin，Level 2）（4）

| 文件 | 方法 | 路径 | 行号 | 细化权限 |
|---|---|---|---|---|
| faq.js | PUT | `/admin/config` | 261 |  |
| faq.js | POST | `/admin/config/clear-secret` | 282 |  |
| faq.js | POST | `/admin/rebuild` | 410 |  |
| faq.js | GET | `/admin/audit` | 486 |  |

## 公开（155）

| 文件 | 方法 | 路径 | 行号 | 细化权限 |
|---|---|---|---|---|
| admin.js | GET | `/announcements` | 211 |  |
| admin.js | GET | `/theme` | 401 |  |
| announcement.js | GET | `/popup` | 7 |  |
| announcement.js | GET | `/` | 24 |  |
| auth.js | POST | `/send-code` | 73 |  |
| auth.js | POST | `/register` | 134 |  |
| auth.js | POST | `/login` | 139 |  |
| auth.js | GET | `/user/:username` | 478 |  |
| auth.js | GET | `/qq/login` | 557 |  |
| auth.js | GET | `/qq/bind` | 569 |  |
| auth.js | GET | `/qq/callback` | 597 |  |
| banners.js | GET | `/` | 9 |  |
| cdn.js | GET | `/info` | 81 |  |
| cdn.js | GET | `/manifest` | 86 |  |
| cdn.js | POST | `/sign` | 104 |  |
| cdn.js | GET | `/sign` | 121 |  |
| checkin.js | GET | `/leaderboard` | 358 |  |
| checkin.js | GET | `/rewards` | 408 |  |
| discipline.js | GET | `/query` | 233 |  |
| discipline.js | GET | `/user/:userId` | 266 |  |
| donation.js | GET | `/summary` | 44 |  |
| donation.js | GET | `/donors` | 72 |  |
| economics.js | GET | `/overview` | 32 |  |
| economics.js | GET | `/export` | 256 |  |
| express-index.js | GET | `/quotes` | 39 |  |
| express-index.js | GET | `/settlements` | 44 |  |
| express-index.js | GET | `/history` | 61 |  |
| generations.js | GET | `/` | 19 |  |
| generations.js | GET | `/user/:userId` | 29 |  |
| gis.js | GET | `/config` | 58 |  |
| gis.js | GET | `/client/contract` | 80 |  |
| gis.js | GET | `/worlds` | 88 |  |
| gis.js | GET | `/worlds/:id` | 93 |  |
| gis.js | GET | `/servers` | 98 |  |
| gis.js | GET | `/objects` | 276 |  |
| gis.js | GET | `/objects/:type/:id` | 291 |  |
| gis.js | POST | `/objects/:type` | 322 |  |
| gis.js | PUT | `/objects/:type/:id` | 332 |  |
| gis.js | POST | `/objects/:type/:id/submit` | 337 |  |
| gis.js | POST | `/objects/:type/:id/wiki` | 365 |  |
| gis.js | GET | `/wiki/:wikiPageId/objects` | 385 |  |
| gis.js | GET | `/search` | 391 |  |
| gis.js | GET | `/place` | 400 |  |
| gis.js | GET | `/nearby` | 409 |  |
| gis.js | GET | `/terrain/coverage` | 423 |  |
| gis.js | GET | `/terrain/height` | 428 |  |
| gis.js | GET | `/terrain/contours` | 436 |  |
| gis.js | GET | `/terrain/grid` | 445 |  |
| gis.js | GET | `/terrain/slope` | 453 |  |
| gis.js | GET | `/terrain/hillshade` | 461 |  |
| gis.js | GET | `/terrain/profile` | 470 |  |
| gis.js | GET | `/terrain/distribution` | 485 |  |
| gis.js | GET | `/terrain/stats` | 493 |  |
| gis.js | GET | `/history/snapshots` | 528 |  |
| gis.js | GET | `/places` | 577 |  |
| gis.js | GET | `/places/:kind/:refId` | 585 |  |
| gis.js | GET | `/market/locations` | 590 |  |
| gis.js | GET | `/market/locations/count` | 599 |  |
| gmirs.js | GET | `/query` | 191 |  |
| gmirs.js | GET | `/user/:id` | 213 |  |
| gmirs.js | GET | `/verify` | 229 |  |
| gmirs.js | GET | `/export` | 255 |  |
| gmirs.js | GET | `/proxy-image` | 273 |  |
| launcher.js | GET | `/home.xaml` | 50 |  |
| market.js | GET | `/config` | 47 |  |
| market.js | GET | `/map/art.png` | 288 |  |
| mc.js | GET | `/servers` | 21 |  |
| mc.js | GET | `/status` | 32 |  |
| mod.js | POST | `/bind/request` | 86 |  |
| mod.js | GET | `/bind/confirm` | 141 |  |
| mod.js | GET | `/bind/status` | 172 |  |
| mod.js | GET | `/updates` | 660 |  |
| mod.js | POST | `/online/report` | 728 |  |
| mod.js | GET | `/online` | 829 |  |
| mod.js | POST | `/heartbeat` | 863 |  |
| oauth.js | GET | `/authorize` | 51 |  |
| oauth.js | POST | `/token` | 120 |  |
| oauth.js | POST | `/revoke` | 224 |  |
| oauth.js | GET | `/verify` | 266 |  |
| oauth.js | GET | `/userinfo` | 303 |  |
| oauth.js | GET | `/member` | 328 |  |
| oauth.js | GET | `/scopes` | 357 |  |
| password.js | POST | `/forgot-password` | 10 |  |
| password.js | POST | `/reset-password` | 46 |  |
| password.js | GET | `/verify-reset-token/:token` | 86 |  |
| pay-confirm.js | GET | `/:token` | 51 |  |
| pay.js | GET | `/render/charge.png` | 1220 |  |
| pay.js | GET | `/render/charge/:token.png` | 1231 |  |
| pay.js | GET | `/render/summary.png` | 1245 |  |
| pay.js | GET | `/qr.png` | 1539 |  |
| permissions.js | GET | `/registry` | 61 |  |
| permissions.js | GET | `/templates` | 84 |  |
| permissions.js | POST | `/registry/sync` | 89 |  |
| permissions.js | GET | `/roles` | 95 |  |
| permissions.js | POST | `/roles` | 107 |  |
| permissions.js | GET | `/roles/:id` | 112 |  |
| permissions.js | PUT | `/roles/:id` | 118 |  |
| permissions.js | PUT | `/roles/:id/permissions` | 124 |  |
| permissions.js | POST | `/roles/:id/status` | 132 |  |
| permissions.js | GET | `/roles/:id/members` | 139 |  |
| permissions.js | POST | `/roles/:id/members` | 146 |  |
| permissions.js | DELETE | `/roles/:id/members/:userId` | 152 |  |
| permissions.js | GET | `/users/search` | 159 |  |
| permissions.js | PUT | `/users/:id/roles` | 192 |  |
| permissions.js | GET | `/audit` | 199 |  |
| posts.js | GET | `/public-stats` | 21 |  |
| posts.js | GET | `/` | 38 |  |
| posts.js | GET | `/:id` | 114 |  |
| projections.js | GET | `/` | 18 |  |
| projections.js | GET | `/:id` | 50 |  |
| projections.js | POST | `/:id/download` | 100 |  |
| push.js | GET | `/vapid-public-key` | 16 |  |
| qqbot-pay.js | POST | `/receive-code` | 79 |  |
| qqbot-pay.js | POST | `/payer-code` | 112 |  |
| qqbot-pay.js | GET | `/records` | 143 |  |
| qqbot-pay.js | POST | `/charge` | 165 |  |
| qqbot-pay.js | POST | `/help-card` | 227 |  |
| qqbot-pay.js | GET | `/help-card/:hash.png` | 273 |  |
| qqbot-pay.js | GET | `/render-url` | 293 |  |
| qqbot-pay.js | GET | `/charge-poster` | 309 |  |
| qqbot-pay.js | GET | `/pending-approvals` | 331 |  |
| qqbot-pay.js | POST | `/approve/:id` | 345 |  |
| qqbot-rag.js | POST | `/ask` | 23 |  |
| qqbot-rag.js | GET | `/health` | 73 |  |
| qqbot.js | POST | `/bind` | 38 |  |
| qqbot.js | GET | `/user` | 143 |  |
| qqbot.js | POST | `/verify-code` | 157 |  |
| qqbot.js | POST | `/confirm-code` | 201 |  |
| qqbot.js | POST | `/task-complete` | 252 |  |
| rankings.js | GET | `/contribution` | 6 |  |
| rankings.js | GET | `/posts-views` | 34 |  |
| rankings.js | GET | `/posts-likes` | 71 |  |
| rankings.js | GET | `/checkin` | 108 |  |
| rankings.js | GET | `/stock` | 144 |  |
| rankings.js | GET | `/online-time` | 179 |  |
| shop.js | GET | `/items` | 29 |  |
| shop.js | GET | `/items/:id` | 51 |  |
| skins.js | GET | `/random` | 118 |  |
| stock.js | GET | `/stocks` | 163 |  |
| stock.js | GET | `/stocks/:id` | 189 |  |
| stock.js | GET | `/stocks/:id/history` | 214 |  |
| stock.js | GET | `/stocks/:id/kline` | 232 |  |
| team.js | GET | `/public` | 340 |  |
| team.js | GET | `/public/:id` | 354 |  |
| team.js | GET | `/list` | 366 |  |
| team.js | GET | `/export/:id` | 380 |  |
| team.js | POST | `/import` | 391 |  |
| titles.js | GET | `/` | 9 |  |
| updates.js | GET | `/latest.yml` | 46 |  |
| updates.js | GET | `/release-notes.json` | 63 |  |
| updates.js | GET | `/android/latest.json` | 76 |  |
| updates.js | GET | `/files/*` | 89 |  |
| wiki.js | GET | `/slug-suggest` | 147 |  |
| wiki.js | GET | `/submissions` | 640 |  |
| wiki.js | GET | `/submissions/:id` | 657 |  |

## 登录用户（普通业务/用户自助）（123）

| 文件 | 方法 | 路径 | 行号 | 细化权限 |
|---|---|---|---|---|
| auth.js | GET | `/me` | 228 |  |
| auth.js | PUT | `/profile` | 280 |  |
| auth.js | PUT | `/username` | 319 |  |
| auth.js | PUT | `/password` | 360 |  |
| auth.js | POST | `/send-bind-code` | 398 |  |
| auth.js | POST | `/verify-email` | 444 |  |
| chat.js | GET | `/bubbles` | 29 |  |
| chat.js | POST | `/bubbles/:id/buy` | 50 |  |
| chat.js | GET | `/bubbles/mine` | 87 |  |
| chat.js | GET | `/history/public` | 105 |  |
| chat.js | GET | `/history/dm/:id` | 117 |  |
| chat.js | GET | `/online` | 130 |  |
| chat.js | GET | `/mentions` | 135 |  |
| chat.js | POST | `/upload` | 234 |  |
| chat.js | GET | `/stickers/mine` | 259 |  |
| chat.js | POST | `/stickers` | 276 |  |
| chat.js | DELETE | `/stickers/:id` | 296 |  |
| chat.js | GET | `/dm/conversations` | 349 |  |
| chat.js | GET | `/dm/:id/messages` | 360 |  |
| chat.js | POST | `/dm/:id/read` | 374 |  |
| chat.js | GET | `/dm/unread` | 394 |  |
| checkin.js | POST | `/checkin` | 24 |  |
| checkin.js | POST | `/makeup` | 79 |  |
| checkin.js | POST | `/buy-makeup-card` | 206 |  |
| checkin.js | GET | `/status` | 257 |  |
| checkin.js | GET | `/history` | 334 |  |
| claims.js | GET | `/` | 22 |  |
| claims.js | GET | `/:id` | 63 |  |
| claims.js | POST | `/` | 95 |  |
| express-index.js | GET | `/holdings` | 57 |  |
| express-index.js | POST | `/buy` | 70 |  |
| express-index.js | POST | `/sell` | 76 |  |
| favorites.js | POST | `/posts/:postId` | 14 |  |
| favorites.js | GET | `/posts` | 42 |  |
| favorites.js | GET | `/posts/:postId/check` | 66 |  |
| favorites.js | POST | `/users/:userId` | 82 |  |
| favorites.js | GET | `/users` | 129 |  |
| favorites.js | GET | `/users/:userId/status` | 148 |  |
| favorites.js | GET | `/feed` | 175 |  |
| market.js | POST | `/orders` | 337 |  |
| market.js | GET | `/orders` | 357 |  |
| market.js | GET | `/orders/:id` | 374 |  |
| market.js | POST | `/orders/:id/regen-code` | 401 |  |
| market.js | POST | `/orders/:id/confirm` | 417 |  |
| market.js | POST | `/orders/:id/cancel` | 428 |  |
| market.js | POST | `/orders/:id/refund` | 436 |  |
| market.js | POST | `/orders/:id/dispute` | 468 |  |
| market.js | POST | `/reviews` | 476 |  |
| market.js | GET | `/favorites` | 582 |  |
| market.js | POST | `/favorites` | 598 |  |
| market.js | DELETE | `/favorites/:type/:id` | 611 |  |
| mod.js | GET | `/active-count` | 947 |  |
| notifications.js | GET | `/` | 8 |  |
| notifications.js | PUT | `/:id/read` | 49 |  |
| notifications.js | PUT | `/read-all` | 66 |  |
| notifications.js | DELETE | `/:id` | 81 |  |
| oauth.js | POST | `/authorize` | 82 |  |
| pay.js | POST | `/receive-code` | 323 |  |
| pay.js | GET | `/intents/:token` | 346 |  |
| pay.js | POST | `/intents/:token/confirm` | 391 |  |
| pay.js | POST | `/intents/:token/reject` | 435 |  |
| pay.js | GET | `/payer-code/current` | 503 |  |
| pay.js | POST | `/scan` | 522 |  |
| pay.js | GET | `/payer-code/pending` | 594 |  |
| pay.js | POST | `/charge` | 779 |  |
| pay.js | GET | `/charge/:token` | 804 |  |
| pay.js | POST | `/charge/:token/pay` | 853 |  |
| pay.js | POST | `/charge/:token/close` | 923 |  |
| pay.js | GET | `/charges` | 941 |  |
| pay.js | GET | `/records` | 1004 |  |
| pay.js | GET | `/members` | 1032 |  |
| pay.js | POST | `/charge/:token/targets` | 1093 |  |
| pay.js | DELETE | `/charge/:token/targets/:id` | 1141 |  |
| permissions.js | GET | `/me` | 42 |  |
| player-tasks.js | GET | `/` | 30 |  |
| player-tasks.js | GET | `/mine` | 69 |  |
| player-tasks.js | POST | `/` | 98 |  |
| player-tasks.js | POST | `/:id/accept` | 144 |  |
| player-tasks.js | POST | `/:id/complete` | 199 |  |
| player-tasks.js | POST | `/:id/cancel` | 250 |  |
| posts.js | POST | `/` | 199 |  |
| posts.js | PUT | `/:id` | 251 |  |
| posts.js | DELETE | `/:id` | 278 |  |
| posts.js | POST | `/:id/like` | 301 |  |
| posts.js | POST | `/:id/comments` | 338 |  |
| posts.js | DELETE | `/:postId/comments/:commentId` | 392 |  |
| projections.js | POST | `/` | 70 |  |
| projections.js | DELETE | `/:id` | 114 |  |
| push.js | POST | `/subscribe` | 21 |  |
| push.js | POST | `/unsubscribe` | 41 |  |
| push.js | GET | `/status` | 55 |  |
| qqbot.js | POST | `/confirm` | 85 |  |
| qqbot.js | GET | `/me` | 131 |  |
| shop.js | POST | `/items/:id/buy` | 79 |  |
| shop.js | GET | `/my-items` | 191 |  |
| shop.js | GET | `/my-permissions` | 213 |  |
| shop.js | GET | `/my-titles` | 231 |  |
| skins.js | POST | `/` | 40 |  |
| skins.js | DELETE | `/` | 91 |  |
| stock.js | GET | `/portfolio` | 297 |  |
| stock.js | POST | `/stocks/:id/buy` | 337 |  |
| stock.js | POST | `/stocks/:id/sell` | 424 |  |
| stock.js | GET | `/transactions` | 502 |  |
| tasks.js | GET | `/` | 26 |  |
| tasks.js | GET | `/:id` | 63 |  |
| tasks.js | GET | `/my/all` | 89 |  |
| tasks.js | POST | `/:id/claim` | 107 |  |
| tasks.js | POST | `/:id/complete` | 144 |  |
| titles.js | GET | `/my` | 33 |  |
| titles.js | POST | `/:id/buy` | 134 |  |
| titles.js | PUT | `/equip` | 184 |  |
| upload.js | POST | `/token` | 116 |  |
| upload.js | DELETE | `/object` | 159 |  |
| upload.js | POST | `/projection-token` | 191 |  |
| upload.js | POST | `/image` | 213 |  |
| upload.js | POST | `/images` | 237 |  |
| wiki.js | GET | `/id/:id` | 195 |  |
| wiki.js | POST | `/` | 259 |  |
| wiki.js | POST | `/preview` | 288 |  |
| wiki.js | PUT | `/:id` | 373 |  |
| wiki.js | GET | `/submissions/mine` | 616 |  |
| wiki.js | POST | `/pages/:id/comments` | 774 |  |
| wiki.js | DELETE | `/comments/:id` | 803 |  |

## 可选登录（公开）（18）

| 文件 | 方法 | 路径 | 行号 | 细化权限 |
|---|---|---|---|---|
| donation.js | GET | `/ledger` | 55 |  |
| faq.js | POST | `/ask` | 101 |  |
| faq.js | POST | `/feedback` | 139 |  |
| market.js | GET | `/stores` | 72 |  |
| market.js | GET | `/stores/:id` | 103 |  |
| market.js | GET | `/products` | 136 |  |
| market.js | GET | `/products/:id` | 167 |  |
| market.js | GET | `/map` | 202 |  |
| pay-confirm.js | POST | `/:token/confirm` | 72 |  |
| wiki.js | GET | `/` | 98 |  |
| wiki.js | GET | `/search` | 108 |  |
| wiki.js | GET | `/categories` | 135 |  |
| wiki.js | GET | `/categories/:slug` | 211 |  |
| wiki.js | GET | `/pages/:id/comments` | 764 |  |
| wiki.js | GET | `/:slug/related` | 821 |  |
| wiki.js | GET | `/:slug/history` | 832 |  |
| wiki.js | GET | `/:slug/history/:revisionId` | 843 |  |
| wiki.js | GET | `/:slug` | 856 |  |

## 服务间/玩家令牌鉴权（15）

| 文件 | 方法 | 路径 | 行号 | 细化权限 |
|---|---|---|---|---|
| mod.js | POST | `/checkin` | 195 |  |
| mod.js | GET | `/checkin/status` | 252 |  |
| mod.js | GET | `/tasks` | 273 |  |
| mod.js | GET | `/tasks/my` | 303 |  |
| mod.js | POST | `/tasks/:id/claim` | 324 |  |
| mod.js | POST | `/tasks/:id/complete` | 347 |  |
| mod.js | GET | `/profile` | 405 |  |
| mod.js | GET | `/balance` | 511 |  |
| mod.js | POST | `/transfer` | 528 |  |
| mod.js | POST | `/claims` | 583 |  |
| mod.js | POST | `/online/join` | 679 |  |
| mod.js | POST | `/online/leave` | 704 |  |
| paygate.js | POST | `/order/create` | 39 |  |
| paygate.js | POST | `/order/execute` | 47 |  |
| paygate.js | GET | `/order/query` | 70 |  |

## 处理函数内鉴权（服务间令牌/管理员）（1）

| 文件 | 方法 | 路径 | 行号 | 细化权限 |
|---|---|---|---|---|
| mod.js | GET | `/admin/claims` | 607 |  |

## 公开（仅限流）（2）

| 文件 | 方法 | 路径 | 行号 | 细化权限 |
|---|---|---|---|---|
| skins.js | GET | `/lookup` | 152 |  |
| wiki.js | GET | `/card/:slug.png` | 738 |  |

