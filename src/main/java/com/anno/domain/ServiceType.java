package com.anno.domain;

/**
 * 公共服务：把《纪元1800》里"十来类公共建筑到底有什么用"落到具体数值上。
 * <p>
 * 接进全套建筑表之后，七成的建筑是<b>不产东西</b>的：集市、教堂、学校、消防站、码头、
 * 炮台、银行……如果它们只占地方，玩家永远不会建第二座。所以这里给它们两层作用：
 * <ol>
 *   <li><b>amenity（居民服务）</b>：每一项对应居民的一项"生活需求"。住宅落在它的服务半径内，
 *       该阶层的<b>公共服务覆盖率</b>就往上走；而 {@link ResidentTier#getRequiredServices()}
 *       定义了"这层人非要不可的几项" —— 缺了它们，再多的面包也换不来满额满足度，
 *       税收和人口增长跟着打折。这就是"为什么要在居民区中间塞一座教堂"的答案。</li>
 *   <li><b>island effect（全岛加成）</b>：供电 / 仓储 / 农机 / 泊位这四项不看谁住得近，
 *       只要岛上有就**整岛生效**，效果累加（并设有上限，见各处的 cap 常量）：
 *       电厂让工厂提速、仓库抬高待运上限、拖拉机谷仓让作物长得更快、泊位决定能停几艘闲船。</li>
 * </ol>
 * <p>
 * 一座建筑只登记**一项**主服务（配 {@code serviceRadius} 与 {@code serviceValue}）：
 * 想同时满足好几项就多盖几座不同职能的建筑 —— 这本来就是《纪元1800》逼出来的城市布局问题。
 */
public enum ServiceType {

    /* ---------------- 居民服务（看半径覆盖率） ---------------- */

    MARKET   ("集市",   true,  Effect.NONE,        "镇中心：柴米油盐的采买地"),
    LEISURE  ("休闲",   true,  Effect.NONE,        "酒馆 / 公园 / 餐馆：下班后的去处"),
    FAITH    ("信仰",   true,  Effect.NONE,        "教堂：周日的钟声与告解"),
    EDUCATION("教育",   true,  Effect.NONE,        "学校 / 大学：识字率与工程师的来源"),
    HEALTH   ("医疗",   true,  Effect.NONE,        "医院：疫病来时不至于整区垮掉"),
    SECURITY ("治安",   true,  Effect.NONE,        "警察局 / 消防站：夜里敢出门"),
    CULTURE  ("文化",   true,  Effect.NONE,        "剧院 / 博物馆 / 世界博览会"),
    ADMIN    ("行政",   true,  Effect.NONE,        "市政厅 / 皇宫：管这门子的地方"),
    FINANCE  ("金融",   true,  Effect.TAX,         "银行 / 百货：钱走动的地方"),
    DEFENSE  ("安防",   true,  Effect.NONE,        "炮台 / 炮塔：看得见的炮口"),
    TRANSPORT("交通",   true,  Effect.NONE,        "邮局 / 铁路 / 通勤码头"),

    /* ---------------- 全岛加成（有就算，不看位置） ---------------- */

    POWER_SUPPLY("供电", false, Effect.PRODUCTION, "发电厂：全岛工厂提速"),
    STOCK_BONUS ("仓储", false, Effect.PENDING,    "仓库：全岛建筑待运区上限提高"),
    MECH_BONUS  ("农机", false, Effect.FARM,       "拖拉机谷仓 / 铁路：作物长得更快"),
    MOORING     ("泊位", false, Effect.MOORING,    "码头 / 泊位：闲置的船能停得更近");

    /** 服务加成在哪个环节生效：居民服务平台-output 之间并不通用，按这一栏分派 */
    public enum Effect {
        /** 只影响居民满足度（居民服务） */
        NONE,
        /** 提高税收百分比 */
        TAX,
        /** 提高全岛生产速度百分比 */
        PRODUCTION,
        /** 提高全岛建筑待运区上限（格） */
        PENDING,
        /** 提高全岛作物生长速度百分比 */
        FARM,
        /** 提供额外船只停泊位 */
        MOORING
    }

    private final String label;
    /** 是不是"居民要的服务"（否则是全岛生效的生产/仓储加成） */
    private final boolean amenity;
    private final Effect effect;
    /** 给玩家看的一句话解释（客户端建造卡与面板直接用） */
    private final String hint;

    ServiceType(String label, boolean amenity, Effect effect, String hint) {
        this.label = label;
        this.amenity = amenity;
        this.effect = effect;
        this.hint = hint;
    }

    public String getLabel() { return label; }
    public boolean isAmenity() { return amenity; }
    public Effect getEffect() { return effect; }
    public String getHint() { return hint; }
}
