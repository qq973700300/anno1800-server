package com.anno.service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.anno.domain.BuildingEntity;
import com.anno.domain.BuildingType;
import com.anno.domain.Good;
import com.anno.domain.IslandEntity;
import com.anno.dto.Views;
import com.anno.repo.BuildingRepository;
import com.anno.repo.IslandRepository;
import com.anno.ws.GameSocketHub;
import org.springframework.stereotype.Service;

/**
 * 海上贸易：每个贸易站配一条商船，沿固定航线自动跑外海市场。
 * <p>
 * 【一条船的一趟】出海（40 秒）→ 在外海市场停靠（8 秒）→ 返航（40 秒）→ 在港卸货（8 秒），
 * 一共 {@link #CYCLE_MS} 毫秒，然后立刻开始下一趟。回港那一刻把货按外海价卖掉，金币入账。
 * <p>
 * 【关键设计：船的位置不落库，也不算在服务端】船的航线是固定的，
 * 位置完全是时间的函数 —— 由建筑的 createdAt 推出相位。于是：
 * <ul>
 *   <li>服务端只需要记住"<b>已经结算到第几趟</b>"（{@link BuildingEntity#getShipCycle()}），
 *       不需要每拍更新船的位置；</li>
 *   <li>客户端拿到相位自己插值画，所以就算服务端每 3 秒才推一次快照，
 *       船在海面上也是连续航行的 —— 不必为了"船动得顺"把推送频率加密，
 *       那正是上一轮改造刚砍掉的东西。</li>
 * </ul>
 * 这套写法只有在"航线固定"时才成立；哪天要做玩家手动派船、船能停在任意港口，
 * 就必须真的把船的位置存下来了。
 * <p>
 * 【结算与相位必须对齐】结算发生在"相位回到 0"的那一刻，也就是船刚离港时 ——
 * 玩家看到的是"上一趟的货卸完、船又出发了"，货从仓库消失和船离港是同一个瞬间。
 */
@Service
public class ShipService {

    /** 一趟来回的总时长：出海 40s + 停靠 8s + 返航 40s + 卸货 8s */
    public static final long CYCLE_MS = 96_000L;

    /**
     * 各阶段在整趟里的占比。客户端 {@code jsm/ships.js} 照同一组数画船的轨迹，
     * <b>改这里必须两边一起改</b>，否则面板写着"返航中"而船还在往外开。
     */
    private static final double OUT_END = 0.42;
    private static final double DWELL_END = 0.50;
    private static final double BACK_END = 0.92;

    /** 一条船最多装多少件货 */
    private static final int CAPACITY = 24;

    /**
     * 每样货至少给玩家留多少件不动。
     * <p>
     * 面粉、木板、钢材这些是下游工厂的原料 —— 船要是把仓库清空，
     * 工厂下一拍就停工，玩家会觉得"船在捣乱"。留一手，船只搬"明显囤多了"的那部分。
     */
    private static final int RESERVE = 30;

    /**
     * 外海价 = 本地 NPC 收购价 × 这个系数。
     * <p>
     * 比在本地市场手动卖略高，玩家才有理由去建贸易站、养船 ——
     * 否则"点一下市场就卖掉了"，船就只是个装饰。
     */
    private static final double OVERSEAS_MARKUP = 1.08;

    /**
     * 一次心跳最多补算几趟。
     * <p>
     * 服务端停了一晚再开，按时间算出来的相位已经过去几百趟 ——
     * 不能一口气全结算（那是几百条事件 + 几百次入账），也不能丢掉。
     * 每拍补两趟，几秒钟内自然追上。停机期间工厂也没生产，
     * 所以补算的那些航次多半是空船，不会凭空变出金币。
     */
    private static final int MAX_CATCHUP = 2;

    /** 每跑一趟给多少声望（让"声望"这个数字也吃得到贸易这条线） */
    private static final long REPUTATION_PER_VOYAGE = 2;

    /** 船名：按建筑 id 取一个，省得界面上一排"商船" */
    private static final String[] SHIP_NAMES = {
            "信天翁号", "海燕号", "北风号", "远航号", "浪花号", "信风号",
    };

    private final BuildingRepository buildingRepository;
    private final IslandRepository islandRepository;
    private final InventoryService inventoryService;
    private final MarketService marketService;
    private final PlayerService playerService;
    private final GameSocketHub hub;

    public ShipService(BuildingRepository buildingRepository, IslandRepository islandRepository,
                       InventoryService inventoryService, MarketService marketService,
                       PlayerService playerService, GameSocketHub hub) {
        this.buildingRepository = buildingRepository;
        this.islandRepository = islandRepository;
        this.inventoryService = inventoryService;
        this.marketService = marketService;
        this.playerService = playerService;
        this.hub = hub;
    }

    /* ==================== 推进：补算该结算的航次 ==================== */

    /**
     * 推进**这一座岛**的海上贸易：把"时间上已经跑完、但还没结算"的航次结算掉。
     * <p>
     * 【为什么传 simNow 而不是取 System.currentTimeMillis()】这座岛的模拟时钟
     * （见 {@link IslandEntity#simClockAt(long)}）已经把"离线冻结掉的那段时间"扣掉了。
     * 用墙上时间算的话，玩家离线三天回来，船会按真实时间一口气补算几十趟、白送金币 ——
     * 而"离线完全冻结"正是这次改造的规则：人不在，船也不该跑。
     * <p>
     * 每座贸易站各自按自己的 createdAt 起算，所以几条船是错开出港的，
     * 不会所有船一起回港一起入账（那看着很假，也会让行情在同一毫秒被砸一下）。
     */
    public void tickIsland(Long islandId, Long ownerId, long simNowMs) {
        for (BuildingEntity harbor : buildingRepository.findByIslandId(islandId)) {
            /* 商船只挂靠贸易站 —— 造船厂同为码头类但不是市场（每座贸易站各自一条商船相位） */
            if (!harbor.getType().isTradingPost()) continue;

            long done = (simNowMs - harbor.getCreatedAt()) / CYCLE_MS;
            if (done <= harbor.getShipCycle()) continue;

            int settle = (int) Math.min(done - harbor.getShipCycle(), MAX_CATCHUP);
            int mark = (int) Math.min(done, Integer.MAX_VALUE);
            for (int i = 0; i < settle; i++) settleOne(harbor, ownerId);
            // 水位线一次推到位：这趟没结算的（超过补算上限的那些）不再回头补
            harbor.setShipCycle(mark);
            buildingRepository.save(harbor);
        }
    }

    /** 结算一趟：按"本趟要装的货"从仓库提货、按外海价卖掉、金币入账 */
    private void settleOne(BuildingEntity harbor, Long ownerId) {
        Manifest m = manifestOf(ownerId);
        if (m == null) return;                       // 仓库里没有囤多的货：空船跑一趟，不结算也不报信

        int sold = inventoryService.consumeUpTo(ownerId, m.good(), m.qty());
        if (sold <= 0) return;                       // 竞态：算的时候有货，提的时候被工厂吃掉了

        double gold = sold * marketService.sellPrice(m.good()) * OVERSEAS_MARKUP;
        playerService.addTreasury(ownerId, gold);
        playerService.addReputation(ownerId, REPUTATION_PER_VOYAGE);

        hub.broadcast("event", Map.of(
                "type", "SHIP_RETURNED", "serverTime", System.currentTimeMillis(),
                "payload", Map.of(
                        "playerId", ownerId,
                        "islandId", harbor.getIslandId(),
                        "ship", shipName(harbor),
                        "good", m.good().name(),
                        "label", m.good().getLabel(),
                        "qty", sold,
                        "gold", Math.round(gold * 100) / 100.0)));
    }

    /* ==================== 查询：给客户端看的船 ==================== */

    /**
     * 某个岛上的商船（HTTP 兜底用：自己查岛主、模拟时钟与仓库）。
     * <p>
     * 用 {@link IslandEntity#lastSimClock()} 而不是"现在"：这个接口是 websocket 连不上时的
     * 兜底，那时这座岛其实是被冻结的 —— 船也该停在它最后被模拟到的位置，
     * 而不是按墙上时间自顾自往前跑。
     */
    public List<Views.ShipView> shipsOf(Long islandId) {
        IslandEntity island = islandRepository.findById(islandId).orElse(null);
        if (island == null) return List.of();
        Long ownerId = island.getOwnerId();
        return shipsOf(islandId, ownerId, inventoryService.list(ownerId), island.lastSimClock());
    }

    /**
     * 某个岛上的商船（个人快照用）。
     *
     * @param stock   调用方**已经取好的**那份仓库快照：省一次查询，
     *                也保证面板里"这趟带货"和"仓库"显示的是同一份数据，不会互相打架
     * @param simNowMs 这座岛的**模拟时钟**（不是墙上时间）：离线冻结掉的那段时间不算，
     *                 否则玩家回来会看到船"瞬移"到几十趟之后的相位
     */
    public List<Views.ShipView> shipsOf(Long islandId, Long ownerId, List<Views.StockView> stock,
                                        long simNowMs) {
        List<Views.ShipView> out = new ArrayList<>();
        Manifest m = manifestOf(stock);
        for (BuildingEntity b : buildingRepository.findByIslandId(islandId)) {
            if (!b.getType().isTradingPost()) continue;
            long phase = Math.max(0, simNowMs - b.getCreatedAt()) % CYCLE_MS;
            out.add(new Views.ShipView(b.getId(), islandId, shipName(b),
                    CAPACITY, b.getShipCycle(), stateOf(phase), CYCLE_MS, phase,
                    m == null ? null : m.good().name(),
                    m == null ? null : m.good().getLabel(),
                    m == null ? 0 : m.qty(),
                    m == null ? 0 : Math.round(m.value() * 100) / 100.0));
        }
        return out;
    }

    /** 相位 → 给人看的阶段名（客户端面板直接显示，不必自己再按占比猜一遍） */
    private static String stateOf(long phase) {
        double p = (double) phase / CYCLE_MS;
        if (p < OUT_END) return "出海途中";
        if (p < DWELL_END) return "在外海市场";
        if (p < BACK_END) return "返航途中";
        return "在港卸货";
    }

    private static String shipName(BuildingEntity b) {
        return SHIP_NAMES[(int) Math.abs(b.getId() == null ? 0 : b.getId()) % SHIP_NAMES.length];
    }

    /* ==================== 装货清单 ==================== */

    /** 一趟的装货清单：装什么、装多少、能卖多少钱（只算不扣） */
    private record Manifest(Good good, int qty, double value) {
    }

    private Manifest manifestOf(Long ownerId) {
        return manifestOf(inventoryService.list(ownerId));
    }

    /**
     * 本趟装什么货：在"囤多了"的货里挑**单价最高**的那种，最多装 {@link #CAPACITY} 件。
     * <p>
     * 两道约束都是为了别把玩家的产业链掐断，也为了让船运的东西一眼看得懂：
     * <ol>
     *   <li>每样货至少留 {@link #RESERVE} 件不动（见常量的说明）；</li>
     *   <li>一趟只装一种货 —— 船舱就那么大，当然先运值钱的，
     *       界面上一行"带货：衣物 ×24"也比一串清单清楚。</li>
     * </ol>
     */
    private Manifest manifestOf(List<Views.StockView> stock) {
        Views.StockView best = null;
        for (Views.StockView s : stock) {
            if (s.quantity() - RESERVE <= 0) continue;
            if (best == null || s.unitPrice() > best.unitPrice()) best = s;
        }
        if (best == null) return null;
        Good good = Good.of(best.good());
        int qty = Math.min(CAPACITY, best.quantity() - RESERVE);
        return new Manifest(good, qty, qty * marketService.sellPrice(good) * OVERSEAS_MARKUP);
    }
}
