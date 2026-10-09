package com.anno.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

/**
 * 远征队：一艘船带着补给出海探险（纪元1800 式远征玩法）。
 * <p>
 * 【生命周期】{@code VOYAGING}（航行中）→ 触发事件转 {@code EVENT}（等玩家选择，
 * 超时自动走保守项）→ 回到 {@code VOYAGING}……进度走满或士气归零后定格
 * {@code DONE}（成功结算）或 {@code FAILED}（空手而归）。
 * <p>
 * 【进度是模拟秒驱动的】tick 拿到的是已经过离线冻结/时间倍率折算的"游戏秒"
 * （见 {@code IslandSimService}），所以离线远征照样冻结、不掉士气 ——
 * 和作物生长 / 工厂产出是一套时钟，玩家不用担心挂机回来全船喂鱼。
 * <p>
 * {@code plan} 是出发前就掷好的事件序列（逗号分隔的事件 key）：
 * 一次掷定不再变，重连 / 重启都不会让"同样的进度弹出不同的事件"。
 */
@Entity
@Table(name = "expedition")
public class ExpeditionEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 乐观锁：玩家的选择和心跳 tick 同时改同一行时，后到者收到冲突重试而不是静默覆盖 */
    @Version
    @Column(nullable = false)
    private long version;

    @Column(nullable = false)
    private Long playerId;

    @Column(nullable = false)
    private Long islandId;

    @Column(nullable = false, length = 48)
    private String name;

    /** 目的地 key：GREEN_ISLES（普通航线）/ SKULL_ISLAND（骷髅岛） */
    @Column(nullable = false, length = 32)
    private String destination;

    /** VOYAGING / EVENT / DONE / FAILED */
    @Column(nullable = false, length = 16)
    private String status;

    /** 航程 0~100 */
    @Column(nullable = false)
    private double progress;

    /** 士气 0~100，归零 = 远征失败 */
    @Column(nullable = false)
    private double morale;

    /** 补给 0~100（出发时装的货折算成的点数池），事件选项要花它 */
    @Column(nullable = false)
    private double supplies;

    /** 出发前掷定的事件序列，逗号分隔 */
    @Column(nullable = false, length = 128)
    private String plan;

    /** 已处理到 plan 的第几个事件（0 基） */
    @Column(nullable = false)
    private int stage;

    /** 当前待选择的事件 key（status=EVENT 时非空） */
    @Column(length = 32)
    private String currentEvent;

    /** 当前事件剩余选择时间（游戏秒），归零自动走保守项 */
    @Column(nullable = false)
    private double choiceLeft;

    /** 给人看的航行记录（事件与选择结果逐条追加） */
    @Column(length = 2048)
    private String resultLog = "";

    /** 结算文案（成功 / 失败都写） */
    @Column(length = 512)
    private String reward = "";

    /** 本次远征占用的船（player_ship.id）；结算 / 失败后释放回 IDLE */
    @Column
    private Long shipId;

    /** 出发时用的船型 key（奖励加成按它算；老数据为 null = 无加成） */
    @Column(length = 16)
    private String shipType;

    @Column(nullable = false)
    private long createdAt;

    @Column(nullable = false)
    private long endedAt;

    protected ExpeditionEntity() {
    }

    public ExpeditionEntity(Long playerId, Long islandId, String name, String destination,
                            String plan, long now) {
        this.playerId = playerId;
        this.islandId = islandId;
        this.name = name;
        this.destination = destination;
        this.plan = plan;
        this.status = "VOYAGING";
        this.progress = 0;
        this.morale = 100;
        this.supplies = 100;
        this.stage = 0;
        this.choiceLeft = 0;
        this.createdAt = now;
        this.endedAt = 0;
    }

    public Long getId() { return id; }
    public Long getPlayerId() { return playerId; }
    public Long getIslandId() { return islandId; }
    public String getName() { return name; }
    public String getDestination() { return destination; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public double getProgress() { return progress; }
    public void setProgress(double progress) { this.progress = progress; }
    public double getMorale() { return morale; }
    public void setMorale(double morale) { this.morale = morale; }
    public double getSupplies() { return supplies; }
    public void setSupplies(double supplies) { this.supplies = supplies; }
    public String getPlan() { return plan; }
    public int getStage() { return stage; }
    public void setStage(int stage) { this.stage = stage; }
    public String getCurrentEvent() { return currentEvent; }
    public void setCurrentEvent(String currentEvent) { this.currentEvent = currentEvent; }
    public double getChoiceLeft() { return choiceLeft; }
    public void setChoiceLeft(double choiceLeft) { this.choiceLeft = choiceLeft; }
    public String getResultLog() { return resultLog == null ? "" : resultLog; }
    public void setResultLog(String resultLog) { this.resultLog = resultLog; }
    public String getReward() { return reward == null ? "" : reward; }
    public void setReward(String reward) { this.reward = reward; }
    public Long getShipId() { return shipId; }
    public void setShipId(Long shipId) { this.shipId = shipId; }
    public String getShipType() { return shipType; }
    public void setShipType(String shipType) { this.shipType = shipType; }
    public long getCreatedAt() { return createdAt; }
    public long getEndedAt() { return endedAt; }
    public void setEndedAt(long endedAt) { this.endedAt = endedAt; }
}
