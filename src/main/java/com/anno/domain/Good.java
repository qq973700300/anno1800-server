package com.anno.domain;

import java.util.Arrays;
import java.util.List;

/**
 * 商品定义（纪元1800 风格：原料 -> 加工品 -> 消费品/奢侈品 的生产链）。
 * <p>
 * 标为 plantable 的商品就是"农作物"，可以直接种在岛屿农田地块上（那五种是玩家手播种的）；
 * 其余原料由建筑产出：伐木场 / 矿井 / 采石场 / 渔场 / 牧场 / 种植园。
 * <p>
 * 【数量是怎么长到七十多种的】2026-09-25 把《纪元1800》的建筑表整份接进来了：
 * 从农夫一路到投资者、学者、游客，七层居民各有一套需求，需求又把产业链往下拉到
 * 石油、电力、汽车、电报机这种末端。所以这里是全表的商品，而不是某一层够用的子集。
 * <p>
 * 【老商品的 key 不能改】{@code stock} / {@code market_price} / {@code price_history}
 * 三张表都拿 name() 当业务主键落库，改一个枚举报复性丢失全部库存与行情历史。
 */
public enum Good {

    /* ================= 一、开采 / 采集类原料 ================= */

    WOOD   ("木材",    6.0,  Category.RAW, false, 0, 0, 0),
    CLAY   ("黏土",    5.0,  Category.RAW, false, 0, 0, 0),
    IRON   ("铁矿",   12.0,  Category.RAW, false, 0, 0, 0),
    COAL   ("煤炭",   14.0,  Category.RAW, false, 0, 0, 0),
    SAND   ("石英砂",  9.0,  Category.RAW, false, 0, 0, 0),
    LIMESTONE("石灰石",11.0, Category.RAW, false, 0, 0, 0),
    ZINC   ("锌矿",   20.0,  Category.RAW, false, 0, 0, 0),
    COPPER ("铜矿",   22.0,  Category.RAW, false, 0, 0, 0),
    GOLD   ("金矿",   60.0,  Category.RAW, false, 0, 0, 0),
    OIL    ("原油",   30.0,  Category.RAW, false, 0, 0, 0),

    /* 农业与畜牧产出（虽然来自动物/作物，但在我们的模型里就是"原料"一档） */
    FISH   ("鲜鱼",   10.0,  Category.RAW, false, 0, 0, 0),
    PORK   ("生猪",   16.0,  Category.RAW, false, 0, 0, 0),
    BEEF   ("肉牛",   18.0,  Category.RAW, false, 0, 0, 0),
    RED_PEPPER("红椒",24.0,  Category.RAW, false, 0, 0, 0),
    GRAPES ("葡萄",   22.0,  Category.RAW, false, 0, 0, 0),
    SUGAR_CANE("甘蔗",20.0,  Category.RAW, false, 0, 0, 0),
    COFFEE_BEANS("咖啡豆",26.0, Category.RAW, false, 0, 0, 0),
    CHERRY_WOOD("樱桃木",28.0, Category.RAW, false, 0, 0, 0),
    RESIN  ("树脂",   24.0,  Category.RAW, false, 0, 0, 0),

    /* ================= 二、可播种作物（玩家自己下种） ================= */

    POTATO ("土豆",    8.0,  Category.CROP, true,  30, 8, 12.0),
    GRAIN  ("小麦",   10.0,  Category.CROP, true,  45, 6, 16.0),
    HOPS   ("啤酒花", 14.0,  Category.CROP, true,  60, 5, 24.0),
    COTTON ("棉花",   16.0,  Category.CROP, true,  90, 5, 30.0),
    // 羊毛不可种植（纪元1800式）：羊场是牧场地坪（SHEEP_FARM 配方无输入直接产毛），不拉田
    WOOL   ("羊毛",   18.0,  Category.CROP, false, 60, 4, 28.0),

    /* ================= 三、基础加工品（农夫 / 工人层） ================= */

    TIMBER ("木板",   18.0,  Category.PROCESSED, false, 0, 0, 0),
    BRICK  ("砖块",   16.0,  Category.PROCESSED, false, 0, 0, 0),
    STEEL  ("钢材",   40.0,  Category.PROCESSED, false, 0, 0, 0),
    FLOUR  ("面粉",   20.0,  Category.PROCESSED, false, 0, 0, 0),
    BREAD  ("面包",   45.0,  Category.PROCESSED, false, 0, 0, 0),
    MALT   ("麦芽",   24.0,  Category.PROCESSED, false, 0, 0, 0),
    BEER   ("啤酒",   60.0,  Category.PROCESSED, false, 0, 0, 0),
    SCHNAPPS("烈酒",  40.0,  Category.PROCESSED, false, 0, 0, 0),
    FABRIC ("布料",   34.0,  Category.PROCESSED, false, 0, 0, 0),
    CLOTHES("衣物",   80.0,  Category.PROCESSED, false, 0, 0, 0),
    TALLOW ("油脂",    9.0,  Category.PROCESSED, false, 0, 0, 0),
    SOAP   ("肥皂",   26.0,  Category.PROCESSED, false, 0, 0, 0),
    SAUSAGE("香肠",   34.0,  Category.PROCESSED, false, 0, 0, 0),
    SAIL   ("风帆",   52.0,  Category.PROCESSED, false, 0, 0, 0),
    WEAPON ("火枪",   90.0,  Category.PROCESSED, false, 0, 0, 0),

    /* ================= 四、工匠层：玻璃 / 石料 / 机械 ================= */

    GLASS  ("玻璃",   38.0,  Category.PROCESSED, false, 0, 0, 0),
    WINDOW ("窗户",   72.0,  Category.PROCESSED, false, 0, 0, 0),
    CONCRETE("混凝土",44.0,  Category.PROCESSED, false, 0, 0, 0),
    CANNED_FOOD("罐头",70.0, Category.PROCESSED, false, 0, 0, 0),
    GOULASH("炖菜",   58.0,  Category.PROCESSED, false, 0, 0, 0),
    SEWING_MACHINE("缝纫机",150.0, Category.PROCESSED, false, 0, 0, 0),

    /* ================= 五、工程师层：金属 / 石油 / 电力 / 精密件 ================= */

    BRASS  ("黄铜",   56.0,  Category.PROCESSED, false, 0, 0, 0),
    FUEL   ("燃油",   46.0,  Category.PROCESSED, false, 0, 0, 0),
    /* 电力是一种"工业耗材"：它不像面包那样被居民消耗，而是作为**下游工厂的投入**（电机 / 流水线）。
       这样"先发电再上流水线"的次序才有实际约束力。 */
    POWER  ("电力",   22.0,  Category.INDUSTRIAL, false, 0, 0, 0),
    SPECTACLES("眼镜",170.0, Category.PROCESSED, false, 0, 0, 0),
    BICYCLE("自行车", 240.0, Category.PROCESSED, false, 0, 0, 0),
    MOTOR  ("汽车引擎",320.0, Category.INDUSTRIAL, false, 0, 0, 0),
    CLOCK  ("钟表",   260.0, Category.PROCESSED, false, 0, 0, 0),
    JEWELRY("珠宝",   420.0, Category.LUXURY, false, 0, 0, 0),
    FILAMENT("灯丝",  80.0,  Category.INDUSTRIAL, false, 0, 0, 0),
    LIGHT_BULB("灯泡",130.0, Category.PROCESSED, false, 0, 0, 0),
    SALTPETRE("硝石", 36.0,  Category.INDUSTRIAL, false, 0, 0, 0),
    DYNAMITE("炸药",  120.0, Category.INDUSTRIAL, false, 0, 0, 0),
    BOMB   ("炸弹",   150.0, Category.INDUSTRIAL, false, 0, 0, 0),
    SEA_MINE("水雷",  190.0, Category.INDUSTRIAL, false, 0, 0, 0),
    HEAVY_WEAPON("重炮",380.0,Category.INDUSTRIAL, false, 0, 0, 0),

    /* ================= 六、投资者层：奢侈品 ================= */

    CHAMPAGNE("香槟", 300.0, Category.LUXURY, false, 0, 0, 0),
    COGNAC ("白兰地", 280.0, Category.LUXURY, false, 0, 0, 0),
    COFFEE ("咖啡",   90.0,  Category.PROCESSED, false, 0, 0, 0),
    RUM    ("朗姆酒", 110.0, Category.PROCESSED, false, 0, 0, 0),
    MARQUETRY("镶嵌木工",180.0, Category.PROCESSED, false, 0, 0, 0),
    GRAMOPHONE("留声机",460.0,Category.LUXURY, false, 0, 0, 0),
    COACH  ("马车",   210.0, Category.PROCESSED, false, 0, 0, 0),
    CAB    ("轿车",   620.0, Category.LUXURY, false, 0, 0, 0),
    ELEVATOR("电梯",  300.0, Category.INDUSTRIAL, false, 0, 0, 0),
    BISCUITS("饼干",   64.0, Category.PROCESSED, false, 0, 0, 0),
    FURNITURE("家具", 200.0, Category.PROCESSED, false, 0, 0, 0),
    TYPEWRITER("打字机",290.0, Category.PROCESSED, false, 0, 0, 0),
    BILLIARD_TABLE("台球桌",340.0, Category.LUXURY, false, 0, 0, 0),
    VIOLIN ("小提琴", 380.0, Category.LUXURY, false, 0, 0, 0),
    TOYS   ("玩具",    72.0, Category.PROCESSED, false, 0, 0, 0),
    DRUGS  ("药品",   160.0, Category.PROCESSED, false, 0, 0, 0),
    LACQUER("漆料",    96.0, Category.PROCESSED, false, 0, 0, 0),
    TELEPHONE("电话机",330.0, Category.LUXURY, false, 0, 0, 0),
    BOOTS  ("皮靴",    96.0, Category.PROCESSED, false, 0, 0, 0),

    /* ================= 七、游客层：轻工业消费品 ================= */

    JAM    ("果酱",    62.0, Category.PROCESSED, false, 0, 0, 0),
    SHAMPOO("洗发水",  88.0, Category.PROCESSED, false, 0, 0, 0),
    LEMONADE("柠檬水", 74.0, Category.PROCESSED, false, 0, 0, 0),
    SOUVENIR("纪念品",110.0, Category.PROCESSED, false, 0, 0, 0);

    public enum Category { RAW, CROP, PROCESSED, INDUSTRIAL, LUXURY }

    /** 中文名 */
    private final String label;
    /** 基准价，市场价格围绕它波动 */
    private final double basePrice;
    private final Category category;
    /** 是否可种植 */
    private final boolean plantable;
    /** 生长所需游戏秒数（仅作物） */
    private final int growthSeconds;
    /** 单块地单次收获产量（仅作物） */
    private final int yieldPerHarvest;
    /** 种子成本（种一次扣一次钱） */
    private final double seedCost;

    Good(String label, double basePrice, Category category, boolean plantable,
         int growthSeconds, int yieldPerHarvest, double seedCost) {
        this.label = label;
        this.basePrice = basePrice;
        this.category = category;
        this.plantable = plantable;
        this.growthSeconds = growthSeconds;
        this.yieldPerHarvest = yieldPerHarvest;
        this.seedCost = seedCost;
    }

    public String getLabel() { return label; }
    public double getBasePrice() { return basePrice; }
    public Category getCategory() { return category; }
    public boolean isPlantable() { return plantable; }
    public int getGrowthSeconds() { return growthSeconds; }
    public int getYieldPerHarvest() { return yieldPerHarvest; }
    public double getSeedCost() { return seedCost; }

    /** 所有可种植作物，给客户端下拉用 */
    public static List<Good> crops() {
        return Arrays.stream(values()).filter(Good::isPlantable).toList();
    }

    public static Good of(String name) {
        return Good.valueOf(name.trim().toUpperCase());
    }
}
