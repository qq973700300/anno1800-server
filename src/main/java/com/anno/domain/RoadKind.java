package com.anno.domain;

/**
 * 路面种类：修路时玩家自己选"这段路铺什么"，一格一种、跟着路走。
 * <p>
 * 【为什么不按时代自动升级】整岛一键换装虽然省事，但玩家铺路的先后有语义 ——
 * 港口区先铺石板路走货运、住宅区还留着土路，这种"新旧并存"本身就是城市年轮。
 * 所以路面是路格上的一个字段（{@code road.kind}），换装走"改造"接口按格收费。
 * <p>
 * 【解锁门槛】沿用阶层链：石板路等工人搬进来（农夫满 120）、砖路等工匠
 * （工人满 200）、林荫大道等工程师（工匠满 300）—— {@code gate} 存的是
 * "哪个阶层解锁了才能铺"，判定走 {@code PopulationService.unlocked(islandId, gate)}，
 * 和住宅门槛是同一把尺子。
 */
public enum RoadKind {

    /** 压实的泥土路：开局就有，便宜大碗 */
    DIRT("土路", 30, null),
    /** 石板路：工人时代的货运路面 */
    STONE("石板路", 45, ResidentTier.WORKER),
    /** 红砖路：工匠时代的城市铺装 */
    BRICK("砖路", 60, ResidentTier.ARTISAN),
    /** 林荫大道：工程师时代的宽阔大道，带人行道 */
    BOULEVARD("林荫大道", 90, ResidentTier.ENGINEER);

    public final String label;
    /** 每格造价（土路 = 原来的 road-cost，其它按档次递增） */
    public final int cost;
    /** 解锁门槛：这个阶层解锁了才能铺；null = 开局就有 */
    public final ResidentTier gate;

    RoadKind(String label, int cost, ResidentTier gate) {
        this.label = label;
        this.cost = cost;
        this.gate = gate;
    }

    /** 存档里的 kind 字符串 → 枚举；null / 空 / 认不出的老数据一律回落土路 */
    public static RoadKind of(String s) {
        if (s == null || s.isBlank()) return DIRT;
        try {
            return valueOf(s.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return DIRT;
        }
    }

    /** 把现有路面升级成 kind 的改造费（土路是基准价，差价即改造费） */
    public int restyleCost() {
        return Math.max(0, cost - DIRT.cost);
    }
}
