package com.anno.dto;

import java.util.List;

/** 客户端视图对象合集（全部是只读 record，序列化后直接给手游客户端用） */
public final class Views {

    private Views() {
    }

    public record PlayerView(Long id, String name, String token, double treasury,
                             long reputation, boolean online) {
    }

    /**
     * 岛屿：末尾是网格参数 + **地形串**，客户端据此画出岛形与方格图。
     * <p>
     * coastWidth 是海岸带宽度（格）：**离水不超过这么多步**的陆地是沙滩，
     * 港口（贸易站）只能建在沙滩上。客户端拿它渲染沙滩、并在建造面板上提前告诉玩家
     * "贸易站得往岛边放"，免得只会在服务端被驳回（跟 gridSize 一样，是两侧共用的一份定义）。
     * <p>
     * terrain 是地形快照：长度 = gridSize × gridSize，行优先（index = z × gridSize + x），
     * 每格一个字符 —— {@code '.'} 平原 / {@code '~'} 水 / {@code '^'} 山地 /
     * {@code 'i'} 铁矿脉 / {@code 'c'} 黏土矿脉。客户端的字符表必须与此完全一致。
     * <p>
     * terrainSeed 是这张图的种子（由岛屿 id 推出）：报 bug 时报上它就能复现同一座岛。
     * terrainSummary 是给人看的一行摘要（陆地 / 山地 / 矿脉各多少格），控制台直接显示。
     */
    public record IslandView(Long id, Long ownerId, String name, int fertility,
                             int plotLimit, int plotCount,
                             int gridSize, int coastWidth, double roadCost,
                             String terrain, long terrainSeed, String terrainSummary,
                             Double clockHour, Integer clockDaySeconds) {
    }

    /** 马路：网格上的一格 */
    public record RoadView(Long id, Long islandId, int cellX, int cellZ, String kind, String kindLabel) {
    }

    /** 作物：长在岛上的某一格（cellX, cellZ），位置由玩家自己选 */
    public record PlotView(Long id, Long islandId, int cellX, int cellZ, String crop, String cropLabel,
                           String state, double progress, int plannedYield, double ripeElapsed, Long buildingId) {
    }

    /**
     * 建筑：gridX/gridZ 是**旋转后**占地矩形的左上角，sizeW×sizeH 是旋转后的占地尺寸（格）。
     * <p>
     * rotation 是朝向（度，0=门朝南 / 90=门朝东 / 180=门朝北 / 270=门朝西）：
     * 它既是大门所在的那一边，也决定了 90°/270° 时宽高是否对调 —— 客户端照它画门与摆模型。
     * <p>
     * kind 是用途（PRODUCTION / RESIDENCE / HARBOR）：客户端据此决定"显示生产进度条"
     * 还是"显示居民容量"，住宅与贸易站没有配方和进度可言。
     */
    public record BuildingView(Long id, Long islandId, String type, String label, int level,
                               double progress, boolean stalled, String recipe,
                               Integer gridX, Integer gridZ, int sizeW, int sizeH, int rotation,
                               String kind, int pendingQty, boolean noWorkers, int workers) {
    }

    /**
     * 建筑图鉴：客户端建造面板直接照这份数据渲染，不用在客户端硬编码造价与占地尺寸，
     * 免得改了 {@code BuildingType} 客户端忘记同步。
     * <p>
     * sizeW/sizeH 是**未旋转**的基准尺寸；玩家把建筑转 90° 时客户端自己对调这两个值。
     * <p>
     * kind 让面板能把"工厂 / 住宅 / 港口"分开摆；住宅还会带上 residentTier 与容量，
     * requiredFarmerPopulation 则是"人口门槛解锁"的提示来源（农夫满 N 人才让建）。
     */
    /**
     * 建筑图鉴：客户端建造面板直接照这份数据渲染，不用在客户端硬编码造价与占地尺寸，
     * 免得改了 {@code BuildingType} 客户端忘记同步。
     * <p>
     * sizeW/sizeH 是**未旋转**的基准尺寸；玩家把建筑转 90° 时客户端自己对调这两个值。
     * <p>
     * 【2026-09-25 扩表后新增的字段】接进一百多座建筑之后，客户端要能自己画出
     * "纪元1800 式的分类建造菜单"，所以图鉴里额外带上了：
     * <ul>
     *   <li>{@code group} / {@code groupLabel} / {@code groupIcon}：它属于哪个分页（农夫 / 工人 / 港口 / 军事…）；</li>
     *   <li>{@code form} / {@code tint} / {@code icon}：程序化外观与卡片图标；</li>
     *   <li>{@code requiredTier} / {@code requiredPopulation}：解锁门槛（任意阶层，不只是农夫）；</li>
     *   <li>{@code terrain} / {@code coastal}：地形约束（矿脉 / 山地 / 海岸 / 骑岸线）；</li>
     *   <li>{@code service} 三件套：这座建筑提供什么公共服务。</li>
     * </ul>
     */
    public record BuildingTypeView(String type, String label, int cost, int durationSeconds,
                                   int sizeW, int sizeH, int sizeCells, String recipe,
                                   String kind, String residentTier, int residentCapacity,
                                   int requiredFarmerPopulation, String requiredOre, int workers,
                                   String group, String groupLabel, String groupIcon,
                                   String form, int tint, String icon, String hint,
                                   String requiredTier, String requiredTierLabel, int requiredPopulation,
                                   String terrain, boolean coastal,
                                   String service, String serviceLabel, int serviceRadius,
                                   int serviceValue, String serviceHint,
                                   List<java.util.Map<String, Object>> goodsCost) {
    }

    /**
     * 某个居民阶层的当前状态。
     * <p>
     * population 来自 {@code resident} 表（会随时间涨落），capacity 由岛上的住宅建筑**实时汇总**
     * —— 房子一拆容量立刻掉，所以这里可能出现 "人口 > 容量" 的瞬间，客户端按 capacity 显示即可。
     * satisfaction 是上一轮结算的满足度（1 = 需求全满足）；taxPerMinute 是折算到每分钟的税收，
     * 方便玩家一眼看出"这群人现在每分钟给我挣多少"。
     */
    public record ResidentView(String tier, String label, int population, int capacity,
                               double satisfaction, double taxPerMinute, List<NeedView> needs,
                               boolean unlocked, boolean built) {
    }

    /** 需求明细：这个阶层每分钟要吃 / 用掉多少（requiredPerMinute），仓库现在有多少（stock） */
    public record NeedView(String good, String label, double perResidentPerMinute,
                           int requiredPerMinute, int stock) {
    }

    /**
     * 一项公共服务的覆盖情况：coverage 是"被它覆盖到的住宅占比"（0~1）。
     * 客户端在人口面板上据此提示"还差一座教堂 / 学校"。
     */
    public record ServiceView(String service, String label, String hint, double coverage) {
    }

    /** 岛屿人口总览：客户端人口面板的数据源，也是"这套流程跑起来了吗"的唯一答案 */
    public record PopulationView(Long islandId, boolean hasTradingPost, int totalPopulation,
                                 int totalCapacity, double taxPerMinute,
                                 List<ResidentView> tiers, List<ServiceView> services) {
    }

    public record StockView(String good, String label, int quantity, double unitPrice, double totalValue) {
    }

    public record MarketRow(String good, String label, double price, double basePrice,
                            double changeRatio, int volume) {
    }

    /** 分时点：ts 毫秒时间戳、price 价格、volume 该时段成交量 */
    public record PricePoint(long ts, double price, int volume) {
    }

    /** K 线蜡烛：开高低收 + 成交量 */
    public record Candle(long ts, double open, double high, double low, double close, int volume) {
    }

    public record OfferView(Long id, Long playerId, String playerName, String side, String good,
                            String label, int quantity, int remaining, double unitPrice,
                            String status, long createdAt) {
    }

    public record TradeResult(Long offerId, String side, String good, int quantity,
                              double unitPrice, double total, double treasury) {
    }

    /** 联机广播的世界快照：**全服共用**的那部分（行情 / 在线名单 / 心跳号） */
    public record WorldSnapshot(long serverTime, long tick, int onlinePlayers,
                                List<MarketRow> market, List<PlayerBrief> players) {
    }

    /**
     * 一艘商船：每个贸易站配一条，沿固定航线自动跑外海市场。
     * <p>
     * 【位置不在服务端算】船走的是固定航线，位置完全是时间的函数 ——
     * 客户端拿到 cycleMs（跑一趟来回多久）与 phaseMs（此刻走到哪了）自己插值画。
     * 所以服务端每 3 秒推一次，画面照样是连续航行，不必为了"船动得顺"而加密推送；
     * 船也不用每拍落库（见 {@code ShipService}）。
     * <p>
     * phaseMs 是"本趟已经走了多少毫秒"，配合客户端的 snapAt 往前推即可，
     * 这样两端时钟有偏差也不会让船瞬移。
     * <p>
     * cargo 三件套是**本趟打算卖的货**（装船前先算好，只算不扣）：
     * 面板因此能显示"这趟带货：木材 ×24 · 预计 ¥312"，玩家一眼看出船在干什么。
     */
    public record ShipView(Long harborId, Long islandId, String name,
                           int capacity, int voyages, String state,
                           long cycleMs, long phaseMs,
                           String cargoGood, String cargoLabel, int cargoQty, double cargoValue) {
    }

    /**
     * 单玩家快照：这个人自己岛上的一切 —— 金币 / 库存 / 路网 / 作物 / 建筑及进度 / 人口 / 商船。
     * <p>
     * 【为什么要有它】这些东西原先全靠客户端开一堆 {@code setInterval} 轮询 HTTP：
     * 每个客户端每秒 5 个请求，而且世界一有动静（厂房每产完一轮）还要额外补拉，
     * 请求量跟玩家数 × 建筑数成正比。改成"服务端按玩家推一份完整快照"之后，
     * 客户端不再问"变了没"，收到就整体重画 —— 请求数与建筑数脱钩，
     * HTTP 只留给玩家操作（下单 / 建造 / 播种）。
     * <p>
     * island 是玩家的主岛（他名下第一座岛）。还没有岛的玩家这里是 null，
     * 客户端会走一次建岛的 HTTP 把它补上。
     */
    public record PlayerSnapshot(long serverTime, long tick, PlayerBrief me, IslandView island,
                                 List<RoadView> roads, List<PlotView> plots,
                                 List<BuildingView> buildings, List<StockView> stock,
                                 PopulationView population, List<ShipView> ships) {
    }

    public record PlayerBrief(Long id, String name, boolean online, double treasury, long reputation) {
    }

    /** 实时事件（作物成熟 / 建筑产出 / 成交 / 上下线） */
    public record GameEvent(String type, long serverTime, java.util.Map<String, Object> payload) {
    }

    /**
     * 远征队视图。
     * <p>
     * status=EVENT 时 eventKey/eventTitle/eventText/options 非空 —— 客户端据此弹事件卡；
     * options 里 affordable/needOk 是"补给够不够 / 士气够不够"的预判，按钮置灰用。
     * resultLog 是给人看的航行日志（服务端只留最近几条），reward 是结算文案。
     */
    public record ExpeditionView(Long id, Long islandId, String name, String destination, String destinationLabel,
                                 String status, double progress, double morale, double supplies,
                                 String eventKey, String eventTitle, String eventText,
                                 List<ExpeditionOptionView> options, double choiceLeft,
                                 String resultLog, String reward, long createdAt, long endedAt) {
    }

    /** 远征事件的一个选项：morale/supplies 是增量（负=消耗），needOk/affordable 是可行性预判 */
    public record ExpeditionOptionView(String label, String hint, double morale, double supplies,
                                       double needMorale, boolean needOk, boolean affordable) {
    }

    /* ================= 造船厂与舰队 ================= */

    /** 舰队里的一艘船：state=IDLE（闲置，可派远征）/ AWAY（在海上） */
    public record FleetShipView(Long id, Long islandId, String type, String typeLabel,
                                String state, String stateLabel) {
    }

    /** 船台上在建的船：progress 0~1 */
    public record ShipBuildView(Long id, Long islandId, String shipType, String typeLabel,
                                double progress, double totalSeconds) {
    }

    /** 造船目录：一种船型的造价 / 工期 / 远征加成（客户端面板直接渲染） */
    public record ShipTypeView(String key, String label, double coinCost,
                               List<java.util.Map<String, Object>> goodsCost,
                               double buildSeconds, double expeditionBonus) {
    }

    /** 玩家的舰队 + 各岛船台的在建队列 */
    public record FleetView(List<FleetShipView> ships, List<ShipBuildView> builds) {
    }
}
