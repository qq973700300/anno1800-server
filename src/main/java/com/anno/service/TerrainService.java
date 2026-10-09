package com.anno.service;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import com.anno.config.GameProperties;
import com.anno.domain.IslandEntity;
import com.anno.domain.TerrainMap;
import com.anno.repo.IslandRepository;
import org.springframework.stereotype.Service;

/**
 * 地形的唯一权威。
 *
 * <p>服务端所有"这一格能不能修路 / 盖房 / 种地"的判断都必须走这里，
 * 客户端也拿同一份地形串（{@code IslandView.terrain}）自行渲染 ——
 * <b>地形定义只能有一份</b>。两边各写一套生成算法迟早会漂移：
 * 玩家在 3D 里看到的是草地、点下去服务端说"这一格是水"，这种 bug 极难查。
 *
 * <p>【地形从哪来】
 * <ol>
 *   <li>岛上有落库的地形串（{@code island.terrain}）—— 直接解析，正常路径走这条；</li>
 *   <li>没有（改造前建的老岛）—— 由 {@link #seedFor} 从岛屿 id 推导，
 *       同一座岛永远同一张图，所以不落库也能复现；</li>
 *   <li>落库的串和当前 {@code anno.grid-size} 对不上（改过地图大小）——
 *       按同一套规则重算，顺便从"整片平原"识别出平岛、保持它仍是平岛。</li>
 * </ol>
 *
 * <p>【缓存】地形是纯函数（id + 配置 -> 图），且建好就不再变，所以在内存里缓存。
 * 缓存只影响性能，不影响正确性：丢了重算结果也一样。
 */
@Service
public class TerrainService {

    /** 缓存上限：一座岛约 1KB 字符 + 一个 int 数组，256 座岛不到 1MB */
    private static final int CACHE_LIMIT = 256;

    private final IslandRepository islandRepository;
    private final GameProperties props;

    private final Map<Long, TerrainMap> cache = new ConcurrentHashMap<>();
    /** 缓存是按某个 grid-size 生成的；地图大小改了就得整体作废 */
    private volatile int cachedSize = -1;

    public TerrainService(IslandRepository islandRepository, GameProperties props) {
        this.islandRepository = islandRepository;
        this.props = props;
    }

    /** 岛屿 id + 地图尺寸 -> 地形种子。同一座岛永远同一张图，这是"不落库也能复现"的前提 */
    public long seedFor(Long islandId) {
        long id = islandId == null ? 0L : islandId;
        return id * 0x9E3779B97F4A7C15L ^ props.getGridSize() * 0x2545F4914F6CDD1DL;
    }

    /** 当前生成参数（Application.yml 的 anno.terrain.*） */
    public TerrainMap.Shape shape() {
        GameProperties.Terrain t = props.getTerrain();
        return new TerrainMap.Shape(t.getLandRatio(), t.getMountainRatio(),
                t.getIronVeins(), t.getClayVeins());
    }

    /** 取这座岛的地形图（按 id；缓存里有就直接给） */
    public TerrainMap of(Long islandId) {
        ensureCacheSize();
        TerrainMap cached = cache.get(islandId);
        if (cached != null) return cached;

        IslandEntity island = islandRepository.findById(islandId).orElse(null);
        return resolve(islandId, island == null ? null : island.getTerrain());
    }

    /** 取这座岛的地形图（手里已经有实体时用这个，省一次查询） */
    public TerrainMap of(IslandEntity island) {
        if (island == null) return TerrainMap.flat(props.getGridSize());
        ensureCacheSize();
        TerrainMap cached = cache.get(island.getId());
        if (cached != null) return cached;
        return resolve(island.getId(), island.getTerrain());
    }

    /** 建岛 / 改地形之后调一次，丢掉可能存在的旧缓存 */
    public void invalidate(Long islandId) {
        if (islandId != null) cache.remove(islandId);
    }

    /* ---------------- 内部 ---------------- */

    private void ensureCacheSize() {
        int size = props.getGridSize();
        if (size != cachedSize) {
            cache.clear();
            cachedSize = size;
        } else if (cache.size() > CACHE_LIMIT) {
            cache.clear();
        }
    }

    private TerrainMap resolve(Long islandId, String stored) {
        int size = props.getGridSize();
        TerrainMap map;
        if (stored == null || stored.isBlank()) {
            // 老岛：没有落库的地形，按 id 现推一张（不写库，避免"读接口顺手写库"）
            map = TerrainMap.generate(seedFor(islandId), size, shape());
        } else if (stored.length() == size * size) {
            map = TerrainMap.parse(stored, size);
        } else if (stored.chars().allMatch(c -> c == TerrainMap.PLAIN)) {
            // 尺寸对不上的平岛：它本来就是"一整片平原"，按新尺寸重新铺平就行
            map = TerrainMap.flat(size);
        } else {
            map = TerrainMap.generate(seedFor(islandId), size, shape());
        }
        cache.put(islandId, map);
        return map;
    }
}
