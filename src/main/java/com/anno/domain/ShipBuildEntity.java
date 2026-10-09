package com.anno.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

/**
 * 造船厂的在建船（船台队列）。
 * <p>
 * 一座岛的造船厂同时只能开工一艘（船台就一个）—— 再点开工会被拒。
 * 工期随岛屿心跳推进（游戏秒，离线冻结同作物 / 工厂 / 远征），
 * 完工那一刻 {@link com.anno.service.ShipyardService} 会删除本行并创建
 * {@link ShipEntity} 入舰队。
 */
@Entity
@Table(name = "ship_build")
public class ShipBuildEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Version
    @Column(nullable = false)
    private long version;

    @Column(nullable = false)
    private Long playerId;

    @Column(nullable = false)
    private Long islandId;

    /** 船型 key：ShipType.name() */
    @Column(nullable = false, length = 16)
    private String shipType;

    /** 总工期（游戏秒） */
    @Column(nullable = false)
    private double totalSeconds;

    /** 已推进（游戏秒） */
    @Column(nullable = false)
    private double elapsed;

    @Column(nullable = false)
    private long createdAt;

    protected ShipBuildEntity() {
    }

    public ShipBuildEntity(Long playerId, Long islandId, String shipType, double totalSeconds, long now) {
        this.playerId = playerId;
        this.islandId = islandId;
        this.shipType = shipType;
        this.totalSeconds = totalSeconds;
        this.createdAt = now;
    }

    public Long getId() { return id; }
    public Long getPlayerId() { return playerId; }
    public Long getIslandId() { return islandId; }
    public String getShipType() { return shipType; }
    public double getTotalSeconds() { return totalSeconds; }
    public double getElapsed() { return elapsed; }
    public void setElapsed(double elapsed) { this.elapsed = elapsed; }
    public long getCreatedAt() { return createdAt; }

    /** 0~1 进度 */
    public double progress() {
        return totalSeconds <= 0 ? 1.0 : Math.min(1.0, elapsed / totalSeconds);
    }
}
