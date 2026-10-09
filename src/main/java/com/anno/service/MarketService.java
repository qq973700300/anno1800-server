package com.anno.service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicInteger;

import com.anno.config.GameProperties;
import com.anno.domain.Good;
import com.anno.domain.MarketPriceEntity;
import com.anno.domain.PriceHistoryEntity;
import com.anno.dto.Views;
import com.anno.exception.GameException;
import com.anno.repo.MarketPriceRepository;
import com.anno.repo.PriceHistoryRepository;
import com.anno.ws.GameSocketHub;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 商品贸易（NPC 市场）：动态价格。
 * <p>
 * 买价 = 市价 × 1.02，卖价 = 市价 × 0.98（商人赚 2% 点差）。
 * 大量买入会推高价格、大量卖出会压低价格，之后每个心跳向基准价回归并叠加随机波动。
 * <p>
 * 【落库策略 · 网络游戏做法】行情属于高频写入数据，不能每个心跳都 UPDATE 数据库：
 * <ul>
 *   <li>价格在每个 tick 只改内存（零 DB 开销）；</li>
 *   <li>每 price-flush-ms 批量写库一次，并追加一条行情快照（K 线数据源）；</li>
 *   <li>玩家成交（涉及金币）立即单独落库，关键数据不丢。</li>
 * </ul>
 */
@Service
public class MarketService {

    /** 买卖点差 */
    public static final double SPREAD = 0.02;

    private static final Logger log = LoggerFactory.getLogger(MarketService.class);

    private final MarketPriceRepository marketPriceRepository;
    private final PriceHistoryRepository priceHistoryRepository;
    private final InventoryService inventoryService;
    private final PlayerService playerService;
    private final GameProperties props;
    private final GameSocketHub hub;

    /** 内存行情：商品 -> 当前价 */
    private final Map<Good, Double> prices = new ConcurrentHashMap<>();
    /** 内存行情：商品 -> 距上次快照以来的成交量 */
    private final Map<Good, AtomicInteger> pendingVolume = new ConcurrentHashMap<>();
    /**
     * init() 是否已把行情载入内存。
     * <p>
     * 【为什么需要】@Scheduled 的 fixedRate 任务在容器启动后立刻就会跑一次，而 init() 走
     * ApplicationRunner 是紧接着才执行。全新数据库上前者会比后者先到，
     * findByGood 查不到行 → 走 orElseGet 插入 → 撞 good 唯一键。
     * 加了这个开关（并给定时任务加 initialDelay），初始化没完成前定时落库直接不动作。
     */
    private volatile boolean ready = false;

    public MarketService(MarketPriceRepository marketPriceRepository,
                         PriceHistoryRepository priceHistoryRepository,
                         InventoryService inventoryService,
                         PlayerService playerService,
                         GameProperties props,
                         GameSocketHub hub) {
        this.marketPriceRepository = marketPriceRepository;
        this.priceHistoryRepository = priceHistoryRepository;
        this.inventoryService = inventoryService;
        this.playerService = playerService;
        this.props = props;
        this.hub = hub;
    }

    /** 启动时建行情行并把价格载入内存 */
    @Transactional
    public void init() {
        for (Good g : Good.values()) {
            MarketPriceEntity p = marketPriceRepository.findByGood(g)
                    .orElseGet(() -> marketPriceRepository.save(new MarketPriceEntity(g)));
            prices.put(g, p.getPrice());
            pendingVolume.put(g, new AtomicInteger());
        }
        ready = true;
        log.info("行情已载入内存：{} 种商品", prices.size());
    }

    public double priceOf(Good good) {
        return prices.getOrDefault(good, good.getBasePrice());
    }

    public double buyPrice(Good good) {
        return priceOf(good) * (1 + SPREAD);
    }

    public double sellPrice(Good good) {
        return priceOf(good) * (1 - SPREAD);
    }

    /** 全部行情快照（走内存） */
    public List<Views.MarketRow> snapshot() {
        List<Views.MarketRow> rows = new ArrayList<>();
        for (Good g : Good.values()) {
            double price = priceOf(g);
            rows.add(new Views.MarketRow(g.name(), g.getLabel(), round2(price), round2(g.getBasePrice()),
                    round4((price - g.getBasePrice()) / g.getBasePrice()),
                    pendingVolume.getOrDefault(g, new AtomicInteger()).get()));
        }
        return rows;
    }

    /**
     * 从市场买入。
     * <p>
     * 【统一加锁顺序】全服所有事务都按「库存 stock → 玩家 player → 行情 market_price」的顺序写。
     * 如果这边写「先扣钱再入货」、世界心跳写「先入货再加声望」，两个事务就会互相
     * 攥着对方要的行锁不放，MySQL 只能判定死锁杀掉一个。顺序一致后这个环就不存在了。
     */
    @Transactional
    public Map<String, Object> buy(Long playerId, Good good, int qty) {
        if (qty <= 0) throw GameException.of("数量必须大于 0");
        double unit = buyPrice(good);
        double total = unit * qty;
        inventoryService.add(playerId, good, qty);          // 1) 库存
        playerService.spend(playerId, total, "买入" + good.getLabel() + "x" + qty); // 2) 金币
        impact(good, qty, true);
        flushOne(good);                       // 涉及金币，立即落库
        playerService.addReputation(playerId, Math.max(1, qty / 50));
        hub.broadcast("event", Map.of("type", "MARKET_BUY", "serverTime", System.currentTimeMillis(),
                "payload", Map.of("playerId", playerId, "good", good.name(), "quantity", qty,
                        "unitPrice", round2(unit))));
        return Map.of("good", good.name(), "label", good.getLabel(), "quantity", qty,
                "unitPrice", round2(unit), "total", round2(total),
                "treasury", round2(playerService.require(playerId).getTreasury()));
    }

    /** 向市场卖出（同样遵循 库存 → 金币 → 行情 的顺序） */
    @Transactional
    public Map<String, Object> sell(Long playerId, Good good, int qty) {
        if (qty <= 0) throw GameException.of("数量必须大于 0");
        inventoryService.remove(playerId, good, qty);
        double unit = sellPrice(good);
        double total = unit * qty;
        playerService.addTreasury(playerId, total);
        impact(good, qty, false);
        flushOne(good);                       // 涉及金币，立即落库
        playerService.addReputation(playerId, Math.max(1, qty / 50));
        hub.broadcast("event", Map.of("type", "MARKET_SELL", "serverTime", System.currentTimeMillis(),
                "payload", Map.of("playerId", playerId, "good", good.name(), "quantity", qty,
                        "unitPrice", round2(unit))));
        return Map.of("good", good.name(), "label", good.getLabel(), "quantity", qty,
                "unitPrice", round2(unit), "total", round2(total),
                "treasury", round2(playerService.require(playerId).getTreasury()));
    }

    /** 成交冲击：买入推高、卖出压低（只改内存） */
    private void impact(Good good, int qty, boolean buying) {
        double cur = priceOf(good);
        double delta = cur * props.getMarketImpact() * (qty / 100.0);
        prices.put(good, Math.max(0.5, cur + (buying ? delta : -delta)));
        pendingVolume.computeIfAbsent(good, k -> new AtomicInteger()).addAndGet(qty);
    }

    /** 世界心跳：价格向基准价回归 + 随机波动（纯内存，不碰数据库） */
    public void tick() {
        for (Good g : Good.values()) {
            double base = g.getBasePrice();
            double cur = priceOf(g);
            double next = cur + (base - cur) * props.getMarketRevertRate();
            double noise = (ThreadLocalRandom.current().nextDouble() * 2 - 1) * props.getMarketNoise();
            next = Math.min(base * 2.5, Math.max(base * 0.4, next * (1 + noise)));
            prices.put(g, next);
        }
    }

    /** 定期批量落库：写 market_price + 追加一条行情快照（K 线数据源） */
    @Transactional
    @Scheduled(fixedRateString = "${anno.price-flush-ms}", initialDelayString = "${anno.price-flush-ms}")
    public void flush() {
        if (!ready) return;                      // 初始化还没跑完，先不碰数据库
        long now = System.currentTimeMillis();
        List<PriceHistoryEntity> snaps = new ArrayList<>();
        for (Good g : Good.values()) {
            double price = priceOf(g);
            MarketPriceEntity p = marketPriceRepository.findByGood(g)
                    .orElseGet(() -> marketPriceRepository.save(new MarketPriceEntity(g)));
            int vol = pendingVolume.computeIfAbsent(g, k -> new AtomicInteger()).getAndSet(0);
            p.setPrice(price);
            p.setVolume(p.getVolume() + vol);
            p.setUpdatedAt(now);
            marketPriceRepository.save(p);
            snaps.add(new PriceHistoryEntity(g, price, vol, now));
        }
        priceHistoryRepository.saveAll(snaps);
    }

    /** 交易后单独落库，保证真金白银的数据不丢 */
    @Transactional
    public void flushOne(Good good) {
        if (!ready) return;                      // 行情行还没建好，价格留在内存，下个 flush 补写
        long now = System.currentTimeMillis();
        MarketPriceEntity p = marketPriceRepository.findByGood(good)
                .orElseGet(() -> marketPriceRepository.save(new MarketPriceEntity(good)));
        p.setPrice(priceOf(good));
        p.setUpdatedAt(now);
        marketPriceRepository.save(p);
    }

    /** 清理过期行情快照，避免时序表无限膨胀 */
    @Transactional
    @Scheduled(fixedRate = 600_000)
    public void cleanHistory() {
        long deadline = System.currentTimeMillis() - props.getPriceHistoryHours() * 3600_000;
        int deleted = priceHistoryRepository.deleteOlderThan(deadline);
        if (deleted > 0) log.info("清理过期行情快照 {} 条", deleted);
    }

    /** 分时数据：最近 seconds 秒的行情点 */
    @Transactional(readOnly = true)
    public List<Views.PricePoint> history(Good good, long seconds) {
        long from = System.currentTimeMillis() - seconds * 1000;
        return priceHistoryRepository.findByGoodAndTsGreaterThanEqualOrderByTsAsc(good, from)
                .stream().map(p -> new Views.PricePoint(p.getTs(), round2(p.getPrice()), p.getVolume()))
                .toList();
    }

    /** K 线：把行情点按 period 秒聚合成 OHLC 蜡烛图 */
    @Transactional(readOnly = true)
    public List<Views.Candle> kline(Good good, long periodSeconds, int limit) {
        long from = System.currentTimeMillis() - periodSeconds * 1000 * limit;
        List<PriceHistoryEntity> points =
                priceHistoryRepository.findByGoodAndTsGreaterThanEqualOrderByTsAsc(good, from);
        if (points.isEmpty()) return List.of();

        List<Views.Candle> candles = new ArrayList<>();
        long bucket = periodSeconds * 1000;
        long bucketStart = (points.get(0).getTs() / bucket) * bucket;
        double open = points.get(0).getPrice(), high = open, low = open, close = open;
        int vol = 0;

        for (PriceHistoryEntity p : points) {
            long b = (p.getTs() / bucket) * bucket;
            if (b != bucketStart) {
                candles.add(new Views.Candle(bucketStart, round2(open), round2(high),
                        round2(low), round2(close), vol));
                bucketStart = b;
                open = high = low = close = p.getPrice();
                vol = 0;
            }
            high = Math.max(high, p.getPrice());
            low = Math.min(low, p.getPrice());
            close = p.getPrice();
            vol += p.getVolume();
        }
        candles.add(new Views.Candle(bucketStart, round2(open), round2(high),
                round2(low), round2(close), vol));
        return candles;
    }

    private static double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }

    private static double round4(double v) {
        return Math.round(v * 10000.0) / 10000.0;
    }
}
