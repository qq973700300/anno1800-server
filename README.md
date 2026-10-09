# 纪元1800 手游后端（anno1800-server）

Spring Boot 4.1 + JPA + WebSocket 实现的**联机经营贸易后端**：多人同服、空白方形岛自行规划路网与农田、
种地、跑产业链、做商品贸易与玩家间挂单。
自带一个 three.js 的 **3D 海岛客户端**（`game.html`），浏览器直接开玩。

技术栈：Java 25 · Spring Boot 4.1.0 · Spring Data JPA(Hibernate 7) · **MySQL 8** · 原生 WebSocket · Jackson 3

---

## 一、启动

```bash
# 编译打包
mvn -DskipTests package

# 运行（默认连本机 MySQL 的 anno1800 库）
java -jar target/anno1800-server.jar --server.port=8080

# 不想开 MySQL 时用内存库 H2 调试
java -jar target/anno1800-server.jar --spring.profiles.active=h2 --server.port=8080
```

数据库配置在 `src/main/resources/application.yml`：

```yaml
spring.datasource.url: jdbc:mysql://127.0.0.1:3306/anno1800?...
spring.datasource.username: root
spring.datasource.password: （空）
```

> ⚠️ 若环境里存在 `SERVER__PORT` / `SERVER_PORT` 环境变量，Spring Boot 的宽松绑定会**覆盖** application.yml 的 8080，
> 启动时会报 "Port 63443 was already in use"。加 `--server.port=8080` 即可（命令行参数优先级最高）。

启动后（服务已内置静态页，直接开 **`http://localhost:8080/`** 即是入口页）：

| 入口 | 地址 | 说明 |
|---|---|---|
| **3D 海岛（three.js）** | `http://localhost:8080/game.html` | 空白方形岛：点空格子播种 / 修马路（相邻自动连成路网），沿路盖 2×2~4×4 的厂房；**大门自动吸附邻近道路**，按 `R` 或点"旋转"可原地 90° 转（横摆 / 竖摆）；岛最外一圈画成**沙滩（海岸带）**，贸易站（港口）只能建在那儿、大门自动朝海；右侧有**人口面板**，走"港口 → 住宅 → 居民 → 需求 → 税收"这条闭环 |
| 可视化控制台 | `http://localhost:8080/web-console.html` | REST + WebSocket 全套操作（开岛 / 播种 / 建造 / 拆除 / 买卖 / 挂单 / 查看岛上居民） |
| 行情图 | `http://localhost:8080/market-chart.html` | 股票式 K 线 / 分时（OHLC、MA5/MA10、成交量、十字光标） |
| 入口页 | `http://localhost:8080/` | 导航页 |
| REST | `http://localhost:8080/api/...` | |
| 联机 | `ws://localhost:8080/ws` | |

> 项目根目录也放了同名副本 `web-console.html` / `market-chart.html`，双击用浏览器打开也能用（它们直连
> `localhost:8080`，服务端已开 CORS）。**两个位置的内容是一样的**，改的时候记得同步。

> ⚠️ **3D 端必须走 http 打开**（上面的 8080 地址），直接双击 `game.html` 用 `file://` 会被浏览器以
> ES module CORS 为由拦截（three.js 与 GLTFLoader 都是 `import` 加载的）。改过 `game.html` 后要重新 `package` 才生效。

测试脚本：

```bash
node smoke-test.mjs        # 全链路校验 65 项（路网 / 多格占地 / 拆除 / 大门朝向吸附 / 90° 旋转 / 空地自由播种 / 收获后释放格子 / 港口必须临海 / 矿脉规则 / 随机岛地形与种子稳定 / 居民经济闭环）
node resident-check.mjs    # 居民经济专项 35 项：港口只能建在海边、人口涨满、满足度涨落、断供搬走、拆房即清零、人口门槛（整条经济曲线）
node npc-check.mjs         # 街头生活专项 34 项：先搭小镇等人口涨起来，再用无头 Edge 断言街上人数===人口、居民真的在移动、
                           #   状态机走到 CHAT/SLEEP、三级 LOD 与人群层生效、14 原型与换装轴抽出多样组合（含 3 张截图）
node stress-test.mjs       # 并发压测：平岛 + 4 玩家 × 2 台**真的在建**的伐木场，960 次并发买卖混心跳写入，
                           #   断言工厂确实建成 / 产出确实入库 / 零 5xx / 零 409，并自己 grep 服务端日志（LOG=<路径> 可指定）
node road-shape-check.mjs  # 马路拼接的 16 种形态校验（纯几何，不需要起服务）
node tools/gen-models.mjs --dry-run   # 打印建筑（工厂 + 港口 + 住宅）的混元3D 生成提示词（不需要密钥）
```

> 除 `road-shape-check.mjs` 与 `gen-models.mjs` 外都需要服务已启动，而且都要**等真实时间**：居民消费按"每人每分钟"计、
> 攒够 `anno.resident-settle-seconds`（默认 30 游戏秒）才结算一次。所有等待都是
> 「轮询到条件满足就提前退出」，所以**加时间倍率能显著加快** —— 例如
> `java -cp ... com.anno.AnnoApplication --anno.time-scale=20`，`resident-check.mjs` 十几秒就能跑完。
> 但注意倍率太高会反过来坑到 `smoke-test.mjs`：它假设播下的作物在 40 秒后仍是"成熟可收"，
> 倍率 10 以上时成熟后 120 游戏秒的枯萎窗口会先到，作物会**枯萎**（跑默认倍率 1.0 最稳）。
>
> **造场景一律用 `flat: true` 的平岛**：岛形是按岛屿 id 随机生成的，脚本里写死的坐标
> （"在 (6,8) 修条路""贸易站放 (0,11)"）在随机岛上会落到海里。平岛是一整片平原，
> 它的**最外一圈自动算作海岸带**，所以"贴边是沙滩、往里一格是内陆"这条港口规则照样能验。
> 随机地形本身由 `smoke-test.mjs` 最后一节单独验（岛形不是方块、有海有山有矿、同一座岛不变脸）。
>
> ⚠️ 还有一条比坐标更隐蔽的坑：**占地不能压住马路**（`validatePlacement` 的 ④ 排在 ⑥ 临路之前）。
> 2×2 的工厂放 `(6,7)`、马路在 `(6,8)` —— 占地正好盖住那格路，直接 400。
> `stress-test.mjs` 就因此**两台"造库存的机器"一台都没落地，长期只压了市场买卖**这一条路。
> 写布局时记住：**工厂的边要"贴着"路，不能让占地矩形盖到路上**。

### 建筑 3D 模型：把 AI 生成的模型挂上去

`game.html` 会自动探测 `src/main/resources/static/models/<建筑类型>.glb`，
**放进去就生效，不用改一行代码**。没有模型的类型继续用程序化厂房，所以可以一个一个慢慢补。

```bash
# 看"该生成什么"：每座建筑的中文提示词 + 推荐参数
node tools/gen-models.mjs --dry-run

# 有腾讯云密钥的话，直接批量生成 + 自动下载到 models/
export TENCENTCLOUD_SECRET_ID=xxx TENCENTCLOUD_SECRET_KEY=yyy
node tools/gen-models.mjs                     # 全跑 12 个
node tools/gen-models.mjs LUMBERJACK SAWMILL  # 只跑指定几个
```

模型不需要你调尺寸或对齐：客户端按**包围盒**归一化（缩放到该建筑的占地尺寸、水平居中、底面贴地），
因为 AI 生成的 glb 尺度/原点从不统一。文件名必须是建筑类型名（`LUMBERJACK.glb` / `STEEL_WORKS.glb` …）。

### 从旧版本升级（农田改为玩家自选格子）

旧版的农田是**开岛时预生成的固定 12 块地**（`plot.plot_index`），新版改成玩家在任意空地自选一格播种
（`plot.cell_x / cell_z`）。用旧库跑新代码前，先执行一次幂等迁移（重复跑安全）：

```bash
# 1) 先停服务，并备份 plot 表
mysqldump -h127.0.0.1 -uroot --password= --databases anno1800 --tables plot > plot_backup.sql

# 2) 执行迁移：加 cell_x/cell_z、按旧排版回填已有作物、换唯一索引、删掉 plot_index
mysql -h127.0.0.1 -uroot --password= anno1800 < db/migration_plot_cell.sql
```

脚本会用 `information_schema` 自查每一步，`cell_x` 已存在就跳过，所以中断后重跑也没事；
结尾还会打一行自检结果（行数 / 非法坐标数 / 坐标范围）。已有作物不会丢，会按原来的位置换算成格子坐标。

**建筑朝向迁移**（老库存量建筑补 `rotation` 列，新库由 Hibernate 自动建列、无需执行）：

```bash
mysql -h127.0.0.1 -uroot --password= anno1800 < db/migration_building_rotation.sql
```

同样是幂等脚本：查列存在性 → 不存在才 `ALTER TABLE ... ADD rotation INT NOT NULL DEFAULT 0` →
把非法值（非 0/90/180/270）归零 → 结尾打印各朝向的建筑数量自检。

> H2 profile 已开 `MODE=MySQL`（项目里用了 `insert ignore` / `on duplicate key update` 这类 MySQL 方言），
> 不开兼容模式会在注册建库存行时直接报语法错误。

---

## 二、目录结构

```
src/main/java/com/anno/
├── AnnoApplication.java          启动类（开启世界心跳调度）
├── config/      GameProperties(含岛屿网格参数) / WebSocketConfig / WebConfig(CORS) / DataBootstrap / DbRetry
├── domain/      Good(商品) BuildingType(配方+用途) ResidentTier(居民阶层) Resident(人口)
│                Player/Island/Plot/Building/Stock/MarketPrice/TradeOffer/Road
├── repo/        Player Stock Building Resident TradeOffer PriceHistory Island Road 等 JPA Repository
├── service/     Player Island Farm Production Market Trade Inventory GameTick Road Population
├── controller/  Player Island Farm Building Market Trade World Road
├── ws/          GameSocketHub(广播中枢) GameWebSocketHandler(联机入口)
└── dto/         ApiResponse Views Requests

src/main/resources/static/
├── index.html         入口页
├── game.html          three.js 3D 海岛客户端（离线 three.module.js + GLTFLoader）
├── web-console.html   REST + WebSocket 可视化控制台
├── market-chart.html  K 线 / 分时行情图
├── three.module.js    three.js r169（本地，不依赖 CDN）
├── jsm/               three.js 官方 addons（GLTFLoader / BufferGeometryUtils，离线）
│   ├── npc.js         街头生活：NPC 状态机 + 路网寻路 + 三级 LOD + 人群层
│   └── npc-roster.js  14 种 NPC 原型 + 6 个换装轴 + 低模人形建模
└── models/            AI 生成的建筑模型：<建筑类型>.glb，放进去自动生效

tools/
├── gen-models.mjs     混元生3D 批量生成器（提示词表 + TC3 签名 + 自动下载）
│                      --dry-run 只打印提示词与占地/尺寸规格（不需要密钥）；加 --md 导出成表格
└── model-prompts.md   上面命令导出的成品：各建筑的占地格数、长宽比、目标尺寸与提示词

db/
├── migration_plot_cell.sql          旧库 plot 表迁移（农田改格子坐标）
├── migration_building_rotation.sql  旧库 building 表迁移（新增 rotation 大门朝向列，幂等）
└── migration_population.sql         旧库迁移（新建 resident 人口表，幂等）
```

---

## 三、REST 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/players/register` | 注册 `{name}`，返回 token |
| GET | `/api/players/{id}` | 玩家信息 |
| GET | `/api/players/me?token=` | 用 token 登录 |
| GET | `/api/players/{id}/profile` | 档案（玩家+岛屿+仓库） |
| GET | `/api/players` | 全部玩家 |
| POST | `/api/islands` | 开新岛 `{playerId,name}`（**空白方形岛**，肥力随机 40~95，农田上限 24 株） |
| GET | `/api/islands?playerId=` | 我的岛屿（下发 `gridSize` / `plotLimit` / `roadCost`，客户端据此画方格图） |
| GET | `/api/islands/{id}/plots` | 岛上作物列表（含 `cellX/cellZ` 与生长进度） |
| GET | `/api/islands/{id}/buildings` | 建筑列表（含用途 `kind`、生产进度、占地锚点 `gridX/gridZ`、旋转后 `sizeW/sizeH` 与大门朝向 `rotation`） |
| GET | `/api/islands/{id}/population` | **人口面板**：各阶层的 `population/capacity/satisfaction/taxPerMinute` + 需求明细（商品、每人每分钟消耗、折算后的每分钟需求、仓库现有）+ `hasTradingPost` |
| POST | `/api/farm/plant` | **在指定格子播种** `{playerId,islandId,x,z,crop}`，一格一株 |
| POST | `/api/farm/harvest` | 收获 `{playerId,plotId}`，该格随即空出来 |
| POST | `/api/farm/clear` | 清理枯萎作物 `{playerId,plotId}`，该格随即空出来 |
| GET | `/api/roads?islandId=` | 岛上全部马路格子 |
| POST | `/api/roads` | **修一格马路** `{playerId,islandId,x,z}`（¥30/格） |
| DELETE | `/api/roads` | **拆一格马路** `{playerId,islandId,x,z}`（返还一半造价） |
| GET | `/api/buildings/catalog` | **建筑图鉴**：15 种建筑（12 座工厂 + 1 港口 + 2 座住宅）的造价 / 周期 / **占地尺寸** / 用途 `kind` / 住宅容量与人口门槛 / 配方（客户端照它渲染） |
| POST | `/api/buildings` | 建造 `{playerId,islandId,type,x,z,rotation?}` —— x/z 是占地**左上角**，建筑占 `sizeW×sizeH` 格；`rotation` 省略即**大门自动吸附道路**（取临路最多的一侧，平手按 南→东→北→西），显式传 `0/90/180/270` 则指定朝向（90°/270° 会让占地宽高对调）。两条额外规则：① **贸易站（港口）的占地必须压到海岸带**（岛最外 `anno.coast-width` 圈的沙滩），否则拒掉；② 住宅要有**前提建筑**：没贸易站不能盖住宅，农夫不够 120 盖不了工人住宅 |
| POST | `/api/buildings/{id}/rotate` | **原地旋转 90°** `{playerId}` —— 绕占地中心转，锚点自动微调；旋转后若压到马路 / 作物 / 建筑或不再临路则拒绝 |
| POST | `/api/buildings/{id}/upgrade` | 升级（产量 +100%） |
| DELETE | `/api/buildings/{id}?playerId=` | **拆除建筑**：返还一半造价，占地整块释放；岛上有住宅时**不许拆贸易站**（居民的前提建筑），拆掉住宅后人口**立刻**收敛到新容量 |
| GET | `/api/assets/models` | 已就位的 3D 模型清单（客户端据此决定用模型还是程序化厂房） |
| GET | `/api/market` | 全部行情（现价/涨跌幅/成交量） |
| GET | `/api/market/history?good=WOOD&seconds=3600` | 分时数据（画分时图） |
| GET | `/api/market/kline?good=WOOD&period=60&limit=120` | K 线（period 秒一根，OHLC + 成交量） |
| POST | `/api/market/buy` | 从 NPC 市场买入 `{playerId,good,quantity}` |
| POST | `/api/market/sell` | 卖给 NPC 市场 |
| GET | `/api/market/stock/{playerId}` | 我的仓库 |
| POST | `/api/trade/offers` | 挂单 `{playerId,side:SELL\|BUY,good,quantity,unitPrice}` |
| GET | `/api/trade/offers` | 撮合大厅（可 `?good=WOOL` 过滤） |
| GET | `/api/trade/offers/mine?playerId=` | 我的挂单 |
| POST | `/api/trade/offers/{id}/accept` | 接单 `{takerId}` |
| POST | `/api/trade/offers/{id}/cancel` | 撤单（托管资源原路退回） |
| GET | `/api/world` | 服务器状态（心跳数/在线/行情） |
| GET | `/api/world/goods` | 商品定义（生长时间/产量/种子价） |
| GET | `/api/world/buildings` | 建筑与配方（含用途 `kind`、住宅容量、人口门槛） |

统一返回：`{"ok":true,"code":"OK","message":"success","data":{...}}`，失败 `{"ok":false,"code":"BAD_REQUEST","message":"库存不足：土豆"}`

---

## 四、WebSocket 联机协议

连接 `ws://localhost:8080/ws`

**客户端 → 服务端**

| 消息 | 说明 |
|---|---|
| `{"type":"auth","playerId":1}` | 绑定身份（绑定后计入在线） |
| `{"type":"ping"}` | 心跳 |
| `{"type":"chat","text":"..."}` | 世界频道 |

**服务端 → 客户端**

| 消息 | 说明 |
|---|---|
| `welcome` | 连接成功提示 |
| `authed` | 身份绑定成功 |
| `world` | 每 3 秒的世界快照（tick/在线玩家/全部行情） |
| `event` | 实时事件：`CROP_PLANTED` `CROP_RIPE` `CROP_HARVESTED` `CROP_WITHERED` `BUILDING_BUILT` `BUILDING_ROTATED` `BUILDING_REMOVED` `PRODUCED` `ROAD_BUILT` `ROAD_REMOVED` `MARKET_BUY` `MARKET_SELL` `TRADE_OFFER` `TRADE_FILLED` `PLAYER_ONLINE` `PLAYER_OFFLINE` **`POPULATION_CHANGED`**（人口涨落，带 `tier/population/capacity/delta/satisfaction/tax`） |
| `chat` | 世界聊天 |
| `pong` | 心跳回包 |

---

## 五、玩法机制

**种植**：作物 `POTATO土豆30s / GRAIN小麦45s / HOPS啤酒花60s / COTTON棉花90s / WOOL羊毛60s`。
岛屿是一张**空白方格图**，农田位置由玩家自己定 —— 在任意空格子点一下就能播种（一格一株，
同一格重复种、种在马路 / 建筑上都会被服务端拒绝）。种下时按岛屿肥力算出**生长速度**（0.8~1.2 倍）
与**产量**（0.6~1.4 倍）；成熟后 120 游戏秒不收就枯萎，需 `clear` 清理。
**收获 / 清理后地块行直接删除，这一格立刻空出来** —— 可以接着种，也可以改成修路盖房，地盘完全由你规划。
每座岛同时最多 `anno.plot-limit`（默认 24）株。

**生产链**（建筑自动消耗仓库原料、产出成品）：

| 链 | 配方 |
|---|---|
| 木材 | 伐木场 → 木材 → 锯木厂（木材×2）→ 木板 |
| 建材 | 黏土矿坑 → 黏土 → 砖厂（黏土×2）→ 砖块 |
| 钢铁 | 铁矿 → 铁矿 → 炼钢厂（铁矿×2）→ 钢材 |
| 面包 | 小麦 → 磨坊（小麦×2）→ 面粉 → 面包房（面粉×2）→ 面包 |
| 酒 | 土豆 → 酿酒厂（土豆×3）→ 烈酒；小麦+啤酒花 → 啤酒厂 → 啤酒 |
| 衣物 | 棉花 → 纺织厂（棉花×2）→ 布料 →（+羊毛）制衣厂 → 衣物 |

缺料时建筑自动停工并标记 `stalled`，料齐自动恢复。

### 居民经济：港口 → 住宅 → 居民 → 需求 → 税收

上面那条链只解释了"东西怎么造出来"，但**钱从哪儿来**是另一条链 —— 也就是《纪元1800》
真正的主循环。本项目在补上它之前，收入只有"把货卖给 NPC 市场"和"玩家之间挂单"，
产出与需求之间没有任何关系；现在产出会**被岛上的人吃掉**，吃掉之后才换来税收：

```
贸易站(港口)  →  农夫小屋  →  居民入住  →  吃土豆/喝烈酒  →  缴税  →  人口增长
 3×3 建在海边      2×2 住 24 人    攒够周期才结算      断供就少缴    满 120 名农夫
                                                                        ↓
                                                            解锁工人住宅（面包 + 啤酒，税率翻倍）
```

**顺序是硬规则**：没有贸易站，生活物资运不上岛，`POST /api/buildings` 会直接拒掉住宅；
而贸易站自己还得是个**港口** —— 占地必须压到岛最外圈的沙滩上（见上一节「建港口」）。

| 阶层 | 住宅 | 需求（每人每分钟） | 税率 | 增长 / 流失 |
|---|---|---|---|---|
| **农夫** | 农夫小屋 2×2 住 24 人 | 土豆 0.40 + 烈酒 0.15 | ¥14/人·分 | 满员 30 秒 +25% 容量 / 断供 −45% 人口 |
| **工人** | 工人住宅 3×3 住 40 人（需岛上已有 120 名农夫） | 面包 0.20 + 啤酒 0.10 | ¥26/人·分 | 满员 30 秒 +17.5% 容量 / 断供 −40% 人口 |

按这套数值，一座满员的农夫小屋一分钟吃掉 9.6 土豆 + 3.6 烈酒（市场价值约 ¥221），
换回 ¥336 税收 —— 净赚约 ¥115；工人的单位面积税收 115 金/格，也明显高于农夫的 84 金/格，
所以"升级住宅"是有回报的，代价是产业链要铺得更长。

**几个关键设计点**（对应 `PopulationService`）：

| 问题 | 做法 | 为什么 |
|---|---|---|
| **一秒才吃 0.16 个土豆，取整永远是 0** | 需求按"每人每分钟"写成**速率**，攒够一个结算周期（`anno.resident-settle-seconds`，默认 30 游戏秒）才一次性结算 | 每次算的都是整段时间的量，没有量化误差；周期 / 时间倍率怎么调，消耗量都不变 |
| **先扣货还是先收税** | **先扣货、再算满足度、最后收税** | 倒过来的话，玩家可以在结算瞬间把货卖光、照样拿满额税收，居民等于白吃 |
| **房子拆了人口还悬着** | 人口**容量不落库**，由岛上住宅**实时汇总**；拆房后 `shrinkToCapacity` 立刻把人口压回容量 | 容量是推导值，天然"拆房即掉"，不需要任何同步代码；人口数量才是随时间累积的结果，必须落库 |
| **满足度卡在阈值上反复横跳** | 满足度 ≥ 0.6 才开始涨人，< 0.4 才搬走，中间留一段**滞回** | 给玩家一段补货窗口 |
| **仓库差一点就整轮断供** | 扣货走 `consumeUpTo`（SQL `least(quantity, :qty)`）：有多少扣多少 | 差 0.5 个土豆不该让整轮消费崩掉，满足度会按比例打折 |
| **接入现有心跳不影响原有三段** | 心跳顺序 种植 → 生产 → **人口** → 行情，人口独立分批（4 批）各自事务 + `DbRetry` | 人口必须排在**生产之后**，否则本轮刚产出的东西这一轮吃不到；分批让单岛失败不拖垮全服 |

**岛屿布局与路网**：岛是**方形** —— `anno.grid-size` 默认 22，即 22×22 = 484 格；
网格之外就是海（客户端那块 900×900 的蓝色海面），网格**最外 `anno.coast-width` 圈（默认 1）是海岸带（沙滩）**。
一格只能放一样东西，先修路、再沿路盖厂，是建造的硬规则：

| 操作 | 规则 |
|---|---|
| **修马路** | ¥30/格；不能修在作物 / 建筑**占地**上（建筑占好几格，不是只挡锚点那一格），同格不能重复修 |
| **拆马路** | 返还一半造价（¥15） |
| **盖建筑** | 占地**整块**必须都在岛内、不压作物 / 马路 / 其他建筑，且占地**外圈任意一格**有马路；不满足会明确告诉你差在哪 |
| **建港口** | 贸易站是全岛**唯一**受海岸带约束的建筑：占地必须压到最外圈的沙滩上，否则直接拒掉。它同样要临路（码头只是物流起点，货卸下来还得上路），所以**沿滩修一条岸路**是港口的标配 |
| **大门朝向** | 默认**自动吸附道路**：统计占地东南西北四侧各贴到几格马路，取最多的一侧当大门方向（并列时按 南→东→北→西），且这个朝向必须自己也放得下（90°/270° 会宽高对调）。**港口例外**：门开向**海** —— 按"哪一侧出了网格就是水"排序，出网格最多的一侧当选，所以港口永远朝外海，而不是朝身后那条马路 |
| **旋转 90°** | 绕占地**中心**原地转（0°→90°→180°→270°→0°），锚点自动微调以保持视觉位置不跳；转完仍要满足全部落地校验，否则拒绝并保留原朝向 |
| **拆建筑** | 返还一半造价，占地整块立刻释放（多格建筑放错位置时唯一能反悔的办法） |
| **播种** | 任意空格子都能种，一格一株；压在马路 / 建筑**占地** / 已有作物上都会被拒 |
| **树木** | 客户端按格子伪随机撒的装饰（自动避开路 / 建筑占地 / 作物 / **海岸带**），不占格、不参与任何判定 |

> **为什么单独给港口加一条海岸带规则**：在此之前，贸易站和厂房走的是**完全同一套**判定
> （只要占地外圈临路就能建），于是玩家在地图边缘"看得见海"的地方点下去，得到的是
> 「需要靠马路才能运原料」—— 一个 600 金、名叫"港口"的建筑，待遇和内陆锯木厂一模一样，
> 跟"港口就该建在海边"的直觉完全对不上。现在语义补齐：**海岸带 = 沙滩，网格之外 = 海**。
>
> 定义成"只是给最外圈加一层语义"、而不是"把外圈挖成水域"，是为了**不动地形**：
> 可用格数不变，已经铺在外圈的马路和建筑都不会被淹掉，老存档也不会被卡住。
> 想彻底关掉这条规则，把 `anno.coast-width` 设成 `0` 即可（贸易站退回"普通沿路建筑"）。
> 服务端判定在 `GameProperties.isCoast` + `ProductionService.validatePlacement`，
> 客户端同口径镜像在 `game.html` 的 `isCoastCell` / `touchesCoastRect`，两边必须一起改。

### 建筑是**多格占地**的（像《纪元1800》）

`(x, z)` 是占地矩形的**左上角**，建筑实际占 `sizeW × sizeH` 格。占地越大产量越高，
所以地皮规划是真玩法：4×4 的炼钢厂得挑地方，盖错了只能拆。

| 建筑 | 占地 | 建筑 | 占地 |
|---|---|---|---|
| 伐木场 / 黏土矿坑 / 铁矿 / **农夫小屋** | 2×2 | 锯木厂 / 砖厂 / 面包房 / 酿酒厂 / **贸易站** / **工人住宅** | 3×3 |
| 磨坊 | 2×3 | 纺织厂 / 啤酒厂 | 4×3 |
| — | — | 炼钢厂 / 制衣厂 | 4×4 |

> 前 12 座是**生产型**（`kind=PRODUCTION`，按配方跑心跳）；贸易站是**港口**（`kind=HARBOR`，
> **只能建在岛最外圈的海岸带上、大门自动朝海**）；两座住宅是**住宅型**（`kind=RESIDENCE`）。
> 后三者**没有配方**，不参与生产心跳，
> 靠的是下面那条「居民经济」循环。判定"进不进生产心跳"一律走 `BuildingType.isProduction()`，
> 别再靠"原料表是不是空"去猜，否则以后加一种无配方的生产建筑会静默停产。

> **占地的宽高不落库**，由 `BuildingType.getSizeW()/getSizeH()` 推导 —— 以后调平衡改尺寸不用动数据，
> 老存档自动跟着变。**朝向 `rotation` 是唯一落库的显示字段**（0=南 / 90=东 / 180=北 / 270=西），
> 实际占地宽高 = `type.effSizeW(rotation) × effSizeH(rotation)`，90°/270° 时自动对调，
> 所以「横摆 4×3」与「竖摆 3×4」共用同一个 `(gridX,gridZ)` 锚点语义，不需要拆成两种建筑。
> 建造时的校验覆盖**整块占地**（不是只看锚点），否则大厂之间会"穿模"：
> 客户端 `game.html` 里对应的判定是 `canPlaceAt(x, z, w, h)` / `nearRoadRect(...)`，
> 服务端是 `ProductionService.build` + `RoadService.nearRoad(islandId,x,z,w,h)`，
> 两边是同一套逻辑，改规则时**必须一起改**。

**马路会自动连成路网**（像《纪元 1800》那样）：客户端不给每格马路画一个方块，而是
「中心方块 + 朝有路邻居伸出的车道」，车道正好铺到格子边界、相邻两格严丝合缝，
于是四邻组合**自然拼出 5 种形态**，不需要任何转角模型：

```
尽头(1向)      直路(2向)      拐角(2向)       T 字(3向)       十字(4向)
   █             █ █           █               █ █ █          █ █ █
   █             █ █         █ █                 █            █ █ █
   █             █ █         █ █                 █              █
```

- 路基铺满整格 + 路面按四邻裁形 → 一条直路上没有任何接缝，转角处是完整的圆角矩形拼接。
- 点开任意一格马路，面板会显示 **路口形态（尽头 / 直路 / 拐角 / T 字路口 / 十字路口）** 与
  **连通路网格数**（按四邻洪水填充算出来的路网规模）。
- 形态算法有独立校验脚本：`node road-shape-check.mjs` —— 把 16 种四邻组合栅格化，
  断言面积与"车道是否精确贴到格子边界"（避免出现看着像路、其实差半格的缝）。

> 网格参数（`gridSize` / `coastWidth` / `plotLimit` / `roadCost`）由 `/api/islands` 下发，
> 建筑的造价与占地尺寸由 `/api/buildings/catalog` 下发，前端都不写死 ——
> 改 `application.yml` 的 `anno.grid-size` / `anno.coast-width` 就能换地图与海岸，
> 改 `BuildingType` 就能换建筑体量。

**市场**：买价 = 市价×1.02，卖价 = 市价×0.98（2% 点差）。每成交 100 单位推动价格 ±5%，
每次心跳向基准价回归 2% 并叠加 ±3% 随机波动，价格被限制在基准价的 0.4~2.5 倍——低买高卖有利可图。

**玩家贸易**：挂卖单时货物先托管扣仓、挂买单时金币先冻结，杜绝卖空买空；撤单原路退回。

### 地形：岛不是方块，是随机长出来的

`anno.grid-size` 默认 **36**（36×36 = 1296 格）。岛的轮廓由服务端**按岛屿 id 确定性生成**，
客户端只负责照图施工 —— 两边共用同一份字符表，不会出现"3D 里看着是草地、点下去服务端说这是水"。

| 字符 | 含义 | 能干什么 |
|---|---|---|
| `.` | 平原 | 唯一能修路 / 种地 / 盖普通建筑的地 |
| `~` | 水面 | 不能建、不能修路 |
| `^` | 山地 | 不能建、不能修路、不能种（纯景观 + 挡规划） |
| `i` | 铁矿脉 | **铁矿**必须压在它上面 |
| `c` | 黏土矿脉 | **黏土矿坑**必须压在它上面 |

生成步骤（`com.anno.domain.TerrainMap`）：高度场（值噪声 + 径向衰减）→ 取阈值分海陆 →
**只保留最大的那块陆地**（避免生成一堆碎岛）→ 堆山 → 撒矿脉。下面三个约束是踩坑踩出来的，
改生成器时别拆掉：矿脉不能被山包死（否则采不到）、矿脉得放得下 2×2 的矿场、
撒矿不能把走道堵死（放完之后主连通块只应减少矿脉本身那么多格，否则撤销换点）。

`terrain` / `terrainSeed` / `terrainSummary` 由 `/api/islands` 下发；报 bug 时报上 seed
就能复现同一座岛。测试要**坐标固定**的岛，创建岛屿时传 `flat: true`（一整片平原，等价于老版方形岛）。

> 客户端一切落地判定都以 `atCell()` 为地基：`isLandCell` / `isPlainCell` / `isMountainCell` /
> `oreAtCell` / `isCoastCell`，与服务端 `TerrainMap` 逐条镜像。加地形类型时**两边必须一起改**。

### 街头生活：14 种居民，自己上街

人口不是面板上的数字，是**真的在街上走的人**。`jsm/npc.js` + `jsm/npc-roster.js` 是一套
**纯客户端**的行人系统 —— 服务端仍然是玩法权威（人口 / 税收 / 建造），NPC 只是人口的可视化：
**岛上住了 240 个人，街上就有 240 个路人；人口掉到 0，街就空**，不凭空捏人。

**14 种原型 × 6 个换装轴。** 街道有意思靠的不是单个模型多精细，而是种类够多：

| 男性 6 种 | 女性 6 种 | 儿童 2 种 |
|---|---|---|
| 男村民 / 男工人 / 男农民 / 男商人 / 男老人 / 男青年 | 女村民 / 女工人 / 女农民 / 女商人 / 女老人 / 女青年 | 男孩 / 女孩 |

每个原型有自己的体型（商人圆胖、工人宽肩、老人驼背、儿童矮小头大）、配色池、步行速度与行为倾向；
再叠 6 个变化轴：**帽子 / 衣服颜色 / 发型 / 配饰 / 身高 / 肤色**。
所有轴由一个种子确定性组合（刷新页面不会换脸）—— 14 原型 × 各轴配色池 ≈ 上千种不重样的路人，
但只用了 `buildNpcBody()` 一份建模代码。住宅住哪个阶层，就往哪个池里抽人
（农夫小屋出农民，工人住宅出工人），所以**人群构成也跟着人口结构走**。

**九个格子，六个状态。** 状态机在 `jsm/npc.js` 的 `tick()`：

```
 出门            SLEEP ──(到点)──▶ PLAN ──▶ WALK
 沿道路行走       WALK             （在马路格上 BFS，一格一格走）
 去工作/商店/市场  WALK，由 goal = WORK / SHOP / MARKET 区分
 路边停留        DWELL（goal = LOITER）
 与其他NPC交谈     CHAT            （两两配对，面对面冒气泡）
 回家睡觉        WALK(goal=HOME) ──▶ ENTER ──▶ SLEEP
```

每个人的目标由**一条纯函数** `goalFor(npc, hour)` 决定 —— 输入"现在几点 + 这个人是谁"，
输出"此刻该去哪"。没有 per-NPC 剧本表：改日程只改一个函数，加减人数也不会打乱别人的作息。

几个真正让画面活起来的细节（都别随手删）：
- **作息错峰**：每人带一个 ±0.75 游戏小时的偏移，不会整点钟一起涌出门。
- **人爱扎堆**：闲逛点默认有 2/3 概率凑到附近已经在路边站着的人那儿去 ——
  既像真的（街口就是这么聚起来的），也顺带把"两个人聊起来"的机会做出来了
  （纯随机撒点的话，十几个人撒在几十格马路上根本碰不上面）。
- **分车道**：走路的人固定往行进方向偏一点点，路面上自然分成两股，不会叠成一条糖葫芦。
- **待够 ≠ 赖着**：`dwell` 只是"最少待多久"，作息一变立刻动身；但**该回家了永远不等**，
  否则深夜街上还会有人闲逛。

**三级 LOD + 人群层。** 关键是"名额"和"距离"是两把尺子：

| 档位 | 触发条件 | 渲染方式 |
|---|---|---|
| 完整动画 | 在 `detailMax` 名额内，且距离 < `lodNear` | 完整低模 + 摆臂摆腿 + 说话气泡 |
| 低模 | 同上，距离 < `lodMid` / `lodFar` | 收起手臂 / 只留躯干（省的是 draw call，不是逻辑） |
| 人群剪影 | 名额之外（最多 `crowdMax` 个） | 进 `InstancedMesh`，**2 个 draw call 画几百人** |
| 不画 | 超出 `cullDist`，或正在家睡觉 | 完全不渲染 |

于是"城里看起来有几百人在活动，但真正拿到完整动画编制的只有几十个"。
性能上另有两个约定：全场 NPC **共用一个材质**（颜色全走顶点色），
每个 NPC 只产 5 个网格（合并后的上半身 + 双臂 + 双腿，四肢必须独立，不然走路没有摆臂摆腿）。

**调试开关**：URL 加 `?npc=260` 强制街上的人数。左侧「街头生活」面板里有演示按钮
（会记进 `localStorage`），也会显示**街头此刻的状态分布与原型构成**。
人口为 0 时街上就是空的 —— 面板会直接告诉你缺什么（没住宅 / 住宅没临路 / 还没人口）。

---

## 五·补、数据库设计（网络游戏怎么存才合理）

### 1. 本项目现在的表

| 表 | 内容 | 写频率 | 说明 |
|---|---|---|---|
| `player` | 玩家、金币、声望 | 中 | 带 `@Version` 乐观锁，防并发扣款覆盖 |
| `island` | 岛屿、肥力 | 低 | 建岛时写一次 |
| `plot` | 作物（岛上一格一株） | **高** | 按 `(island_id, cell_x, cell_z)` 唯一；收获 / 清理即删行，格子立刻释放 |
| `building` | 建筑、生产进度 | **高** | 每次心跳更新；只存占地**锚点** `grid_x/grid_z`，宽高由建筑类型推导（改平衡不动数据） |
| `stock` | 仓库（玩家×商品） | 中 | 带乐观锁，防并发扣库存 |
| `market_price` | 当前行情 | 中 | 每 5 秒批量落库 |
| `price_history` | 行情快照（K 线） | **极高** | 时序数据，有 `(good,ts)` 索引，24 小时后清理 |
| `trade_offer` | 玩家挂单 | 低 | 撮合用 |
| `road` | 岛屿马路格子 | 低 | `(island_id, cell_x, cell_z)` 唯一；盖房时查的是建筑**占地的外圈**是否通路 |
| `resident` | 岛上各阶层的人口 / 满足度 / 结算进度 | 中 | `(island_id, tier)` 唯一；**人口数量落库、容量不落库**（容量由住宅实时汇总，拆房即掉）；每次结算一条 UPDATE，不读实体回写 |

### 2. 三条核心原则（本项目已落地）

| 原则 | 做法 | 本项目实现 |
|---|---|---|
| **高频数据走内存** | 世界在内存里 tick，不每个心跳写库 | 价格每 tick 只改内存，每 5 秒批量落库；DB 写入量降为 1/5 |
| **关键数据立即落库** | 涉及金币/道具的操作必须事务 + 强一致 | 买卖成交、挂单冻结/成交立刻写库，且用条件原子 UPDATE 防并发超扣 |
| **时序数据单独管** | 日志、行情这类只增不改的数据单独表 + 定期清理 | `price_history` 独立表 + 索引 + 每 10 分钟清理过期数据 |

### 3. 并发一致性：四类坑与本项目解法（已全部落地）

联机游戏最常见的崩溃不是"功能写错"，而是**多个玩家 + 世界心跳同时改同一行数据**。
本项目把下面四类问题全部处理掉了，压测 960 次并发请求 0 失败、0 报错。

| 坑 | 现象 | 解法 | 代码位置 |
|---|---|---|---|
| **乐观锁把心跳打死** | 心跳给玩家加声望时撞上玩家自己的买卖 → `StaleObjectStateException` → 整条心跳事务回滚，**作物不长、工厂不产、价格不动** | 累加型字段改用**原子 UPDATE**（`set treasury = treasury + :delta`），完全不碰 `@Version` | `PlayerRepository.addTreasury / trySpend / addReputation`、`StockRepository.upsertAdd / takeQuantity` |
| **并发超扣** | "先查余额再扣"在并发下会把钱扣成负数 | 条件原子更新：`where treasury >= :amt`，影响行数 0 就是余额不足 | `PlayerRepository.trySpend` |
| **一单卖两次** | 两人同时点"接单"，都读到 OPEN | 条件原子成交：`where status = OPEN`，只有一个能改成 FILLED | `TradeOfferRepository.fill / closeByOwner` |
| **MySQL 死锁** | `Deadlock found when trying to get lock`，两个事务互相攥着对方要的行锁 | ① **统一加锁顺序**：所有事务都按 `库存 → 玩家 → 行情` 写；② 库存行预建，出入库永远只有 UPDATE；③ `DbRetry` 捕获 `ConcurrencyFailureException` 自动重试 3 次 | `MarketService`、`TradeService`、`DbRetry` |

心跳层的额外保护（`GameTickService` / `ProductionService`）：

- 种植 / 生产 / 行情三个子系统**互相隔离**，一个挂了不影响另外两个；
- 生产**按玩家分批**提交，某一批撞锁只跳过这一批，下个心跳自动补算；
- 撞锁自动重试 3 次（退避 30/60ms），连续失败才打一行 WARN。

> 配套压测脚本：`stress-test.mjs`（4 玩家 × 8 座建筑 × 40 轮 × 24 并发，边跑心跳边疯狂买卖）。

### 4. 上量之后还要改什么

1. **热点数据进 Redis**：库存、行情、在线状态放缓存，MySQL 只做最终持久化。
2. **分库分表**：玩家数据按 `player_id` 取模分片，单表过千万就拆。
3. **读写分离**：行情查询打从库，写入走主库。
4. **时序数据外迁**：`price_history` 涨到千万级后迁 InfluxDB / ClickHouse，或按月分表。
5. **停服落盘**：关服时把内存世界（地块/建筑进度）全量刷盘，开服时载入。
6. **防作弊**：所有数值裁决放服务端，客户端只发意图（本项目已是这个模式）。
7. **批量提交**：开 Hibernate JDBC batch（本项目已开 `batch_size=50`）。

---

## 六、调参（application.yml）

| 参数 | 默认 | 说明 |
|---|---|---|
| `anno.tick-ms` | 1000 | 世界心跳间隔 |
| `anno.broadcast-ms` | 3000 | 全服广播间隔 |
| `anno.time-scale` | 1.0 | 时间加速倍率（调 10 即 10 倍速） |
| `anno.market-revert-rate` | 0.02 | 价格回归速度 |
| `anno.market-noise` | 0.03 | 价格波动幅度 |
| `anno.market-impact` | 0.05 | 成交冲击系数 |
| `anno.start-treasury` | 5000 | 初始资金 |
| `anno.grid-size` | 36 | 岛屿边长（格）：36 即 36×36 = 1296 格。岛的轮廓由地形图随机生成，不是方形 |
| `anno.coast-width` | 1 | **海岸带宽度**（格）：离水不超过这么多步的陆地是沙滩，**贸易站（港口）只能建在沙滩上**，且港口大门自动朝海。设 0 = 关掉这条规则 |
| `anno.terrain.*` | — | 地形生成参数（噪声频率 / 海平面阈值 / 山地比例 / 矿脉数量等）。**同一个岛屿 id 必然生成同一座岛**，与这些参数绑定 |
| `anno.plot-limit` | 24 | 每座岛同时最多能种多少株作物 |
| `anno.road-cost` | 30 | 一格马路造价 |
| `anno.road-refund-rate` | 0.5 | 拆路返还比例 |
| `anno.demolish-refund-rate` | 0.5 | 拆建筑返还比例 |
| `anno.resident-settle-seconds` | 30 | 人口结算周期（游戏秒）。需求按"每人每分钟"计，攒够一个周期才一次性结算；调小会让消耗因取整而偏大（10 秒时 1.6 会凑成 2），调大则人口涨落更迟钝 |

> NPC 的旋钮不在 `application.yml` 里 —— 它整套跑在客户端。
> 想调行人系统，改 `static/jsm/npc.js` 顶部的 `NPC_CONFIG`：
> `daySeconds`（一个游戏日多少真实秒）、`detailMax`（完整动画名额）、`crowdMax`（人群层上限）、
> `maxTotal`（同时模拟的人数上限）、`lodNear/lodMid/lodFar/cullDist`（LOD 距离档）、
> `pathBudget`（每帧最多跑几次寻路 BFS）。想调原型与配色池，改 `static/jsm/npc-roster.js`。

---

## 七、后续可扩展

1. **换 MySQL**：pom 加 `mysql-connector-j`（本地仓库已有），改 `spring.datasource` 即可。
2. **真登录**：目前 token 是 UUID 明文，可换 JWT + Spring Security。
3. **客户端**：已内置 three.js 的 `game.html`（REST 发指令 + WebSocket 收 `world`/`event` 驱动表现层）；
   若换 Unity/Cocos 手游端，协议完全不用改，照搬这套 REST + WebSocket 即可。
4. **居民经济再往深走**：已落地港口 → 住宅 → 需求 → 税收这条闭环，可接着做
   **住宅升级链**（农夫小屋原地升成工人住宅，而不是拆了重盖）、**公共建筑加成**
   （市场/酒馆/教堂提升满足度上限）、**幸福度与节庆事件**、**跨岛人口迁徙**。
5. **街头生活再往深走**：已落地 14 原型 + 6 换装轴 + 六态状态机 + 三级 LOD + 人群层，可接着做
   **NPC 背包与真实交易**（去面包房是真的把面包买走）、**马车/货船等交通工具**、
   **节日游行与集市**（人群按事件聚集到港口）、**NPC 与玩家交互**（点击路人看他的身份、去向、正在想什么）。
6. **其他玩法扩展**：船只与跨岛运输、NPC 商人订单、公会/联盟、排行榜。
