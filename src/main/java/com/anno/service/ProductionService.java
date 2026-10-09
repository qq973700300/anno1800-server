package com.anno.service;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import com.anno.domain.BuildingEntity;
import com.anno.domain.BuildingType;
import com.anno.domain.Good;
import com.anno.domain.ResidentTier;
import com.anno.domain.TerrainMap;
import com.anno.dto.Views;
import com.anno.exception.GameException;
import com.anno.repo.BuildingRepository;
import com.anno.repo.PlotRepository;
import com.anno.repo.RoadRepository;
import com.anno.config.GameProperties;
import com.anno.ws.GameSocketHub;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 产业链：工厂按配方消耗仓库原料、产出成品。
 * 例：小麦 -> 磨坊 -> 面粉 -> 面包房 -> 面包；棉花 -> 纺织厂 -> 布料 ->（+羊毛）制衣厂 -> 衣物。
 */
@Service
public class ProductionService {

    /** 一次推进最多补算几轮生产，防止超长 delta 卡死 */
    private static final int MAX_CYCLES = 5;

    private final BuildingRepository buildingRepository;
    private final IslandService islandService;
    private final InventoryService inventoryService;
    private final PlayerService playerService;
    private final RoadService roadService;
    private final RoadRepository roadRepository;
    private final PlotRepository plotRepository;
    private final GameProperties props;
    private final GameSocketHub hub;
    /** 住宅的建造前置（有没有港口、农夫够不够）要问它 —— 只在建造时用一次，不进生产心跳 */
    private final PopulationService populationService;
    /** 地形（水面 / 山地 / 矿脉）的唯一权威：落地校验与港口朝向都要读它 */
    private final TerrainService terrainService;
    /** 马车物流：产出先堆待运区，攒够一车由它运到就近仓库才入库 */
    private final CartService cartService;
    /** 公共服务 / 全岛加成：仓储抬高待运上限、供电给工厂提速 */
    private final IslandEffectsService effectsService;
    /** 树木账本：伐木场真砍树 —— 半径内现存树查询 + 砍伐记录 */
    private final TreeService treeService;
    /** 伐木场砍伐欠账：每产 woodPerTree 木砍一棵树，欠账累积器（内存即可，重启最多少砍半棵） */
    private final Map<Long, Integer> woodSinceChop = new java.util.concurrent.ConcurrentHashMap<>();
    /** 林区砍光的警示标志（只翻转时广播一次，内存即可） */
    private final Map<Long, Boolean> treeStarved = new java.util.concurrent.ConcurrentHashMap<>();

    public ProductionService(BuildingRepository buildingRepository, IslandService islandService,
                             InventoryService inventoryService, PlayerService playerService,
                             RoadService roadService, RoadRepository roadRepository,
                             PlotRepository plotRepository,
                             GameProperties props, GameSocketHub hub,
                             PopulationService populationService, TerrainService terrainService,
                             CartService cartService, IslandEffectsService effectsService,
                             TreeService treeService) {
        this.buildingRepository = buildingRepository;
        this.islandService = islandService;
        this.inventoryService = inventoryService;
        this.playerService = playerService;
        this.roadService = roadService;
        this.roadRepository = roadRepository;
        this.plotRepository = plotRepository;
        this.props = props;
        this.hub = hub;
        this.populationService = populationService;
        this.terrainService = terrainService;
        this.cartService = cartService;
        this.effectsService = effectsService;
        this.treeService = treeService;
    }

    /**
     * 建造。
     * <p>
     * 【布局规则·多格占地】像《纪元1800》一样，建筑不是都占一格：
     * {@code (x, z)} 是占地矩形的**左上角**，实际占 {@code sizeW × sizeH} 格。
     * 校验必须覆盖**整块占地**，只查锚点那一格会让大厂互相"穿模"：
     * <ol>
     *   <li>整块占地都在岛内（查右下角那格，不是锚点）；</li>
     *   <li>占地里任何一格都不能压着作物或马路；</li>
     *   <li>与已有建筑的占地不能重叠（对方也可能是多格建筑）；</li>
     *   <li>占地**外圈**任意一格临路即可 —— 4×4 的炼钢厂不必四面环街，贴一条边就行。</li>
     * </ol>
     * 这样"先规划路网、再沿路铺工厂"才是真玩法：地皮有限，大厂要挑地方。
     * <p>
     * 【朝向】rotation 传 null 就自动吸附：门朝着门口那条马路开（见
     * {@link #autoRotation}），玩家不传方向也能得到合理摆位。
     * <p>
     * 【居民建筑】住宅还要额外过"先有港口、再有人口规模"两道门槛，
     * 这就是《纪元1800》那条链在本项目里的落点。
     */
    @Transactional
    public Views.BuildingView build(Long playerId, Long islandId, BuildingType type,
                                    Integer x, Integer z, Integer rotation) {
        islandService.requireOwn(islandId, playerId);
        if (x == null || z == null) throw GameException.of("请先在岛上选一个格子");

        requireUnlock(islandId, type);

        int rot = resolveRotation(islandId, type, x, z, rotation);

        playerService.spend(playerId, type.getBuildCost(), "建造" + type.getLabel());
        // 建造材料（纪元1800式：房子不只要钱，还要木头）。库存不足抛"库存不足：木材，需要 N，现有 M"，
        // 整个 build() 在同一事务里 —— 钱和料要么一起扣成功，要么一起回滚，不会出现"扣了钱没建成"。
        for (Map.Entry<Good, Integer> c : type.getBuildGoods().entrySet())
            inventoryService.remove(playerId, c.getKey(), c.getValue());
        BuildingEntity b = buildingRepository.save(new BuildingEntity(islandId, type, x, z, rot));
        // 新住宅落成即有**初始移民**迁入（纪元 1800 里新房会"叮"地来一家子）：
        // 这也是劳动力系统的启动器 —— 没有这一步，"人口 0 → 全岛工厂缺工人"会死锁。
        if (type.isResidence()) {
            populationService.seedSettlers(islandId, type.getResidentTier(),
                    Math.min(8, type.getResidentCapacity()));
        }
        hub.broadcast("event", Map.of("type", "BUILDING_BUILT", "serverTime", System.currentTimeMillis(),
                "payload", Map.of("playerId", playerId, "islandId", islandId,
                        "building", type.name(), "x", x, "z", z,
                        "sizeW", b.getSizeW(), "sizeH", b.getSizeH(), "rotation", rot)));
        return view(b);
    }

    /**
     * 敲定朝向：玩家显式传了就用他的（归一化到 90° 的整数倍并校验落地），
     * 没传就按"门口哪边马路多"自动摆，这就是**大门自动吸附道路**的默认行为。
     */
    private int resolveRotation(Long islandId, BuildingType type, int x, int z, Integer rotation) {
        if (rotation != null) {
            int rot = BuildingType.normalizeRotation(rotation);
            validatePlacement(islandId, type, x, z, rot, null);
            return rot;
        }
        return autoRotation(islandId, type, x, z);
    }

    /**
     * 自动挑一个"门朝着马路、且放得下"的朝向。
     * <p>
     * 候选顺序是「车前马路多的朝向优先」，然后逐个试占地能不能落地：
     * 4×3 的纺织厂在岛边可能只有"横着"放得下，那就退而求其次选横着的朝向 ——
     * 门朝向让位于"能不能放下"，但会尽量选有路的一侧。
     * 一个都放不下时抛出的仍是第一次校验的错误信息，玩家看到的还是"为什么不能建"。
     * <p>
     * <b>港口是例外</b>：贸易站的门要朝着<b>海</b>，不是朝着马路 ——
     * 它自己就是物流的起点，货从码头卸下来才上路。所以先走
     * {@link #seaFirstRotations}（按"哪一侧外面是水"排序）。
     */
    private int autoRotation(Long islandId, BuildingType type, int x, int z) {
        int w = type.getSizeW(), h = type.getSizeH();
        GameException first = null;
        int[] order = type.isCoastal()
                ? seaFirstRotations(islandId, x, z, w, h)
                : roadService.doorRotationCandidates(islandId, x, z, w, h);
        for (int rot : order) {
            try {
                validatePlacement(islandId, type, x, z, rot, null);
                return rot;
            } catch (GameException e) {
                if (first == null) first = e;
            }
        }
        throw first;
    }

    /**
     * 港口的四个朝向，按「门那一侧外面有多少水」从多到少排序。
     * <p>
     * 计分有两档（{@link #seaOnSide}）：先看该侧相邻格**是水**的有几格，
     * 再看该侧相邻格在**海岸带**（沙滩）上有几格。用 100 当权重把两档合成一个分数，
     * 是因为"门前就是水"永远比"站在沙滩上但门朝内陆"更像个码头。
     * 平手沿用 南 → 东 → 北 → 西（稳定排序，结果可复现）。
     */
    private int[] seaFirstRotations(Long islandId, int x, int z, int w, int h) {
        Integer[] order = {0, 1, 2, 3};
        Arrays.sort(order, (a, b) -> {
            int sa = seaOnSide(islandId, x, z, w, h, a * 90);
            int sb = seaOnSide(islandId, x, z, w, h, b * 90);
            return sa != sb ? sb - sa : a - b;
        });
        int[] out = new int[4];
        for (int i = 0; i < 4; i++) out[i] = order[i] * 90;
        return out;
    }

    /**
     * 某个朝向下，"门那一侧"外面有多少水：水格数 ×100 + 沙滩格数。
     * <p>
     * 方向与客户端 {@code sideSeaCount} 必须一致（0=南 +z / 90=东 +x / 180=北 -z / 270=西 -x），
     * 否则玩家在 3D 里看到的门和落库的 rotation 会打起来。
     * <p>
     * 【水格数不再等于"出网格"】岛形不规则之后，网格里到处都可能是海与海湾，
     * 所以这里问的是地形图上的水，而不是"这一格在不在网格外" ——
     * 一座岛心的海湾边同样能停船。
     */
    private int seaOnSide(Long islandId, int x, int z, int w, int h, int rotation) {
        int rot = BuildingType.normalizeRotation(rotation);
        // 旋转 90°/270° 时占地宽高对调，门的"边"长度按旋转后的尺寸算
        int ew = BuildingType.effW(w, h, rot), eh = BuildingType.effH(w, h, rot);
        TerrainMap terrain = terrainService.of(islandId);
        int water = 0, coast = 0;
        for (int[] c : sideCells(x, z, ew, eh, rot)) {
            if (terrain.isWater(c[0], c[1])) water++;
            else if (terrain.isCoast(c[0], c[1], props.getCoastWidth())) coast++;
        }
        return water * 100 + coast;
    }

    /** "门那一侧"贴着占地外边的那些格子（不含四个角格 —— 角格没有可以朝向的边） */
    private static List<int[]> sideCells(int x, int z, int ew, int eh, int rot) {
        List<int[]> out = new ArrayList<>(Math.max(ew, eh));
        switch (rot) {
            case 0 -> { for (int i = x; i < x + ew; i++) out.add(new int[]{i, z + eh}); }
            case 90 -> { for (int j = z; j < z + eh; j++) out.add(new int[]{x + ew, j}); }
            case 180 -> { for (int i = x; i < x + ew; i++) out.add(new int[]{i, z - 1}); }
            default -> { for (int j = z; j < z + eh; j++) out.add(new int[]{x - 1, j}); }
        }
        return out;
    }

    /**
     * 建造 / 旋转共用的落地校验（建造与旋转必须同一套规则，否则转一下就"穿模"了）。
     *
     * @param ignoreId 正在旋转的那座建筑：它的旧占地不该算作冲突，传 null 表示全新建造
     */
    private void validatePlacement(Long islandId, BuildingType type, int x, int z, int rot, Long ignoreId) {
        int w = type.effSizeW(rot), h = type.effSizeH(rot);
        TerrainMap terrain = terrainService.of(islandId);

        // ① 整块占地都得是"能盖房的地"：不能压水、不能压山。
        //    逐格看而不是只看两个角 —— 岛形不规则之后，一条海湾完全可能从占地中间穿过去。
        //    【港口是唯一的例外】贸易站是码头，按《纪元1800》的做法本来就要一半在岸上、
        //    一半伸进海里，所以它允许压水；但仍要求"至少一格陆地 + 至少一格水面"，见 ②。
        int landCells = 0, waterCells = 0, mountainCells = 0, coastCells = 0;
        for (int[] c : type.cells(x, z, rot)) {
            int cx = c[0], cz = c[1];
            if (!terrain.inGrid(cx, cz)) {
                if (type.isCoastal()) {
                    // 【码头的第二个例外】探出地图边缘的那几格当作"海" —— 网格外就是外海，
                    // 这正是"一半在岸上、一半伸进海里"的极端形态；全场无水的平岛（测试/调试用）
                    // 也因此能在最外圈贴边建港，居民经济闭环才验得下去。
                    waterCells++;
                    continue;
                }
                throw GameException.of(String.format("%s 占地 %d×%d 格，放在这里会超出岛屿边界，往岛内挪几格",
                        type.getLabel(), w, h));
            }
            if (terrain.isWater(cx, cz)) {
                if (!type.isCoastal()) {
                    throw GameException.of(String.format(
                            "%s 占地 %d×%d 格，放在这里会压到水面（(%d, %d) 是海），往陆地上挪",
                            type.getLabel(), w, h, cx, cz));
                }
                waterCells++;
                continue;
            }
            // 【山地】绝大多数建筑盖不上山；但采石场 / 煤矿 / 金矿**非要山不可**（见 ③b）
            if (terrain.isMountain(cx, cz)) {
                if (!type.requiresMountain()) {
                    throw GameException.of(String.format(
                            "%s 盖不到山地上（(%d, %d) 是山地），往平原上放",
                            type.getLabel(), cx, cz));
                }
                mountainCells++;
                landCells++;
                continue;
            }
            if (type.requiresCoast() && terrain.isCoast(cx, cz, props.getCoastWidth())) coastCells++;
            landCells++;
        }

        // ② 港口必须**骑在岸线上**：占地里既要有陆地、又要有水面（或贴着地图边缘 ——
        //    网格外就是外海，这与 TerrainMap.coastDistances "出界当海"是同一份约定；
        //    否则全场无水的平岛——测试/调试用——永远建不出港口，居民经济闭环验不了）。
        //    这是码头与"海边一座普通仓库"的区别 —— 只压沙滩、整块都在陆地上是不够的。
        //    两条都不满足时优先报"没压到水"，因为那是玩家最常犯的那一个。
        if (type.isCoastal()) {
            boolean touchesEdge = x == 0 || z == 0
                    || x + w - 1 >= terrain.size() - 1 || z + h - 1 >= terrain.size() - 1;
            if (waterCells == 0 && !touchesEdge) {
                throw GameException.of(String.format(
                        "%s 是码头，占地得骑在岸线上 —— 往海里挪几格，让 %d×%d 的占地压到至少 1 格水面（贴着地图边缘也算临海）",
                        type.getLabel(), w, h));
            }
            if (landCells == 0) {
                throw GameException.of(String.format(
                        "%s 不能整座泡在海里 —— 占地里至少要留 1 格陆地",
                        type.getLabel()));
            }
        }

        // ③ 采掘类要压在矿脉上：矿脉是地形生成出来的，一座岛只有几处，
        //    这才是"铁矿 / 黏土"这类建筑存在的意义 —— 否则它们跟普通厂房没区别。
        if (type.requiresOre()) {
            char ore = TerrainMap.oreCharFor(type.getOre());
            boolean onVein = false;
            for (int[] c : type.cells(x, z, rot)) {
                if (terrain.at(c[0], c[1]) == ore) { onVein = true; break; }
            }
            if (!onVein) {
                throw GameException.of(String.format(
                        "%s 必须建在%s上 —— 地图上那几处矿石堆就是矿脉，先把这座建筑挪过去",
                        type.getLabel(), TerrainMap.oreLabel(ore)));
            }
        }

        // ③b 依山而建（采石场 / 煤矿 / 金矿）：整块占地至少压到一格山地 ——
        //     这是《纪元1800》里"矿必须开在矿脉或山体里"的简化版：我们的地形没有煤矿脉，
        //     就让这一类建筑去占那些本来就盖不了房子的山体，等于把废地变成产地。
        if (type.requiresMountain() && mountainCells == 0) {
            throw GameException.of(String.format(
                    "%s 必须开在山地里 —— 占地上至少要有 1 格山地，把建筑挪到山上",
                    type.getLabel()));
        }

        // ③c 贴岸而建（沙矿 / 渔场 / 油井）：至少压到一格海岸沙滩
        if (type.requiresCoast() && coastCells == 0) {
            throw GameException.of(String.format(
                    "%s 只能建在海岸沙滩上 —— 把建筑挪到岛边那一圈",
                    type.getLabel()));
        }

        // ④ 占地里每一格都不能压作物 / 马路（一次取全岛，别 16 格打 16 条 SQL）
        Set<String> cropCells = plotRepository.findByIslandIdOrderByCellXAscCellZAsc(islandId).stream()
                .map(p -> p.getCellX() + "," + p.getCellZ()).collect(Collectors.toSet());
        Set<String> roadCells = roadRepository.findByIslandId(islandId).stream()
                .map(r -> r.getCellX() + "," + r.getCellZ()).collect(Collectors.toSet());
        for (int[] c : type.cells(x, z, rot)) {
            String k = c[0] + "," + c[1];
            if (cropCells.contains(k)) throw GameException.of("占地范围里有格子种着作物，先收获或清理");
            if (roadCells.contains(k)) throw GameException.of("占地压到了马路，工厂不能盖在路上");
        }

        // ⑤ 与已有建筑的占地不能重叠（按整块矩形判，比逐格更省也算得清）
        for (BuildingEntity b : buildingRepository.findByIslandId(islandId)) {
            if (ignoreId != null && ignoreId.equals(b.getId())) continue;
            if (b.overlaps(x, z, w, h)) {
                throw GameException.of(String.format("这里已经有 %s（占地 %d×%d 格），两座建筑的地不能重叠",
                        b.getType().getLabel(), b.getSizeW(), b.getSizeH()));
            }
        }

        // ⑥ 占地外圈随便哪一格临路就行。
        //    【港口除外】它靠船运货，不该强求公路通到海边 —— 海岸带在最外圈，
        //    要求临路就等于逼玩家先把路铺到岛缘，海边那一圈反而建不下去。
        if (!type.isCoastal() && !roadService.nearRoad(islandId, x, z, w, h)) {
            throw GameException.of(String.format("%s 需要靠马路才能运原料，选一块挨着马路的空地",
                    type.getLabel()));
        }
    }

    /**
     * 住宅的建造前置 —— 《纪元1800》"先有港口，再有居民"那条链的落点。
     * <p>
     * ① 盖住宅前岛上必须先有一座<b>贸易站</b>（港口 / 仓库）：居民的生活物资得先能运上岛。
     * ② 高级住宅还要<b>人口门槛</b>：岛上农夫够数了，才解锁工人住宅，也才有新的需求要满足。
     * <p>
     * 只对住宅生效：生产型建筑与贸易站自己不受影响，老存档里已经铺满工厂的岛不会被卡住。
     */
    /**
     * 建造前置 —— 《纪元1800》"先有港口，再有人口规模，才有新业态"那条链的落点。
     * <p>
     * ① <b>住宅必须先有贸易站</b>：居民的生活物资得先能运上岛。
     * ② <b>阶层门槛</b>：整份工人业态要等农夫住够一定规模才解锁，工匠业态再等工人住够 ——
     *     这是建造菜单按阶层分页（客户端底部那排标签）背后的同一套门槛。
     * <p>
     * 【对哪些建筑生效】**全部**：过去只有住宅被卡，导致"解锁了新业态"这件事在 UI 上
     * 服务端对不上账 —— 客户端灰着按钮、服务端却放行。现在统一在这里判。
     * 生产效率高、不影响老存档的那批建筑在 {@code BuildingType.Def#free()} 里豁免了门槛。
     */
    private void requireUnlock(Long islandId, BuildingType type) {
        if (type.isResidence() && !populationService.hasTradingPost(islandId)) {
            throw GameException.of("先在岛上建一座贸易站：居民的生活物资要从港口运进来，没有港口没人肯搬来");
        }
        ResidentTier req = type.getRequiredTier();
        if (req == null || type.getRequiredPopulation() <= 0) return;
        int have = populationService.populationOf(islandId, req);
        if (have < type.getRequiredPopulation()) {
            throw GameException.of(String.format(
                    "%s 需要岛上先住够 %d 名%s（现在 %d 名）—— 先把那一层的人口堆起来",
                    type.getLabel(), type.getRequiredPopulation(), req.getLabel(), have));
        }
    }

    /**
     * 原地旋转 90°：只转朝向，不搬家。
     * <p>
     * 【为什么绕占地中心转，而不是绕左上角锚点】锚点是左上角，直接原地加 90° 会让整座厂房
     * "跳"到隔壁去（3 格宽的转成 4 格宽，右下角会甩出去两格）。绕中心转才符合玩家的直觉：
     * 转完之后原来那块地的中心还是中心。
     * <p>
     * 转完新占地可能压到别的东西（比如旁边新修的路、新种的田），所以照样走一遍落地校验，
     * 放不下就明确报错而不是硬转。
     */
    @Transactional
    public Views.BuildingView rotate(Long playerId, Long buildingId) {
        BuildingEntity b = buildingRepository.findById(buildingId)
                .orElseThrow(() -> GameException.of("建筑不存在：" + buildingId));
        if (!islandService.ownerOf(b.getIslandId()).equals(playerId)) {
            throw GameException.of("这不是你的建筑");
        }
        if (b.getGridX() == null || b.getGridZ() == null) {
            throw GameException.of("这座建筑是旧存档、没有坐标，转不了（拆掉重盖一座即可）");
        }
        BuildingType type = b.getType();
        int oldRot = b.getRotation(), newRot = BuildingType.normalizeRotation(oldRot + 90);

        // 绕中心转：锚点位移 =（旧宽 - 新宽）/ 2，四舍五入到最近的格子
        int nx = b.getGridX() + (int) Math.round((type.effSizeW(oldRot) - type.effSizeW(newRot)) / 2.0);
        int nz = b.getGridZ() + (int) Math.round((type.effSizeH(oldRot) - type.effSizeH(newRot)) / 2.0);

        validatePlacement(b.getIslandId(), type, nx, nz, newRot, b.getId());

        b.setGridX(nx);
        b.setGridZ(nz);
        b.setRotation(newRot);
        BuildingEntity saved = buildingRepository.save(b);

        hub.broadcast("event", Map.of("type", "BUILDING_ROTATED", "serverTime", System.currentTimeMillis(),
                "payload", Map.of("playerId", playerId, "islandId", b.getIslandId(),
                        "building", type.name(), "x", nx, "z", nz,
                        "sizeW", saved.getSizeW(), "sizeH", saved.getSizeH(), "rotation", newRot)));
        return view(saved);
    }

    /** 升级：每级产出 +100% */
    @Transactional
    public Views.BuildingView upgrade(Long playerId, Long buildingId) {
        BuildingEntity b = buildingRepository.findById(buildingId)
                .orElseThrow(() -> GameException.of("建筑不存在：" + buildingId));
        if (!islandService.ownerOf(b.getIslandId()).equals(playerId)) {
            throw GameException.of("这不是你的建筑");
        }
        double cost = b.getType().getBuildCost() * b.getLevel();
        playerService.spend(playerId, cost, "升级" + b.getType().getLabel());
        b.setLevel(b.getLevel() + 1);
        return view(buildingRepository.save(b));
    }

    /**
     * 拆除建筑：返还一半造价，占地整块立刻释放（可以原地改修路、播种或换别的厂）。
     * <p>
     * 多格建筑一旦放错位置，没有拆除就只能废掉一片地皮 —— 所以这是占地系统的必要配套。
     */
    @Transactional
    public Map<String, Object> demolish(Long playerId, Long buildingId) {
        BuildingEntity b = buildingRepository.findById(buildingId)
                .orElseThrow(() -> GameException.of("建筑不存在：" + buildingId));
        if (!islandService.ownerOf(b.getIslandId()).equals(playerId)) {
            throw GameException.of("这不是你的建筑");
        }
        BuildingType t = b.getType();
        Long islandId = b.getIslandId();

        double refund = Math.round(t.getBuildCost() * props.getDemolishRefundRate() * 100.0) / 100.0;
        int sizeW = b.getSizeW(), sizeH = b.getSizeH();      // 旋转后的占地（腾出多少格按这个算）
        // 厂房拆掉后它的工人立刻释放回劳动力池（下一拍 tickIsland 重新分配）；
        // 在途的那辆车照走 —— 车已经出发了，货照常到港入库。
        cartService.abandonBuilding(buildingId);
        buildingRepository.delete(b);
        playerService.addTreasury(playerId, refund);

        // 房子没了，超出的居民立刻搬走。容量是由住宅实时推导的（不落库），
        // 所以这里要主动收敛一次人口，否则会一直显示"人口 > 容量"直到下个结算周期。
        if (t.isResidence()) populationService.shrinkToCapacity(islandId);

        hub.broadcast("event", Map.of("type", "BUILDING_REMOVED", "serverTime", System.currentTimeMillis(),
                "payload", Map.of("playerId", playerId, "islandId", islandId,
                        "building", t.name(), "x", b.getGridX() == null ? -1 : b.getGridX(),
                        "z", b.getGridZ() == null ? -1 : b.getGridZ())));
        return Map.of("id", buildingId, "type", t.name(), "label", t.getLabel(),
                "sizeW", sizeW, "sizeH", sizeH, "rotation", b.getRotation(), "refund", refund);
    }

    @Transactional(readOnly = true)
    public List<Views.BuildingView> buildings(Long islandId) {
        return buildingRepository.findByIslandId(islandId).stream().map(this::view).toList();
    }

    /**
     * 推进**这一座岛**上所有建筑的生产。
     * <p>
     * 【为什么不再分批】改造前这里是"findAll 全库建筑 → 按玩家切成固定 4 批 → 每批一个事务"，
     * 因为当时一个事务要吞下全服几千座厂房，只好分批来缩小锁范围。现在由
     * {@link IslandSimService} 按岛调用，一个事务本来就只装一座岛的建筑，
     * 分批的复杂度没必要了 —— 离线玩家的岛更是完全不会被调到。
     * <p>
     * 并发仍然安全：玩家正巧在点建造/拆除时，乐观锁冲突会由调用方
     * （{@code IslandSimService} 的 DbRetry）整体重试。
     * <p>
     * {@code deltaSeconds} 是"这座岛这次该补的游戏秒数"，由岛屿水位线算出来 ——
     * 所以玩家离开三天再回来，这里拿到的仍是**离线宽限内**的那几秒，不会爆产。
     */
    @Transactional
    public void tickIsland(Long islandId, Long ownerId, double deltaSeconds) {
        if (deltaSeconds <= 0) return;
        List<BuildingEntity> buildings = buildingRepository.findByIslandId(islandId);
        if (buildings.isEmpty()) return;

        // 到港的马车先卸货（哪怕这拍工厂全停着，在途的货也要入库）
        cartService.flushIsland(islandId, ownerId, deltaSeconds, inventoryService);

        // ---- 劳动力分配：全岛人口就是劳动力池，按建成顺序（id 序）分给工厂 ----
        // 纪元 1800 的规则：厂房要有人上班才转；人不够时先建的厂优先招工，
        // 后建的厂招不满就只能停着 —— 这也是"别一口气铺一堆厂"的经营压力来源。
        int remaining = populationService.totalPopulation(islandId);
        for (BuildingEntity b : buildings) {
            BuildingType t = b.getType();
            if (!t.isProduction() || t.getWorkers() <= 0) continue;
            boolean staffed = remaining >= t.getWorkers();
            if (staffed) remaining -= t.getWorkers();
            if (staffed == b.isNoWorkers()) {           // 只在翻转那一拍落库 + 广播，平时零开销
                b.setNoWorkers(!staffed);
                buildingRepository.updateNoWorkers(b.getId(), !staffed);
                hub.broadcast("event", Map.of("type", staffed ? "WORKERS_OK" : "WORKERS_SHORT",
                        "serverTime", System.currentTimeMillis(),
                        "payload", Map.of("playerId", ownerId, "islandId", islandId,
                                "buildingId", b.getId(), "label", t.getLabel(),
                                "workers", t.getWorkers())));
            }
        }

        // ---- 全岛加成：仓库抬高待运上限、发电厂给工厂提速 ----
        // 这两项由 🏭 公共设施提供（见 IslandEffectsService），是"要不要在产区旁边
        // 塞一座仓库 / 能不能先把电厂点起来"的实际收益来源。
        IslandEffectsService.Effects fx = effectsService.effectsOf(buildings);
        double speedMul = fx.speedMultiplier();
        int pendingCap = props.getPendingCap() + fx.pendingBonus();

        // 声望按玩家累计，最后一次性原子写入，避免每个周期写一次
        int cycles = 0;
        for (BuildingEntity b : buildings) {
            cycles += processOne(b, ownerId, deltaSeconds, speedMul, pendingCap);
        }
        if (cycles > 0) playerService.addReputation(ownerId, cycles);
    }

    /**
     * 推进单座建筑，返回本轮完成的周期数。
     * <p>
     * 【性能关键点】建筑实体在这里**只读不写**：进度算出来后用一条 UPDATE 落库
     * （BuildingRepository.updateProgress），不调用 save。
     * 否则会话里会挂住几十个脏实体，而每次出入库的 @Modifying 查询都会 flush 整个会话，
     * 变成 N 座建筑 × N 次 flush 的 O(N²) 写库。
     * <p>
     * 【2026-09-25】接进全量建筑表后多出两类<b>全岛加成</b>：工厂速度按电力供应提速 1.0~1.36，
     * 待运区上限让仓库 / 港口仓库往上加 —— 所以这里比改造前多了 speedMul 与 pendingCap 两个入参。
     */
    private int processOne(BuildingEntity b, Long ownerId, double deltaSeconds,
                           double speedMul, int pendingCap) {
            BuildingType type = b.getType();
            // 住宅与贸易站没有配方（周期是 0）：硬跑的话 while 会空转满 MAX_CYCLES 圈，
            // 还会广播一堆"产出了 0 个东西"的事件，把事件流冲爆。人口那边单独结算它们。
            if (!type.isProduction()) return 0;
            int duration = type.getDurationSeconds();
            double elapsed = b.getElapsed() + deltaSeconds * speedMul;
            boolean stalled = false;
            int cycles = 0;
            int pending = b.getPendingQty();

            // 【缺工人】劳动力分配在 tickIsland 里做完，这里只认结果：没分到工人的厂原地停摆
            if (b.isNoWorkers()) {
                buildingRepository.updateProgress(b.getId(), Math.min(elapsed, duration), true, pending);
                return 0;
            }

            // 【缺树】伐木场只砍伐半径内的树：林区砍光就硬停产（纪元1800 式 —— 森林是一次性资源）。
            // 翻转那一拍广播一次 TREE_STARVED，恢复有树（拆了重盖 / 半径扩到新林区）再广播 TREE_OK。
            if (type == BuildingType.LUMBERJACK) {
                int trees = treeService.availableTreeCount(b, props.getLumberChopRadius());
                if (trees <= 0) {
                    if (treeStarved.put(b.getId(), Boolean.TRUE) == null) {
                        hub.broadcast("event", Map.of("type", "TREE_STARVED",
                                "serverTime", System.currentTimeMillis(),
                                "payload", Map.of("playerId", ownerId, "islandId", b.getIslandId(),
                                        "buildingId", b.getId(), "label", type.getLabel(),
                                        "radius", props.getLumberChopRadius())));
                    }
                    buildingRepository.updateProgress(b.getId(), Math.min(elapsed, duration), true, pending);
                    return 0;
                }
                if (treeStarved.remove(b.getId()) != null) {
                    hub.broadcast("event", Map.of("type", "TREE_OK",
                            "serverTime", System.currentTimeMillis(),
                            "payload", Map.of("playerId", ownerId, "islandId", b.getIslandId(),
                                    "buildingId", b.getId(), "label", type.getLabel(),
                                    "trees", trees)));
                }
            }

            while (elapsed >= duration && cycles < MAX_CYCLES) {
                if (!hasInputs(ownerId, type)) {
                    stalled = true;
                    elapsed = duration;
                    break;
                }
                if (pending >= pendingCap) {
                    // 待运区堆满：产出来也没地方放（没港口 / 车运不过来），停产待援。
                    // stalled=true 让客户端亮红灯，但原因在面板里写清"待运区已满"。
                    stalled = true;
                    elapsed = duration;
                    break;
                }
                /* 扣料：上面 hasInputs 刚用新鲜库存查过，正常必够。但并发下（玩家同一瞬
                   在市场卖货）仍可能被打空 —— 这时绝不能把 GameException 抛出 tickIsland：
                   那会连水位线一起回滚，整座岛每 3 秒原样重炸、永久冻结（2026-09-24 血案）。
                   所以这里全有或全无：哪个料缺了，把已扣的如数退回，按"缺料停工"处理。 */
                boolean missing = false;
                java.util.List<Map.Entry<Good, Integer>> taken = new java.util.ArrayList<>();
                try {
                    for (Map.Entry<Good, Integer> e : type.getInputs().entrySet()) {
                        inventoryService.remove(ownerId, e.getKey(), e.getValue());
                        taken.add(e);
                    }
                } catch (GameException ex) {
                    for (Map.Entry<Good, Integer> e : taken) {
                        inventoryService.add(ownerId, e.getKey(), e.getValue());   // 退料，一件不留
                    }
                    missing = true;
                }
                if (missing) {
                    stalled = true;
                    elapsed = duration;
                    break;
                }
                int level = b.getLevel();
                // 【产出先进待运区】不再直接进仓库 —— 马车把它运到仓库那刻才算"入库"。
                // 一轮的产出量 × 等级，超上限就只攒到上限（不让 pending 无限膨胀）。
                int outQty = type.getOutputs().values().stream().mapToInt(Integer::intValue).sum() * level;
                pending = Math.min(pendingCap, pending + outQty);
                elapsed -= duration;
                stalled = false;
                cycles++;
                // 【真砍树】伐木场每产 woodPerTree 木就要砍掉一棵树（欠账累积）：
                // 树是地理资源不是商品，砍掉的那格从"现存树"里永久消失（记 tree_chop 表），
                // 并广播给客户端把那棵树演倒下。这一行就是"不是凭空生成木头"的落点。
                if (type == BuildingType.LUMBERJACK) {
                    int since = woodSinceChop.merge(b.getId(), outQty, Integer::sum);
                    if (since >= props.getWoodPerTree()) {
                        woodSinceChop.put(b.getId(), since - props.getWoodPerTree());
                        TreeService.TreeCell chopped = treeService.chopNearest(b, props.getLumberChopRadius());
                        if (chopped != null) {
                            Map<String, Object> payload = new java.util.HashMap<>();
                            payload.put("playerId", ownerId);
                            payload.put("islandId", b.getIslandId());
                            payload.put("buildingId", b.getId());
                            payload.put("x", chopped.x());
                            payload.put("z", chopped.z());
                            hub.broadcast("event", Map.of("type", "TREE_CHOPPED",
                                    "serverTime", System.currentTimeMillis(), "payload", payload));
                        }
                    }
                }
                /* 这里**故意不广播**"产出"事件：每座厂房每产完一轮推一条，十几座厂房叠起来
                   就是每秒好几条，客户端收到还得各自回拉一次库存 —— 纯噪音。
                   产出结果（库存 / 进度）已经跟着 GameTickService 的个人快照走了。 */
            }

            // ---- 派车：待运攒够一车、厂里没有车在途、岛上有仓库可收货 ----
            if (pending >= props.getCartLoad() && !cartService.hasInFlight(b.getId())) {
                List<BuildingEntity> depots = findDepots(b.getIslandId());
                if (!depots.isEmpty()) {
                    Good outGood = type.getOutputs().keySet().iterator().next();
                    int load = Math.min(pending, props.getCartCapacity());
                    // 就近原则：对每座仓库各算一次行程，货走耗时最短的那条路（不再无脑去贸易站）
                    CartService.NearestPlan nearest = cartService.planNearest(b, depots);
                    pending -= load;
                    cartService.dispatch(b, ownerId, outGood, load, nearest.depot(), nearest.plan());
                }
            }

            // 每 tick 都要落库：elapsed 推进了，进度条才会走
            buildingRepository.updateProgress(b.getId(), elapsed, stalled, pending);
            return cycles;
    }

    /** 岛上的仓库类建筑（贸易站 + 小仓库）—— 马车的候选目的地，派车按行程挑最近的。造船厂虽同为码头类但不收货 */
    private List<BuildingEntity> findDepots(Long islandId) {
        return buildingRepository.findByIslandId(islandId).stream()
                .filter(b -> b.getType().isDepot()).toList();
    }

    private boolean hasInputs(Long ownerId, BuildingType type) {
        for (Map.Entry<Good, Integer> e : type.getInputs().entrySet()) {
            if (!inventoryService.hasEnough(ownerId, e.getKey(), e.getValue())) return false;
        }
        return true;
    }

    public Views.BuildingView view(BuildingEntity b) {
        BuildingType t = b.getType();
        // sizeW/sizeH 取**旋转后**的占地：客户端直接照它画占地框与摆模型，不必自己再算一遍
        // progress 对住宅 / 港口固定给 0：它们没有生产周期，报 100% 会让人以为产线跑通了
        return new Views.BuildingView(b.getId(), b.getIslandId(), t.name(), t.getLabel(),
                b.getLevel(), t.isProduction() ? b.progress() : 0, b.isStalled(), recipeOf(t),
                b.getGridX(), b.getGridZ(), b.getSizeW(), b.getSizeH(), b.getRotation(),
                t.getKind().name(), b.getPendingQty(), b.isNoWorkers(), t.getWorkers());
    }

    /**
     * 建筑图鉴：客户端建造面板用它渲染，避免客户端硬编码造价/占地导致与服务端不一致。
     */
    public List<Views.BuildingTypeView> catalog() {
        return Arrays.stream(BuildingType.values())
                .map(t -> new Views.BuildingTypeView(t.name(), t.getLabel(), t.getBuildCost(),
                        t.getDurationSeconds(), t.getSizeW(), t.getSizeH(), t.getSizeCells(),
                        recipeOf(t), t.getKind().name(),
                        t.getResidentTier() == null ? null : t.getResidentTier().name(),
                        t.getResidentCapacity(), t.getRequiredFarmerPopulation(),
                        // 采掘类要压在矿脉上：把"要哪种矿"下发给客户端，面板才能提前置灰
                        t.getOre() == null ? null : t.getOre().name(),
                        t.getWorkers(),
                        // ---- 扩表后的 UI 元数据：客户端建造菜单照它渲染分页与卡片 ----
                        t.getGroup().name(), t.getGroup().getLabel(), t.getGroup().getIcon(),
                        t.getForm().name(), t.getTint(), t.getIcon(),
                        t.getHint() == null ? recipeOf(t) : t.getHint(),
                        t.getRequiredTier() == null ? null : t.getRequiredTier().name(),
                        t.getRequiredTier() == null ? null : t.getRequiredTier().getLabel(),
                        t.getRequiredPopulation(),
                        t.getGround().name(), t.isCoastal(),
                        t.getService() == null ? null : t.getService().name(),
                        t.getService() == null ? null : t.getService().getLabel(),
                        t.getServiceRadius(), t.getServiceValue(),
                        t.getService() == null ? null : t.getService().getHint(),
                        // 建造材料（纪元1800式）：客户端建造坞显示"+ 木材5"并做不足置灰
                        goodsCostOf(t)))
                .toList();
    }

    /** 材料成本下发给客户端的格式：[{good, label, qty}]，照抄 ShipTypeView 的 goodsCost */
    private static List<Map<String, Object>> goodsCostOf(BuildingType t) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map.Entry<Good, Integer> e : t.getBuildGoods().entrySet())
            out.add(Map.of("good", e.getKey().name(), "label", e.getKey().getLabel(), "qty", e.getValue()));
        return out;
    }

    /**
     * 一句话说清这座建筑"干什么"。
     * 住宅与港口没有配方，所以给它们一句人话描述，而不是空字符串 ——
     * 客户端面板直接把这条字符串打在建筑名下。
     */
    private String recipeOf(BuildingType t) {
        // 公共设施 / 军事设施 / 纯加成设施：本来就没有配方，把"它干什么用"那句话摆出来
        // （这本是 {@code hint} 的活儿，但要保证图鉴里 recipe 这一列永远有字）。
        if (!t.isProduction()) {
            String job = t.getHint();
            if (job != null && !job.isBlank()) {
                return t.providesService()
                        ? job + "（" + t.getService().getLabel() + "服务半径 " + t.getServiceRadius() + " 格）"
                        : job;
            }
            if (t.isResidence()) {
                String wants = t.getResidentTier().getNeeds().keySet().stream()
                        .map(Good::getLabel).collect(Collectors.joining(" + "));
                return String.format("住 %d 名%s，需要 %s",
                        t.getResidentCapacity(), t.getResidentTier().getLabel(), wants);
            }
            return switch (t.getKind()) {
                case HARBOR -> "码头设施（部分 Logistic 加成）";
                case PUBLIC -> "公共设施";
                case MILITARY -> "军事设施";
                default -> "—";
            };
        }
        if (t.getInputs().isEmpty()) {
            String out = t.getOutputs().entrySet().stream()
                    .map(e -> e.getKey().getLabel() + "x" + e.getValue())
                    .collect(Collectors.joining(" + "));
            // 采掘类还要说清"得建在矿脉上"：否则玩家只看到"产出 铁矿x1"，
            // 完全不知道为什么这块地盖不下去。
            return t.requiresOre()
                    ? out + "（建在" + TerrainMap.oreLabel(TerrainMap.oreCharFor(t.getOre())) + "上）"
                    : out;
        }
        return t.getInputs().entrySet().stream()
                .map(e -> e.getKey().getLabel() + "x" + e.getValue())
                .collect(Collectors.joining(" + "))
                + " => "
                + t.getOutputs().entrySet().stream()
                .map(e -> e.getKey().getLabel() + "x" + e.getValue())
                .collect(Collectors.joining(" + "));
    }
}
