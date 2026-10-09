package com.anno.service;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.anno.config.GameProperties;
import com.anno.domain.BuildingEntity;
import com.anno.domain.BuildingType;
import com.anno.domain.Good;
import com.anno.domain.ResidentEntity;
import com.anno.domain.ResidentTier;
import com.anno.domain.ServiceType;
import com.anno.dto.Views;
import com.anno.repo.BuildingRepository;
import com.anno.repo.ResidentRepository;
import com.anno.ws.GameSocketHub;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 人口：把"生产出来的东西"真正变成"钱"的那一环。
 * <p>
 * 《纪元1800》的经济闭环是「港口 → 住宅 → 居民有需求 → 满足需求才收得到税 → 人口增长 →
 * 解锁更高级的建筑与需求」。在补上这个服务之前，本项目只有前半段
 * （造厂 → 产出 → 卖给 NPC 市场），居民、需求、税收三环整体缺失。
 * <p>
 * 【职责边界】
 * <ul>
 *   <li>人口<b>容量</b>不落库：由岛上的住宅建筑实时汇总（{@link #capacityOf}），
 *       拆掉一栋房子容量立刻跟着掉，不需要任何同步代码；</li>
 *   <li>人口<b>数量</b>落库（{@code resident} 表），它是随时间累积的结果；</li>
 *   <li>本服务<b>不碰</b>生产心跳：住宅与贸易站没有配方，{@code ProductionService.tick} 会跳过它们。</li>
 * </ul>
 * <p>
 * 【为什么按周期结算而不是每秒结算】
 * 需求按"每人每分钟"计，而心跳每秒一次：24 个农夫一秒只吃 0.16 个土豆，
 * 直接取整永远是 0，东西永远消耗不掉。所以把时间攒够一个周期（默认 30 游戏秒）
 * 再一次性结算，每次算的都是整段时间的量，没有量化误差。
 * <p>
 * 【公共服务】住宅建得再密，没有教堂学校也能住，但<b>住得不痛快</b>：
 * {@link ResidentTier#getRequiredServices()} 列出这一层人非要不可的公共设施，
 * 覆盖率不足时满足度按比例打折 —— 这就是"为什么要在居民区中间塞一座教堂"的数值答案。
 */
@Service
public class PopulationService {

    private static final Logger log = LoggerFactory.getLogger(PopulationService.class);

    /** 满足度高于它才开始有人搬进来 */
    private static final double SATISFIED = 0.6;
    /** 满足度低于它居民就会搬走；0.4~0.6 之间保持不动，留一段滞回避免人口在阈值上反复横跳 */
    private static final double UNHAPPY = 0.4;
    /**
     * 公共服务一项不剩时的满足度上限：0.5 意味着"楼盖满了也只会停在那儿不涨人口"，
     * 玩家必须先把对应的公共设施补上才能真正升级阶层。农夫没有硬性服务需求，取 1。
     */
    private static final double SERVICE_FLOOR = 0.5;

    private final ResidentRepository residentRepository;
    private final BuildingRepository buildingRepository;
    private final IslandService islandService;
    private final InventoryService inventoryService;
    private final PlayerService playerService;
    private final GameProperties props;
    private final GameSocketHub hub;
    /** 公共服务 / 全岛加成的汇总：见 {@link IslandEffectsService} */
    private final IslandEffectsService effects;

    public PopulationService(ResidentRepository residentRepository, BuildingRepository buildingRepository,
                             IslandService islandService, InventoryService inventoryService,
                             PlayerService playerService, GameProperties props,
                             GameSocketHub hub, IslandEffectsService effects) {
        this.residentRepository = residentRepository;
        this.buildingRepository = buildingRepository;
        this.islandService = islandService;
        this.inventoryService = inventoryService;
        this.playerService = playerService;
        this.props = props;
        this.hub = hub;
        this.effects = effects;
    }

    // ==================================================================
    // 按岛推进：消费 → 满足度 → 税收 → 人口增减
    // ==================================================================

    /**
     * 推进**这一座岛**的居民消费、税收与人口增减。
     * <p>
     * 【为什么不再分批】改造前这里是"拉出全服所有住宅与贸易站算容量 + findAll 全服居民行"，
     * 再切成固定 4 批结算 —— 开销同样与注册玩家数成正比。现在由
     * {@link IslandSimService} 按岛调用，只碰这座岛的建筑与居民行；离线玩家的岛不会被调到。
     * <p>
     * {@code deltaSeconds} 是"这座岛这次该补的游戏秒数"，由岛屿水位线算出来：
     * 玩家离线三天再回来，拿到的仍只是**离线宽限内**的那几秒 —— 居民不会一口气吃掉整仓货。
     */
    @Transactional
    public void tickIsland(Long islandId, Long ownerId, double deltaSeconds) {
        if (deltaSeconds <= 0) return;

        // 各阶层容量：由岛上的住宅实时汇总（不落库）
        Map<ResidentTier, Integer> capacity = new EnumMap<>(ResidentTier.class);
        List<BuildingEntity> buildings = buildingRepository.findByIslandId(islandId);
        for (BuildingEntity b : buildings) {
            BuildingType t = b.getType();
            if (!t.isResidence()) continue;
            capacity.merge(t.getResidentTier(), t.getResidentCapacity(), Integer::sum);
        }
        // 公共服务覆盖率与全岛加成：整岛算一次，七个阶层共用（别每阶层都重扫一遍建筑表）
        Map<ServiceType, Double> coverage = effects.coverageOf(buildings);
        IslandEffectsService.Effects fx = effects.effectsOf(buildings);
        settleIsland(islandId, ownerId, capacity, deltaSeconds, coverage, fx);
    }

    private void settleIsland(Long islandId, Long ownerId, Map<ResidentTier, Integer> caps,
                              double deltaSeconds, Map<ServiceType, Double> coverage,
                              IslandEffectsService.Effects fx) {
        Map<ResidentTier, ResidentEntity> rows = new LinkedHashMap<>();
        residentRepository.findByIslandId(islandId).forEach(r -> rows.put(r.getTier(), r));

        // 要结算的阶层 = 有房子的 ∪ 有人的（房子拆光了但人还没走完的也要继续结算，让他们离开）
        Set<ResidentTier> tiers = new LinkedHashSet<>(caps.keySet());
        tiers.addAll(rows.keySet());

        for (ResidentTier tier : tiers) {
            int capacity = caps.getOrDefault(tier, 0);
            ResidentEntity res = rows.get(tier);
            if (res == null) {
                if (capacity <= 0) continue;
                res = residentRepository.save(new ResidentEntity(islandId, tier));
            }
            settleOne(islandId, ownerId, res, capacity, deltaSeconds, coverage, fx);
        }
    }

    /**
     * 结算一个岛上的一个阶层：扣货 → 算满足度 → 收税 → 人口增减。
     * <p>
     * 顺序很关键：<b>先扣货再收税</b>。倒过来的话，玩家可以在结算瞬间把货卖光、
     * 照样拿满额税收，居民等于白吃。
     */
    private void settleOne(Long islandId, Long ownerId, ResidentEntity res, int capacity,
                           double deltaSeconds, Map<ServiceType, Double> coverage,
                           IslandEffectsService.Effects fx) {
        ResidentTier tier = res.getTier();
        long now = System.currentTimeMillis();

        // ① 房子没了就得搬走：人口立刻收敛到容量上限，不让它悬在半空
        int pop = Math.min(res.getPopulation(), capacity);

        // ② 攒够一个结算周期才真正结算
        double period = props.getResidentSettleSeconds();
        double carry = res.getCarrySeconds() + deltaSeconds;
        if (carry < period) {
            residentRepository.updateSettlement(res.getId(), pop, res.getSatisfaction(),
                    carry, res.getLastTax());
            return;
        }
        // 积压过多（服务器卡了一分钟）时最多只补算一个周期，避免一次把仓库扣空
        carry = Math.min(carry - period, period);

        double minutes = period / 60.0;
        int before = pop;

        // 公共服务满足比例：这一层人非要不可的那几项，平均覆盖了多少比例的住宅
        double service = effects.factorFor(tier.getRequiredServices(), coverage);
        double serviceFactor = tier.getRequiredServices().isEmpty()
                ? 1.0
                : SERVICE_FLOOR + (1.0 - SERVICE_FLOOR) * service;

        // ③ 逐项需求：先看仓库有多少，算出"这项能满足几成"
        Map<Good, Integer> toConsume = new LinkedHashMap<>();
        double satSum = 0;
        int satCount = 0;
        for (Map.Entry<Good, Double> e : tier.getNeeds().entrySet()) {
            double need = e.getValue() * pop * minutes;
            int have = inventoryService.quantity(ownerId, e.getKey());
            double ratio = need <= 0 ? 1.0 : Math.min(1.0, have / need);
            satSum += ratio;
            satCount++;
            toConsume.put(e.getKey(), Math.min((int) Math.round(need), have));
        }
        // 满足度 = 各项供应率的平均值。缺一项就掉一半，两项都断供就归零。
        //      再乘"公共服务系数"：缺教堂 / 学校这类硬性公共设施时，再多的面包也换不来满额满足度。
        double satisfaction = (satCount == 0 ? 1.0 : satSum / satCount) * serviceFactor;

        // ④ 真的扣货（有多少扣多少，不会因为差一点就整轮中断）
        for (Map.Entry<Good, Integer> e : toConsume.entrySet()) {
            if (e.getValue() > 0) inventoryService.consumeUpTo(ownerId, e.getKey(), e.getValue());
        }

        // ⑤ 收税：断供就按比例少缴，银行类设施再乘一份全岛加成。
        //    这是"居民经济"里唯一的收入来源，也是公共建筑间接增值的那一段。
        double tax = Math.round(tier.getTaxPerResidentPerMinute() * pop * minutes
                * satisfaction * fx.taxMultiplier());
        if (tax > 0) playerService.addTreasury(ownerId, tax);

        // ⑥ 人口增减
        if (satisfaction >= SATISFIED) {
            int grow = (int) Math.ceil(capacity * tier.getGrowthPerMinute() * minutes);
            pop = Math.min(capacity, pop + Math.max(pop < capacity ? 1 : 0, grow));
        } else if (satisfaction < UNHAPPY) {
            int leave = (int) Math.ceil(pop * tier.getDeclinePerMinute() * minutes);
            pop = Math.max(0, pop - Math.max(1, leave));
        }
        // 0.4 ~ 0.6 之间：保持不动，让玩家有时间补货

        residentRepository.updateSettlement(res.getId(), pop, satisfaction, carry, tax);

        if (pop != before) {
            hub.broadcast("event", Map.of("type", "POPULATION_CHANGED", "serverTime", now,
                    "payload", Map.of("playerId", ownerId, "islandId", islandId,
                            "tier", tier.name(), "tierLabel", tier.getLabel(),
                            "population", pop, "capacity", capacity,
                            "delta", pop - before,
                            "satisfaction", round2(satisfaction), "tax", tax)));
            log.info("【人口】岛 {} 的{} {} → {}（满足度 {}%，本轮税收 ¥{}）",
                    islandId, tier.getLabel(), before, pop, Math.round(satisfaction * 100), (long) tax);
        }
    }

    // ==================================================================
    // 查询
    // ==================================================================

    /** 岛上每个阶层的人口 / 容量 / 满足度 / 需求明细 —— 客户端人口面板照这份数据渲染 */
    @Transactional(readOnly = true)
    public Views.PopulationView population(Long islandId) {
        List<BuildingEntity> buildings = buildingRepository.findByIslandId(islandId);
        boolean hasTradingPost = buildings.stream().anyMatch(b -> b.getType().isTradingPost());
        Long ownerId = islandService.ownerOf(islandId);

        Map<ResidentTier, Integer> caps = new EnumMap<>(ResidentTier.class);
        for (BuildingEntity b : buildings) {
            if (b.getType().isResidence()) {
                caps.merge(b.getType().getResidentTier(), b.getType().getResidentCapacity(), Integer::sum);
            }
        }
        Map<ResidentTier, ResidentEntity> rows = new EnumMap<>(ResidentTier.class);
        residentRepository.findByIslandId(islandId).forEach(r -> rows.put(r.getTier(), r));

        int totalPop = 0, totalCap = 0;
        double totalTax = 0;
        List<Views.ResidentView> tiers = new ArrayList<>();
        Map<ServiceType, Double> coverage = effects.coverageOf(buildings);

        for (ResidentTier tier : ResidentTier.values()) {
            int capacity = caps.getOrDefault(tier, 0);
            ResidentEntity r = rows.get(tier);
            int pop = r == null ? 0 : Math.min(r.getPopulation(), capacity);
            double satisfaction = r == null ? 1.0 : r.getSatisfaction();
            double taxPerMinute = r == null ? 0 : r.getLastTax() * (60.0 / props.getResidentSettleSeconds());

            totalPop += pop;
            totalCap += capacity;
            totalTax += taxPerMinute;

            List<Views.NeedView> needs = new ArrayList<>();
            for (Map.Entry<Good, Double> e : tier.getNeeds().entrySet()) {
                Good good = e.getKey();
                needs.add(new Views.NeedView(good.name(), good.getLabel(), e.getValue(),
                        (int) Math.round(e.getValue() * pop),
                        inventoryService.quantity(ownerId, good)));
            }
            tiers.add(new Views.ResidentView(tier.name(), tier.getLabel(), pop, capacity,
                    round2(satisfaction), round2(taxPerMinute), needs,
                    unlocked(islandId, tier), capacity > 0 || pop > 0));
        }

        return new Views.PopulationView(islandId, hasTradingPost, totalPop, totalCap,
                round2(totalTax), tiers, serviceStats(coverage));
    }

    /** 公共服务面板用：每一项服务当前覆盖了多少住宅（客户端据此提示"还差一座教堂"） */
    private List<Views.ServiceView> serviceStats(Map<ServiceType, Double> coverage) {
        List<Views.ServiceView> out = new ArrayList<>();
        for (ResidentTier tier : ResidentTier.values()) {
            for (ServiceType s : tier.getRequiredServices()) {
                // 同一项服务被多个阶层需要时只列一次（面板上一行就够）
                if (out.stream().anyMatch(v -> v.service().equals(s.name()))) continue;
                out.add(new Views.ServiceView(s.name(), s.getLabel(), s.getHint(),
                        round2(coverage.getOrDefault(s, 0.0))));
            }
        }
        return out;
    }

    /** 某座岛已有的农夫人口（建造门槛校验要用） */
    @Transactional(readOnly = true)
    public int farmers(Long islandId) {
        return populationOf(islandId, ResidentTier.FARMER);
    }

    /** 这座岛上某个阶层当前住了多少人（0 = 一个也没有） */
    @Transactional(readOnly = true)
    public int populationOf(Long islandId, ResidentTier tier) {
        return residentRepository.findByIslandIdAndTier(islandId, tier)
                .map(ResidentEntity::getPopulation).orElse(0);
    }

    /** 全岛总人口（各阶层合计）—— 它就是劳动力池：工厂的"所需工人"从这里分配 */
    @Transactional(readOnly = true)
    public int totalPopulation(Long islandId) {
        int total = 0;
        for (ResidentEntity r : residentRepository.findByIslandId(islandId)) {
            total += r.getPopulation();
        }
        return total;
    }

    /**
     * 新住宅落成时的**初始移民**：一座新房直接迁入一小批居民。
     * <p>
     * 【为什么必须有】劳动力改由人口提供后，"人口 0 → 工厂全停 → 没产出 → 居民没吃的
     * → 人口永远 0"是个死锁。纪元 1800 里新房子本来就会"叮"地来一家子 —— 这里迁入
     * min(8, 剩余容量) 人，让第一条产业链能转起来，之后照旧按满足度自然增长。
     * <p>
     * 已有人口的行直接累加（不覆盖），容量不够就少迁。
     */
    @Transactional
    public void seedSettlers(Long islandId, ResidentTier tier, int count) {
        if (count <= 0) return;
        int capacity = 0;
        for (BuildingEntity b : buildingRepository.findByIslandId(islandId)) {
            if (b.getType().isResidence() && b.getType().getResidentTier() == tier) {
                capacity += b.getType().getResidentCapacity();
            }
        }
        if (capacity <= 0) return;
        ResidentEntity res = residentRepository.findByIslandIdAndTier(islandId, tier).orElse(null);
        int current = res == null ? 0 : res.getPopulation();
        int seeded = Math.min(count, Math.max(0, capacity - current));
        if (seeded <= 0) return;
        if (res == null) {
            res = residentRepository.save(new ResidentEntity(islandId, tier));
        }
        res.setPopulation(current + seeded);
        residentRepository.save(res);
        hub.broadcast("event", Map.of("type", "POPULATION_CHANGED", "serverTime", System.currentTimeMillis(),
                "payload", Map.of("islandId", islandId, "tier", tier.name(),
                        "population", current + seeded, "seeded", seeded)));
    }

    /** 岛上有没有贸易站 —— 没有它居民的生活物资运不上岛，不能盖住宅。
     *  【必须认对外开放的那一个】HARBOR 类里还有造船厂 / 码头 / 泊位，它们都停不下有大船、
     *  也当不成"物资前提"，所以判定走 {@link BuildingType#isTradingPost()}。 */
    @Transactional(readOnly = true)
    public boolean hasTradingPost(Long islandId) {
        return buildingRepository.findByIslandId(islandId).stream()
                .anyMatch(b -> b.getType().isTradingPost());
    }

    /**
     * 这个阶层在这座岛上解锁了没。
     * 农夫永远可用；工人需要岛上先住满一定数量的农夫 —— 就是《纪元1800》
     * "人口到了一定规模才解锁新建筑"的那条线。
     */
    @Transactional(readOnly = true)
    public boolean unlocked(Long islandId, ResidentTier tier) {
        ResidentTier req = tier.getRequiredTier();
        if (req == null) return true;
        return populationOf(islandId, req) >= tier.getRequiredPopulation();
    }

    /**
     * 把人口收敛到当前容量以内（拆房后立刻生效，不用等下次心跳）。
     * 容量由住宅推导，房子一没，多出来的人必须马上离开。
     */
    @Transactional
    public void shrinkToCapacity(Long islandId) {
        Map<ResidentTier, Integer> caps = new EnumMap<>(ResidentTier.class);
        for (BuildingEntity b : buildingRepository.findByIslandId(islandId)) {
            if (b.getType().isResidence()) {
                caps.merge(b.getType().getResidentTier(), b.getType().getResidentCapacity(), Integer::sum);
            }
        }
        for (ResidentEntity r : residentRepository.findByIslandId(islandId)) {
            int cap = caps.getOrDefault(r.getTier(), 0);
            if (r.getPopulation() > cap) {
                r.setPopulation(cap);
                residentRepository.save(r);
            }
        }
    }

    private static double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }
}
