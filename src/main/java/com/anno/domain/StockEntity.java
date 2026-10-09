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
import jakarta.persistence.Version;

/** 玩家仓库：某种商品的持有量 */
@Entity
@Table(name = "stock",
        uniqueConstraints = @UniqueConstraint(name = "uk_stock_player_good", columnNames = {"player_id", "good"}))
public class StockEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 乐观锁：防止并发消费/生产时把库存改错 */
    @Version
    @Column(nullable = false)
    private long version;

    @Column(name = "player_id", nullable = false)
    private Long playerId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Good good;

    @Column(nullable = false)
    private int quantity;

    protected StockEntity() {
    }

    public StockEntity(Long playerId, Good good, int quantity) {
        this.playerId = playerId;
        this.good = good;
        this.quantity = quantity;
    }

    public Long getId() { return id; }
    public Long getPlayerId() { return playerId; }
    public Good getGood() { return good; }
    public int getQuantity() { return quantity; }
    public void setQuantity(int quantity) { this.quantity = Math.max(0, quantity); }
}
