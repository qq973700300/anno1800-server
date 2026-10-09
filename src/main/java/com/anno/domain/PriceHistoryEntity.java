package com.anno.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;

/**
 * 行情快照（时序数据）：每隔 price-flush-ms 对每个商品记一条。
 * <p>
 * 时序表增长极快，靠 (good, ts) 索引查区间，靠清理任务删除过期数据，
 * 真上量后应迁到 InfluxDB / ClickHouse 或按月分表。
 */
@Entity
@Table(name = "price_history",
        indexes = @Index(name = "idx_price_history_good_ts", columnList = "good, ts"))
public class PriceHistoryEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Good good;

    /** 当时价格 */
    @Column(nullable = false)
    private double price;

    /** 自上次快照以来的成交量 */
    @Column(nullable = false)
    private int volume;

    /** 时间戳（毫秒） */
    @Column(nullable = false)
    private long ts;

    protected PriceHistoryEntity() {
    }

    public PriceHistoryEntity(Good good, double price, int volume, long ts) {
        this.good = good;
        this.price = price;
        this.volume = volume;
        this.ts = ts;
    }

    public Long getId() { return id; }
    public Good getGood() { return good; }
    public double getPrice() { return price; }
    public int getVolume() { return volume; }
    public long getTs() { return ts; }
}
