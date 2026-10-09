package com.anno.service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.anno.config.GameProperties;
import com.anno.domain.BuildingEntity;
import com.anno.domain.BuildingType;
import com.anno.domain.RoadEntity;
import com.anno.domain.RoadKind;
import com.anno.domain.ResidentTier;
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
 * 马路：修路 / 拆路 / 查询路网。
 * <p>
 * 规则：一格只能有一条路；不能压在作物或建筑上；拆路返还一半造价。
 * 建筑必须紧邻马路才能盖（校验在 ProductionService.build 里）。
 */
@Service
public class RoadService {

    private final RoadRepository roadRepository;
    private final BuildingRepository buildingRepository;
    private final PlotRepository plotRepository;
    private final IslandService islandService;
    private final PlayerService playerService;
    private final PopulationService populationService;
    private final TerrainService terrainService;
    private final GameProperties props;
    private final GameSocketHub hub;

    public RoadService(RoadRepository roadRepository, BuildingRepository buildingRepository,
                       PlotRepository plotRepository, IslandService islandService, PlayerService playerService,
                       PopulationService populationService, TerrainService terrainService, GameProperties props,
                       GameSocketHub hub) {
        this.roadRepository = roadRepository;
        this.buildingRepository = buildingRepository;
        this.plotRepository = plotRepository;
        this.islandService = islandService;
        this.playerService = playerService;
        this.populationService = populationService;
        this.terrainService = terrainService;
        this.props = props;
        this.hub = hub;
    }

    /** 修一格马路（缺省土路，兼容老调用） */
    @Transactional
    public Views.RoadView build(Long playerId, Long islandId, Integer x, Integer z) {
        return build(playerId, islandId, x, z, (String) null);
    }

    /** 修一格马路：kind 指定路面种类（土路 / 石板路 / 砖路 / 林荫大道） */
    @Transactional
    public Views.RoadView build(Long playerId, Long islandId, Integer x, Integer z, String kind) {
        islandService.requireOwn(islandId, playerId);
        requireFreeCell(islandId, x, z, "这里已经是马路了");
        RoadKind rk = requireRoadKind(islandId, kind);
        playerService.spend(playerId, rk.cost, "修路·" + rk.label + "(" + x + "," + z + ")");
        RoadEntity r = roadRepository.save(new RoadEntity(islandId, x, z, rk));
        hub.broadcast("event", java.util.Map.of("type", "ROAD_BUILT",
                "serverTime", System.currentTimeMillis(),
                "payload", java.util.Map.of("playerId", playerId, "islandId", islandId, "x", x, "z", z,
                        "kind", rk.name())));
        return roadView(r);
    }

    /** 解析请求里的路面种类：认不出就报错，还没解锁也报错（提示差多少人） */
    private RoadKind requireRoadKind(Long islandId, String kind) {
        RoadKind rk;
        try {
            rk = RoadKind.of(kind);
            if (kind != null && !kind.isBlank()
                    && !rk.name().equalsIgnoreCase(kind.trim())) throw GameException.of("没有这种路面：" + kind);
        } catch (GameException e) {
            throw e;
        } catch (IllegalArgumentException e) {
            throw GameException.of("没有这种路面：" + kind);
        }
        if (rk.gate != null && !populationService.unlocked(islandId, rk.gate)) {
            ResidentTier req = rk.gate.getRequiredTier();
            throw GameException.of(rk.label + "还没解锁 —— 要等" + req.getLabel() + "满 "
                    + rk.gate.getRequiredPopulation() + " 人");
        }
        return rk;
    }

    private static Views.RoadView roadView(RoadEntity r) {
        RoadKind rk = r.getKind();
        return new Views.RoadView(r.getId(), r.getIslandId(), r.getCellX(), r.getCellZ(), rk.name(), rk.label);
    }

    /** 批量修路上限（与客户端划矩形的格子上限一致） */
    public static final int BATCH_LIMIT = 400;

    /**
     * 一条龙修路：一次 HTTP 往返 + 一个事务把整条线修完。
     * <p>
     * 【为什么要有这个接口】批量建造原来靠客户端逐格 await 单格接口 ——
     * 20 格的线 = 20 次<b>串行</b>往返，松手后画面前毫无反馈，最后还要一次性重建
     * 路网，"卡一下才出道路"就是这两段叠出来的。批量接口把 N 次往返压成 1 次。
     * <p>
     * 语义与旧版客户端逐格循环完全一致：逐格修，撞到第一个障碍（钱不够 / 有占用 /
     * 不能临路）就停，撞墙前的格子照常生效（部分成功）；响应里带 stop 说明停在哪。
     */
    @Transactional
    public Map<String, Object> buildBatch(Long playerId, Long islandId, List<Requests.CellRef> cells) {
        return buildBatch(playerId, islandId, cells, null);
    }

    /** 同上，整条一种路面 */
    @Transactional
    public Map<String, Object> buildBatch(Long playerId, Long islandId, List<Requests.CellRef> cells, String kind) {
        islandService.requireOwn(islandId, playerId);
        List<Views.RoadView> built = new ArrayList<>();
        String stop = null;
        if (cells == null || cells.isEmpty()) {
            stop = "没有要铺的格子";
        } else {
            for (Requests.CellRef c : cells) {
                if (built.size() >= BATCH_LIMIT) { stop = "一次最多铺 " + BATCH_LIMIT + " 格"; break; }
                try {
                    built.add(build(playerId, islandId, c.x(), c.z(), kind));
                } catch (GameException e) {
                    stop = e.getMessage();
                    break;
                }
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("built", built);
        out.put("count", built.size());
        out.put("stop", stop);
        return out;
    }

    /**
     * 路面改造：把已有路格换成另一种路面，收差价（{@link RoadKind#restyleCost}）。
     * 本来就是这种路面的格子跳过不收费；没路的格子跳过（修路走 build）。
     * 全部格子照单收完再报"钱不够"？不 —— 逐格扣，扣不动就停（部分成功，响应带 stop），
     * 和批量修路同一套语义，玩家不会遇到"一格没改钱却全扣了"。
     */
    @Transactional
    public Map<String, Object> restyle(Long playerId, Long islandId, String kind, List<Requests.CellRef> cells) {
        islandService.requireOwn(islandId, playerId);
        RoadKind rk = requireRoadKind(islandId, kind);
        int done = 0, spent = 0;
        String stop = null;
        if (cells == null || cells.isEmpty()) {
            stop = "没有要改造的格子";
        } else {
            for (Requests.CellRef c : cells) {
                RoadEntity r = roadRepository.findByIslandIdAndCellXAndCellZ(islandId, c.x(), c.z()).orElse(null);
                if (r == null) continue;                       // 没路的格子跳过
                if (r.getKind() == rk) continue;               // 已经是这种路面
                int fee = rk.restyleCost();
                try {
                    playerService.spend(playerId, fee, "改铺" + rk.label + "(" + c.x() + "," + c.z() + ")");
                } catch (GameException e) {
                    stop = e.getMessage();
                    break;
                }
                r.setKind(rk);
                roadRepository.save(r);   // 显式 save：dbRetry(REQUIRES_NEW) 包裹下别赌脏检查
                done++;
                spent += fee;
            }
        }
        if (done > 0) {
            hub.broadcast("event", java.util.Map.of("type", "ROAD_REBUILT",
                    "serverTime", System.currentTimeMillis(),
                    "payload", java.util.Map.of("playerId", playerId, "islandId", islandId, "kind", rk.name())));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("kind", rk.name());
        out.put("kindLabel", rk.label);
        out.put("restyled", done);
        out.put("spent", spent);
        out.put("stop", stop);
        return out;
    }

    /** 拆一格马路，返还一半造价（按这段路自己的路面算 —— 石板路拆了多退点） */
    @Transactional
    public void remove(Long playerId, Long islandId, Integer x, Integer z) {
        islandService.requireOwn(islandId, playerId);
        RoadEntity r = roadRepository.findByIslandIdAndCellXAndCellZ(islandId, x, z)
                .orElseThrow(() -> GameException.of("这里没有马路"));
        int n = roadRepository.deleteByIslandIdAndCellXAndCellZ(islandId, x, z);
        if (n == 0) throw GameException.of("这里没有马路");
        playerService.addTreasury(playerId, r.getKind().cost * props.getRoadRefundRate());
        hub.broadcast("event", java.util.Map.of("type", "ROAD_REMOVED",
                "serverTime", System.currentTimeMillis(),
                "payload", java.util.Map.of("playerId", playerId, "islandId", islandId, "x", x, "z", z)));
    }

    @Transactional(readOnly = true)
    public List<Views.RoadView> roads(Long islandId) {
        return roadRepository.findByIslandId(islandId).stream()
                .map(RoadService::roadView)
                .toList();
    }

    /** 该格子是否紧邻马路（四邻，不含对角） */
    @Transactional(readOnly = true)
    public boolean nearRoad(Long islandId, int x, int z) {
        return nearRoad(islandId, x, z, 1, 1);
    }

    /**
     * 占地 w×h 的建筑是否临路：**外圈任意一格**是马路即可。
     * <p>
     * 不再要求"四邻都有路"—— 4×4 的炼钢厂四面环街既不合理也没必要，贴一条边就能运货。
     * 这里直接拿本岛路网做一次内存判定，避免 4×4 打十几条 exists 查询。
     * <p>
     * 注意外圈**包含四个角格**（斜对角有路也算靠得上）；只有"门朝哪边"才需要角格以外的
     * 真正的一条边，那部分逻辑在 {@link #doorRotation}。
     */
    @Transactional(readOnly = true)
    public boolean nearRoad(Long islandId, int x, int z, int w, int h) {
        for (RoadEntity r : roadRepository.findByIslandId(islandId)) {
            if (BuildingType.perimeterHas(x, z, w, h, r.getCellX(), r.getCellZ())) return true;
        }
        return false;
    }

    /**
     * <b>大门朝向自动吸附</b>：算出占地外圈哪一侧的马路最多，返回那一侧的朝向角度
     * （0=门朝南 +z、90=门朝东 +x、180=门朝北 -z、270=门朝西 -x）。四面都没路返回 -1。
     * <p>
     * 为什么取"马路最多的一侧"而不是"第一侧有路就行"：厂房往往只贴一条街，
     * 但路口拐角处相邻两侧都会有一两格路；按格数取最多的那侧，门才会朝着真正的主路开，
     * 而不是随机开在某个角落。平手时按 南 → 东 → 北 → 西 的顺序（结果可复现，不是随机的）。
     */
    @Transactional(readOnly = true)
    public int doorRotation(Long islandId, int x, int z, int w, int h) {
        int[] hits = sideHits(islandId, x, z, w, h);
        int bestSide = -1, bestCount = 0;
        for (int side = 0; side < 4; side++) {
            if (hits[side] > bestCount) { bestCount = hits[side]; bestSide = side; }
        }
        return bestSide < 0 ? -1 : bestSide * 90;
    }

    /**
     * 四个朝向按「门前马路多」排序后的候选列表，供建造时逐个试：
     * 首选那侧有路的朝向（门贴着主路），那侧若阵型放不下（4×3 转 3×4 可能顶到岛边），
     * 就依次退让给下一个朝向。
     */
    @Transactional(readOnly = true)
    public int[] doorRotationCandidates(Long islandId, int x, int z, int w, int h) {
        int[] hits = sideHits(islandId, x, z, w, h);
        Integer[] order = {0, 1, 2, 3};
        java.util.Arrays.sort(order, (a, b) -> hits[a] != hits[b] ? hits[b] - hits[a] : a - b);
        int[] out = new int[4];
        for (int i = 0; i < 4; i++) out[i] = order[i] * 90;
        return out;
    }

    /** 占地外圈上，南 / 东 / 北 / 西 各侧各有多少格马路 */
    private int[] sideHits(Long islandId, int x, int z, int w, int h) {
        int[] hits = new int[4];
        for (RoadEntity r : roadRepository.findByIslandId(islandId)) {
            int side = BuildingType.perimeterSideOf(x, z, w, h, r.getCellX(), r.getCellZ());
            if (side >= 0) hits[side]++;
        }
        return hits;
    }

    /** 校验格子可修路：在岛上、是平原（不是水也不是山）、没种作物、没被建筑（含多格占地）压着 */
    private void requireFreeCell(Long islandId, Integer x, Integer z, String roadMsg) {
        if (x == null || z == null) throw GameException.of("请选择格子");
        TerrainMap terrain = terrainService.of(islandId);
        if (!terrain.inGrid(x, z)) throw GameException.of("这一格超出岛屿范围");
        // 岛形是随机的：网格里到处都可能是海与山，修路前必须先问地形
        if (terrain.isWater(x, z)) throw GameException.of("这里是水面，修不了马路");
        if (terrain.isMountain(x, z)) throw GameException.of("这里是山地（陡坡），马路修不过去");
        if (plotRepository.existsByIslandIdAndCellXAndCellZ(islandId, x, z)) {
            throw GameException.of("这一格种了作物，先收获或清理再修路");
        }
        // 建筑可能占好几格：只比锚点会让马路"穿"进厂房
        for (BuildingEntity b : buildingRepository.findByIslandId(islandId)) {
            if (b.covers(x, z)) {
                throw GameException.of(String.format("这里是%s的占地（%d×%d 格），先拆掉建筑才能修路",
                        b.getType().getLabel(), b.getSizeW(), b.getSizeH()));
            }
        }
        if (roadRepository.existsByIslandIdAndCellXAndCellZ(islandId, x, z)) {
            throw GameException.of(roadMsg);
        }
    }
}
