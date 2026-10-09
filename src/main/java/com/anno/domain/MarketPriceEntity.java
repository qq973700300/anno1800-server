package com.anno.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** 市场行情：每种商品一个动态价格 */
@Entity
@Table(name = "market_price")
public class MarketPriceEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, unique = true, length = 16)
    private Good good;

    /** 当前价 */
    @Column(nullable = false)
    private double price;

    /** 基准价，价格会向它回归 */
    @Column(nullable = false)
    private double basePrice;

    /** 24 小时内的累计成交量，给客户端做热度展示 */
    @Column(nullable = false)
    private int volume;

    @Column(nullable = false)
    private long updatedAt;

    protected MarketPriceEntity() {
    }

    public MarketPriceEntity(Good good) {
        this.good = good;
        this.price = good.getBasePrice();
        this.basePrice = good.getBasePrice();
        this.volume = 0;
        this.updatedAt = System.currentTimeMillis();
    }

    public Long getId() { return id; }
    public Good getGood() { return good; }
    public double getPrice() { return price; }
    public void setPrice(double price) { this.price = Math.max(0.5, price); }
    public double getBasePrice() { return basePrice; }
    public int getVolume() { return volume; }
    public void setVolume(int volume) { this.volume = volume; }
    public long getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(long updatedAt) { this.updatedAt = updatedAt; }

    /** 相对基准价的涨跌幅，负数=跌（客户端按中国习惯：涨红跌绿） */
    public double changeRatio() {
        return (price - basePrice) / basePrice;
    }
}
