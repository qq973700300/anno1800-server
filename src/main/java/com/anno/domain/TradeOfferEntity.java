package com.anno.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** 玩家之间的挂单（贸易系统）：卖家挂出卖单，其他玩家接单 */
@Entity
@Table(name = "trade_offer")
public class TradeOfferEntity {

    public enum Status { OPEN, FILLED, CANCELLED }

    public enum Side { SELL, BUY }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "player_id", nullable = false)
    private Long playerId;

    /** 接单方，成交后写入 */
    @Column(name = "counterparty_id")
    private Long counterpartyId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 4)
    private Side side;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Good good;

    @Column(nullable = false)
    private int quantity;

    /** 剩余未成交数量 */
    @Column(nullable = false)
    private int remaining;

    @Column(nullable = false)
    private double unitPrice;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 12)
    private Status status;

    @Column(nullable = false)
    private long createdAt;

    protected TradeOfferEntity() {
    }

    public TradeOfferEntity(Long playerId, Side side, Good good, int quantity, double unitPrice) {
        this.playerId = playerId;
        this.side = side;
        this.good = good;
        this.quantity = quantity;
        this.remaining = quantity;
        this.unitPrice = unitPrice;
        this.status = Status.OPEN;
        this.createdAt = System.currentTimeMillis();
    }

    public Long getId() { return id; }
    public Long getPlayerId() { return playerId; }
    public Long getCounterpartyId() { return counterpartyId; }
    public void setCounterpartyId(Long counterpartyId) { this.counterpartyId = counterpartyId; }
    public Side getSide() { return side; }
    public Good getGood() { return good; }
    public int getQuantity() { return quantity; }
    public int getRemaining() { return remaining; }
    public void setRemaining(int remaining) { this.remaining = Math.max(0, remaining); }
    public double getUnitPrice() { return unitPrice; }
    public Status getStatus() { return status; }
    public void setStatus(Status status) { this.status = status; }
    public long getCreatedAt() { return createdAt; }
}
