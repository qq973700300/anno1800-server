package com.anno.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

/**
 * 玩家舰队里的一艘船（造船厂完工后入列）。
 * <p>
 * 【状态机】{@code IDLE}（闲置，停泊在港口边，可被远征派出）→
 * {@code AWAY}（在海上跑远征，被远征队占用）→ 归来（成功结算或失败）回 {@code IDLE}。
 * <p>
 * 船属于岛：远征从哪座岛出发就只能用那座岛闲置的船 —— 和纪元1800 的
 * "船停在各岛港口"一致，也免掉跨岛调度的一堆边界情况。
 */
@Entity
@Table(name = "player_ship")
public class ShipEntity {

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
    private String type;

    /** IDLE（闲置）/ AWAY（在海上） */
    @Column(nullable = false, length = 8)
    private String state;

    @Column(nullable = false)
    private long createdAt;

    protected ShipEntity() {
    }

    public ShipEntity(Long playerId, Long islandId, String type, long now) {
        this.playerId = playerId;
        this.islandId = islandId;
        this.type = type;
        this.state = "IDLE";
        this.createdAt = now;
    }

    public Long getId() { return id; }
    public Long getPlayerId() { return playerId; }
    public Long getIslandId() { return islandId; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getState() { return state; }
    public void setState(String state) { this.state = state; }
    public long getCreatedAt() { return createdAt; }
}
