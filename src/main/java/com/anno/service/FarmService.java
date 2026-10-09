package com.anno.service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.anno.config.GameProperties;
import com.anno.domain.BuildingEntity;
import com.anno.domain.BuildingType;
import com.anno.domain.Good;
import com.anno.domain.IslandEntity;
import com.anno.domain.PlotEntity;
import com.anno.domain.TerrainMap;
import com.anno.dto.Requests;
import com.anno.dto.Views;
import com.anno.exception.GameException;
import com.anno.repo.BuildingRepository;
import com.anno.repo.PlotRepository;
import com.anno.repo.RoadRepository;
import com.anno.ws.GameSocketHub;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 种植系统：播种 -> 生长 -> 成熟 -> **自动收获入库** -> 原地重种下一茬。
 * <p>
 * 【成熟就自动收】农田不需要玩家盯着收：一株长够了就把这一茬的产量写进仓库，
 * 然后**立刻原地重新开始长**。地块行不删、格子不空出来 —— 播一次种，这块地就像
 * 工厂一样自己循环下去，玩家只负责决定"在哪块地上种什么"。
 * <p>
 * 【农田归玩家自己安排】岛屿是一张方格图，服务端**不再预生成农田**：
 * 玩家自己在任意空地上点一格播种，一格只能有一株作物。
 * 手动收获 / 清理枯萎作物时才会删掉地块行，那一格随之空出来 —— 可以接着种，
 * 也可以改成修路盖厂房，布局完全由玩家规划。
 * <p>
 * 种什么由玩家自己的农场决定：建了哪种农场就能在它周围拉哪种田，没有岛屿适种限制。
 * 生长速度与产量一律用作物基础值 —— 不再做肥力数值加成。
 */
@Service
public class FarmService {

    /**
     * 能"拉田"的农场建筑 -> 绑定作物（纪元1800式：马铃薯农场只种土豆）。
     * 新增农场类型时在这里登记一行即可。
     * 羊毛不在此列（纪元1800式：羊场是牧场地坪，配方无输入直接产毛，不拉田）。
     * 注意：COTTON（棉花）目前没有对应农场建筑，暂时无法种植（老存档已种的照常生长）。
     */
    public static final Map<BuildingType, Good> FIELD_CROPS = Map.of(
            BuildingType.POTATO_FARM, Good.POTATO,
            BuildingType.GRAIN_FARM,  Good.GRAIN,
            BuildingType.HOP_FARM,    Good.HOPS);

    /** 田块允许离农场建筑占区多远（切比雪夫距离，按 footprint 边缘算） */
    public static final int FIELD_RANGE = 3;

    private final PlotRepository plotRepository;
    private final RoadRepository roadRepository;
    private final BuildingRepository buildingRepository;
    private final IslandService islandService;
    private final InventoryService inventoryService;
    private final PlayerService playerService;
    private final TerrainService terrainService;
    private final GameProperties props;
    private final GameSocketHub hub;

    public FarmService(PlotRepository plotRepository, RoadRepository roadRepository,
                       BuildingRepository buildingRepository, IslandService islandService,
                       InventoryService inventoryService, PlayerService playerService,
                       TerrainService terrainService, GameProperties props, GameSocketHub hub) {
        this.plotRepository = plotRepository;
        this.roadRepository = roadRepository;
        this.buildingRepository = buildingRepository;
        this.islandService = islandService;
        this.inventoryService = inventoryService;
        this.playerService = playerService;
        this.terrainService = terrainService;
        this.props = props;
        this.hub = hub;
    }

    /**
     * 播种（纪元1800式）：**田必须从一座农场建筑"拉"出来**。
     * 作物由农场类型决定（马铃薯农场只种土豆），田格必须在农场占区周围 {@link #FIELD_RANGE} 格内。
     * 老存档里没有 buildingId 的散田不受影响（照常生长），只是不再允许新增散田。
     */
    @Transactional
    public Views.PlotView plant(Long playerId, Long islandId, Integer x, Integer z,
                                Good crop, Long buildingId) {
        BuildingEntity farm = requireFieldFarm(islandId, playerId, buildingId);
        return plantAt(playerId, islandId, x, z, resolveFieldCrop(farm, crop), farm);
    }

    /** 找出"能拉田"的农场建筑：存在、属于这座岛、类型在 {@link #FIELD_CROPS} 里 */
    private BuildingEntity requireFieldFarm(Long islandId, Long playerId, Long buildingId) {
        if (buildingId == null) {
            throw GameException.of("请先建一座农场，点农场建筑拉田（田是农场的，不能凭空种）");
        }
        BuildingEntity farm = buildingRepository.findById(buildingId)
                .orElseThrow(() -> GameException.of("农场建筑不存在：" + buildingId));
        if (!farm.getIslandId().equals(islandId)) {
            throw GameException.of("这座农场不在当前岛上");
        }
        islandService.requireOwn(islandId, playerId);
        if (!FIELD_CROPS.containsKey(farm.getType())) {
            throw GameException.of(farm.getType().getLabel() + "不是能拉田的农场");
        }
        return farm;
    }

    /** 农场绑定的作物；请求里带了 crop 时必须一致（客户端一般不传，由农场决定） */
    private Good resolveFieldCrop(BuildingEntity farm, Good requested) {
        Good fieldCrop = FIELD_CROPS.get(farm.getType());
        if (requested != null && requested != fieldCrop) {
            throw GameException.of(farm.getType().getLabel() + "只能种" + fieldCrop.getLabel()
                    + "，种不了" + requested.getLabel());
        }
        return fieldCrop;
    }

    /** 校验田格在农场占区边缘的切比雪夫距离 ≤ {@link #FIELD_RANGE} */
    private void requireFieldRange(BuildingEntity farm, int x, int z) {
        int dx = Math.max(0, Math.max(farm.getGridX() - x, x - (farm.getGridX() + farm.getSizeW() - 1)));
        int dz = Math.max(0, Math.max(farm.getGridZ() - z, z - (farm.getGridZ() + farm.getSizeH() - 1)));
        int dist = Math.max(dx, dz);
        if (dist > FIELD_RANGE) {
            throw GameException.of("这块地离农场太远（最多 " + FIELD_RANGE + " 格），把田拉到农场周围");
        }
    }

    /** 在农场周围种下一株（种子的钱、占格校验都在这里） */
    private Views.PlotView plantAt(Long playerId, Long islandId, Integer x, Integer z,
                                   Good crop, BuildingEntity farm) {
        if (crop == null || !crop.isPlantable()) {
            throw GameException.of("该商品不能种植：" + (crop == null ? "null" : crop.getLabel()));
        }
        IslandEntity island = islandService.requireOwn(islandId, playerId);
        requirePlantableCell(island, x, z);
        requireFieldRange(farm, x, z);

        playerService.spend(playerId, crop.getSeedCost(), "购买" + crop.getLabel() + "种子");

        PlotEntity plot = new PlotEntity(islandId, x, z);
        plot.setCrop(crop);
        plot.setState(PlotEntity.State.GROWING);
        plot.setGrowElapsed(0);
        plot.setGrowTarget(crop.getGrowthSeconds());
        plot.setPlannedYield(crop.getYieldPerHarvest());
        plot.setRipeElapsed(0);
        plot.setBuildingId(farm.getId());
        PlotEntity saved = plotRepository.save(plot);

        hub.broadcast("event", Map.of("type", "CROP_PLANTED", "serverTime", System.currentTimeMillis(),
                "payload", Map.of("playerId", playerId, "islandId", islandId,
                        "x", x, "z", z, "crop", crop.name(), "buildingId", farm.getId())));
        return view(saved);
    }

    /** 批量播种上限（与客户端划矩形的格子上限一致） */
    public static final int BATCH_LIMIT = 400;

    /**
     * 一片播种（从农场拉田）：一次 HTTP 往返 + 一个事务把整个矩形种完。
     * 作物由农场建筑决定（buildingId 必填），撞到第一个障碍（钱不够 / 耕地上限 / 超范围）就停，
     * 撞墙前的格子照常生效（部分成功）；响应带 stop 说明停在哪。
     */
    @Transactional
    public Map<String, Object> plantBatch(Long playerId, Long islandId,
                                          List<Requests.CellRef> cells, String cropName, Long buildingId) {
        BuildingEntity farm = requireFieldFarm(islandId, playerId, buildingId);
        Good crop = resolveFieldCrop(farm, cropName == null ? null : Good.of(cropName));
        List<Views.PlotView> built = new ArrayList<>();
        String stop = null;
        if (cells == null || cells.isEmpty()) {
            stop = "没有要种的格子";
        } else {
            for (Requests.CellRef c : cells) {
                if (built.size() >= BATCH_LIMIT) { stop = "一次最多种 " + BATCH_LIMIT + " 株"; break; }
                try {
                    built.add(plantAt(playerId, islandId, c.x(), c.z(), crop, farm));
                } catch (GameException e) {
                    stop = e.getMessage();
                    break;
                }
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("built", built);
        out.put("count", built.size());
        out.put("crop", crop.name());
        out.put("stop", stop);
        return out;
    }

    /** 收获：成熟作物 -> 仓库，地块行删除（格子空出来） */
    @Transactional
    public Map<String, Object> harvest(Long playerId, Long plotId) {
        PlotEntity plot = plotRepository.findById(plotId)
                .orElseThrow(() -> GameException.of("作物不存在：" + plotId));
        if (!islandService.ownerOf(plot.getIslandId()).equals(playerId)) {
            throw GameException.of("这不是你的作物");
        }
        if (plot.getState() != PlotEntity.State.RIPE) {
            throw GameException.of("作物还没成熟，当前状态：" + plot.getState());
        }
        Good crop = plot.getCrop();
        int yield = plot.getPlannedYield();
        int cx = plot.getCellX(), cz = plot.getCellZ();
        inventoryService.add(playerId, crop, yield);
        playerService.addReputation(playerId, 1);
        plotRepository.delete(plot);

        hub.broadcast("event", Map.of("type", "CROP_HARVESTED", "serverTime", System.currentTimeMillis(),
                "payload", Map.of("playerId", playerId, "islandId", plot.getIslandId(),
                        "x", cx, "z", cz, "crop", crop.name(), "label", crop.getLabel(), "yield", yield)));
        return Map.of("crop", crop.name(), "label", crop.getLabel(), "yield", yield, "x", cx, "z", cz);
    }

    /** 清理枯萎作物：地块行删除（格子空出来） */
    @Transactional
    public Map<String, Object> clear(Long playerId, Long plotId) {
        PlotEntity plot = plotRepository.findById(plotId)
                .orElseThrow(() -> GameException.of("作物不存在：" + plotId));
        if (!islandService.ownerOf(plot.getIslandId()).equals(playerId)) {
            throw GameException.of("这不是你的作物");
        }
        if (plot.getState() != PlotEntity.State.WITHERED) {
            throw GameException.of("这株作物不用清理，当前状态：" + plot.getState());
        }
        int cx = plot.getCellX(), cz = plot.getCellZ();
        plotRepository.delete(plot);
        return Map.of("x", cx, "z", cz, "cleared", true);
    }

    /**
     * 铲除作物（**任意状态**，铲除工具用）：地块行删除，格子空出来，种子钱不退。
     * 与 {@link #clear} 的区别：clear 只收枯萎株（自然流程的收尾），remove 是玩家主动铲掉
     * 长势中的作物改布局 —— 收不回种子钱正是"铲掉重来"的代价。
     */
    @Transactional
    public Map<String, Object> removePlot(Long playerId, Long plotId) {
        PlotEntity plot = plotRepository.findById(plotId)
                .orElseThrow(() -> GameException.of("作物不存在：" + plotId));
        if (!islandService.ownerOf(plot.getIslandId()).equals(playerId)) {
            throw GameException.of("这不是你的作物");
        }
        int cx = plot.getCellX(), cz = plot.getCellZ();
        plotRepository.delete(plot);
        return Map.of("x", cx, "z", cz, "removed", true);
    }

    @Transactional(readOnly = true)
    public List<Views.PlotView> plots(Long islandId) {
        return plotRepository.findByIslandIdOrderByCellXAscCellZAsc(islandId).stream()
                .map(this::view).toList();
    }

    /**
     * 推进**这一座岛**上的作物生长：长够一茬就自动入库、原地重种。
     * <p>
     * 【只推进一座岛】改造前这里是"拉出全服所有生长中的作物、推完再全量写回"，
     * 开销与注册玩家数成正比。现在由 {@link IslandSimService} 按岛调用，
     * 只碰这座岛的地块 —— 离线玩家的岛根本不会被调到。
     * <p>
     * {@code deltaSeconds} 是"这座岛这次该补的游戏秒数"，由岛屿水位线算出来，
     * 所以同一段代码既服务"每 3 秒一次的在线推进"，也服务"玩家回来时的一次性补算"。
     */
    @Transactional
    public void tickIsland(Long islandId, Long ownerId, double deltaSeconds) {
        tickIsland(islandId, ownerId, deltaSeconds, 1.0);
    }

    /**
     * 带<b>农机加成</b>的推进：拖拉机谷仓 / 邮箱这类设施给的百分比（见 {@code IslandEffectsService}），
     * 让同一的生长时间在实际感觉上"更快收割一茬"。
     */
    @Transactional
    public void tickIsland(Long islandId, Long ownerId, double deltaSeconds, double growthMul) {
        if (deltaSeconds <= 0) return;
        List<PlotEntity> active = plotRepository.findByIslandIdAndStateIn(islandId,
                List.of(PlotEntity.State.GROWING, PlotEntity.State.RIPE));
        if (active.isEmpty()) return;

        Map<Good, Integer> gained = new LinkedHashMap<>();
        int harvests = 0;

        for (PlotEntity plot : active) {
            /* 停在 RIPE 上的地块是"自动收获上线之前"种下的老存档：这一拍收掉它，
               之后 RIPE 只会在一拍的中间出现，不会再被持久化下来 */
            if (plot.getState() == PlotEntity.State.RIPE) {
                harvestInto(plot, gained);
                harvests++;
                replant(plot);
                continue;
            }
            plot.setGrowElapsed(plot.getGrowElapsed() + deltaSeconds * growthMul);
            /* 减掉一个周期而不是清零：时间倍率高（anno.time-scale=20）时一拍要收好几茬，
               余数必须留下来 —— 清零等于每次结算都悄悄吞掉一段生长时间，作物会越种越慢 */
            while (plot.getGrowTarget() > 0 && plot.getGrowElapsed() >= plot.getGrowTarget()) {
                plot.setGrowElapsed(plot.getGrowElapsed() - plot.getGrowTarget());
                harvestInto(plot, gained);
                harvests++;
            }
        }
        plotRepository.saveAll(active);

        // 按作物汇总后一次性入库：64 块地同时熟，也只写一次那条库存行
        List<Map<String, Object>> crops = new ArrayList<>();
        for (Map.Entry<Good, Integer> e : gained.entrySet()) {
            inventoryService.add(ownerId, e.getKey(), e.getValue());
            crops.add(Map.of("crop", e.getKey().name(), "label", e.getKey().getLabel(),
                    "yield", e.getValue()));
        }
        if (crops.isEmpty()) return;
        playerService.addReputation(ownerId, harvests);

        hub.broadcast("event", Map.of("type", "CROP_HARVESTED", "serverTime", System.currentTimeMillis(),
                "payload", Map.of("auto", true, "islandId", islandId, "crops", crops)));
    }

    /** 把这一茬的产量记进汇总表 —— 真正入库要等这座岛的地块全算完，见调用处 */
    private void harvestInto(PlotEntity plot, Map<Good, Integer> gained) {
        gained.merge(plot.getCrop(), plot.getPlannedYield(), Integer::sum);
    }

    /** 原地重种下一茬：地块行不删、格子不空出来，玩家不用管 */
    private void replant(PlotEntity plot) {
        plot.setState(PlotEntity.State.GROWING);
        plot.setGrowElapsed(0);
        plot.setRipeElapsed(0);
    }

    /** 校验这一格能不能种：是平原（不是水 / 山 / 矿脉）、没马路、没建筑、没别的作物，且没超过本岛农田上限 */
    private void requirePlantableCell(IslandEntity island, Integer x, Integer z) {
        Long islandId = island.getId();
        if (x == null || z == null) throw GameException.of("请先在岛上点一格空地");
        TerrainMap terrain = terrainService.of(island);
        if (!terrain.inGrid(x, z)) throw GameException.of("这一格超出岛屿范围");
        // 只有平原能种：水面不行，山地的坡上也种不了，矿脉那几格得留着开矿
        if (terrain.isWater(x, z)) throw GameException.of("这里是水面，种不了地");
        if (terrain.isMountain(x, z)) throw GameException.of("这里是山地（陡坡），种不了地");
        if (terrain.oreAt(x, z) != TerrainMap.PLAIN) {
            throw GameException.of("这一格是" + TerrainMap.oreLabel(terrain.oreAt(x, z))
                    + "，留着开矿吧 —— 换一格平地种");
        }
        if (roadRepository.existsByIslandIdAndCellXAndCellZ(islandId, x, z)) {
            throw GameException.of("这里是马路，不能种地");
        }
        // 建筑会占好几格：要按整块占地判断，不能只比左上角那格
        for (BuildingEntity b : buildingRepository.findByIslandId(islandId)) {
            if (b.covers(x, z)) {
                throw GameException.of("这里是" + b.getType().getLabel() + "的占地，不能种地");
            }
        }
        if (plotRepository.existsByIslandIdAndCellXAndCellZ(islandId, x, z)) {
            throw GameException.of("这一格已经种了作物，换一格吧");
        }
        int used = plotRepository.countByIslandId(islandId);
        if (used >= island.getPlotLimit()) {
            throw GameException.of("农田已满（本岛上限 " + island.getPlotLimit() + " 株），先收获或清理一些");
        }
    }

    public Views.PlotView view(PlotEntity p) {
        Good crop = p.getCrop();
        return new Views.PlotView(p.getId(), p.getIslandId(), p.getCellX(), p.getCellZ(),
                crop == null ? null : crop.name(), crop == null ? null : crop.getLabel(),
                p.getState().name(), p.progress(), p.getPlannedYield(), p.getRipeElapsed(),
                p.getBuildingId());
    }
}
