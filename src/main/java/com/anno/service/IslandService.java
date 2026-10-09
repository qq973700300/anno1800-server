package com.anno.service;

import java.util.List;
import java.util.concurrent.ThreadLocalRandom;

import com.anno.config.GameProperties;
import com.anno.domain.IslandEntity;
import com.anno.domain.TerrainMap;
import com.anno.dto.Views;
import com.anno.exception.GameException;
import com.anno.repo.IslandRepository;
import com.anno.repo.PlotRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 岛屿：创建领地。
 * <p>
 * 岛**不是**方形，也**不是**整片陆地：每座岛有一张由 id 决定的地形图（海面 / 平原 / 山地 / 矿脉），
 * 玩家自己在平原上播种、修路、盖房，在沙滩上放港口，在矿脉上开矿。
 * 地形由 {@link TerrainService} 统一供给，这里只负责"开岛时把它定下来"。
 */
@Service
public class IslandService {

    private static final Logger log = LoggerFactory.getLogger(IslandService.class);

    private final IslandRepository islandRepository;
    private final PlotRepository plotRepository;
    private final TerrainService terrainService;
    private final GameProperties props;

    public IslandService(IslandRepository islandRepository, PlotRepository plotRepository,
                         TerrainService terrainService, GameProperties props) {
        this.islandRepository = islandRepository;
        this.plotRepository = plotRepository;
        this.terrainService = terrainService;
        this.props = props;
    }

    public IslandEntity create(Long ownerId, String name) {
        return create(ownerId, name, false);
    }

    /**
     * 开一座新岛。
     *
     * @param flat 铺一座**一整片平原的平岛**（没有水、没有山、没有矿）。
     *             给自动化测试与调试用：随机岛形没法让脚本写死坐标，
     *             而回归测试要的恰恰是"同样的输入、同样的结果"。
     */
    @Transactional
    public IslandEntity create(Long ownerId, String name, boolean flat) {
        String islandName = (name == null || name.isBlank())
                ? "新岛屿-" + (islandRepository.countByOwnerId(ownerId) + 1) : name.trim();
        // 肥力随机 40~95，决定这座岛适不适合种地
        int fertility = ThreadLocalRandom.current().nextInt(40, 96);
        IslandEntity island = islandRepository.save(
                new IslandEntity(ownerId, islandName, fertility, props.getPlotLimit()));

        // 地形要有 id 才能定种子（同一座岛永远同一张图），所以先落库拿到 id 再补地形。
        // 这次 setTerrain 不用再 save：实体在事务里是受管的，提交时脏检查会一起写下去。
        String terrain = flat
                ? TerrainMap.flatString(props.getGridSize())
                : TerrainMap.generate(terrainService.seedFor(island.getId()),
                        props.getGridSize(), terrainService.shape()).encode();
        island.setTerrain(terrain);

        terrainService.invalidate(island.getId());
        log.info("岛屿 #{}（{}）地形：{}", island.getId(), islandName, terrainService.of(island).describe());
        return island;
    }

    @Transactional(readOnly = true)
    public IslandEntity require(Long islandId) {
        return islandRepository.findById(islandId)
                .orElseThrow(() -> GameException.of("岛屿不存在：" + islandId));
    }

    @Transactional(readOnly = true)
    public IslandEntity requireOwn(Long islandId, Long playerId) {
        IslandEntity island = require(islandId);
        if (!island.getOwnerId().equals(playerId)) {
            throw GameException.of("这不是你的岛屿");
        }
        return island;
    }

    @Transactional(readOnly = true)
    public List<Views.IslandView> list(Long ownerId) {
        return islandRepository.findByOwnerId(ownerId).stream().map(this::view).toList();
    }

    /** 岛屿视图：网格参数 + **地形串**。客户端照地形串画出岛形，种植资格由「对应农场建筑」决定 */
    public Views.IslandView view(IslandEntity i) {
        TerrainMap terrain = terrainService.of(i);
        return new Views.IslandView(i.getId(), i.getOwnerId(), i.getName(),
                i.getFertility(), i.getPlotLimit(), plotRepository.countByIslandId(i.getId()),
                props.getGridSize(), props.getCoastWidth(), props.getRoadCost(),
                terrain.encode(), terrainService.seedFor(i.getId()), terrain.describe(),
                i.gameHourAt(System.currentTimeMillis()), IslandEntity.DAY_SECONDS);
    }

    @Transactional(readOnly = true)
    public Long ownerOf(Long islandId) {
        return require(islandId).getOwnerId();
    }
}
