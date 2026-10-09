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

/** 农田地块：种植系统的最小单位。一块地 = 岛上一格，位置由玩家自己选 */
@Entity
@Table(name = "plot",
        uniqueConstraints = @UniqueConstraint(name = "uk_plot_island_cell", columnNames = {"island_id", "cell_x", "cell_z"}))
public class PlotEntity {

    public enum State { EMPTY, GROWING, RIPE, WITHERED }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "island_id", nullable = false)
    private Long islandId;

    /** 所在格子 X */
    @Column(name = "cell_x", nullable = false)
    private int cellX;

    /** 所在格子 Z */
    @Column(name = "cell_z", nullable = false)
    private int cellZ;

    @Enumerated(EnumType.STRING)
    @Column(length = 16)
    private Good crop;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private State state = State.EMPTY;

    /** 已生长的游戏秒数 */
    @Column(nullable = false)
    private double growElapsed;

    /** 本块地长熟所需的游戏秒数 */
    @Column(nullable = false)
    private double growTarget;

    /** 成熟后未收获的等待秒数，超过 witherSeconds 会枯萎 */
    @Column(nullable = false)
    private double ripeElapsed;

    /** 预估产量（受岛屿肥力影响，种下时算好） */
    @Column(nullable = false)
    private int plannedYield;

    /** 归属的农场建筑（纪元1800式：田从农场"拉"出来）；老存档的散田为 NULL，照常生长 */
    @Column(name = "building_id")
    private Long buildingId;

    protected PlotEntity() {
    }

    public PlotEntity(Long islandId, int cellX, int cellZ) {
        this.islandId = islandId;
        this.cellX = cellX;
        this.cellZ = cellZ;
    }

    public Long getId() { return id; }
    public Long getIslandId() { return islandId; }
    public int getCellX() { return cellX; }
    public int getCellZ() { return cellZ; }
    public Good getCrop() { return crop; }
    public void setCrop(Good crop) { this.crop = crop; }
    public State getState() { return state; }
    public void setState(State state) { this.state = state; }
    public double getGrowElapsed() { return growElapsed; }
    public void setGrowElapsed(double growElapsed) { this.growElapsed = growElapsed; }
    public double getGrowTarget() { return growTarget; }
    public void setGrowTarget(double growTarget) { this.growTarget = growTarget; }
    public double getRipeElapsed() { return ripeElapsed; }
    public void setRipeElapsed(double ripeElapsed) { this.ripeElapsed = ripeElapsed; }
    public int getPlannedYield() { return plannedYield; }
    public void setPlannedYield(int plannedYield) { this.plannedYield = plannedYield; }
    public Long getBuildingId() { return buildingId; }
    public void setBuildingId(Long buildingId) { this.buildingId = buildingId; }

    /** 生长进度 0~1，给客户端画进度条 */
    public double progress() {
        if (state == State.RIPE || state == State.WITHERED) return 1.0;
        if (growTarget <= 0) return 0.0;
        return Math.min(1.0, growElapsed / growTarget);
    }
}
