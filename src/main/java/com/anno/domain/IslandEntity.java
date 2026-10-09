package com.anno.domain;

import java.util.List;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** 岛屿：玩家的领地，上面有农田地块和建筑 */
@Entity
@Table(name = "island")
public class IslandEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long ownerId;

    @Column(nullable = false, length = 48)
    private String name;

    /** 肥力 0~100，影响作物产量与生长速度 */
    @Column(nullable = false)
    private int fertility;

    /** 可用农田地块数量上限 */
    @Column(nullable = false)
    private int plotLimit;

    /**
     * 地形快照：每格一个字符（{@link TerrainMap}），长度 = gridSize × gridSize，行优先。
     * <p>
     * 用 MEDIUMTEXT 而不是定长 varchar：grid-size 可调（现在 80 格 = 6400 字符，
     * 4096 的旧列会装不下 —— 扩容网格后新建岛直接 "Data too long" 报错），
     * 岛屿还可能继续变大，mediumtext 上限 16MB，随便扩。
     * <p>
     * 允许为空 —— 为空表示"改造前建的老岛"，服务端会按岛屿 id 现推一张地形图
     * （见 {@code TerrainService}），老存档因此不会因为多了地形就登不进去。
     */
    @Column(columnDefinition = "mediumtext")
    private String terrain;

    @Column(nullable = false)
    private long createdAt;

    /**
     * 上次推进模拟的**墙上时间**（毫秒）—— 岛屿级的时间水位线，懒结算的核心。
     * <p>
     * 【为什么要有它】改造前是世界心跳每秒遍历全服数据（所有作物、所有建筑、所有居民），
     * 离线玩家的岛也在跑，于是开销与"注册玩家数"成正比。有了水位线之后，
     * 模拟改成"按需补算"：某座岛上次推进到几点记在这里，下次推进只补这段时间，
     * 离线期间根本没人碰它 —— 1 万在线就只有 1 万座岛在算，而不是 1 万份历史数据。
     * <p>
     * 0 表示"这一列是后加的、还没初始化"（老存档）：第一次推进时就地补上，不做任何冻结。
     */
    @Column(name = "last_sim_at", nullable = false)
    private long lastSimAt;

    /**
     * 累计被"冻结"掉的墙上时间（毫秒）：这座岛的模拟时钟 = 墙上时间 - 本值。
     * <p>
     * 【离线完全冻结】玩家不在线时，他的岛不长作物、不开工、居民不吃不缴税、商船也不跑。
     * 于是"离线那段时间"必须从模拟时钟里扣掉，否则商船会按真实时间一次性补算几十趟
     * （航次完全由时间推导，见 {@code ShipService}），等于离线白送金币。
     * <p>
     * 只有超出"离线宽限"的部分才计入这里（见 {@code GameProperties#getOfflineGraceMs}）：
     * 切个标签页、网络抖动几秒仍按在线算，玩家不会觉得"我刚离开就白等了"。
     */
    @Column(name = "frozen_ms", nullable = false)
    private long frozenMs;

    protected IslandEntity() {
    }

    public IslandEntity(Long ownerId, String name, int fertility, int plotLimit) {
        this.ownerId = ownerId;
        this.name = name;
        this.fertility = fertility;
        this.plotLimit = plotLimit;
        this.createdAt = System.currentTimeMillis();
        this.lastSimAt = this.createdAt;
    }

    public Long getId() { return id; }
    public Long getOwnerId() { return ownerId; }
    public String getName() { return name; }
    public int getFertility() { return fertility; }
    public void setFertility(int fertility) { this.fertility = fertility; }
    public int getPlotLimit() { return plotLimit; }
    public void setPlotLimit(int plotLimit) { this.plotLimit = plotLimit; }
    public String getTerrain() { return terrain; }
    public void setTerrain(String terrain) { this.terrain = terrain; }
    public long getCreatedAt() { return createdAt; }
    public long getLastSimAt() { return lastSimAt; }
    public void setLastSimAt(long lastSimAt) { this.lastSimAt = lastSimAt; }
    public long getFrozenMs() { return frozenMs; }
    public void setFrozenMs(long frozenMs) { this.frozenMs = Math.max(0, frozenMs); }

    /**
     * 这座岛的**模拟时钟**（毫秒）：墙上时间扣掉"被冻结的那部分"。
     * <p>
     * 一切"由时间推导、不落库"的东西都得按它算 —— 目前是商船的航次与相位。
     * 用墙上时间算的话，玩家离线三天回来，船会一口气补算几十趟。
     */
    public long simClockAt(long wallNow) {
        return wallNow - frozenMs;
    }

    /** 一个游戏日的**真实**秒数：与客户端 npc.js 的 NPC_CONFIG.daySeconds 同源，随岛屿视图下发。 */
    public static final int DAY_SECONDS = 600;

    /**
     * 岛上的**游戏时刻**（0~24，小数）：从模拟时钟推导 —— 模拟时钟每真实秒走
     * 86400 / {@link #DAY_SECONDS} = 144 游戏秒，折成小时后对 24 取余。
     * <p>
     * 【为什么从 simClock 推导、不自己记一列】商船相位用的就是 simClock（{@link #simClockAt}）：
     * 在线按真实速率走、离线冻结（水位线 lastSimAt/frozenMs 持久在库）、重启自动续走。
     * 日夜跟着同一条时间线，才不会出现"作物停着不长、天却照常亮暗"的自相矛盾；
     * 玩家进游戏拿到的时刻就是这座岛上次被模拟到的时刻 —— 不再是客户端写死的"永远早上 7 点"。
     * 注意**不乘 time-scale**：与商船同规（见 memory），倍率只加快经济结算，不改昼夜节奏。
     * 相位锚在 Unix 纪元（simClock = 墙钟 - 冻结量），所以新岛加入的是"世界当前时刻"——
     * 常数开局偏移会被墙钟项淹没，想要"新岛必清晨"得加岛相位列，见 clockHour 下发处注释。
     */
    public double gameHourAt(long wallNow) {
        double gameHours = simClockAt(wallNow) / 1000.0 * (86400.0 / DAY_SECONDS) / 3600.0;
        return gameHours % 24.0;
    }

    /**
     * **上次模拟那一刻**的模拟时钟（毫秒）。
     * <p>
     * 离线（或 websocket 断了走 HTTP 兜底）时读它，等于"把船停在它最后被模拟到的位置"——
     * 与同一时刻被冻结的作物、工厂进度是同一个时间点，界面上不会出现
     * "作物停着不长、船却还在跑"这种自相矛盾。
     */
    public long lastSimClock() {
        return lastSimAt <= 0 ? System.currentTimeMillis() : lastSimAt - frozenMs;
    }

    /** 肥力带来的产量系数：0.6 ~ 1.4 */
    public double yieldFactor() {
        return 0.6 + (fertility / 100.0) * 0.8;
    }

    /** 肥力带来的生长速度系数：越肥长得越快，0.8 ~ 1.2 */
    public double growthFactor() {
        return 1.2 - (fertility / 100.0) * 0.4;
    }
}
