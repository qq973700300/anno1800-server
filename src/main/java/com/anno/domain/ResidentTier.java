package com.anno.domain;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static java.util.Map.entry;

/**
 * 居民阶层：决定这群人**要什么**、**交多少税**、**多快搬进来**。
 * <p>
 * 这是《纪元1800》经济循环里最关键的一环 —— 生产出来的东西不再是"卖给抽象市场"就完事，
 * 而是**被岛上的人消耗掉**，消耗换来税收。于是"产量"第一次和"需求"挂上了钩。
 * <p>
 * 【七个阶层】农夫 → 工人 → 工匠 → 工程师 → 投资者，外加 Land of Lions 的学者与游客。
 * 越往上单位人口缴税越高，但需求越长、而且要的已经不是面包而是香槟与轿车 ——
 * 后期一条完整产业链往往要横跨五六个加工步骤，这正是这次扩表的目的。
 * <p>
 * 【解锁】每一层都要看下一层的人口：农夫满 120 才有人愿意当工人，工人满 200 才出工匠……
 * 见 {@code requiredTier} / {@code requiredPopulation}。住宅建筑与前一层 lockstep，
 * 服务端 {@code ProductionService.requireResidentPrerequisites} 与 PopulationService.unlocked 共用这套门槛。
 * <p>
 * 【公共服务需求】 {@link #getRequiredServices()}：这一层人"非要不可"的公共服务。
 * 缺它们时哪怕物资全满，满足度也只能到 partial（见 PopulationService 的 serviceFactor）——
 * 这是公共建筑存在的理由。
 * <p>
 * 【设计要点·为什么消耗量按"每人每分钟"而不是"每次结算"】
 * 世界心跳是可变速的（{@code anno.time-scale} 能调到 10 倍速），结算周期也是可配的。
 * 把需求写成"每人每分钟"这种**速率**，无论结算周期是 30 秒还是 120 秒，
 * 换算出的消耗量都一致，调参时不用重算平衡。
 * <p>
 * 【与市场的关系】居民消费是**叠加**在原有市场之上的：市场依然是无限吞吐的 NPC，
 * 玩家可以继续低买高卖。但把货喂给居民通常更划算（见各阶层税率与需求的比值），
 * 代价是要自己把产业链铺齐、还要承担"断供就掉人口"的风险。
 */
public enum ResidentTier {

    /**
     * 农夫：最好养活的一级，只要有土豆和烈酒就肯交税。
     * 24 人一分钟喝掉 9.6 土豆 + 3.6 烈酒（市场价值约 ¥221），换来 ¥336 税收 —— 净赚约 ¥115。
     */
    FARMER("农夫", 1,
            Map.ofEntries(entry(Good.POTATO, 0.40), entry(Good.SCHNAPPS, 0.15)),
            14.0,   // 每人每分钟缴税
            0.50,   // 每分钟填充容量的比例（30 秒结算一次即 25%）
            0.45,   // 断供时每分钟流失的比例
            null, 0,
            List.of()),

    /**
     * 工人：需求升级到面包与啤酒，税率翻倍，但房子更占地（3×3）。
     * 单位面积税收 1040/9 ≈ 115 金/格，明显高于农夫的 336/4 = 84 金/格 —— 升级是有回报的。
     * 【要一座集市】这是最便宜的一条公共服务门槛：镇子上得有个买东西的地方。
     */
    WORKER("工人", 2,
            Map.ofEntries(entry(Good.BREAD, 0.20), entry(Good.BEER, 0.10)),
            26.0, 0.35, 0.40,
            FARMER, 120,
            List.of(ServiceType.MARKET)),

    /**
     * 工匠：第一次要求"生活方式" —— 除了吃饱（面包 / 罐焖肉），还要肥皂、啤酒和成衣。
     * 【要集市与教堂】两座公共建筑都得上，否则满足度永远卡在三四成。
     */
    ARTISAN("工匠", 3,
            Map.ofEntries(
                    entry(Good.BREAD, 0.15),
                    entry(Good.SOAP, 0.10),
                    entry(Good.CANNED_FOOD, 0.10),
                    entry(Good.BEER, 0.10),
                    entry(Good.CLOTHES, 0.08)),
            52.0, 0.30, 0.38,
            WORKER, 200,
            List.of(ServiceType.MARKET, ServiceType.FAITH)),

    /**
     * 工程师：需求第一次伸向工业品 —— 缝纫机、灯泡、眼镜，还要每天一杯咖啡。
     * 【要教育与医疗】学校与医院是工业革命时期城市的基本配置。
     */
    ENGINEER("工程师", 4,
            Map.ofEntries(
                    entry(Good.BREAD, 0.12),
                    entry(Good.CANNED_FOOD, 0.10),
                    entry(Good.COFFEE, 0.08),
                    entry(Good.SEWING_MACHINE, 0.05),
                    entry(Good.LIGHT_BULB, 0.05),
                    entry(Good.SPECTACLES, 0.04)),
            105.0, 0.26, 0.34,
            ARTISAN, 300,
            List.of(ServiceType.MARKET, ServiceType.EDUCATION, ServiceType.HEALTH)),

    /**
     * 投资者：只在乎奢侈品 —— 香槟、白兰地、珠宝、留声机、轿车、高级家具。
     * 税率最高的同时也是链条最长的一层：每一件奢侈品背后都压着五六座上游工厂。
     */
    INVESTOR("投资者", 5,
            Map.ofEntries(
                    entry(Good.CHAMPAGNE, 0.05),
                    entry(Good.COGNAC, 0.04),
                    entry(Good.JEWELRY, 0.03),
                    entry(Good.GRAMOPHONE, 0.02),
                    entry(Good.CAB, 0.02),
                    entry(Good.FURNITURE, 0.04)),
            220.0, 0.22, 0.30,
            ENGINEER, 400,
            List.of(ServiceType.ADMIN, ServiceType.CULTURE, ServiceType.FINANCE)),

    /**
     * 学者：Land of Lions 那套。要咖啡、饼干这类"书房伙食"，再加两种文具/电器。
     */
    SCHOLAR("学者", 6,
            Map.ofEntries(
                    entry(Good.COFFEE, 0.08),
                    entry(Good.BISCUITS, 0.08),
                    entry(Good.BOOTS, 0.06),
                    entry(Good.TYPEWRITER, 0.03),
                    entry(Good.TELEPHONE, 0.03)),
            300.0, 0.20, 0.28,
            INVESTOR, 250,
            List.of(ServiceType.EDUCATION, ServiceType.CULTURE, ServiceType.TRANSPORT)),

    /**
     * 游客：不住在这里也要消费 —— 纪念品、果酱、柠檬水、洗发水、玩具。
     * 解锁条件挂在工程师人口上：城市工业起来了，才有游客愿意来看。
     */
    TOURIST("游客", 7,
            Map.ofEntries(
                    entry(Good.SOUVENIR, 0.10),
                    entry(Good.LEMONADE, 0.10),
                    entry(Good.JAM, 0.08),
                    entry(Good.SHAMPOO, 0.06),
                    entry(Good.TOYS, 0.05)),
            160.0, 0.55, 0.50,
            ENGINEER, 350,
            List.of(ServiceType.LEISURE, ServiceType.TRANSPORT, ServiceType.MARKET));

    private final String label;
    /** 阶层序号，越大越"高级"（客户端排序、解锁链都用） */
    private final int rank;
    /** 需求表：商品 -> **每人每分钟**消耗量 */
    private final Map<Good, Double> needs;
    /** 满足度 100% 时，**每人每分钟**交给公司（玩家）的税金 */
    private final double taxPerResidentPerMinute;
    /** 需求被满足时，每分钟新搬进来的人口占"住宅容量"的比例 */
    private final double growthPerMinute;
    /** 需求断供时，每分钟流失的人口占"当前人口"的比例 */
    private final double declinePerMinute;
    /** 解锁的**前置阶层**（null = 从一开始就可用，农夫是唯一一个） */
    private final ResidentTier requiredTier;
    /** 前置阶层要在这座岛上住够多少人，本阶层才算解锁 */
    private final int requiredPopulation;
    /** 非要不可的公共服务（缺一项就把满足度打折，详见 PopulationService.serviceFactor） */
    private final List<ServiceType> requiredServices;

    ResidentTier(String label, int rank, Map<Good, Double> needs,
                 double taxPerResidentPerMinute, double growthPerMinute, double declinePerMinute,
                 ResidentTier requiredTier, int requiredPopulation,
                 List<ServiceType> requiredServices) {
        this.label = label;
        this.rank = rank;
        this.needs = new LinkedHashMap<>(needs);
        this.taxPerResidentPerMinute = taxPerResidentPerMinute;
        this.growthPerMinute = growthPerMinute;
        this.declinePerMinute = declinePerMinute;
        this.requiredTier = requiredTier;
        this.requiredPopulation = requiredPopulation;
        this.requiredServices = List.copyOf(requiredServices);
    }

    public String getLabel() { return label; }
    public int getRank() { return rank; }
    public Map<Good, Double> getNeeds() { return needs; }
    public double getTaxPerResidentPerMinute() { return taxPerResidentPerMinute; }
    public double getGrowthPerMinute() { return growthPerMinute; }
    public double getDeclinePerMinute() { return declinePerMinute; }

    /** 解锁的前置阶层（null = 无门槛） */
    public ResidentTier getRequiredTier() { return requiredTier; }

    /** 前置阶层需要在这座岛上住够多少人（0 = 无门槛） */
    public int getRequiredPopulation() { return requiredPopulation; }

    /** 这一层人非要不可的公共服务（缺一项只影响打折幅度，不会硬性阻止定居） */
    public List<ServiceType> getRequiredServices() { return requiredServices; }

    /** 某个商品对这个阶层来说是"必备品"还是"锦上添花" —— 目前所有需求都是等权必备品 */
    public boolean needs(Good good) {
        return needs.containsKey(good);
    }

    /** 是不是该项服务的常客（客户端把"本层要哪些服务"列出来用） */
    public boolean needsService(ServiceType service) {
        return !requiredServices.isEmpty() && requiredServices.contains(service);
    }

    /** 某一阶层的下一个阶层（解锁链用）；最高层返回 null */
    public static ResidentTier nextOf(ResidentTier tier) {
        return Arrays.stream(values())
                .filter(t -> t.requiredTier == tier)
                .findFirst().orElse(null);
    }

    /** 按 rank 排序的全部阶层（客户端展示顺序） */
    public static List<ResidentTier> ordered() {
        return Arrays.stream(values()).sorted((a, b) -> Integer.compare(a.rank, b.rank)).toList();
    }

    /** 玩家一次性看到的服务清单（去重） */
    public static Set<ServiceType> allServices() {
        return Arrays.stream(values())
                .flatMap(t -> t.requiredServices.stream())
                .collect(java.util.stream.Collectors.toCollection(
                        () -> new java.util.LinkedHashSet<>()));
    }

    public static ResidentTier of(String name) {
        return ResidentTier.valueOf(name.trim().toUpperCase());
    }
}
