package com.anno.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

/**
 * 一座岛上某个**阶层**的居民聚居状态（岛 + 阶层 唯一一行）。
 * <p>
 * 为什么不按"每栋房子一行"存？因为玩家关心的是"我这座岛上有多少农夫、他们满意吗"，
 * 而不是"第 7 号小屋住了几个人"。按阶层聚合后，增减人口永远是一条 UPDATE 打一行，
 * 房子盖多盖少只影响容量（容量由建筑实时推导，不落库，和占地宽高的处理方式一致）。
 * <p>
 * 【人口是状态、容量是推导】
 * population 必须落库（它是随时间累积的结果）；
 * capacity 不落库，每次用时从岛上的住宅建筑实时汇总 —— 这样拆掉一栋房子，
 * 容量立刻跟着掉，不需要任何"同步容量"的维护代码。
 */
@Entity
@Table(name = "resident",
        uniqueConstraints = @UniqueConstraint(name = "uk_resident_island_tier",
                columnNames = {"island_id", "tier"}))
public class ResidentEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "island_id", nullable = false)
    private Long islandId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private ResidentTier tier;

    /** 当前住着的人数 */
    @Column(nullable = false)
    private int population;

    /** 上一次结算算出的满足度 0~1（1 = 需求全满足）；界面直接显示它 */
    @Column(nullable = false)
    private double satisfaction = 1.0;

    /**
     * 距上一次结算又累积了多少**游戏秒**。
     * <p>
     * 为什么需要它：需求按"每人每分钟"算，而心跳是每秒一次，
     * 一秒钟的需求量 24×0.4/60 ≈ 0.16，直接取整会永远是 0（东西永远消耗不掉）。
     * 所以把时间攒起来，攒够一个结算周期（默认 30 游戏秒）再一次性结算，
     * 这样每次算的都是"整段时间"的量，没有量化误差。
     */
    @Column(name = "carry_seconds", nullable = false)
    private double carrySeconds;

    /** 上一次结算实际入账的税金（每分钟口径），用于界面展示"这座岛每分钟收多少" */
    @Column(name = "last_tax", nullable = false)
    private double lastTax;

    protected ResidentEntity() {
    }

    public ResidentEntity(Long islandId, ResidentTier tier) {
        this.islandId = islandId;
        this.tier = tier;
        this.population = 0;
    }

    public Long getId() { return id; }
    public Long getIslandId() { return islandId; }
    public ResidentTier getTier() { return tier; }
    public int getPopulation() { return population; }
    public void setPopulation(int population) { this.population = Math.max(0, population); }
    public double getSatisfaction() { return satisfaction; }
    public void setSatisfaction(double satisfaction) { this.satisfaction = satisfaction; }
    public double getCarrySeconds() { return carrySeconds; }
    public void setCarrySeconds(double carrySeconds) { this.carrySeconds = carrySeconds; }
    public double getLastTax() { return lastTax; }
    public void setLastTax(double lastTax) { this.lastTax = lastTax; }

    /** 这座岛这个阶层每分钟消耗多少某种商品 */
    public double needPerMinute(Good good) {
        Double per = tier.getNeeds().get(good);
        return per == null ? 0 : per * population;
    }

    /** 需求被满足时每分钟的税收（满足度 100% 口径，实际值要乘 satisfaction） */
    public double taxPerMinute() {
        return tier.getTaxPerResidentPerMinute() * population;
    }
}
