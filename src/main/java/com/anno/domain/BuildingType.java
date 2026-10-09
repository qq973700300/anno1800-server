package com.anno.domain;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 建筑类型 + 生产配方 —— 《纪元1800》的建筑表在本项目里的落点。
 * <p>
 * 【2026-09-25 大扩表】原先只有十几座厂房，这次按纪元1800的建筑表整份接了进来：
 * 从农夫一行一行的农田、作坊，到工程师的石油发电厂、汽车生产线，再到投资者的宫殿、
 * 世界博览会，以及 Land of Lions 的学者与游客系列 —— 一共一百多座。
 * 为了不让这份表变成"改一个数值要在十几处翻箱倒柜"的泥团，
 * 每个建筑的定义走 {@link Def} 这个流式 builder，一眼能看出"它属于哪一层、长什么样、有什么用"。
 * <p>
 * 每座生产性建筑每经过 durationSeconds 秒，消耗 inputs 里的库存，产出 outputs。
 * 原料不足时会"停工"，等库存补齐自动恢复。
 * <p>
 * 【占地】像《纪元1800》一样，建筑不是都占一格：农业/采掘类小（2×2、3×3），
 * 加工类越来越大（4×3、4×4、5×5）。占地越大产量越高，逼玩家规划土地与路网。
 * 建造时传入的 (x, z) 是占地矩形的**左上角**（x/z 最小的那格）。
 * <p>
 * 【用途五分】
 * <ul>
 *   <li>{@link Kind#PRODUCTION}：按配方跑；</li>
 *   <li>{@link Kind#RESIDENCE}：提供某一阶层的居住容量，撑起人口与税收；</li>
 *   <li>{@link Kind#HARBOR}：码头类，骑在岸线上、门朝海；</li>
 *   <li>{@link Kind#PUBLIC}：公共设施，靠 {@link ServiceType} 服务半径影响居民满足度；</li>
 *   <li>{@link Kind#MILITARY}：军事设施，提供安防服务（炮台类同样骑岸线）。</li>
 * </ul>
 * 判定"这座建筑要不要进生产心跳"一律走 {@link #isProduction()}，
 * 别再靠"inputs 是不是空"去猜，否则以后加一种无配方的生产建筑就会静默停产。
 * <p>
 * 【地形约束】见 {@link Ground}：铁矿/黏土必须压矿脉，采石场/金矿必须依山，
 * 沙矿/渔场/油井必须靠着岸线。矿脉是地图生成出来的、一座岛只有几处，
 * 这才是"铁矿 / 黏土"这类建筑存在的意义 —— 否则它们跟普通厂房没区别。
 */
public enum BuildingType {

    /* ==================================================================
       一、基础设施（任何时候都能建的小物件）
       ================================================================== */

    SMALL_WAREHOUSE(Def.infra("小仓库", 400, 3, 3, "🏬", Form.WAREHOUSE, 0xa1887f)
            .service(ServiceType.STOCK_BONUS, 18, 10)
            .depot(40)
            .hint("全岛建筑待运区上限 +10；马车可就近卸货（容量 40）")),

    POST_BOX(Def.infra("邮箱", 60, 1, 1, "📮", Form.POSTBOX, 0x8d6e63)
            .service(ServiceType.TRANSPORT, 6, 2)
            .hint("巷口的信箱 —— 最便宜的一格「交通」覆盖")),

    /* ==================================================================
       二、农夫业态 Farmers
       ================================================================== */

    //                              名称      造价  周期  宽 高  工人
    LUMBERJACK(Def.prod("伐木场", 120, 5, 2, 2, 2).group(Group.FARMERS).free()
            .form(Form.HUT).tint(0x8d6e63).icon("🪵")
            .out(Good.WOOD, 1)),

    CLAY_PIT(Def.mine("黏土矿坑", 110, 6, 2, 2, 2, Good.CLAY).group(Group.WORKERS).free()
            .form(Form.QUARRY).tint(0xbcaaa4).icon("🟤")),

    IRON_MINE(Def.mine("铁矿", 300, 8, 2, 2, 3, Good.IRON).group(Group.WORKERS).free()
            .form(Form.MINEHEAD).tint(0x607d8b).icon("⛏️")),

    SAWMILL(Def.prod("锯木厂", 260, 8, 3, 3, 4).group(Group.FARMERS).free()
            .form(Form.WORKSHOP).tint(0xa1887f).icon("🪚")
            .in(Good.WOOD, 2).out(Good.TIMBER, 1)),

    FISHERY(Def.prod("渔场", 220, 12, 3, 3, 3).group(Group.FARMERS).free()
            .ground(Ground.COAST)
            .form(Form.FISHERY).tint(0x90a4ae).icon("🐟")
            .out(Good.FISH, 3)),

    POTATO_FARM(Def.prod("马铃薯农场", 250, 40, 3, 3, 4).group(Group.FARMERS)
            .form(Form.FARM_FIELD).tint(0x9ccc65).icon("🥔")
            .out(Good.POTATO, 3)),

    SCHNAPPS_DISTILLERY(Def.prod("烈酒厂", 500, 12, 3, 3, 3).group(Group.FARMERS).free()
            .form(Form.FACTORY).tint(0x9ccc65).icon("🍶")
            .in(Good.POTATO, 3).out(Good.SCHNAPPS, 1)),

    SHEEP_FARM(Def.prod("羊场", 300, 45, 3, 3, 3).group(Group.FARMERS)
            .form(Form.FARM_PASTURE).tint(0xcfc7b8).icon("🐑")
            .out(Good.WOOL, 2)),

    FRAMEWORK_KNITTERS(Def.prod("裁缝作坊", 460, 25, 3, 3, 5).group(Group.FARMERS)
            .form(Form.WORKSHOP).tint(0xbcaaa4).icon("🧵")
            .in(Good.WOOL, 2).out(Good.CLOTHES, 1)),

    FARMER_HOUSE(Def.residence("农夫住宅", 240, 2, 2, ResidentTier.FARMER, 24)
            .group(Group.FARMERS).free()
            .form(Form.COTTAGE).tint(0xd7b06a).icon("🏡")),

    /* ==================================================================
       三、工人业态 Workers
       ================================================================== */

    WORKER_HOUSE(Def.residence("工人住宅", 520, 3, 3, ResidentTier.WORKER, 40)
            .group(Group.WORKERS)
            .form(Form.ROWHOUSE).tint(0xc98f5a).icon("🏘️")),

    GRAIN_FARM(Def.prod("粮食农场", 300, 45, 3, 3, 4).group(Group.WORKERS)
            .form(Form.FARM_FIELD).tint(0xd9c04a).icon("🌾")
            .out(Good.GRAIN, 3)),

    MILL(Def.prod("面粉厂", 280, 8, 2, 3, 3).group(Group.WORKERS).free()
            .form(Form.MILL).tint(0xd7ccc8).icon("⚙️")
            .in(Good.GRAIN, 2).out(Good.FLOUR, 1)),

    BAKERY(Def.prod("面包房", 420, 10, 3, 3, 4).group(Group.WORKERS).free()
            .form(Form.WORKSHOP).tint(0xffb74d).icon("🍞")
            .in(Good.FLOUR, 2).out(Good.BREAD, 1)),

    PIG_FARM(Def.prod("猪圈", 280, 40, 3, 3, 3).group(Group.WORKERS)
            .form(Form.FARM_PASTURE).tint(0xd7b0a0).icon("🐖")
            .out(Good.PORK, 3)),

    SLAUGHTERHOUSE(Def.prod("屠宰场", 380, 25, 3, 3, 5).group(Group.WORKERS)
            .form(Form.FACTORY).tint(0xc98a8a).icon("🥓")
            .in(Good.PORK, 2).out(Good.SAUSAGE, 2)),

    RENDERING_WORKS(Def.prod("渲染厂", 420, 25, 3, 3, 4).group(Group.WORKERS)
            .form(Form.FACTORY).tint(0xbcaaa4).icon("🕯️")
            .in(Good.PORK, 2).out(Good.TALLOW, 2)),

    SOAP_FACTORY(Def.prod("肥皂厂", 460, 20, 3, 3, 5).group(Group.WORKERS)
            .form(Form.FACTORY).tint(0xe1f0e8).icon("🧼")
            .in(Good.TALLOW, 2).out(Good.SOAP, 2)),

    CHARCOAL_KILN(Def.prod("炭窑", 320, 15, 3, 3, 4).group(Group.WORKERS)
            .form(Form.KILN).tint(0x4e4a44).icon("🪵")
            .in(Good.WOOD, 2).out(Good.COAL, 1)),

    BRICKWORKS(Def.prod("砖厂", 240, 10, 3, 3, 3).group(Group.WORKERS).free()
            .form(Form.KILN).tint(0xd84315).icon("🧱")
            .in(Good.CLAY, 2).out(Good.BRICK, 1)),

    /** 早期的炼铁：不用煤，但一份铁矿只出一块钢。依赖度高而量少时先用它顶上 */
    FURNACE(Def.prod("炼铁炉", 480, 14, 3, 3, 4).group(Group.WORKERS)
            .form(Form.SMELTER).tint(0x546e7a).icon("🔥")
            .in(Good.IRON, 2).out(Good.STEEL, 1)),

    STEEL_WORKS(Def.prod("钢铁厂", 620, 12, 4, 4, 5).group(Group.WORKERS).free()
            .form(Form.SMELTER).tint(0x546e7a).icon("⚙️")
            .in(Good.IRON, 2).in(Good.COAL, 1).out(Good.STEEL, 2)),

    WEAPON_FACTORY(Def.prod("武器工厂", 900, 30, 4, 3, 6).group(Group.WORKERS)
            .form(Form.ARSENAL).tint(0x455a64).icon("🔫")
            .in(Good.STEEL, 2).out(Good.WEAPON, 1)),

    SAILMAKERS(Def.prod("风帆制造厂", 620, 25, 4, 3, 5).group(Group.WORKERS)
            .form(Form.WORKSHOP).tint(0xeef0e6).icon("⛵")
            .in(Good.WOOL, 2).out(Good.SAIL, 1)),

    MALTHOUSE(Def.prod("麦芽厂", 380, 15, 3, 3, 4).group(Group.WORKERS)
            .form(Form.FACTORY).tint(0xd7c06a).icon("🌾")
            .in(Good.GRAIN, 2).out(Good.MALT, 2)),

    HOP_FARM(Def.prod("啤酒花农场", 340, 45, 3, 3, 4).group(Group.WORKERS)
            .form(Form.PLANTATION).tint(0x6ab04c).icon("🌿")
            .out(Good.HOPS, 2)),

    BREWERY(Def.prod("啤酒厂", 760, 14, 4, 3, 5).group(Group.WORKERS).free()
            .form(Form.FACTORY).tint(0xffca28).icon("🍺")
            .in(Good.MALT, 2).in(Good.HOPS, 2).out(Good.BEER, 2)),

    TEXTILE_MILL(Def.prod("纺织厂", 600, 10, 4, 3, 5).group(Group.WORKERS).free()
            .form(Form.FACTORY).tint(0xe1bee7).icon("🧶")
            .in(Good.COTTON, 2).out(Good.FABRIC, 1)),

    CLOTHING_FACTORY(Def.prod("制衣厂", 900, 14, 4, 4, 6).group(Group.WORKERS).free()
            .form(Form.FACTORY).tint(0xba68c8).icon("👕")
            .in(Good.FABRIC, 1).in(Good.WOOL, 2).out(Good.CLOTHES, 2)),

    /* ==================================================================
       四、工匠业态 Artisans
       ================================================================== */

    ARTISAN_HOUSE(Def.residence("工匠住宅", 900, 3, 3, ResidentTier.ARTISAN, 60)
            .group(Group.ARTISANS)
            .form(Form.TOWNHOUSE).tint(0xc7784f).icon("🏠")),

    RED_PEPPER_FARM(Def.prod("红椒农场", 380, 45, 3, 3, 4).group(Group.ARTISANS)
            .form(Form.FARM_FIELD).tint(0xd84a3a).icon("🌶️")
            .out(Good.RED_PEPPER, 2)),

    CATTLE_FARM(Def.prod("牛场", 420, 45, 3, 3, 4).group(Group.ARTISANS)
            .form(Form.FARM_PASTURE).tint(0xa1887f).icon("🐄")
            .out(Good.BEEF, 2)),

    ARTISANAL_KITCHEN(Def.prod("手工厨房", 720, 25, 3, 3, 6).group(Group.ARTISANS)
            .form(Form.WORKSHOP).tint(0xe57373).icon("🍲")
            .in(Good.SAUSAGE, 2).in(Good.RED_PEPPER, 1).out(Good.GOULASH, 2)),

    CANNERY(Def.prod("罐头厂", 980, 30, 4, 3, 7).group(Group.ARTISANS)
            .form(Form.FACTORY).tint(0xbcaaa4).icon("🥫")
            .in(Good.BEEF, 2).in(Good.RED_PEPPER, 1).out(Good.CANNED_FOOD, 2)),

    SAND_MINE(Def.mine("沙矿", 400, 15, 3, 3, 4, Ground.COAST).group(Group.ARTISANS)
            .form(Form.QUARRY).tint(0xe1d3a0).icon("🏖️")
            .out(Good.SAND, 3)),

    GLASSMAKERS(Def.prod("玻璃厂", 900, 25, 4, 3, 6).group(Group.ARTISANS)
            .form(Form.SMELTER).tint(0xa8dfe8).icon("🪟")
            .in(Good.SAND, 2).in(Good.COAL, 1).out(Good.GLASS, 2)),

    WINDOW_MAKERS(Def.prod("窗户厂", 1100, 25, 4, 3, 6).group(Group.ARTISANS)
            .form(Form.WORKSHOP).tint(0xbfe3ea).icon("🪞")
            .in(Good.GLASS, 2).in(Good.TIMBER, 1).out(Good.WINDOW, 2)),

    COAL_MINE(Def.mine("煤矿", 520, 15, 3, 3, 5, Ground.MOUNTAIN).group(Group.ARTISANS)
            .form(Form.MINEHEAD).tint(0x3e3a37).icon("⛏️")
            .out(Good.COAL, 3)),

    SEWING_MACHINE_FACTORY(Def.prod("缝纫机工厂", 1600, 35, 4, 4, 8).group(Group.ARTISANS)
            .form(Form.FACTORY).tint(0x78909c).icon("🪡")
            .in(Good.STEEL, 2).in(Good.TIMBER, 2).out(Good.SEWING_MACHINE, 1)),

    /* ==================================================================
       五、工程师业态 Engineers
       ================================================================== */

    ENGINEER_HOUSE(Def.residence("工程师住宅", 1500, 3, 3, ResidentTier.ENGINEER, 80)
            .group(Group.ENGINEERS)
            .form(Form.TOWNHOUSE).tint(0x8d99ae).icon("🏢")),

    LIMESTONE_QUARRY(Def.mine("石灰石采石场", 780, 15, 4, 3, 6, Ground.MOUNTAIN).group(Group.ENGINEERS)
            .form(Form.QUARRY).tint(0xded3bb).icon("🪨")
            .out(Good.LIMESTONE, 3)),

    CONCRETE_FACTORY(Def.prod("混凝土厂", 1400, 25, 4, 4, 7).group(Group.ENGINEERS)
            .form(Form.FACTORY).tint(0xbdb9ac).icon("🧱")
            .in(Good.LIMESTONE, 2).in(Good.COAL, 1).out(Good.CONCRETE, 2)),

    OIL_WELL(Def.prod("油井", 1200, 20, 3, 3, 5).group(Group.ENGINEERS)
            .ground(Ground.COAST)
            .form(Form.DERRICK).tint(0x455a64).icon("🛢️")
            .out(Good.OIL, 2)),

    OIL_REFINERY(Def.prod("石油炼制厂", 2200, 30, 5, 4, 10).group(Group.ENGINEERS)
            .form(Form.REFINERY).tint(0x37474f).icon("🏭")
            .in(Good.OIL, 2).out(Good.FUEL, 2)),

    OIL_STORE(Def.infra("石油储存设施", 1200, 3, 3, "🛢️", Form.REFINERY, 0x546e7a)
            .group(Group.ENGINEERS)
            .service(ServiceType.STOCK_BONUS, 20, 15)
            .hint("全岛待运区上限 +15")),

    SMALL_OIL_HARBOR(Def.harbor("小型石油港", 2000, 4, 3).group(Group.ENGINEERS)
            .form(Form.JETTY).tint(0x455a64).icon("🛢️")
            .service(ServiceType.STOCK_BONUS, 18, 20)
            .hint("油料专用泊位：待运区上限 +20")),

    OIL_POWER_PLANT(Def.prod("石油发电厂", 3000, 20, 5, 4, 10).group(Group.ENGINEERS)
            .form(Form.POWER_PLANT).tint(0x455a64).icon("⚡")
            .in(Good.FUEL, 2).out(Good.POWER, 4)
            .service(ServiceType.POWER_SUPPLY, 0, 12)
            .hint("全岛工厂提速 +12%")),

    GAS_FIRED_POWER_PLANT(Def.prod("燃气发电厂", 4200, 18, 5, 5, 12).group(Group.INVESTORS)
            .form(Form.POWER_PLANT).tint(0x37474f).icon("⚡")
            .in(Good.FUEL, 3).out(Good.POWER, 6)
            .service(ServiceType.POWER_SUPPLY, 0, 18)
            .hint("全岛工厂提速 +18%")),

    ZINC_MINE(Def.mine("锌矿", 900, 15, 3, 3, 6, Ground.MOUNTAIN).group(Group.ENGINEERS)
            .form(Form.MINEHEAD).tint(0x90a4ae).icon("⛏️")
            .out(Good.ZINC, 2)),

    COPPER_MINE(Def.mine("铜矿", 900, 15, 3, 3, 6, Ground.MOUNTAIN).group(Group.ENGINEERS)
            .form(Form.MINEHEAD).tint(0xb87333).icon("⛏️")
            .out(Good.COPPER, 2)),

    BRASS_SMELTERY(Def.prod("黄铜冶炼厂", 1900, 25, 4, 4, 8).group(Group.ENGINEERS)
            .form(Form.SMELTER).tint(0xb5a642).icon("🟨")
            .in(Good.ZINC, 1).in(Good.COPPER, 1).out(Good.BRASS, 2)),

    GOLD_MINE(Def.mine("金矿", 2600, 20, 3, 3, 8, Ground.MOUNTAIN).group(Group.INVESTORS)
            .form(Form.MINEHEAD).tint(0xd4af37).icon("⛏️")
            .out(Good.GOLD, 1)),

    SPECTACLE_FACTORY(Def.prod("眼镜厂", 1800, 30, 4, 3, 6).group(Group.ENGINEERS)
            .form(Form.WORKSHOP).tint(0xa8dfe8).icon("👓")
            .in(Good.GLASS, 2).in(Good.BRASS, 1).out(Good.SPECTACLES, 1)),

    BICYCLE_FACTORY(Def.prod("自行车厂", 2400, 35, 4, 4, 8).group(Group.ENGINEERS)
            .form(Form.FACTORY).tint(0x8d6e63).icon("🚲")
            .in(Good.STEEL, 2).in(Good.BRASS, 1).out(Good.BICYCLE, 1)),

    MOTOR_ASSEMBLY_LINE(Def.prod("汽车生产线", 5200, 45, 6, 4, 16).group(Group.ENGINEERS)
            .form(Form.FACTORY).tint(0x607d8b).icon("🚗")
            .in(Good.STEEL, 3).in(Good.BRASS, 2).in(Good.POWER, 2).out(Good.MOTOR, 1)),

    CLOCKMAKERS(Def.prod("钟表厂", 2100, 30, 4, 3, 6).group(Group.ENGINEERS)
            .form(Form.WORKSHOP).tint(0xb0a06a).icon("🕰️")
            .in(Good.BRASS, 2).in(Good.GLASS, 1).out(Good.CLOCK, 1)),

    GOLDSMITHS(Def.prod("金匠", 3200, 35, 3, 3, 6).group(Group.INVESTORS)
            .form(Form.WORKSHOP).tint(0xd4af37).icon("💍")
            .in(Good.GOLD, 1).in(Good.BRASS, 1).out(Good.JEWELRY, 1)),

    FILAMENT_FACTORY(Def.prod("灯丝厂", 1600, 25, 4, 3, 6).group(Group.ENGINEERS)
            .form(Form.FACTORY).tint(0xffd54f).icon("💡")
            .in(Good.ZINC, 2).in(Good.POWER, 1).out(Good.FILAMENT, 2)),

    LIGHT_BULB_FACTORY(Def.prod("电灯泡厂", 2400, 25, 4, 4, 8).group(Group.ENGINEERS)
            .form(Form.FACTORY).tint(0xfff176).icon("💡")
            .in(Good.FILAMENT, 1).in(Good.GLASS, 1).out(Good.LIGHT_BULB, 2)),

    TRACTOR_BARN(Def.infra("拖拉机谷仓", 1800, 3, 3, "🚜", Form.FARM_FIELD, 0x8d6e63)
            .group(Group.ENGINEERS)
            .service(ServiceType.MECH_BONUS, 0, 15)
            .hint("全岛作物生长提速 +15%")),

    RAILWAY(Def.infra("铁路", 2500, 4, 3, "🚉", Form.RAIL_STATION, 0x546e7a)
            .group(Group.ENGINEERS)
            .service(ServiceType.TRANSPORT, 20, 6)
            .hint("通勤 + 货运：交通覆盖与全岛农机加成")),

    STEAM_SHIPYARD(Def.harbor("蒸汽船造船厂", 6000, 5, 4).group(Group.ENGINEERS)
            .form(Form.DRYDOCK).tint(0x546e7a).icon("🛳️")
            .service(ServiceType.MOORING, 0, 3)
            .hint("干船坞：额外停泊位 +3")),

    FUEL_STATION(Def.infra("加油站", 600, 2, 2, "⛽", Form.STORE, 0xd84315)
            .group(Group.ENGINEERS)
            .service(ServiceType.TRANSPORT, 10, 4)
            .hint("马车与通勤的中转点")),

    /* ==================================================================
       六、投资者业态 Investors
       ================================================================== */

    INVESTOR_HOUSE(Def.residence("投资者住宅", 3000, 4, 4, ResidentTier.INVESTOR, 100)
            .group(Group.INVESTORS)
            .form(Form.MANSION).tint(0xe0d3b0).icon("🏰")),

    VINEYARD(Def.prod("葡萄园", 900, 50, 4, 3, 6).group(Group.INVESTORS)
            .form(Form.PLANTATION).tint(0x8e6d9e).icon("🍇")
            .out(Good.GRAPES, 2)),

    CHAMPAGNE_CELLAR(Def.prod("香槟酒窖", 3200, 40, 4, 4, 10).group(Group.INVESTORS)
            .form(Form.FACTORY).tint(0xd9c27e).icon("🍾")
            .in(Good.GRAPES, 2).in(Good.GLASS, 1).out(Good.CHAMPAGNE, 2)),

    COGNAC_WORKSHOP(Def.prod("白兰地工坊", 3000, 40, 4, 3, 8).group(Group.INVESTORS)
            .form(Form.WORKSHOP).tint(0xb98b4f).icon("🥃")
            .in(Good.GRAPES, 3).out(Good.COGNAC, 2)),

    MARQUETRY_WORKSHOP(Def.prod("木工坊", 2200, 30, 4, 3, 8).group(Group.INVESTORS)
            .form(Form.WORKSHOP).tint(0xa0785a).icon("🪑")
            .in(Good.TIMBER, 2).in(Good.CHERRY_WOOD, 1).out(Good.MARQUETRY, 1)),

    JEWELLERS(Def.prod("珠宝厂", 4600, 40, 4, 3, 10).group(Group.INVESTORS)
            .form(Form.WORKSHOP).tint(0xd4af37).icon("💎")
            .in(Good.GOLD, 2).in(Good.MARQUETRY, 1).out(Good.JEWELRY, 3)),

    GRAMOPHONE_FACTORY(Def.prod("留声机工厂", 5600, 45, 5, 4, 14).group(Group.INVESTORS)
            .form(Form.FACTORY).tint(0xb5a642).icon("📻")
            .in(Good.BRASS, 2).in(Good.MARQUETRY, 1).in(Good.POWER, 1).out(Good.GRAMOPHONE, 1)),

    COACHMAKERS(Def.prod("马车厂", 2600, 35, 4, 3, 8).group(Group.INVESTORS)
            .form(Form.WORKSHOP).tint(0x8d6e63).icon("🐎")
            .in(Good.TIMBER, 2).in(Good.STEEL, 1).out(Good.COACH, 1)),

    CAB_ASSEMBLY_LINE(Def.prod("轿车生产线", 7200, 50, 6, 4, 18).group(Group.INVESTORS)
            .form(Form.FACTORY).tint(0x455a64).icon("🚙")
            .in(Good.MOTOR, 1).in(Good.COACH, 1).out(Good.CAB, 1)),

    ELEVATOR_LINE(Def.prod("电梯生产线", 4800, 45, 5, 4, 14).group(Group.INVESTORS)
            .form(Form.FACTORY).tint(0x90a4ae).icon("🛗")
            .in(Good.STEEL, 2).in(Good.CONCRETE, 1).in(Good.POWER, 2).out(Good.ELEVATOR, 1)),

    BISCUIT_LINE(Def.prod("饼干生产线", 2600, 30, 4, 4, 10).group(Group.INVESTORS)
            .form(Form.FACTORY).tint(0xd9b06a).icon("🍪")
            .in(Good.FLOUR, 2).in(Good.SUGAR_CANE, 1).out(Good.BISCUITS, 2)),

    FURNITURE_STORE(Def.prod("家具店", 2200, 30, 4, 3, 8).group(Group.INVESTORS)
            .form(Form.STORE).tint(0xa0785a).icon("🛋️")
            .in(Good.TIMBER, 2).in(Good.FABRIC, 1).out(Good.FURNITURE, 1)),

    TYPEWRITER_LINE(Def.prod("打字机生产线", 3600, 40, 5, 3, 12).group(Group.INVESTORS)
            .form(Form.FACTORY).tint(0x78909c).icon("⌨️")
            .in(Good.STEEL, 2).in(Good.SEWING_MACHINE, 1).out(Good.TYPEWRITER, 1)),

    BILLIARD_TABLES(Def.prod("台球桌工坊", 3900, 40, 4, 3, 10).group(Group.INVESTORS)
            .form(Form.WORKSHOP).tint(0x4e7a55).icon("🎱")
            .in(Good.TIMBER, 2).in(Good.FABRIC, 2).out(Good.BILLIARD_TABLE, 1)),

    VIOLINS(Def.prod("小提琴工坊", 4200, 45, 3, 3, 10).group(Group.INVESTORS)
            .form(Form.WORKSHOP).tint(0xb98b4f).icon("🎻")
            .in(Good.CHERRY_WOOD, 2).in(Good.MARQUETRY, 1).out(Good.VIOLIN, 1)),

    TOYS(Def.prod("玩具工坊", 1800, 25, 4, 3, 8).group(Group.INVESTORS)
            .form(Form.WORKSHOP).tint(0xffb74d).icon("🧸")
            .in(Good.TIMBER, 1).in(Good.FABRIC, 1).out(Good.TOYS, 2)),

    DRUG_STORE(Def.prod("药店", 2400, 30, 3, 3, 8).group(Group.INVESTORS)
            .form(Form.STORE).tint(0xe1f0e8).icon("💊")
            .in(Good.SALTPETRE, 1).in(Good.GLASS, 1).out(Good.DRUGS, 2)),

    ORCHARD_CHERRY(Def.prod("樱桃木果园", 1200, 55, 4, 3, 6).group(Group.INVESTORS)
            .form(Form.ORCHARD).tint(0x8d6e63).icon("🍒")
            .out(Good.CHERRY_WOOD, 2)),

    ORCHARD_RESIN(Def.prod("树脂果园", 1200, 50, 4, 3, 6).group(Group.INVESTORS)
            .form(Form.ORCHARD).tint(0xc9a227).icon("🌲")
            .out(Good.RESIN, 2)),

    LACQUER_WORKS(Def.prod("漆料工坊", 2200, 30, 4, 3, 8).group(Group.INVESTORS)
            .form(Form.FACTORY).tint(0x8e3b2f).icon("🎨")
            .in(Good.RESIN, 2).out(Good.LACQUER, 2)),

    /* ==================================================================
       七、学者 Scholars（Land of Lions）
       ================================================================== */

    SCHOLAR_HOUSE(Def.residence("学者住宅", 2200, 3, 3, ResidentTier.SCHOLAR, 70)
            .group(Group.SCHOLARS)
            .form(Form.TOWNHOUSE).tint(0xb0bec5).icon("🏫")),

    RESEARCH_INSTITUTE(Def.publicService("研究所", 7000, 5, 4, "🔬", Form.COLONNADE, 0xaeb6bf)
            .group(Group.SCHOLARS)
            .service(ServiceType.EDUCATION, 24, 6)
            .hint("高级教育与这片区的智商担当")),

    COFFEE_PLANTATION(Def.prod("咖啡园", 1500, 50, 4, 3, 8).group(Group.SCHOLARS)
            .form(Form.PLANTATION).tint(0x6d4c41).icon("☕")
            .out(Good.COFFEE_BEANS, 3)),

    ADVANCED_COFFEE_ROASTER(Def.prod("高级咖啡烘焙厂", 2800, 30, 4, 4, 10).group(Group.SCHOLARS)
            .form(Form.FACTORY).tint(0x6d4c41).icon("☕")
            .in(Good.COFFEE_BEANS, 2).out(Good.COFFEE, 2)),

    SUGAR_PLANTATION(Def.prod("甘蔗园", 1400, 50, 4, 3, 8).group(Group.SCHOLARS)
            .form(Form.PLANTATION).tint(0xc0ca33).icon("🎋")
            .out(Good.SUGAR_CANE, 3)),

    ADVANCED_RUM_DISTILLERY(Def.prod("高级朗姆酒厂", 3000, 35, 4, 4, 10).group(Group.SCHOLARS)
            .form(Form.FACTORY).tint(0xd84315).icon("🥃")
            .in(Good.SUGAR_CANE, 3).out(Good.RUM, 2)),

    ADVANCED_COTTON_MILL(Def.prod("高级棉纺厂", 2400, 25, 5, 3, 10).group(Group.SCHOLARS)
            .form(Form.FACTORY).tint(0xeef0e6).icon("🧵")
            .in(Good.COTTON, 3).out(Good.FABRIC, 3)),

    BOOTMAKERS(Def.prod("靴厂", 2000, 30, 4, 3, 8).group(Group.SCHOLARS)
            .form(Form.WORKSHOP).tint(0x795548).icon("👢")
            .in(Good.FABRIC, 2).in(Good.TALLOW, 1).out(Good.BOOTS, 2)),

    TAILORS_SHOP(Def.prod("裁缝店", 2600, 35, 4, 3, 8).group(Group.SCHOLARS)
            .form(Form.STORE).tint(0xba68c8).icon("🧥")
            .in(Good.FABRIC, 2).in(Good.SEWING_MACHINE, 1).out(Good.CLOTHES, 3)),

    TELEPHONE_MANUFACTURER(Def.prod("电话工厂", 3600, 40, 4, 4, 12).group(Group.SCHOLARS)
            .form(Form.FACTORY).tint(0x607d8b).icon("📞")
            .in(Good.BRASS, 2).in(Good.FILAMENT, 1).out(Good.TELEPHONE, 1)),

    RADIO_TOWER(Def.publicService("广播塔", 5000, 3, 3, "📡", Form.RADIO_TOWER, 0x90a4ae)
            .group(Group.SCHOLARS)
            .service(ServiceType.CULTURE, 24, 6)
            .hint("开阔的文化与新闻覆盖")),

    /* ==================================================================
       八、游客 Tourists
       ================================================================== */

    HOTEL(Def.residence("酒店", 4000, 4, 4, ResidentTier.TOURIST, 60)
            .group(Group.TOURISTS)
            .form(Form.MANSION).tint(0xe4d5b7).icon("🏨")),

    TOURIST_MOORING(Def.harbor("游客码头", 1200, 3, 3).group(Group.TOURISTS)
            .form(Form.MOORING).tint(0x8d9db6).icon("⚓")
            .service(ServiceType.MOORING, 0, 2)
            .hint("游船泊位 +2")),

    BUS_STOP(Def.infra("公交车站", 300, 2, 2, "🚏", Form.BUS_STOP, 0x607d8b)
            .group(Group.TOURISTS)
            .service(ServiceType.TRANSPORT, 10, 3)
            .hint("最省地方的一格交通覆盖")),

    RESTAURANT(Def.publicService("餐厅", 1500, 3, 3, "🍽️", Form.STORE, 0xd84315)
            .group(Group.TOURISTS)
            .service(ServiceType.LEISURE, 14, 4)
            .hint("游客与市民都爱去的饭点")),

    CAFE(Def.publicService("咖啡馆", 1200, 3, 3, "☕", Form.STORE, 0x8d6e63)
            .group(Group.TOURISTS)
            .service(ServiceType.LEISURE, 12, 4)
            .hint("街角的座位永远坐满")),

    BAR(Def.publicService("酒吧", 1000, 3, 3, "🍻", Form.STORE, 0xd4af37)
            .group(Group.TOURISTS)
            .service(ServiceType.LEISURE, 12, 4)
            .hint("下班后的第一站")),

    JAM_FACTORY(Def.prod("果酱工厂", 1800, 25, 4, 3, 8).group(Group.TOURISTS)
            .form(Form.FACTORY).tint(0xc2185b).icon("🍯")
            .in(Good.GRAPES, 2).in(Good.SUGAR_CANE, 1).out(Good.JAM, 2)),

    SHAMPOO_FACTORY(Def.prod("洗发水化工厂", 2000, 25, 4, 3, 8).group(Group.TOURISTS)
            .form(Form.REFINERY).tint(0x81d4fa).icon("🧴")
            .in(Good.RESIN, 1).in(Good.TALLOW, 1).out(Good.SHAMPOO, 2)),

    LEMONADE_FACTORY(Def.prod("柠檬水工厂", 1800, 25, 4, 3, 8).group(Group.TOURISTS)
            .form(Form.FACTORY).tint(0xfff176).icon("🍋")
            .in(Good.SUGAR_CANE, 2).in(Good.GLASS, 1).out(Good.LEMONADE, 2)),

    SOUVENIR_FACTORY(Def.prod("纪念品工厂", 1600, 25, 4, 3, 8).group(Group.TOURISTS)
            .form(Form.WORKSHOP).tint(0xffb74d).icon("🎁")
            .in(Good.TIMBER, 1).in(Good.FABRIC, 1).out(Good.SOUVENIR, 2)),

    IRON_TOWER(Def.publicService("铁塔", 15000, 4, 4, "🗼", Form.IRON_TOWER, 0x8d8577)
            .group(Group.TOURISTS)
            .service(ServiceType.CULTURE, 30, 8)
            .hint("全岛地标：大片文化覆盖")),

    /* ==================================================================
       九、港口设施 Harbour
       ================================================================== */

    /**
     * 贸易站 = 港口 / 码头：居民的生活物资得先能运上岛，所以**建造宅前必须先有它**。
     * <p>
     * 【必须骑在岸线上】占地里既要有一格陆地、又要有一格水面，大门自动朝向外海而不是马路。
     * 【不必临路】靠船运货，不该逼玩家把公路铺到岛缘。
     */
    TRADING_POST(Def.harbor("贸易站", 600, 3, 3).group(Group.HARBOR).free()
            .form(Form.QUAY_CRANE).tint(0x8d9db6).icon("⚓")
            .service(ServiceType.MOORING, 0, 2)
            .depot(80)
            .hint("贸易与仓储枢纽（居民物资的前提，容量 80）")),

    /**
     * 造船厂：码头类建筑（骑岸线、门朝海），船台队列走 {@code ShipyardService}。
     * 【它不是贸易站】：各处 isTradingPost() 判定把两者区分开。
     */
    SHIPYARD(Def.harbor("造船厂", 1500, 4, 4).group(Group.HARBOR).free()
            .form(Form.DRYDOCK).tint(0x6d8a96).icon("🚢")
            .service(ServiceType.MOORING, 0, 2)
            .hint("岸边的船台 —— 点它开工造船")),

    QUAY(Def.harbor("码头", 200, 2, 2).group(Group.HARBOR).free()
            .form(Form.JETTY).tint(0x8d8577).icon("⚓")
            .service(ServiceType.MOORING, 0, 1)
            .hint("一段石砌栈桥：泊位 +1")),

    DEPOT(Def.harbor("港口仓库", 700, 3, 3).group(Group.HARBOR)
            .form(Form.WAREHOUSE).tint(0x90a4ae).icon("📦")
            .service(ServiceType.STOCK_BONUS, 20, 15)
            .hint("全岛待运区上限 +15")),

    HARBOURMASTERS_OFFICE(Def.harbor("港务长办公室", 900, 3, 3).group(Group.HARBOR)
            .form(Form.HALL).tint(0x78909c).icon("🧭")
            .service(ServiceType.ADMIN, 16, 4)
            .hint("航运调度：行政覆盖")),

    REPAIR_CRANE(Def.harbor("修理起重机", 1400, 3, 3).group(Group.HARBOR)
            .form(Form.QUAY_CRANE).tint(0x546e7a).icon("🏗️")
            .service(ServiceType.MOORING, 0, 2)
            .hint("舾装与修理：泊位 +2")),

    PIER(Def.harbor("突堤码头", 500, 3, 2).group(Group.HARBOR)
            .form(Form.JETTY).tint(0xa1887f).icon("⚓")
            .service(ServiceType.MOORING, 0, 1)
            .hint("伸出去的那一条：泊位 +1")),

    PUBLIC_MOORING(Def.harbor("公共泊位", 300, 2, 2).group(Group.ARTISANS)
            .form(Form.MOORING).tint(0x8d9db6).icon("⚓")
            .service(ServiceType.MOORING, 0, 1)
            .hint("公共停泊：泊位 +1")),

    COMMUTER_PIER(Def.harbor("通勤码头", 1600, 3, 3).group(Group.ENGINEERS)
            .form(Form.MOORING).tint(0x8d9db6).icon("🚤")
            .service(ServiceType.TRANSPORT, 18, 5)
            .hint("跨岛通勤与泊位")),

    DOCKLANDS(Def.harbor("港区", 8000, 5, 5).group(Group.ARTISANS)
            .form(Form.QUAY_CRANE).tint(0x607d8b).icon("🏗️")
            .service(ServiceType.STOCK_BONUS, 24, 25)
            .hint("大港区：待运区上限 +25")),

    /* ==================================================================
       十、公共设施 Public
       ================================================================== */

    MARKETPLACE(Def.publicService("集市", 350, 3, 3, "🏪", Form.STALL, 0xe0a458)
            .group(Group.PUBLIC).free()
            .service(ServiceType.MARKET, 12, 0)
            .hint("农夫也离不开的那块棚子")),

    PUB(Def.publicService("酒馆", 420, 3, 3, "🍺", Form.HALL, 0xd9864a)
            .group(Group.PUBLIC).free()
            .service(ServiceType.LEISURE, 12, 0)
            .hint("下班后的第一站")),

    FIRE_STATION(Def.publicService("消防站", 600, 3, 3, "🚒", Form.HALL, 0xc62828)
            .group(Group.PUBLIC).free()
            .service(ServiceType.SECURITY, 14, 0)
            .hint("住密了就得有人看着火")),

    MODEST_PARK(Def.publicService("小型公园", 250, 3, 3, "🌳", Form.PARK, 0x6da04a)
            .group(Group.PUBLIC).free()
            .service(ServiceType.LEISURE, 10, 0)
            .hint("最便宜的休闲覆盖")),

    CHURCH(Def.publicService("教堂", 1200, 4, 4, "⛪", Form.CHURCH, 0xe4ddd0)
            .group(Group.PUBLIC)
            .service(ServiceType.FAITH, 16, 0)
            .hint("周日的钟声 —— 工匠那一层的硬需求")),

    SCHOOL(Def.publicService("学校", 900, 4, 3, "🏫", Form.SCHOOL, 0xc9a227)
            .group(Group.PUBLIC)
            .service(ServiceType.EDUCATION, 16, 0)
            .hint("识字率：工程师层的来源")),

    POLICE_STATION(Def.publicService("警察局", 800, 4, 3, "🚓", Form.HALL, 0x37474f)
            .group(Group.PUBLIC)
            .service(ServiceType.SECURITY, 16, 0)
            .hint("夜里敢出门的底气")),

    TRADE_UNION(Def.publicService("工会", 1500, 4, 4, "🏛️", Form.HALL, 0xa05a4a)
            .group(Group.PUBLIC)
            .service(ServiceType.ADMIN, 18, 0)
            .hint("工人的自治组织")),

    QUAINT_PARK(Def.publicService("精致公园", 300, 3, 3, "🌷", Form.PARK, 0x7cb342)
            .group(Group.PUBLIC)
            .service(ServiceType.LEISURE, 12, 0)
            .hint("林荫与花坛")),

    TOWN_HALL(Def.publicService("市政厅", 4000, 5, 5, "🏛️", Form.COLONNADE, 0xe0d8c3)
            .group(Group.PUBLIC)
            .service(ServiceType.ADMIN, 20, 0)
            .hint("城市的心脏：投资者的硬需求之一")),

    VARIETY_THEATRE(Def.publicService("剧院", 2200, 4, 4, "🎭", Form.THEATRE, 0x9c4f9c)
            .group(Group.PUBLIC)
            .service(ServiceType.CULTURE, 18, 0)
            .hint("文化与灯红酒绿")),

    UNIVERSITY(Def.publicService("大学", 3500, 5, 4, "🎓", Form.COLONNADE, 0xd0b98a)
            .group(Group.PUBLIC)
            .service(ServiceType.EDUCATION, 22, 0)
            .hint("高等教育")),

    MUSEUM(Def.publicService("博物馆", 3000, 4, 4, "🏺", Form.COLONNADE, 0xd8cbb0)
            .group(Group.PUBLIC)
            .service(ServiceType.CULTURE, 20, 0)
            .hint("藏品与门面")),

    HOSPITAL(Def.publicService("医院", 2600, 4, 4, "🏥", Form.HOSPITAL, 0xeceff1)
            .group(Group.PUBLIC)
            .service(ServiceType.HEALTH, 20, 0)
            .hint("疫病来时不至于整区垮掉")),

    POST_OFFICE(Def.publicService("邮局", 900, 3, 3, "✉️", Form.HALL, 0xd4af37)
            .group(Group.PUBLIC)
            .service(ServiceType.TRANSPORT, 14, 0)
            .hint("信件与包裹的集散点")),

    BANK(Def.publicService("银行", 5000, 4, 3, "🏦", Form.COLONNADE, 0xe0d8c3)
            .group(Group.PUBLIC)
            .service(ServiceType.FINANCE, 20, 15)
            .hint("全岛税收 +15%")),

    BOTANICAL_GARDEN(Def.publicService("植物园", 6000, 5, 5, "🌺", Form.PARK, 0x4f8b52)
            .group(Group.PUBLIC)
            .service(ServiceType.CULTURE, 18, 0)
            .hint("兼具休闲与文化的温室")),

    ELABORATE_PARK(Def.publicService("华丽公园", 1200, 4, 4, "⛲", Form.PARK, 0x66bb6a)
            .group(Group.PUBLIC)
            .service(ServiceType.LEISURE, 14, 0)
            .hint("带喷泉的那一座")),

    ESPLANADE(Def.publicService("滨海大道", 900, 4, 2, "🌊", Form.ESPLANADE, 0xd8cbb0)
            .group(Group.PUBLIC)
            .service(ServiceType.LEISURE, 12, 0)
            .hint("傍晚散步的地方")),

    WORLDS_FAIR(Def.publicService("世界博览会", 20000, 6, 6, "🎡", Form.EXPO, 0xe4d5b7)
            .group(Group.PUBLIC)
            .service(ServiceType.CULTURE, 30, 0)
            .hint("巨型展馆：超大范围文化覆盖")),

    PALACE(Def.publicService("皇宫", 30000, 6, 6, "👑", Form.PALACE, 0xf0e6c8)
            .group(Group.PUBLIC)
            .service(ServiceType.ADMIN, 30, 0)
            .hint("全岛最高行政与文化象征")),

    LOCAL_DEPARTMENT(Def.publicService("地方部门", 4000, 4, 4, "🗂️", Form.HALL, 0xc0b298)
            .group(Group.PUBLIC)
            .service(ServiceType.ADMIN, 18, 0)
            .hint("分部办公：行政覆盖")),

    DEPARTMENT_STORE(Def.publicService("百货商店", 6000, 4, 4, "🛍️", Form.STORE, 0xd7a678)
            .group(Group.PUBLIC)
            .service(ServiceType.FINANCE, 22, 20)
            .hint("全岛税收 +20%")),

    MEMBERS_CLUB(Def.publicService("会员俱乐部", 7000, 4, 4, "🥂", Form.MANSION, 0x9c7046)
            .group(Group.PUBLIC)
            .service(ServiceType.LEISURE, 24, 0)
            .hint("不对外开放的那扇门")),

    SKYLINE_TOWER(Def.publicService("天际线塔", 25000, 5, 5, "🏙️", Form.SKYSCRAPER, 0xb0bec5)
            .group(Group.PUBLIC)
            .service(ServiceType.CULTURE, 25, 0)
            .hint("地标：文化与行政双象征")),

    SKYSCRAPER(Def.publicService("摩天大楼", 28000, 5, 5, "🌆", Form.SKYSCRAPER, 0x90a4ae)
            .group(Group.PUBLIC)
            .service(ServiceType.ADMIN, 25, 0)
            .hint("直上云霄的行政中心")),

    /* ==================================================================
       十一、军事 Military
       ================================================================== */

    MOUNTED_GUNS(Def.military("炮台", 1800, 3, 3, "🔫", Form.GUN_BATTERY, 0x546e7a).coastal()
            .group(Group.MILITARY)
            .service(ServiceType.DEFENSE, 16, 10)
            .hint("架在岸炮位上的一门炮")),

    CANNON_TOWER(Def.military("炮塔", 2600, 3, 3, "🗼", Form.TOWER_GENERIC, 0x607d8b).coastal()
            .group(Group.MILITARY)
            .service(ServiceType.DEFENSE, 18, 14)
            .hint("转台式的要塞炮塔")),

    FLAK_EMPLACEMENT(Def.military("防空设施", 2400, 3, 3, "🎯", Form.GUN_BATTERY, 0x78909c)
            .group(Group.MILITARY)
            .service(ServiceType.DEFENSE, 14, 8)
            .hint("仰角 85 度的那一门")),

    FLAME_TOWER(Def.military("火焰塔", 3200, 3, 3, "🔥", Form.TOWER_GENERIC, 0x8e3b2f)
            .group(Group.MILITARY)
            .service(ServiceType.DEFENSE, 16, 12)
            .hint("夜里也烧着的塔")),

    BOMB_FACTORY(Def.prod("炸弹工厂", 3200, 35, 4, 4, 10).group(Group.MILITARY)
            .form(Form.ARSENAL).tint(0x455a64).icon("💣")
            .in(Good.WEAPON, 1).in(Good.DYNAMITE, 1).out(Good.BOMB, 1)),

    SEA_MINE_FACTORY(Def.prod("海雷工厂", 3600, 35, 4, 4, 10).group(Group.MILITARY)
            .ground(Ground.COAST)
            .form(Form.ARSENAL).tint(0x37474f).icon("⚓")
            .in(Good.BOMB, 1).in(Good.STEEL, 2).out(Good.SEA_MINE, 1)),

    SALTPETRE_WORKS(Def.prod("硝石厂", 1800, 25, 4, 3, 8).group(Group.MILITARY)
            .form(Form.FACTORY).tint(0xded3bb).icon("🧂")
            .in(Good.LIMESTONE, 2).in(Good.COAL, 1).out(Good.SALTPETRE, 2)),

    DYNAMITE_FACTORY(Def.prod("炸药厂", 2400, 30, 4, 4, 10).group(Group.MILITARY)
            .form(Form.FACTORY).tint(0xd84315).icon("🧨")
            .in(Good.SALTPETRE, 2).in(Good.STEEL, 1).out(Good.DYNAMITE, 1)),

    HEAVY_WEAPONS_FACTORY(Def.prod("重型武器工厂", 5200, 45, 5, 5, 14).group(Group.MILITARY)
            .form(Form.ARSENAL).tint(0x455a64).icon("🛡️")
            .in(Good.DYNAMITE, 1).in(Good.WEAPON, 2).out(Good.HEAVY_WEAPON, 1)),

    ANTI_ARMOUR_GUN(Def.military("反装甲炮", 3800, 3, 3, "🛡️", Form.GUN_BATTERY, 0x546e7a)
            .group(Group.MILITARY)
            .service(ServiceType.DEFENSE, 18, 16)
            .hint("炮口对着装甲舰的那门炮")),

    BIG_BETTY(Def.military("巨炮 Betty", 12000, 4, 4, "💥", Form.BIG_GUN, 0x37474f)
            .group(Group.MILITARY)
            .service(ServiceType.DEFENSE, 24, 30)
            .hint("一发决定胜负的超大口径"));

    /* ==================================================================
       下面都是"元数据"：kind / 分组 / 外观 / 服务 / 解锁 / 地形
       ================================================================== */

    /** 建筑用途：决定它参不参与生产心跳、要不要特殊落地规则、客户端怎么展示它 */
    public enum Kind {
        /** 生产型：按配方消耗原料产出成品 */
        PRODUCTION,
        /** 住宅型：提供某一阶层的居住容量，本身不生产任何东西 */
        RESIDENCE,
        /** 港口型：骑岸线、门朝海、不必临路（贸易站 / 造船厂 / 码头类） */
        HARBOR,
        /** 公共设施：不带配方，靠服务半径给居民供应 Amenity */
        PUBLIC,
        /** 军事设施：提供安防服务；炮台类同样要骑在岸线上 */
        MILITARY
    }

    /**
     * 建造菜单的分组 —— 也就是客户端底部那排"阶层 / 类别"标签的来源。
     * <p>
     * 【为什么vänt了 tier 字段】纪元1800 的建造菜单就是按"这一层人解锁了什么"排的：
     * 农夫成为你的第一批人之后，整份"工人业态"才会亮起来。所以每个分组绑一个阶层，
     * 这座组里所有建筑默认继承该阶层的解锁门槛（个别建筑可以用
     * {@link Def#free()} 豁免—— 例如铁矿黏土这类早期就必须能开的建筑）。
     */
    public enum Group {
        INFRA    ("基础设施", "🛠️", null),
        FARMERS  ("农夫",   "🧑‍🌾", ResidentTier.FARMER),
        WORKERS  ("工人",   "⚒️", ResidentTier.WORKER),
        ARTISANS ("工匠",   "🎩", ResidentTier.ARTISAN),
        ENGINEERS("工程师", "🎓", ResidentTier.ENGINEER),
        INVESTORS("投资者", "💼", ResidentTier.INVESTOR),
        SCHOLARS ("学者",   "📚", ResidentTier.SCHOLAR),
        TOURISTS ("游客",   "🧳", ResidentTier.TOURIST),
        PUBLIC   ("公共",   "🏛️", null),
        HARBOR   ("港口",   "⚓", null),
        MILITARY ("军事",   "⚔️", ResidentTier.WORKER);

        private final String label;
        private final String icon;
        private final ResidentTier tier;

        Group(String label, String icon, ResidentTier tier) {
            this.label = label;
            this.icon = icon;
            this.tier = tier;
        }

        public String getLabel() { return label; }
        public String getIcon() { return icon; }
        /** 这个分组属于哪个阶层（null = 不属于任何阶层，自行在 Def 里定门槛） */
        public ResidentTier getTier() { return tier; }
    }

    /**
     * 外观形态：客户端 {@code proc-buildings.js} 照它拼三维体块。
     * <p>
     * 一百多座建筑不可能座座做模型，但也不该全是"一个盒子加一个屋顶"。
     * 所以这里把外观拆成几十个可复用的<b>形制</b>：同样是 3×3，
     * 面包房是斜顶作坊、教堂是尖塔、砖厂是圆锥窑、公园是树+喷泉 ——
     * 隔一条街就能认出"那座是干什么用的"，之后某个民居有了真模型再逐个替换。
     */
    public enum Form {
        HUT, COTTAGE, ROWHOUSE, TOWNHOUSE, MANSION,
        WORKSHOP, FACTORY, SMELTER, KILN, MILL, REFINERY, POWER_PLANT, ARSENAL, DERRICK,
        MINEHEAD, QUARRY,
        FARM_FIELD, FARM_PASTURE, ORCHARD, PLANTATION, FISHERY,
        STALL, STORE, HALL, COLONNADE, CHURCH, SCHOOL, HOSPITAL, THEATRE,
        PARK, ESPLANADE, TOWER_GENERIC, RADIO_TOWER, IRON_TOWER, SKYSCRAPER, PALACE, EXPO,
        WAREHOUSE, QUAY_CRANE, JETTY, MOORING, DRYDOCK,
        GUN_BATTERY, BIG_GUN,
        RAIL_STATION, BUS_STOP, POSTBOX
    }

    /**
     * 落地地形约束。
     * <p>
     * 【为什么不止"矿脉"】扩表之后出现了一批"只能建在某类地形上"的建筑：
     * 采石场要依山、沙矿渔场要贴岸、 Trad 油井干脆要伸进海里。
     * 把这三种写成一个枚举，落地校验里就只有一处分支要考虑"它挑地"。
     */
    public enum Ground {
        /** 平原随意（绝大多数厂房） */
        ANY,
        /** 占地必须压在对应矿脉上（铁矿 / 黏土） */
        ORE,
        /** 占地至少要压到一格山地（采石场 / 煤矿 / 金矿） */
        MOUNTAIN,
        /** 占地至少要压到一格海岸沙滩（沙矿 / 渔场 / 油井） */
        COAST
    }

    private final String label;
    /** 建造成本（金币） */
    private final int buildCost;
    /** 一轮生产耗时（游戏秒） */
    private final int durationSeconds;
    /** 占地宽度（格，x 方向） */
    private final int sizeW;
    /** 占地高度（格，z 方向） */
    private final int sizeH;
    /** 输入配方：商品 -> 数量 */
    private final Map<Good, Integer> inputs;
    /** 输出配方：商品 -> 数量 */
    private final Map<Good, Integer> outputs;
    /** 用途：生产 / 住宅 / 港口 / 公共 / 军事 */
    private final Kind kind;
    /** 住宅容纳的是哪个阶层（非住宅为 null） */
    private final ResidentTier residentTier;
    /** 住宅能住多少人（非住宅为 0） */
    private final int residentCapacity;
    /** 建造门槛：前置阶层与所需人口；null 表示从一开始就能建 */
    private final ResidentTier requiredTier;
    private final int requiredPopulation;
    /** 开工所需工人数（生产型建筑从全岛人口里分配） */
    private final int workers;
    /** 必须压在哪种矿脉上才能建（null = 不挑矿脉，普通厂房都是这种） */
    private final Good ore;
    /** 挑哪种地形（见 {@link Ground}） */
    private final Ground ground;
    /** 是不是像码头那样必须骑岸线（Jetty-type 的 HARBOR / 岸炮） */
    private final boolean coastal;
    /** 建造菜单分组 */
    private final Group group;
    /** 外观形制（客户端程序化建模用） */
    private final Form form;
    /** 外观主色（客户端程序化建模用） */
    private final int tint;
    /** 建造卡上的图标 */
    private final String icon;
    /** 一句话说明（没有配方时客户端打在卡上） */
    private final String hint;
    /** 提供的公共服务（null = 不提供） */
    private final ServiceType service;
    /** 服务半径（格；0 = 全岛生效，只用于 stock/power/mech/mooring 这类加成） */
    private final int serviceRadius;
    /** 服务强度：税率百分比 / 待运区格数 / 生产提速百分比 / 泊位数 —— 含义随 service 而定 */
    private final int serviceValue;
    /** 仓库容量（单位货）：马车卸货入库时玩家总囤货不能超过全岛仓库容量之和（0 = 不是仓库） */
    private final int depotCapacity;

    BuildingType(Def d) {
        this.label = d.label;
        this.buildCost = d.cost;
        this.durationSeconds = d.duration;
        this.sizeW = d.w;
        this.sizeH = d.h;
        this.workers = d.workers;
        this.inputs = new LinkedHashMap<>(d.inputs);
        this.outputs = new LinkedHashMap<>(d.outputs);
        this.kind = d.kind;
        this.residentTier = d.tier;
        this.residentCapacity = d.capacity;
        this.ore = d.ore;
        this.ground = d.ground;
        this.coastal = d.coastal || d.kind == Kind.HARBOR;
        this.group = d.group == null ? Group.INFRA : d.group;
        this.form = d.form == null ? Form.FACTORY : d.form;
        this.tint = d.tint;
        this.icon = d.icon == null ? "🏗️" : d.icon;
        this.hint = d.hint;
        this.service = d.service;
        this.serviceRadius = d.radius;
        this.serviceValue = d.value;
        this.depotCapacity = d.depotCapacity;

        // 解锁门槛：Def 里显式指定优先；否则继承**分组所属阶层**的门槛；
        // .free() 显式豁免（那些从第一分钟就该能开的建筑）。
        ResidentTier gate = null;
        int pop = 0;
        if (d.free) {
            gate = null; pop = 0;
        } else if (d.requiredTier != null) {
            gate = d.requiredTier; pop = Math.max(0, d.requiredPopulation);
        } else if (this.group.getTier() != null && this.group.getTier().getRequiredTier() != null) {
            gate = this.group.getTier().getRequiredTier();
            pop = this.group.getTier().getRequiredPopulation();
        } else {
            Gate extra = Gates.MAP.get(name());
            if (extra != null) { gate = extra.tier(); pop = extra.population(); }
        }
        this.requiredTier = gate;
        this.requiredPopulation = pop;
    }

    public String getLabel() { return label; }
    public int getBuildCost() { return buildCost; }
    public int getDurationSeconds() { return durationSeconds; }
    /** 未旋转时的占地宽（图鉴下发用；实际落地占地请走 effSizeW(rotation)） */
    public int getSizeW() { return sizeW; }
    /** 未旋转时的占地高 */
    public int getSizeH() { return sizeH; }
    /** 占地格数（客户端面板显示"占地 N 格"）—— 旋转 90° 不改变格数 */
    public int getSizeCells() { return sizeW * sizeH; }
    public Map<Good, Integer> getInputs() { return inputs; }
    public Map<Good, Integer> getOutputs() { return outputs; }

    /* ---------------- 建造材料（纪元1800式：房子不只要钱，还要木头） ---------------- */

    /**
     * 建造材料表：**全部建筑收料**，按分组定材料、按造价定数量，公式派生 ——
     * 154 座零手填，想调只改 {@link #buildGoodsTable()} 一处。
     * <ul>
     *   <li>农夫档 + 基础设施 → 木材 {@code max(2, round(造价/50))}（FARMER_HOUSE 240→5木）；</li>
     *   <li>工人及以上 / 港口 / 公共 / 军事 → 木板 {@code max(3, round(造价/60))}（WORKER_HOUSE 520→9木板）；</li>
     *   <li>豁免：贸易站（第一座建筑，前置）与伐木场（木材自举链起点）—— 只扣钱，和纪元1800一致。</li>
     * </ul>
     * <p>
     * 【初始化时序】静态字段在所有 enum 常量构造完之后才按声明序初始化（同 {@link Gates} 的坑），
     * 所以本字段必须声明在 enum 常量之后，{@code values()} 在这里拿到的才是全量表。
     */
    private static final Map<BuildingType, Map<Good, Integer>> BUILD_GOODS = buildGoodsTable();

    private static Map<BuildingType, Map<Good, Integer>> buildGoodsTable() {
        Map<BuildingType, Map<Good, Integer>> m = new LinkedHashMap<>();
        for (BuildingType t : values()) {
            if (t == TRADING_POST || t == LUMBERJACK) continue;
            boolean raw = t.group == Group.FARMERS || t.group == Group.INFRA;
            Good mat = raw ? Good.WOOD : Good.TIMBER;
            int qty = Math.max(raw ? 2 : 3,
                    (int) Math.round(t.buildCost / (raw ? 50.0 : 60.0)));
            m.put(t, Map.of(mat, qty));
        }
        return m;
    }

    /** 建造时要付的材料（不可变；豁免建筑返回空表） */
    public Map<Good, Integer> getBuildGoods() {
        Map<Good, Integer> m = BUILD_GOODS.get(this);
        return m == null ? Map.of() : m;
    }

    /* ---------------- 用途与居民 ---------------- */

    public Kind getKind() { return kind; }

    /** 是否按配方生产：世界心跳只推进生产型建筑，其余必须跳过（否则周期 0 会空转） */
    public boolean isProduction() { return kind == Kind.PRODUCTION; }
    public boolean isResidence() { return kind == Kind.RESIDENCE; }
    public boolean isHarbor() { return kind == Kind.HARBOR; }
    public boolean isPublic() { return kind == Kind.PUBLIC; }
    public boolean isMilitary() { return kind == Kind.MILITARY; }

    /**
     * 是不是贸易站本站。HARBOR 类里还有造船厂 / 码头 / 泊位 —— "居民物资能上岛的前提"、
     * NPC 商船挂靠、马车入库这些语义<b>只属于贸易站</b>，别拿 isHarbor() 去判。
     */
    public boolean isTradingPost() { return this == TRADING_POST; }

    /**
     * 是不是<b>仓库类建筑</b>（贸易站 + 仓库）：马车的合法收货点 ——
     * 派车按"路网距离最近"挑一个，而不是无脑去贸易站。
     * 以后加新仓库建筑（大仓库 / 贸易港）改这一处就行。
     */
    public boolean isDepot() { return depotCapacity > 0; }

    /** 仓库容量（单位货）：0 = 不是仓库。玩家总囤货上限 = 全部岛的全部 {@link #isDepot()} 容量之和 */
    public int getDepotCapacity() { return depotCapacity; }

    /** 住宅容纳的阶层（非住宅为 null） */
    public ResidentTier getResidentTier() { return residentTier; }

    /** 住宅容量：一座能住多少人（非住宅为 0）。容量与朝向无关，旋转不改变它 */
    public int getResidentCapacity() { return residentCapacity; }

    /** 解锁的前置阶层（null = 无门槛） */
    public ResidentTier getRequiredTier() { return requiredTier; }

    /** 前置阶层需要在岛上住够多少人（0 = 无门槛） */
    public int getRequiredPopulation() { return requiredPopulation; }

    /**
     * 【兼容旧调用】原来只有"要多少农夫"这一个门槛，
     * 现在门槛可以挂在任意阶层上，这里把"要看农夫人口"的情况照旧返回。
     */
    public int getRequiredFarmerPopulation() {
        return requiredTier == ResidentTier.FARMER ? requiredPopulation : 0;
    }

    /** 开工所需工人数（0 = 不需要：住宅 / 港口 / 公共设施） */
    public int getWorkers() { return workers; }

    /** 必须压在哪种矿脉上才能建（null = 普通厂房，不挑地） */
    public Good getOre() { return ore; }

    /** 是不是采掘类：占地必须压到对应矿脉上 */
    public boolean requiresOre() { return ore != null; }

    /** 挑哪种地形（见 {@link Ground}） */
    public Ground getGround() { return ground; }

    /** 必须压到山地？ */
    public boolean requiresMountain() { return ground == Ground.MOUNTAIN; }

    /** 必须压到海岸沙滩？ */
    public boolean requiresCoast() { return ground == Ground.COAST; }

    /** 挑地的总开关（客户端 Nexus 需要在预览里提前拦掉） */
    public boolean hasTerrainRule() { return ground != Ground.ANY; }

    /** 要不要像码头那样骑岸线（允许压水、免临路） */
    public boolean isCoastal() { return coastal; }

    /* ---------------- 外观与分组 ---------------- */

    public Group getGroup() { return group; }
    public Form getForm() { return form; }
    public int getTint() { return tint; }
    public String getIcon() { return icon; }
    public String getHint() { return hint; }

    /* ---------------- 公共服务 ---------------- */

    public ServiceType getService() { return service; }
    public int getServiceRadius() { return serviceRadius; }
    public int getServiceValue() { return serviceValue; }
    public boolean providesService() { return service != null; }

    /* ---------------- 静态工具：按带效用分组索引 ---------------- */

    /** 某个分组里的全部建筑（客户端建造菜单按它渲染分页） */
    public static List<BuildingType> inGroup(Group group) {
        List<BuildingType> out = new ArrayList<>();
        for (BuildingType t : values()) if (t.group == group) out.add(t);
        return out;
    }

    /** 某个阶层名下的住宅（多个 -> null 时也返回空表） */
    public static List<BuildingType> residencesOf(ResidentTier tier) {
        List<BuildingType> out = new ArrayList<>();
        for (BuildingType t : values()) if (t.isResidence() && t.residentTier == tier) out.add(t);
        return out;
    }

    /** 提供某项服务的全部建筑 */
    public static Set<BuildingType> providersOf(ServiceType service) {
        Set<BuildingType> out = EnumSet.noneOf(BuildingType.class);
        for (BuildingType t : values()) if (t.service == service) out.add(t);
        return out;
    }

    /* ==================================================================
       朝向（rotation）：0=门朝南(+z) / 90=门朝东(+x) / 180=门朝北(-z) / 270=门朝西(-x)
       —— 同时也是"这把厂房怎么摆"：90°/270° 会把占地宽高对调，
       所以 4×3 的纺织厂既能横着摆（占 4×3）也能竖着摆（占 3×4）。
       锚点 (ax, az) 始终是**旋转后那块占地**的左上角，这样 cells/covers
       的逻辑与不旋转时完全一致，只是宽高换了个来源。
       ================================================================== */

    /** 把任意角度归一化到 0 / 90 / 180 / 270（null 当作 0；-90 当作 270） */
    public static int normalizeRotation(Integer degrees) {
        if (degrees == null) return 0;
        int r = ((degrees % 360) + 360) % 360;
        return (int) (Math.round(r / 90.0) % 4) * 90;
    }

    /** 该朝向下占地是否宽高对调 */
    public static boolean isQuarterTurn(int rotation) {
        return normalizeRotation(rotation) % 180 != 0;
    }

    /** 该朝向下的实际占地宽（格） */
    public int effSizeW(int rotation) {
        return isQuarterTurn(rotation) ? sizeH : sizeW;
    }

    /** 该朝向下的实际占地高（格） */
    public int effSizeH(int rotation) {
        return isQuarterTurn(rotation) ? sizeW : sizeH;
    }

    /** 该朝向下占地覆盖的格子数（与朝向无关，恒等于 sizeW × sizeH） */
    public int effSizeCells(int rotation) {
        return effSizeW(rotation) * effSizeH(rotation);
    }

    /**
     * 旋转后的一对宽高 —— 静态版，给"手里只有基准尺寸、还没有建筑实体"的地方用
     * （例如建港口前先按各朝向给"哪一侧外面是水"打分）。
     */
    public static int effW(int baseW, int baseH, int rotation) {
        return isQuarterTurn(rotation) ? baseH : baseW;
    }

    /** 见 {@link #effW(int, int, int)} */
    public static int effH(int baseW, int baseH, int rotation) {
        return isQuarterTurn(rotation) ? baseW : baseH;
    }

    /** 以 (ax, az) 为左上角、按 rotation 摆放时，这块占地覆盖的格子（x 为主序） */
    public List<int[]> cells(int ax, int az, int rotation) {
        int w = effSizeW(rotation), h = effSizeH(rotation);
        List<int[]> out = new ArrayList<>(w * h);
        for (int x = ax; x < ax + w; x++) {
            for (int z = az; z < az + h; z++) out.add(new int[]{x, z});
        }
        return out;
    }

    /**
     * 以 (ax, az) 为左上角、按 rotation 摆放时，(x, z) 是否落在它的占地里。
     * 建造校验用它做整块冲突判定，修路/播种校验用它查"这格是不是被建筑压着"。
     */
    public boolean covers(int ax, int az, int rotation, int x, int z) {
        int w = effSizeW(rotation), h = effSizeH(rotation);
        return x >= ax && x < ax + w && z >= az && z < az + h;
    }

    /** 两块占地矩形是否有重叠（同为左上角锚点，bw×bh 是对方**旋转后**的占地） */
    public boolean overlaps(int ax, int az, int rotation, int bx, int bz, int bw, int bh) {
        int w = effSizeW(rotation), h = effSizeH(rotation);
        return ax < bx + bw && bx < ax + w && az < bz + bh && bz < az + h;
    }

    /**
     * 占地矩形 (ax, az, w, h) 的外圈是否包含 (x, z)。
     * 判定"建筑是否临路"用：外圈任意一格是马路就能建，4×4 的大厂贴一条边即可，不必四面环街。
     */
    public static boolean perimeterHas(int ax, int az, int w, int h, int x, int z) {
        boolean onRing = (x == ax - 1 || x == ax + w) || (z == az - 1 || z == az + h);
        if (!onRing) return false;
        return x >= ax - 1 && x <= ax + w && z >= az - 1 && z <= az + h;
    }

    /**
     * 占地外圈上的某个格子属于哪一侧 —— 0=南(+z) / 1=东(+x) / 2=北(-z) / 3=西(-x)；不在"边"上返回 -1。
     * <p>
     * 乘 90 就是"门开在这一侧"的朝向角度，也就是"大门吸附到旁边那条马路"的返回值来源。
     * <p>
     * 【与 {@link #perimeterHas} 的区别】这里**不含四个角格** —— 判定"临路"时角格也算数
     * （斜对角有路就算靠得上），但门只能开在一条**边**上，角格没有可以朝向的边，
     * 所以这里返回 -1，交给下一个候选朝向或被下游忽略。
     */
    public static int perimeterSideOf(int ax, int az, int w, int h, int x, int z) {
        if (z == az + h && x >= ax && x < ax + w) return 0;   // 南
        if (x == ax + w && z >= az && z < az + h) return 1;   // 东
        if (z == az - 1 && x >= ax && x < ax + w) return 2;   // 北
        if (x == ax - 1 && z >= az && z < az + h) return 3;   // 西
        return -1;
    }

    public static BuildingType of(String name) {
        return BuildingType.valueOf(name.trim().toUpperCase());
    }

    /* ==================================================================
       Def：一个建筑该写哪些字段，全在这口建造器里，
       这样枚举常量每行只留"肉眼可读的那几个词"，改数值不用在构造签名里数逗号。
       ================================================================== */
    /**
     * 「不分阶层」的三个类别（公共 / 港口 / 军事）里，少数建筑的门槛只能逐个写死：
     * 集市与消防站开局就该有，但教堂、市政厅、皇宫必须一层层往上解锁。
     * 键是建筑常量名，值是"要看哪个阶层住够多少人"。
     * <p>
     * 【为什么不写进 Def】这些建筑分布在三处不同的静态工厂里，逐个补 {@code .unlock()}
     * 会让那几行变得又长又难读；集中成一张表，一眼就能看清"这一层解锁了哪些公共设施"。
     */
    /* 【为什么这张表装在嵌套类里】枚举的静态字段要等<b>所有常量构造完</b>才初始化，
       构造函数里直接读 EXTRA_GATES 会读到 null。放进嵌套类后，第一次用到它时才初始化，
       而它自己不依赖 BuildingType 的任何常量 —— 于是"构造函数里查表"这件事是安全的。 */
    private static final class Gates {
    static final Map<String, Gate> MAP = Map.ofEntries(
            Map.entry("CHURCH",             new Gate(ResidentTier.FARMER, 120)),
            Map.entry("SCHOOL",             new Gate(ResidentTier.FARMER, 120)),
            Map.entry("POLICE_STATION",     new Gate(ResidentTier.FARMER, 120)),
            Map.entry("TRADE_UNION",        new Gate(ResidentTier.FARMER, 120)),
            Map.entry("QUAINT_PARK",        new Gate(ResidentTier.FARMER, 120)),
            Map.entry("DEPOT",              new Gate(ResidentTier.FARMER, 120)),
            Map.entry("POST_OFFICE",        new Gate(ResidentTier.WORKER, 200)),
            Map.entry("HOSPITAL",           new Gate(ResidentTier.WORKER, 200)),
            Map.entry("HARBOURMASTERS_OFFICE", new Gate(ResidentTier.WORKER, 200)),
            Map.entry("REPAIR_CRANE",       new Gate(ResidentTier.WORKER, 200)),
            Map.entry("TOWN_HALL",          new Gate(ResidentTier.ARTISAN, 300)),
            Map.entry("VARIETY_THEATRE",    new Gate(ResidentTier.ARTISAN, 300)),
            Map.entry("UNIVERSITY",         new Gate(ResidentTier.ARTISAN, 300)),
            Map.entry("MUSEUM",             new Gate(ResidentTier.ARTISAN, 300)),
            Map.entry("BANK",               new Gate(ResidentTier.ARTISAN, 300)),
            Map.entry("ESPLANADE",          new Gate(ResidentTier.ARTISAN, 300)),
            Map.entry("ELABORATE_PARK",     new Gate(ResidentTier.ARTISAN, 300)),
            Map.entry("BOTANICAL_GARDEN",   new Gate(ResidentTier.ENGINEER, 400)),
            Map.entry("LOCAL_DEPARTMENT",   new Gate(ResidentTier.ENGINEER, 400)),
            Map.entry("DEPARTMENT_STORE",   new Gate(ResidentTier.ENGINEER, 400)),
            Map.entry("MEMBERS_CLUB",       new Gate(ResidentTier.ENGINEER, 400)),
            Map.entry("WORLDS_FAIR",        new Gate(ResidentTier.ENGINEER, 400)),
            Map.entry("PALACE",             new Gate(ResidentTier.ENGINEER, 400)),
            Map.entry("SKYLINE_TOWER",      new Gate(ResidentTier.ENGINEER, 400)),
            Map.entry("SKYSCRAPER",         new Gate(ResidentTier.ENGINEER, 400)));
    }

    /** 见 {@link Gates}：一座建筑的解锁门槛（前置阶层 + 需要住够多少人） */
    private record Gate(ResidentTier tier, int population) { }

    public static final class Def {

        final String label;
        final int cost;
        final int duration;
        final int w, h, workers;
        final Map<Good, Integer> inputs = new LinkedHashMap<>();
        final Map<Good, Integer> outputs = new LinkedHashMap<>();
        final Kind kind;
        ResidentTier tier;
        int capacity;
        Good ore;
        Ground ground = Ground.ANY;
        boolean coastal;
        Group group;
        Form form;
        int tint = 0x90a4ae;
        String icon;
        String hint;
        ServiceType service;
        int radius;
        int value;
        int depotCapacity;
        ResidentTier requiredTier;
        int requiredPopulation;
        boolean free;

        private Def(String label, int cost, int duration, int w, int h, int workers, Kind kind) {
            this.label = label;
            this.cost = cost;
            this.duration = duration;
            this.w = w;
            this.h = h;
            this.workers = workers;
            this.kind = kind;
        }

        /** 生产型：带配方 */
        public static Def prod(String label, int cost, int duration, int w, int h, int workers) {
            return new Def(label, cost, duration, w, h, workers, Kind.PRODUCTION);
        }

        /** 采掘（压矿脉） */
        public static Def mine(String label, int cost, int duration, int w, int h, int workers, Good ore) {
            Def d = new Def(label, cost, duration, w, h, workers, Kind.PRODUCTION);
            d.ore = ore;
            d.ground = Ground.ORE;
            return d;
        }

        /** 采石 / 矿井 / 露天开采：必须压到山地或海岸 */
        public static Def mine(String label, int cost, int duration, int w, int h, int workers, Ground ground) {
            Def d = new Def(label, cost, duration, w, h, workers, Kind.PRODUCTION);
            d.ground = ground;
            return d;
        }

        /** 住宅 */
        public static Def residence(String label, int cost, int w, int h, ResidentTier tier, int capacity) {
            Def d = new Def(label, cost, 0, w, h, 0, Kind.RESIDENCE);
            d.tier = tier;
            d.capacity = capacity;
            return d;
        }

        /** 码头类：骑岸线、门朝海 */
        public static Def harbor(String label, int cost, int w, int h) {
            return new Def(label, cost, 0, w, h, 0, Kind.HARBOR);
        }

        /** 公共设施：主轴是服务半径 */
        public static Def publicService(String label, int cost, int w, int h, String icon, Form form, int tint) {
            Def d = new Def(label, cost, 0, w, h, 0, Kind.PUBLIC);
            d.icon = icon;
            d.form = form;
            d.tint = tint;
            return d;
        }



    /** 基础设施 / 加成设施（自带 service 的那种，可能还带配方——看后续是否调 prod 风格方法） */
        public static Def infra(String label, int cost, int w, int h, String icon, Form form, int tint) {
            Def d = new Def(label, cost, 0, w, h, 0, Kind.PUBLIC);
            d.icon = icon;
            d.form = form;
            d.tint = tint;
            return d;
        }

        /** 军事设施 */
        public static Def military(String label, int cost, int w, int h, String icon, Form form, int tint) {
            Def d = new Def(label, cost, 0, w, h, 0, Kind.MILITARY);
            d.icon = icon;
            d.form = form;
            d.tint = tint;
            return d;
        }

        public Def in(Good g, int qty) { inputs.put(g, qty); return this; }
        public Def out(Good g, int qty) { outputs.put(g, qty); return this; }

        public Def group(Group g) { this.group = g; return this; }
        public Def form(Form f) { this.form = f; return this; }
        public Def tint(int t) { this.tint = t; return this; }
        public Def icon(String i) { this.icon = i; return this; }
        public Def hint(String s) { this.hint = s; return this; }

        /** 压矿脉 / 山地 / 海岸 */
        public Def ground(Ground g) { this.ground = g; return this; }

        /** 仓库容量：马车能往这里卸货，且计入玩家囤货上限（0 = 不是收货点，默认） */
        public Def depot(int capacity) { this.depotCapacity = capacity; return this; }

        /** 像码头那样骑岸线（炮台用它） */
        public Def coastal() { this.coastal = true; return this; }

        /** 公共服务 + 半径 + 强度 */
        public Def service(ServiceType s, int radius, int value) {
            this.service = s;
            this.radius = radius;
            this.value = value;
            return this;
        }

        /** 显式解锁门槛：要看某个阶层在这座岛上住够多少人 */
        public Def unlock(ResidentTier tier, int population) {
            this.requiredTier = tier;
            this.requiredPopulation = population;
            this.free = false;
            return this;
        }

        /** 豁免分组自带的门槛 —— 从第一分钟就能建 */
        public Def free() { this.free = true; this.requiredTier = null; this.requiredPopulation = 0; return this; }
    }
}
