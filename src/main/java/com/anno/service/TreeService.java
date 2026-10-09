package com.anno.service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.anno.config.GameProperties;
import com.anno.domain.BuildingEntity;
import com.anno.domain.TerrainMap;
import com.anno.domain.TreeChopEntity;
import com.anno.repo.BuildingRepository;
import com.anno.repo.PlotRepository;
import com.anno.repo.RoadRepository;
import com.anno.repo.TreeChopRepository;

/**
 * 树木的<b>服务端账本</b>：初始森林是确定性推导的，会变的只有"哪些格子被砍了"。
 * <p>
 * 【为什么这么设计】树的布局 100% 由岛 id 决定 —— 客户端 {@code buildTrees()}
 * （game.html）用「岛 id 种子 + 逐格哈希」算出整片森林，服务端零数据。
 * 伐木场要"真的砍附近的树"，服务端就必须知道每格有没有树 —— 办法不是落库全量树
 * （1600 行/岛、客户端渲染链路要整个改掉），而是 <b>Java 1:1 复刻客户端算法</b> +
 * 一张砍伐记录表（{@code tree_chop}，一行 = 一格永远没树）。两边同一套算法、
 * 同一份地形串、同一份砍伐记录，推导结果必然一致。
 * <p>
 * 【位级对齐是硬指标】客户端是 JS 位运算（32 位环绕），这里全部用 Java
 * {@code int} 自然溢出 —— 两者的位模式对每一步运算都相同；唯一的浮点环节
 * {@code hash2} 的 {@code Math.sin} 用 {@link StrictMath#sin}（fdlibm，与 V8 同源）。
 * 验证脚本会用「客户端 {@code __annoTreePositions()} ↔ 服务端静态树集」全等对拍。
 * <p>
 * 【排除规则与客户端 buildTrees 逐条对齐】水（陆地的反面）、海岸带（离水 ≤
 * coast-width 步）、山地、矿脉是<b>静态</b>的（地形决定，可缓存）；
 * 建筑 / 马路 / 农田占格是<b>动态</b>的（每次查询现算）—— 与客户端
 * "修路只移除路面那一棵、其他树纹丝不动"的稳定性同一套语义。
 * <p>
 * 【森林会复育】被砍的格子记在 {@code tree_chop}（一行 = 一格 + 复育时刻），
 * 时刻一到这格就重新算"有树"—— 伐木场不用搬家，森林轮伐即可永续。
 */
@Service
public class TreeService {

    /** 树的一格：坐标 + 到伐木场的距离（砍伐按"从近到远"排序）+ 复育时刻（0 = 非砍伐查询） */
    public record TreeCell(int x, int z, double dist, long regrowAt) { }

    /** 调试 / 下发快照：静态树集（纯地形推导）+ 已砍列表（[x, z, 复育时刻]） */
    public record TreeInfo(int staticCount, List<int[]> staticTrees, List<long[]> chopped) { }

    private final TerrainService terrainService;
    private final TreeChopRepository chopRepository;
    private final BuildingRepository buildingRepository;
    private final RoadRepository roadRepository;
    private final PlotRepository plotRepository;
    private final GameProperties props;

    /** 每座岛的静态树格缓存（地形串 + 岛 id 决定，进程内不变） */
    private final Map<Long, boolean[]> staticCache = new ConcurrentHashMap<>();

    public TreeService(TerrainService terrainService, TreeChopRepository chopRepository,
                       BuildingRepository buildingRepository, RoadRepository roadRepository,
                       PlotRepository plotRepository, GameProperties props) {
        this.terrainService = terrainService;
        this.chopRepository = chopRepository;
        this.buildingRepository = buildingRepository;
        this.roadRepository = roadRepository;
        this.plotRepository = plotRepository;
        this.props = props;
    }

    /* ==================================================================
       与客户端 buildTrees（game.html "9. 树木"）逐行对齐的纯函数
       ================================================================== */

    /**
     * 格子 → 大数空间哈希（客户端 {@code cellHash}）。
     * <p>
     * JS 里 {@code (seed + (x*A ^ z*B)) >>> 0}：中间值以 float64 参与加法后
     * ToUint32；Java 用 int 自然溢出 —— 补码加法与 uint 加法在 mod 2³² 下同余，
     * 位模式完全一致。前提 {@code islandId * 7919 < 2^53}（自增主键远远够不着）。
     */
    public static int cellHash(int x, int z, int seed) {
        return seed + ((x * 73856093) ^ (z * 19349663));
    }

    /**
     * mulberry32 风格哈希 → [0,1)（客户端 {@code seededRand}）。
     * {@code Math.imul(a,b)} 的 Java 等价物就是 int 乘法（溢出截断 32 位）。
     */
    public static double seededRand(int seed) {
        int t = seed + 0x6D2B79F5;
        t = (t ^ (t >>> 15)) * (t | 1);
        t ^= t + ((t ^ (t >>> 7)) * (t | 61));
        return ((t ^ (t >>> 14)) & 0xFFFFFFFFL) / 4294967296.0;
    }

    /** 格点哈希（客户端 {@code hash2}）：StrictMath.sin 与 V8 的 Math.sin 同为 fdlibm */
    public static double hash2(double x, double y) {
        double n = StrictMath.sin(x * 127.1 + y * 311.7) * 43758.5453;
        return n - StrictMath.floor(n);
    }

    /** 平滑值噪声（客户端 {@code smoothNoise}）：格点哈希 + smoothstep 双线性插值 */
    public static double smoothNoise(double x, double y) {
        int xi = (int) StrictMath.floor(x), yi = (int) StrictMath.floor(y);
        double xf = x - xi, yf = y - yi;
        double u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
        double a = hash2(xi, yi), b = hash2(xi + 1, yi);
        double c = hash2(xi, yi + 1), e = hash2(xi + 1, yi + 1);
        return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + e * u) * v;
    }

    /* ==================================================================
       静态树格（纯地形推导，缓存）
       ================================================================== */

    /**
     * 静态树格位图（不含建筑/路/农田/砍伐这些动态因素）。
     * <p>
     * 对齐客户端 {@code buildTrees}：{@code density = min(1, 2800/陆地格数)} 是
     * <b>地形常量</b>（山、矿、海岸格都算陆地、都进分母 —— 与客户端 landCells 一致），
     * {@code p = max(0, (grove - 0.35) × 0.85) × density} —— 纪元式<strong>成片森林</strong>：
     * 林区强度不到 0.35 的空地一树不长，深林区（grove→1） probability ≈ 0.55×density；
     * 噪声频率 0.05 让林区斑块直径放大到 ~18 格，一眼就是"一片森林"。
     */
    public boolean[] staticTreeGrid(long islandId) {
        return staticCache.computeIfAbsent(islandId, id -> computeStatic(id, terrainService.of(id)));
    }

    private boolean[] computeStatic(long islandId, TerrainMap map) {
        int size = map.size();
        boolean[] grid = new boolean[size * size];
        int land = map.count(TerrainMap.PLAIN) + map.count(TerrainMap.MOUNTAIN)
                + map.count(TerrainMap.IRON) + map.count(TerrainMap.CLAY);
        double density = Math.min(1.0, 2800.0 / Math.max(1, land));
        int seedBase = (int) (islandId * 7919);
        int coast = props.getCoastWidth();
        for (int z = 0; z < size; z++) {
            for (int x = 0; x < size; x++) {
                char c = map.at(x, z);
                if (c == TerrainMap.WATER) continue;                    // 水里不长树
                if (map.isCoast(x, z, coast)) continue;                 // 沙滩不长树
                if (c == TerrainMap.MOUNTAIN) continue;                 // 山地不长树
                if (c == TerrainMap.IRON || c == TerrainMap.CLAY) continue; // 矿脉露出来
                double grove = smoothNoise(x * 0.05 + 3.1, z * 0.05 + 8.7);
                double p = Math.max(0, (grove - 0.35) * 0.85) * density; // 只有林区才长树（与客户端同判式）
                if (seededRand(cellHash(x, z, seedBase)) > p) continue; // rand ≤ p 才长（与客户端同判式）
                grid[z * size + x] = true;
            }
        }
        return grid;
    }

    /* ==================================================================
       动态查询：现存树（排除占格与已砍）
       ================================================================== */

    /**
     * 伐木场半径内的<b>现存</b>树，按距离从近到远排序。
     * 建筑占地 / 马路 / 农田上的树不算（长不出来）；被砍的格子要等树苗复育期满
     * （{@code regrowAt} 之前不算树）—— 补种让森林成为可再生资源。
     */
    @Transactional(readOnly = true)
    public List<TreeCell> availableTreesNear(BuildingEntity mill, double radius) {
        TerrainMap map = terrainService.of(mill.getIslandId());
        boolean[] grid = staticTreeGrid(mill.getIslandId());
        Set<Long> blocked = occupiedCells(mill.getIslandId());
        Map<Long, Long> chopAt = chopTimes(mill.getIslandId());
        long now = System.currentTimeMillis();
        int size = map.size();
        double cx = mill.getGridX() + mill.getSizeW() / 2.0;
        double cz = mill.getGridZ() + mill.getSizeH() / 2.0;
        int r = (int) Math.ceil(radius);
        List<TreeCell> out = new ArrayList<>();
        for (int dz = -r; dz <= r; dz++) {
            for (int dx = -r; dx <= r; dx++) {
                int x = mill.getGridX() + dx, z = mill.getGridZ() + dz;
                if (x < 0 || z < 0 || x >= size || z >= size) continue;
                if (!grid[z * size + x]) continue;
                double d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
                if (d > radius) continue;
                if (blocked.contains(key(x, z))) continue;
                Long rg = chopAt.get(key(x, z));
                if (rg != null && rg > now) continue;   // 树苗还没长成：这格暂时没树
                out.add(new TreeCell(x, z, d, 0L));
            }
        }
        out.sort(Comparator.comparingDouble(TreeCell::dist));
        return out;
    }

    /**
     * 砍掉半径内<b>最近</b>的一棵树，返回被砍的格子（带复育时刻）；半径内没树返回 {@code null}。
     * 唯一约束兜底并发：同一格永远只有一行砍伐记录（复育不改行，只看时间）。
     */
    @Transactional
    public TreeCell chopNearest(BuildingEntity mill, double radius) {
        List<TreeCell> trees = availableTreesNear(mill, radius);
        if (trees.isEmpty()) return null;
        TreeCell t = trees.get(0);
        if (chopRepository.existsByIslandIdAndCellXAndCellZ(mill.getIslandId(), t.x(), t.z())) return null;
        long regrowAt = System.currentTimeMillis() + props.getLumberRegrowMinutes() * 60_000L;
        chopRepository.save(new TreeChopEntity(mill.getIslandId(), t.x(), t.z(), regrowAt));
        return new TreeCell(t.x(), t.z(), t.dist(), regrowAt);
    }

    /** 半径内现存树的数量（停产判定用，省得把整棵列表搬回去） */
    @Transactional(readOnly = true)
    public int availableTreeCount(BuildingEntity mill, double radius) {
        return availableTreesNear(mill, radius).size();
    }

    /** 调试 / 客户端加载用：静态树集 + 砍伐记录（含复育时刻，0 = 老档早已复育） */
    @Transactional(readOnly = true)
    public TreeInfo info(long islandId) {
        boolean[] grid = staticTreeGrid(islandId);
        int size = terrainService.of(islandId).size();
        List<int[]> staticTrees = new ArrayList<>();
        for (int z = 0; z < size; z++) {
            for (int x = 0; x < size; x++) {
                if (grid[z * size + x]) staticTrees.add(new int[]{x, z});
            }
        }
        List<long[]> chopped = chopRepository.findByIslandId(islandId).stream()
                .map(c -> new long[]{c.getCellX(), c.getCellZ(), c.getRegrowAt()}).toList();
        return new TreeInfo(staticTrees.size(), staticTrees, chopped);
    }

    /* ---------------- 占格与砍伐记录 ---------------- */

    /** 建筑 + 马路 + 农田的占格集合（客户端 buildTrees 的三个动态排除） */
    private Set<Long> occupiedCells(long islandId) {
        Set<Long> out = new HashSet<>();
        for (BuildingEntity b : buildingRepository.findByIslandId(islandId)) {
            if (b.getGridX() == null || b.getGridZ() == null) continue;
            for (int x = b.getGridX(); x < b.getGridX() + b.getSizeW(); x++) {
                for (int z = b.getGridZ(); z < b.getGridZ() + b.getSizeH(); z++) {
                    out.add(key(x, z));
                }
            }
        }
        roadRepository.findByIslandId(islandId).forEach(r -> out.add(key(r.getCellX(), r.getCellZ())));
        plotRepository.findByIslandIdOrderByCellXAscCellZAsc(islandId).forEach(p -> out.add(key(p.getCellX(), p.getCellZ())));
        return out;
    }

    /** 砍伐记录：格子 → 复育时刻（ms 纪元）。时刻已过的格子视为树已长回 */
    private Map<Long, Long> chopTimes(long islandId) {
        Map<Long, Long> out = new HashMap<>();
        chopRepository.findByIslandId(islandId).forEach(c -> out.put(key(c.getCellX(), c.getCellZ()), c.getRegrowAt()));
        return out;
    }

    private long key(int x, int z) { return (long) x << 20 | z; }
}
