package com.anno.service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.anno.domain.BuildingEntity;
import com.anno.domain.BuildingType;
import com.anno.domain.IslandEntity;
import com.anno.domain.ShipBuildEntity;
import com.anno.domain.ShipEntity;
import com.anno.domain.ShipType;
import com.anno.dto.Views;
import com.anno.exception.GameException;
import com.anno.repo.BuildingRepository;
import com.anno.repo.IslandRepository;
import com.anno.repo.ShipBuildRepository;
import com.anno.repo.ShipRepository;
import com.anno.ws.GameSocketHub;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 造船厂：开工（扣金币 + 扣木板等物料）→ 船台工期（随岛屿心跳推进）→ 完工入舰队。
 * <p>
 * 【造船厂是码头类建筑】选址复用港口的"骑岸线"校验（船台本来就该伸到水边），
 * 但它<b>不是</b>贸易站：居民物资前提、NPC 商船挂靠、马车入库仍然只认贸易站。
 * <p>
 * 【一岛一船台】同一座岛的造船厂同时只能造一艘 —— 船台就一个，符合直觉，
 * 也省掉多船并进的队列 UI。工期是游戏秒：离线冻结、时间倍率同全岛模拟。
 * <p>
 * 【舰队】完工的船进 {@code player_ship} 表，闲置（IDLE）的船是远征的
 * "门票" —— 见 {@link ExpeditionService}：一艘闲置船 = 一条可出发的远征。
 */
@Service
public class ShipyardService {

    private static final Logger log = LoggerFactory.getLogger(ShipyardService.class);

    private final ShipRepository shipRepo;
    private final ShipBuildRepository buildRepo;
    private final BuildingRepository buildingRepository;
    private final IslandRepository islandRepository;
    private final PlayerService playerService;
    private final InventoryService inventoryService;
    private final GameSocketHub hub;

    public ShipyardService(ShipRepository shipRepo, ShipBuildRepository buildRepo,
                           BuildingRepository buildingRepository, IslandRepository islandRepository,
                           PlayerService playerService, InventoryService inventoryService,
                           GameSocketHub hub) {
        this.shipRepo = shipRepo;
        this.buildRepo = buildRepo;
        this.buildingRepository = buildingRepository;
        this.islandRepository = islandRepository;
        this.playerService = playerService;
        this.inventoryService = inventoryService;
        this.hub = hub;
    }

    /* ================= 查询 ================= */

    @Transactional(readOnly = true)
    public Views.FleetView fleet(Long playerId) {
        List<Views.FleetShipView> ships = new ArrayList<>();
        for (ShipEntity s : shipRepo.findByPlayerIdOrderByIdAsc(playerId)) ships.add(shipView(s));
        List<Views.ShipBuildView> builds = new ArrayList<>();
        for (ShipBuildEntity b : buildRepo.findByPlayerId(playerId)) builds.add(buildView(b));
        return new Views.FleetView(ships, builds);
    }

    /** 船型目录：客户端造船面板直接渲染，不在前端硬编码造价 */
    public List<Views.ShipTypeView> catalog() {
        List<Views.ShipTypeView> out = new ArrayList<>();
        for (ShipType t : ShipType.values()) {
            List<Map<String, Object>> goods = new ArrayList<>();
            t.goodsCost.forEach((g, qty) -> goods.add(Map.of(
                    "good", g.name(), "label", g.getLabel(), "qty", qty)));
            out.add(new Views.ShipTypeView(t.name(), t.label, t.coinCost, goods,
                    t.buildSeconds, t.expeditionBonus));
        }
        return out;
    }

    /* ================= 开工 ================= */

    @Transactional
    public Views.ShipBuildView build(Long playerId, Long islandId, String shipTypeKey) {
        playerService.require(playerId);
        IslandEntity island = islandRepository.findById(islandId)
                .orElseThrow(() -> GameException.of("岛屿不存在"));
        if (!island.getOwnerId().equals(playerId)) throw GameException.of("这不是你的岛");

        ShipType st = ShipType.parse(shipTypeKey);

        boolean hasShipyard = buildingRepository.findByIslandId(islandId).stream()
                .anyMatch(b -> b.getType() == BuildingType.SHIPYARD);
        if (!hasShipyard) throw GameException.of("岛上还没有造船厂 —— 先在岸线上建一座（骑在海岸带上）");

        if (!buildRepo.findByIslandId(islandId).isEmpty())
            throw GameException.of("船台上已经开工了一艘 —— 一次只能造一艘，等它下水");

        playerService.spend(playerId, st.coinCost, "造船");
        for (Map.Entry<com.anno.domain.Good, Integer> c : st.goodsCost.entrySet())
            inventoryService.remove(playerId, c.getKey(), c.getValue());

        ShipBuildEntity b = new ShipBuildEntity(playerId, islandId, st.name(),
                st.buildSeconds, System.currentTimeMillis());
        buildRepo.save(b);
        try {
            hub.sendToPlayer(playerId, "ship", Map.of("kind", "building", "build", buildView(b)));
        } catch (Exception ex) {
            log.warn("造船推送失败：{}", ex.toString());
        }
        return buildView(b);
    }

    /* ================= 心跳推进（IslandSimService 每拍调） ================= */

    @Transactional
    public void tickIsland(Long islandId, Long ownerId, double seconds) {
        List<ShipBuildEntity> builds = buildRepo.findByIslandId(islandId);
        if (builds.isEmpty()) return;

        boolean shipyardStillThere = buildingRepository.findByIslandId(islandId).stream()
                .anyMatch(b -> b.getType() == BuildingType.SHIPYARD);

        for (ShipBuildEntity b : builds) {
            try {
                if (!shipyardStillThere) {          // 船台被拆了：船造不下去，工料不退
                    buildRepo.delete(b);
                    push(ownerId, "cancelled", null);
                    continue;
                }
                b.setElapsed(b.getElapsed() + seconds);
                if (b.getElapsed() >= b.getTotalSeconds()) {
                    ShipEntity ship = new ShipEntity(b.getPlayerId(), islandId,
                            b.getShipType(), System.currentTimeMillis());
                    shipRepo.save(ship);
                    buildRepo.delete(b);
                    push(b.getPlayerId(), "launched", shipView(ship));
                } else {
                    buildRepo.save(b);
                }
            } catch (Exception ex) {
                log.warn("造船 {} 推进失败：{}", b.getId(), ex.toString());
            }
        }
    }

    /* ================= 视图与推送 ================= */

    public Views.FleetShipView shipView(ShipEntity s) {
        ShipType t = ShipType.parse(s.getType());
        return new Views.FleetShipView(s.getId(), s.getIslandId(), s.getType(), t.label,
                s.getState(), "AWAY".equals(s.getState()) ? "在海上" : "闲置停泊");
    }

    public Views.ShipBuildView buildView(ShipBuildEntity b) {
        ShipType t = ShipType.parse(b.getShipType());
        return new Views.ShipBuildView(b.getId(), b.getIslandId(), b.getShipType(),
                t.label, b.progress(), b.getTotalSeconds());
    }

    private void push(Long playerId, String kind, Views.FleetShipView ship) {
        try {
            Map<String, Object> payload = ship == null
                    ? Map.of("kind", kind)
                    : Map.of("kind", kind, "ship", ship);
            hub.sendToPlayer(playerId, "ship", payload);
        } catch (Exception ex) {
            log.warn("造船推送失败：{}", ex.toString());
        }
    }
}
