package com.anno.service;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Service;

import com.anno.config.GameProperties;
import com.anno.domain.BuildingEntity;
import com.anno.domain.BuildingType;
import com.anno.domain.Good;
import com.anno.repo.BuildingRepository;
import com.anno.repo.IslandRepository;
import com.anno.repo.RoadRepository;
import com.anno.repo.StockRepository;
import com.anno.ws.GameSocketHub;

/**
 * 马车物流：厂房产出的货先进"待运区"（{@code BuildingEntity.pendingQty}），
 * 攒够一车才由马车运往<b>最近的仓库</b>（贸易站 / 小仓库，路网 BFS 挑近的），
 * 到站后还要花几秒<b>卸货</b>，卸完那一刻才真正进玩家仓库 —— 仓库囤满时车会
 * 停在门口等空间（纪元1800 的"上下货要时间、仓库有上限"）。
 * <p>
 * 【车的一生】三阶段状态机（{@link Phase}）：
 * <ol>
 *   <li>{@code TRAVEL}：沿路网走到仓库门口（BFS 路径下发客户端演动画）；</li>
 *   <li>{@code UNLOAD}：停在仓库门口卸货 {@code anno.depot-unload-seconds} 游戏秒 ——
 *       走完才 {@code inventory.add} + 广播 CART_ARRIVED；</li>
 *   <li>{@code WAIT}：卸货时玩家总囤货已顶到仓库容量上限 —— 车原地滞留，
 *       广播 WAREHOUSE_FULL，每拍重试，玩家卖货 / 居民消耗腾出空间后自动继续卸。</li>
 * </ol>
 * 【为什么车在内存里、不落库】车只是"在路上的货"——待运量已经落库（扣掉车上的那部分），
 * 服务重启时在途的车会丢，等于路上那批货损失掉：纪元里船翻了货也没了，可接受。
 * 关键的是"这一批货已经离开厂房、还没进仓库"这个状态不靠车存在：待运量落库，
 * 重启后厂房照常继续攒下一车。
 * <p>
 * 【与懒结算的关系】车在 {@code ProductionService.tickIsland} 里随岛推进：
 * 岛在线才走表 —— 玩家下线，车也停在路边，和作物 / 工厂同一套时间观。
 */
@Service
public class CartService {

    /** 车的阶段：赶路 → 卸货 → （仓库满了）滞留等空间 */
    public enum Phase { TRAVEL, UNLOAD, WAIT }

    /** 一辆在途的马车 */
    public record Cart(Long buildingId, Long islandId, Long ownerId,
                       String good, int qty,
                       double remainSeconds, double totalSeconds,
                       List<int[]> path,
                       Phase phase, boolean fullWarned) {

        /** 便于兼容旧构造（TRAVEL 起点） */
        public Cart(Long buildingId, Long islandId, Long ownerId, String good, int qty,
                    double remainSeconds, double totalSeconds, List<int[]> path) {
            this(buildingId, islandId, ownerId, good, qty, remainSeconds, totalSeconds, path, Phase.TRAVEL, false);
        }
    }

    /** 就近选库的结果：选中的仓库 + 去它的行程 */
    public record NearestPlan(BuildingEntity depot, DispatchPlan plan) { }

    private final Map<Long, Cart> inFlight = new ConcurrentHashMap<>();   // key = buildingId
    private final RoadRepository roadRepository;
    private final IslandRepository islandRepository;
    private final BuildingRepository buildingRepository;
    private final StockRepository stockRepository;
    private final GameProperties props;
    private final GameSocketHub hub;

    public CartService(RoadRepository roadRepository, IslandRepository islandRepository,
                       BuildingRepository buildingRepository, StockRepository stockRepository,
                       GameProperties props, GameSocketHub hub) {
        this.roadRepository = roadRepository;
        this.islandRepository = islandRepository;
        this.buildingRepository = buildingRepository;
        this.stockRepository = stockRepository;
        this.props = props;
        this.hub = hub;
    }

    /** 这座建筑有没有车还在路上（一厂一车，避免同一条路对头车） */
    public boolean hasInFlight(Long buildingId) {
        return inFlight.containsKey(buildingId);
    }

    /**
     * 计算建筑 → 仓库的行程（游戏秒），并尽量给出**路网 BFS 路径**给客户端演动画。
     * 起终点分别是厂房 / 仓库外圈贴着的马路格；两块路网不连通（或根本没贴路）时
     * 退化为"直线越野"：距离按切比雪夫 ×1.6 折算，path 返回 null 让客户端走直线。
     */
    public DispatchPlan plan(BuildingEntity from, BuildingEntity depot) {
        Set<Long> roads = new HashSet<>();
        Map<Long, int[]> cellOf = new HashMap<>();
        for (var r : roadRepository.findByIslandId(from.getIslandId())) {
            roads.add(key(r.getCellX(), r.getCellZ()));
            cellOf.put(key(r.getCellX(), r.getCellZ()), new int[]{r.getCellX(), r.getCellZ()});
        }
        List<int[]> start = adjacentRoads(from, roads);
        List<int[]> goal = adjacentRoads(depot, roads);

        List<int[]> path = start.isEmpty() || goal.isEmpty() ? null : bfs(start, goal, roads, cellOf);
        double cells;
        if (path != null) {
            cells = path.size();
        } else {
            double[] c1 = center(from), c2 = center(depot);
            double cheb = Math.max(Math.abs(c1[0] - c2[0]), Math.abs(c1[1] - c2[1]));
            cells = cheb * 1.6;
        }
        double seconds = Math.max(2.0, cells * props.getCartSecondsPerCell());
        return new DispatchPlan(path, seconds);
    }

    /**
     * 就近原则：对每个候选仓库各算一次行程，取<b>耗时最短</b>的那个。
     * 路网不连通的退化行程（切比雪夫直线）与连通行程同一把尺子（游戏秒），直接可比。
     * 纪元1800 的货运直觉：厂子边上就有仓库时，货不该横穿全岛去港口。
     */
    public NearestPlan planNearest(BuildingEntity from, List<BuildingEntity> depots) {
        BuildingEntity best = null;
        DispatchPlan bestPlan = null;
        for (BuildingEntity d : depots) {
            DispatchPlan p = plan(from, d);
            if (bestPlan == null || p.travelSeconds() < bestPlan.travelSeconds()) {
                best = d;
                bestPlan = p;
            }
        }
        return new NearestPlan(best, bestPlan);
    }

    /** 派车：货从待运区移到车上（调用方负责先扣 pendingQty），广播给客户端演动画 */
    public void dispatch(BuildingEntity b, Long ownerId, Good good, int qty,
                         BuildingEntity depot, DispatchPlan plan) {
        double scale = Math.max(0.01, props.getTimeScale());
        double realMs = plan.travelSeconds() * 1000.0 / scale;
        long unloadMs = (long) (props.getDepotUnloadSeconds() * 1000.0 / scale);
        Cart cart = new Cart(b.getId(), b.getIslandId(), ownerId, good.name(), qty,
                plan.travelSeconds(), plan.travelSeconds(), plan.path());
        inFlight.put(b.getId(), cart);
        Map<String, Object> payload = new HashMap<>();
        payload.put("playerId", ownerId);
        payload.put("islandId", b.getIslandId());
        payload.put("buildingId", b.getId());
        payload.put("destId", depot.getId());
        payload.put("good", good.name());
        payload.put("label", good.getLabel());
        payload.put("qty", qty);
        payload.put("durMs", (long) realMs);
        payload.put("unloadMs", unloadMs);
        if (plan.path() != null) payload.put("path", plan.path());
        hub.broadcast("event", Map.of("type", "CART_DISPATCHED",
                "serverTime", System.currentTimeMillis(), "payload", payload));
    }

    /**
     * 推进这座岛的在途马车：到站 → 卸货（耗时）→ 入库。
     * 每个阶段超时一步到位（离线回来 delta 很大时，一拍内走完 TRAVEL→UNLOAD→入库）。
     */
    public void flushIsland(Long islandId, Long ownerId, double deltaSeconds, InventoryService inventory) {
        if (deltaSeconds <= 0 || inFlight.isEmpty()) return;
        for (Cart cart : List.copyOf(inFlight.values())) {
            if (!islandId.equals(cart.islandId())) continue;
            switch (cart.phase()) {
                case TRAVEL -> {
                    double remain = cart.remainSeconds() - deltaSeconds;
                    if (remain > 0) {
                        inFlight.put(cart.buildingId(), new Cart(cart.buildingId(), cart.islandId(), cart.ownerId(),
                                cart.good(), cart.qty(), remain, cart.totalSeconds(), cart.path(),
                                Phase.TRAVEL, cart.fullWarned()));
                    } else {
                        // 到站：开始卸货（车停在仓库门口，客户端继续等 ARRIVED 再演回程）
                        inFlight.put(cart.buildingId(), new Cart(cart.buildingId(), cart.islandId(), cart.ownerId(),
                                cart.good(), cart.qty(), props.getDepotUnloadSeconds(),
                                props.getDepotUnloadSeconds(), cart.path(), Phase.UNLOAD, false));
                    }
                }
                case UNLOAD -> {
                    double remain = cart.remainSeconds() - deltaSeconds;
                    if (remain > 0) {
                        inFlight.put(cart.buildingId(), new Cart(cart.buildingId(), cart.islandId(), cart.ownerId(),
                                cart.good(), cart.qty(), remain, cart.totalSeconds(), cart.path(),
                                Phase.UNLOAD, cart.fullWarned()));
                    } else {
                        tryUnload(cart, inventory);
                    }
                }
                case WAIT -> tryUnload(cart, inventory);   // 满仓滞留：每拍重试，腾出空间就继续卸
            }
        }
    }

    /** 卸货入库：容量够才收，不够转 WAIT（每车只广播一次满仓提示） */
    private void tryUnload(Cart cart, InventoryService inventory) {
        long cap = depotCapacity(cart.ownerId());
        long used = stockRepository.totalQuantity(cart.ownerId());
        if (used + cart.qty() > cap) {
            if (!cart.fullWarned()) {
                hub.broadcast("event", Map.of("type", "WAREHOUSE_FULL",
                        "serverTime", System.currentTimeMillis(),
                        "payload", Map.of("playerId", cart.ownerId(), "islandId", cart.islandId(),
                                "buildingId", cart.buildingId(), "good", cart.good(),
                                "label", Good.valueOf(cart.good()).getLabel(), "qty", cart.qty(),
                                "capacity", cap, "used", used)));
            }
            inFlight.put(cart.buildingId(), new Cart(cart.buildingId(), cart.islandId(), cart.ownerId(),
                    cart.good(), cart.qty(), 0, cart.totalSeconds(), cart.path(), Phase.WAIT, true));
            return;
        }
        inFlight.remove(cart.buildingId());
        Good good = Good.valueOf(cart.good());
        inventory.add(cart.ownerId(), good, cart.qty());
        hub.broadcast("event", Map.of("type", "CART_ARRIVED",
                "serverTime", System.currentTimeMillis(),
                "payload", Map.of("playerId", cart.ownerId(), "islandId", cart.islandId(),
                        "buildingId", cart.buildingId(), "good", cart.good(),
                        "label", Good.valueOf(cart.good()).getLabel(), "qty", cart.qty())));
    }

    /**
     * 玩家的<b>总仓库容量</b>：名下所有岛的全部仓库类建筑（{@link BuildingType#isDepot()}）
     * 容量之和。玩家库存是跨岛扁平表，所以容量也按玩家聚合 ——
     * 岛多仓库多能囤的就多，逻辑自洽且不必把库存拆成岛级记账。
     */
    private long depotCapacity(Long ownerId) {
        long cap = 0;
        for (var island : islandRepository.findByOwnerId(ownerId)) {
            for (BuildingEntity b : buildingRepository.findByIslandId(island.getId())) {
                cap += b.getType().getDepotCapacity();
            }
        }
        return cap;
    }

    /** 建筑被拆时调用：车上的货照样送到（车已经出发了） */
    public void abandonBuilding(Long buildingId) {
        Cart cart = inFlight.remove(buildingId);
        if (cart != null) {
            // 车照走，只是不再代表任何建筑 —— 挂到 buildingId 负数键上，避免被新建筑复用时误清
            inFlight.put(-buildingId, new Cart(-buildingId, cart.islandId(), cart.ownerId(),
                    cart.good(), cart.qty(), cart.remainSeconds(), cart.totalSeconds(), cart.path(),
                    cart.phase(), cart.fullWarned()));
        }
    }

    /* ---------------- 路网 BFS ---------------- */

    /** 建筑外圈贴着的马路格（没有就空列表 —— 货运得靠车开到门口） */
    private List<int[]> adjacentRoads(BuildingEntity b, Set<Long> roads) {
        List<int[]> out = new ArrayList<>();
        if (b.getGridX() == null || b.getGridZ() == null) return out;
        BuildingType t = b.getType();
        int ax = b.getGridX(), az = b.getGridZ(), w = b.getSizeW(), h = b.getSizeH();
        for (int x = ax - 1; x <= ax + w; x++) {
            for (int z = az - 1; z <= az + h; z++) {
                boolean onRing = (x == ax - 1 || x == ax + w) || (z == az - 1 || z == az + h);
                if (onRing && roads.contains(key(x, z))) out.add(new int[]{x, z});
            }
        }
        return out;
    }

    /** 多源 BFS：从厂房门口的马路格走到仓库门口的马路格，返回途经格序列（含两端） */
    private List<int[]> bfs(List<int[]> starts, List<int[]> goals, Set<Long> roads, Map<Long, int[]> cellOf) {
        Set<Long> goalKeys = new HashSet<>();
        for (int[] g : goals) goalKeys.add(key(g[0], g[1]));
        Deque<Long> queue = new ArrayDeque<>();
        Map<Long, Long> prev = new HashMap<>();
        for (int[] s : starts) {
            Long k = key(s[0], s[1]);
            prev.put(k, k);
            queue.add(k);
        }
        Long found = null;
        while (!queue.isEmpty() && found == null) {
            Long cur = queue.poll();
            if (goalKeys.contains(cur)) { found = cur; break; }
            int[] c = cellOf.get(cur);
            for (int[] d : new int[][]{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}) {
                Long nk = key(c[0] + d[0], c[1] + d[1]);
                if (roads.contains(nk) && !prev.containsKey(nk)) {
                    prev.put(nk, cur);
                    queue.add(nk);
                }
            }
        }
        if (found == null) return null;
        List<int[]> path = new ArrayList<>();
        Long cur = found;
        while (cur != null) {
            path.add(cellOf.get(cur));
            Long p = prev.get(cur);
            if (p == null || p.equals(cur)) break;   // 走到起点（prev 指向自己）
            cur = p;
        }
        return path.reversed();
    }

    private long key(int x, int z) { return (long) x << 20 | z; }

    private double[] center(BuildingEntity b) {
        return new double[]{b.getGridX() == null ? 0 : b.getGridX() + b.getSizeW() / 2.0,
                            b.getGridZ() == null ? 0 : b.getGridZ() + b.getSizeH() / 2.0};
    }

    /** 行程规划结果：路径（可能为 null = 走直线）+ 行程游戏秒 */
    public record DispatchPlan(List<int[]> path, double travelSeconds) {
    }
}
