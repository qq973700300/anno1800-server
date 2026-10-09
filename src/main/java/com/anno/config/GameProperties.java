package com.anno.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** 世界参数，全部可在 application.yml 里热调 */
@Component
@ConfigurationProperties(prefix = "anno")
public class GameProperties {

    /** 世界心跳间隔（毫秒） */
    private long tickMs = 1000;
    /** 全服广播间隔（毫秒） */
    private long broadcastMs = 3000;
    /** 时间加速倍率 */
    private double timeScale = 1.0;
    /** 每次心跳价格向基准价回归的比例 */
    private double marketRevertRate = 0.02;
    /** 随机波动幅度 */
    private double marketNoise = 0.03;
    /** 成交冲击：每 100 单位推动价格的比例 */
    private double marketImpact = 0.05;
    /** 新玩家初始资金 */
    private double startTreasury = 5000;
    /** 行情落库间隔（毫秒）：价格每 tick 只在内存变动，每隔这么久才批量写库并记录一条快照 */
    private long priceFlushMs = 5000;
    /** 行情快照保留时长（小时） */
    private long priceHistoryHours = 24;

    /**
     * 离线宽限（毫秒）：玩家不在线时，他的岛**停止模拟**（作物不长、工厂不产、
     * 居民不吃不缴税、商船不跑）；只有掉线时长超过这个宽限的部分才真的被冻结掉。
     * <p>
     * 【为什么留一段宽限而不是严格 0】浏览器切后台、网络抖动几秒都是常态，
     * 一断线就冻结会让玩家觉得"我就切了个标签页，回来作物白等了"。
     * 宽限内的这段时间仍按在线推进，观感上是连续的。
     * <p>
     * 它同时也是**单次推进的上限**：服务端卡顿或休眠唤醒后，一次心跳不会推进一大截。
     * 设成 0 = 严格冻结（一离线就停），设得很大 = 回到"离线也在跑"的老行为。
     */
    private long offlineGraceMs = 5000;

    /* ---------------- 岛屿网格（修路 / 摆建筑 / 种地共用同一张方格图） ---------------- */
    /**
     * 网格边长（格）：一座岛最多 gridSize × gridSize 格。
     * <p>
     * 这是**画布尺寸**，不是陆地面积 —— 海里有多少陆地由地形决定（见 {@link Terrain}），
     * 默认约 62% 是陆地、其中一成多是山地、再扣掉矿脉，真正能盖房子的平原大约占四成。
     * <p>
     * 22×22（484 格）时岛小得像个沙盘，36×36（1296 格）能跑通玩法但一眼望到头，
     * 56×56（3136 格、可建平原约 1700 格）才是"一座岛"该有的样子。
     */
    private int gridSize = 56;
    /** 每座岛最多能种多少块作物：农田不再预生成，玩家自己在空地上播种（岛大了，上限也得跟着涨） */
    private int plotLimit = 64;
    /** 修一格马路的造价 */
    private double roadCost = 30;
    /** 拆路返还比例 */
    private double roadRefundRate = 0.5;
    /** 拆建筑返还比例（多格建筑放错位置时得能反悔，否则地皮会被废掉） */
    private double demolishRefundRate = 0.5;

    /**
     * 海岸带宽度（格）：**离水不超过这么多步**的陆地就是沙滩，港口（贸易站）只能建在沙滩上。
     * <p>
     * 注意是"离水步数"而不是"网格最外几圈"：岛形是不规则的，
     * 网格最外一圈大部分是水，那条定义已经没有意义了。
     * 网格之外也算水，所以一整片平原的平岛会退化成"最外 coastWidth 圈是沙滩"——
     * 与改造前完全一致，老存档不会被卡住。设成 0 等于关掉这条规则。
     */
    private int coastWidth = 1;

    /* ---------------- 地形（岛的轮廓 / 山地 / 矿脉） ---------------- */
    /**
     * 岛形与地下资源。地形是**算出来的**：种子由岛屿 id 决定，
     * 同一座岛永远长同一个样子（所以地形不必落库也能复现，落库只是给个快照）。
     */
    private Terrain terrain = new Terrain();

    /**
     * 地形生成参数。想换一批岛的风貌（更碎 / 更整、山更多 / 没山）改这里就够了。
     */
    public static class Terrain {

        /**
         * 陆地占比（占整张网格）。0.62 意味着有近四成是水 ——
         * 岸线曲折、留出港湾，但也别把可建地挤没了。
         */
        private double landRatio = 0.62;

        /** 山地占陆地的比例：山体堆在岛心，把它周围的平原切成"山脚地" */
        private double mountainRatio = 0.13;

        /**
         * 矿脉数量（每条 4~8 格）。矿脉撒在山脚下、离岸至少 2 格，
         * 每种矿脉的总面积不超过平原的 10%。
         * 岛从 36 格放大到 56 格之后平原多了两倍多，矿脉也得跟着加，否则全岛只有三处矿。
         */
        private int ironVeins = 5;
        private int clayVeins = 5;

        public double getLandRatio() { return landRatio; }
        public void setLandRatio(double landRatio) { this.landRatio = landRatio; }

        public double getMountainRatio() { return mountainRatio; }
        public void setMountainRatio(double mountainRatio) { this.mountainRatio = mountainRatio; }

        public int getIronVeins() { return ironVeins; }
        public void setIronVeins(int ironVeins) { this.ironVeins = Math.max(0, ironVeins); }

        public int getClayVeins() { return clayVeins; }
        public void setClayVeins(int clayVeins) { this.clayVeins = Math.max(0, clayVeins); }
    }

    /* ---------------- 居民经济（港口 → 住宅 → 居民需求 → 税收） ---------------- */
    /**
     * 人口结算周期（游戏秒）。
     * <p>
     * 不能按心跳（1 秒）结算：需求按"每人每分钟"算，24 个农夫一秒只吃 0.16 个土豆，
     * 取整后永远是 0，东西根本消耗不掉。攒到 30 秒一次，每次算的都是"整段时间"的量。
     * 调小会让消耗量因取整而偏大（如 10 秒时 1.6 会凑成 2），调大则人口变化更迟钝。
     */
    private double residentSettleSeconds = 30;

    /* ---------------- 物流（产出 → 马车 → 就近仓库） ---------------- */
    /** 马车满载量：建筑待运攒够这么多才派一班车（太少会车水马龙，太多则入库太钝） */
    private int cartLoad = 6;
    /** 马车最大载货：待运再多，一趟也只拉这么多 */
    private int cartCapacity = 12;
    /** 马车走一格路耗时（游戏秒）：行程 = 路网距离 × 它 */
    private double cartSecondsPerCell = 0.45;
    /** 建筑待运区上限：堆到这么多还没车拉（没仓库 / 没连通）就停产待援 */
    private int pendingCap = 30;
    /** 马车到仓库后的卸货耗时（游戏秒）：停在仓库门口，卸完才真正入库 —— 纪元1800 的"上下货要时间" */
    private double depotUnloadSeconds = 8;

    /* ---------------- 伐木场（真砍树） ---------------- */
    /** 砍伐半径（格，欧氏距离）：伐木场只砍这个范围内的树，砍光即停产 */
    private double lumberChopRadius = 8;
    /** 每砍 1 棵树对应的产木数：产 2 木消耗 1 棵树（欠账累积，不足不砍） */
    private int woodPerTree = 2;
    /**
     * 树苗复育时长（分钟）：被砍的格子过了这么久重新长回成树。
     * 森林因此是<b>可再生</b>资源 —— 伐木场不用拆了搬家，规划两片林区轮伐即可。
     */
    private long lumberRegrowMinutes = 10;

    /** 马车满载量 */
    public int getCartLoad() { return cartLoad; }
    /** 马车最大载货 */
    public int getCartCapacity() { return cartCapacity; }
    /** 马车每格耗时（游戏秒） */
    public double getCartSecondsPerCell() { return cartSecondsPerCell; }
    /** 待运区上限 */
    public int getPendingCap() { return pendingCap; }
    /** 卸货耗时（游戏秒） */
    public double getDepotUnloadSeconds() { return depotUnloadSeconds; }
    /** 伐木场砍伐半径（格） */
    public double getLumberChopRadius() { return lumberChopRadius; }
    /** 每砍 1 棵树的产木数 */
    public int getWoodPerTree() { return woodPerTree; }
    /** 树苗复育时长（分钟） */
    public long getLumberRegrowMinutes() { return lumberRegrowMinutes; }

    /**
     * 格子是否在网格范围内。
     * <p>
     * <b>这只是"画布边界"，不等于"这里是陆地"</b>：网格里可能有水（海面与海湾）、
     * 有山地、有矿脉。"这一格能不能盖 / 能不能修路 / 能不能种"一律去问
     * {@code TerrainService}（它持有这座岛的地形图），别再用 inBounds 当陆地判定。
     */
    public boolean inBounds(int x, int z) {
        return x >= 0 && z >= 0 && x < gridSize && z < gridSize;
    }

    public long getTickMs() { return tickMs; }
    public void setTickMs(long tickMs) { this.tickMs = tickMs; }

    public long getBroadcastMs() { return broadcastMs; }
    public void setBroadcastMs(long broadcastMs) { this.broadcastMs = broadcastMs; }

    public double getTimeScale() { return timeScale; }
    public void setTimeScale(double timeScale) { this.timeScale = timeScale; }

    public double getMarketRevertRate() { return marketRevertRate; }
    public void setMarketRevertRate(double marketRevertRate) { this.marketRevertRate = marketRevertRate; }

    public double getMarketNoise() { return marketNoise; }
    public void setMarketNoise(double marketNoise) { this.marketNoise = marketNoise; }

    public double getMarketImpact() { return marketImpact; }
    public void setMarketImpact(double marketImpact) { this.marketImpact = marketImpact; }

    public double getStartTreasury() { return startTreasury; }
    public void setStartTreasury(double startTreasury) { this.startTreasury = startTreasury; }

    public long getPriceFlushMs() { return priceFlushMs; }
    public void setPriceFlushMs(long priceFlushMs) { this.priceFlushMs = priceFlushMs; }

    public long getPriceHistoryHours() { return priceHistoryHours; }
    public void setPriceHistoryHours(long priceHistoryHours) { this.priceHistoryHours = priceHistoryHours; }

    public long getOfflineGraceMs() { return offlineGraceMs; }
    public void setOfflineGraceMs(long offlineGraceMs) { this.offlineGraceMs = Math.max(0, offlineGraceMs); }

    public int getGridSize() { return gridSize; }
    public void setGridSize(int gridSize) { this.gridSize = gridSize; }

    public int getPlotLimit() { return plotLimit; }
    public void setPlotLimit(int plotLimit) { this.plotLimit = plotLimit; }

    public double getRoadCost() { return roadCost; }
    public void setRoadCost(double roadCost) { this.roadCost = roadCost; }

    public double getRoadRefundRate() { return roadRefundRate; }
    public void setRoadRefundRate(double roadRefundRate) { this.roadRefundRate = roadRefundRate; }

    public double getDemolishRefundRate() { return demolishRefundRate; }
    public void setDemolishRefundRate(double demolishRefundRate) { this.demolishRefundRate = demolishRefundRate; }

    public int getCoastWidth() { return coastWidth; }
    public void setCoastWidth(int coastWidth) { this.coastWidth = Math.max(0, coastWidth); }

    public Terrain getTerrain() { return terrain; }
    public void setTerrain(Terrain terrain) { this.terrain = terrain; }

    public double getResidentSettleSeconds() { return residentSettleSeconds; }
    public void setResidentSettleSeconds(double residentSettleSeconds) {
        this.residentSettleSeconds = Math.max(1, residentSettleSeconds);
    }

    /** 每次心跳推进的游戏秒数 */
    public double secondsPerTick() {
        return (tickMs / 1000.0) * timeScale;
    }
}
