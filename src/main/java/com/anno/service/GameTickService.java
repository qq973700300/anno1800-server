package com.anno.service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;

import com.anno.domain.IslandEntity;
import com.anno.dto.Views;
import com.anno.ws.GameSocketHub;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * 世界心跳与推送。
 * <p>
 * 【心跳只推进"全服共享"的东西】行情是所有人共用的一份价格，所以它仍然每 tick 走一步。
 * <b>各个玩家岛上的模拟不在这里</b> —— 那部分已经改成懒结算（见 {@link IslandSimService}）：
 * 只在玩家在线时按岛补算，离线玩家的岛一秒资源都不花。
 * <p>
 * 【推送分两层】{@code world} 是全服共用的那点东西（行情 / 在线名单 / 心跳号），
 * 一次广播所有人；{@code snapshot} 是每个玩家自己的世界（金币 / 库存 / 路网 / 作物 / 建筑 / 人口），
 * 按玩家单独推。这样客户端不必再自己开一堆定时器轮询 HTTP —— 详见 {@link Views.PlayerSnapshot}。
 */
@Service
public class GameTickService {

    private static final Logger log = LoggerFactory.getLogger(GameTickService.class);

    private final MarketService marketService;
    private final PlayerService playerService;
    private final GameSocketHub hub;
    /** 个人快照要用到的几个只读查询：岛（含地形串）、路网、仓库、商船 */
    private final IslandService islandService;
    private final RoadService roadService;
    private final InventoryService inventoryService;
    private final FarmService farmService;
    private final ProductionService productionService;
    private final PopulationService populationService;
    private final ShipService shipService;
    /** 懒结算入口：广播前把这位玩家的岛推进到"现在" */
    private final IslandSimService islandSimService;

    private final AtomicLong tick = new AtomicLong();

    public GameTickService(MarketService marketService, PlayerService playerService,
                           GameSocketHub hub, IslandService islandService, RoadService roadService,
                           InventoryService inventoryService, FarmService farmService,
                           ProductionService productionService, PopulationService populationService,
                           ShipService shipService, IslandSimService islandSimService) {
        this.marketService = marketService;
        this.playerService = playerService;
        this.hub = hub;
        this.islandService = islandService;
        this.roadService = roadService;
        this.inventoryService = inventoryService;
        this.farmService = farmService;
        this.productionService = productionService;
        this.populationService = populationService;
        this.shipService = shipService;
        this.islandSimService = islandSimService;
    }

    /**
     * 世界心跳：只推进**全服共享**的行情。
     * <p>
     * 这里曾经每秒遍历全服数据（作物 / 建筑 / 居民），那套开销与注册玩家数成正比，
     * 一万在线时等于每秒把整个数据库翻一遍。现在这些全部搬到了
     * {@link IslandSimService}，由广播按玩家、按岛懒结算。
     */
    @Scheduled(fixedRateString = "${anno.tick-ms}")
    public void tick() {
        runWithRetry("行情", marketService::tick);
        tick.incrementAndGet();
    }

    /** 带重试地跑一个子系统：乐观锁冲突重试 3 次，其它异常只记一行摘要 */
    private void runWithRetry(String name, Runnable task) {
        for (int attempt = 1; attempt <= 3; attempt++) {
            try {
                task.run();
                return;
            } catch (OptimisticLockingFailureException e) {
                if (attempt == 3) {
                    log.warn("[{}] 连续 3 次并发冲突，本轮跳过（下个心跳自动补算）", name);
                    return;
                }
                try {
                    Thread.sleep(40L * attempt);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    return;
                }
            } catch (Exception e) {
                log.error("[{}] 推进失败：{}", name, e.toString());
                return;
            }
        }
    }

    /** 广播世界快照给所有联机客户端 */
    @Scheduled(fixedRateString = "${anno.broadcast-ms}")
    public void broadcast() {
        try {
            long now = System.currentTimeMillis();
            Set<Long> online = hub.onlinePlayerIds();
            /* 在线名单只查一次：它同时喂给世界快照的玩家列表和每份个人快照里的 "me"。
               逐个玩家再查一遍会变成 N 次全表扫描 —— 广播是每 3 秒跑一次的常驻任务。 */
            List<Views.PlayerBrief> players = playerService.onlineList();
            Map<Long, Views.PlayerBrief> byId = new HashMap<>();
            for (Views.PlayerBrief p : players) byId.put(p.id(), p);

            hub.broadcast("world", new Views.WorldSnapshot(now, tick.get(), online.size(),
                    marketService.snapshot(), players));

            for (Long playerId : online) {
                try {
                    /* 【懒结算的落点】先把这个玩家的岛推进到"现在"，再取快照。
                       离线期间它一直没被碰过，所以这一步补算的就是"刚过去的这几秒"；
                       离线太久的部分会被冻结掉（见 IslandSimService），不会爆产。 */
                    List<IslandEntity> islands = islandSimService.advance(playerId, now);
                    hub.sendToPlayer(playerId, "snapshot", snapshotOf(playerId, byId.get(playerId), now, islands));
                } catch (Exception e) {
                    // 单个玩家的快照失败（比如他的岛数据正在被改）不该拖垮其他玩家
                    log.warn("玩家 {} 快照推送失败：{}", playerId, e.toString());
                }
            }
        } catch (Exception e) {
            log.error("世界广播异常", e);
        }
    }

    /**
     * 组装某个玩家的完整快照：他自己岛上的一切。
     * <p>
     * 【为什么连地形串都发】客户端拿 island 里的 terrain 画岛形，
     * 而"岛形变了"和"建筑变了"要走同一套重建逻辑，所以干脆跟快照一起发，
     * 免得客户端为了岛形再单独留一个低频轮询。
     * <p>
     * 玩家还没有岛时 island 为 null，其余列表给空 —— 客户端见到 null 会走一次建岛 HTTP。
     *
     * @param islands 调用方刚从 {@link IslandSimService#advance} 拿到的实体（水位线已推进）：
     *                直接用它拼视图，省掉一次"按 owner 查岛"，也保证商船的相位跟模拟时钟对得上
     */
    private Views.PlayerSnapshot snapshotOf(Long playerId, Views.PlayerBrief me, long now,
                                           List<IslandEntity> islands) {
        IslandEntity own = islands.isEmpty() ? null : islands.get(0);
        if (own == null) {
            return new Views.PlayerSnapshot(now, tick.get(), me, null,
                    List.of(), List.of(), List.of(), inventoryService.list(playerId), null, List.of());
        }
        Views.IslandView island = islandService.view(own);
        Long islandId = island.id();
        List<Views.StockView> stock = inventoryService.list(playerId);
        return new Views.PlayerSnapshot(now, tick.get(), me, island,
                roadService.roads(islandId),
                farmService.plots(islandId),
                productionService.buildings(islandId),
                stock,
                populationService.population(islandId),
                // 仓库那份直接复用上面取好的：省一次查询，也保证"这趟带货"和"仓库"是同一份数据。
                // 模拟时钟同理：船必须按"扣掉离线冻结"的时钟算相位
                shipService.shipsOf(islandId, playerId, stock, own.simClockAt(now)));
    }

    public long getTick() {
        return tick.get();
    }
}
