package com.anno.service;

import java.util.ArrayList;
import java.util.List;

import com.anno.domain.Good;
import com.anno.domain.StockEntity;
import com.anno.dto.Views;
import com.anno.exception.GameException;
import com.anno.repo.MarketPriceRepository;
import com.anno.repo.StockRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 仓库：所有产出的商品都进这里，贸易/生产都从这里扣。
 * <p>
 * 出入库都用带 delta 的原子 UPDATE（见 StockRepository），
 * 因此世界心跳里的工厂扣料、玩家同时的挂单买卖不会互相踩到乐观锁。
 */
@Service
public class InventoryService {

    /** 开局赠料基准线（纪元1800式"旗舰带料"）：新玩家注册即有，老档不足补齐 */
    public static final int STARTER_WOOD = 20;
    public static final int STARTER_TIMBER = 4;

    private final StockRepository stockRepository;
    private final MarketPriceRepository marketPriceRepository;

    public InventoryService(StockRepository stockRepository, MarketPriceRepository marketPriceRepository) {
        this.stockRepository = stockRepository;
        this.marketPriceRepository = marketPriceRepository;
    }

    /** 入库：一条 upsert 搞定，不产生"先查后插"的锁竞争 */
    @Transactional
    public void add(Long playerId, Good good, int qty) {
        if (qty <= 0) return;
        stockRepository.upsertAdd(playerId, good.name(), qty);
    }

    /**
     * 给玩家预建全部商品的空库存行。
     * 建好之后出入库就只剩 UPDATE，不会再有 INSERT 带来的间隙锁死锁。
     */
    @Transactional
    public void initRowsForPlayer(Long playerId) {
        for (Good g : Good.values()) {
            stockRepository.createRowIfAbsent(playerId, g.name());
        }
    }

    /**
     * 开局赠料（纪元1800式：开局旗舰给你捎来一船建材）。
     * <p>
     * 建房要木头之后，没有这批料会死锁：建房要料 → 没住宅 → 没人口 → 伐木场没工人
     * → 永远没木头。新玩家注册时调用；木材 20 够盖 4 座农夫住宅 + 1 座伐木场周转。
     */
    @Transactional
    public void grantStarter(Long playerId) {
        add(playerId, Good.WOOD, STARTER_WOOD);
        add(playerId, Good.TIMBER, STARTER_TIMBER);
    }

    /** 老档补偿：木材/木板低于基准线的一次性抬到基准线（幂等，每次启动都跑） */
    @Transactional
    public void topUpStarter(Long playerId) {
        stockRepository.topUpTo(playerId, Good.WOOD, STARTER_WOOD);
        stockRepository.topUpTo(playerId, Good.TIMBER, STARTER_TIMBER);
    }

    /** 出库：库存不足直接抛异常（条件 UPDATE 影响 0 行） */
    @Transactional
    public void remove(Long playerId, Good good, int qty) {
        if (qty <= 0) return;
        if (stockRepository.takeQuantity(playerId, good, qty) > 0) return;
        int hold = quantity(playerId, good);
        throw GameException.of("库存不足：" + good.getLabel() + "，需要 " + qty + "，现有 " + hold);
    }

    /**
     * 出库（尽力而为）：扣 {@code min(当前库存, qty)}，**不抛异常**，返回打算扣掉的数量。
     * <p>
     * 居民消费专用。工厂缺料要停工报错是对的（玩家得知道产线断了），
     * 但居民断供不该把整轮结算打断 —— 仓库只剩 3 个土豆而 24 个农夫要 10 个时，
     * 正确行为是"这 3 个大家都分着吃、满足度打折"，而不是抛异常。
     * 扣减走 SQL 的 {@code least()}，并发下也绝不会把库存扣成负数。
     */
    @Transactional
    public int consumeUpTo(Long playerId, Good good, int qty) {
        if (qty <= 0) return 0;
        int have = quantity(playerId, good);
        if (have <= 0) return 0;
        int want = Math.min(have, qty);
        if (stockRepository.takeUpTo(playerId, good.name(), want) == 0) return 0;
        return want;
    }

    @Transactional(readOnly = true)
    public int quantity(Long playerId, Good good) {
        // 必须走原生标量查询：实体查询在长事务里会返回一级缓存里的过期库存（见 rawQuantity 注释）
        Integer q = stockRepository.rawQuantity(playerId, good.name());
        return q == null ? 0 : q;
    }

    @Transactional(readOnly = true)
    public boolean hasEnough(Long playerId, Good good, int qty) {
        return quantity(playerId, good) >= qty;
    }

    @Transactional(readOnly = true)
    public List<Views.StockView> list(Long playerId) {
        List<Views.StockView> views = new ArrayList<>();
        for (StockEntity s : stockRepository.findByPlayerId(playerId)) {
            if (s.getQuantity() <= 0) continue;
            double price = marketPriceRepository.findByGood(s.getGood())
                    .map(p -> p.getPrice()).orElse(s.getGood().getBasePrice());
            views.add(new Views.StockView(s.getGood().name(), s.getGood().getLabel(),
                    s.getQuantity(), price, price * s.getQuantity()));
        }
        return views;
    }
}
