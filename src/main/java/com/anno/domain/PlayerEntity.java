package com.anno.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

/** 玩家（联机世界里的一家"贸易公司"） */
@Entity
@Table(name = "player")
public class PlayerEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 乐观锁版本号：多端同时花钱/交易时，后提交的一方会收到冲突错误而不是静默覆盖，
     * 是联机游戏防"并发扣款丢更新"的标准做法。
     */
    @Version
    @Column(nullable = false)
    private long version;

    @Column(nullable = false, unique = true, length = 32)
    private String name;

    /** 简易登录凭证，客户端后续请求带上即可 */
    @Column(nullable = false, unique = true, length = 64)
    private String token;

    /** 金库 */
    @Column(nullable = false)
    private double treasury;

    /** 声望（贸易与生产积累） */
    @Column(nullable = false)
    private long reputation;

    /** 探险图鉴：已点亮的发现物 key，JSON 数组串（如 ["SKULL_ISLAND","KONG_IDOL"]） */
    @Column(length = 1024)
    private String discoveries = "[]";

    @Column(nullable = false)
    private boolean online;

    @Column(nullable = false)
    private long createdAt;

    @Column(nullable = false)
    private long lastSeenAt;

    protected PlayerEntity() {
    }

    public PlayerEntity(String name, String token, double treasury) {
        this.name = name;
        this.token = token;
        this.treasury = treasury;
        this.reputation = 0;
        this.online = false;
        this.createdAt = System.currentTimeMillis();
        this.lastSeenAt = this.createdAt;
    }

    public Long getId() { return id; }
    public String getName() { return name; }
    public String getToken() { return token; }
    public double getTreasury() { return treasury; }
    public void setTreasury(double treasury) { this.treasury = treasury; }
    public long getReputation() { return reputation; }
    public void setReputation(long reputation) { this.reputation = reputation; }
    public String getDiscoveries() { return discoveries == null ? "[]" : discoveries; }
    public void setDiscoveries(String discoveries) { this.discoveries = discoveries; }
    public boolean isOnline() { return online; }
    public void setOnline(boolean online) { this.online = online; }
    public long getCreatedAt() { return createdAt; }
    public long getLastSeenAt() { return lastSeenAt; }
    public void setLastSeenAt(long lastSeenAt) { this.lastSeenAt = lastSeenAt; }
}
