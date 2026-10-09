package com.anno.controller;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;

import com.anno.domain.BuildingType;
import com.anno.domain.Good;
import com.anno.dto.ApiResponse;
import com.anno.service.GameTickService;
import com.anno.service.MarketService;
import com.anno.ws.GameSocketHub;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 世界状态与静态配置（客户端做 UI 时拉一次即可） */
@RestController
@RequestMapping("/api/world")
public class WorldController {

    private final MarketService marketService;
    private final GameTickService gameTickService;
    private final GameSocketHub hub;

    public WorldController(MarketService marketService, GameTickService gameTickService, GameSocketHub hub) {
        this.marketService = marketService;
        this.gameTickService = gameTickService;
        this.hub = hub;
    }

    /** 服务器状态：心跳数、在线人数、连接数、行情 */
    @GetMapping
    public ApiResponse<Map<String, Object>> status() {
        return ApiResponse.ok(Map.of(
                "serverTime", System.currentTimeMillis(),
                "tick", gameTickService.getTick(),
                "onlinePlayers", hub.onlinePlayerIds().size(),
                "connections", hub.sessionCount(),
                "market", marketService.snapshot()));
    }

    /** 所有商品定义（含作物生长时间、产量、种子成本） */
    @GetMapping("/goods")
    public ApiResponse<Object> goods() {
        return ApiResponse.ok(Arrays.stream(Good.values()).map(g -> Map.of(
                "code", g.name(),
                "label", g.getLabel(),
                "category", g.getCategory().name(),
                "basePrice", g.getBasePrice(),
                "plantable", g.isPlantable(),
                "growthSeconds", g.getGrowthSeconds(),
                "yieldPerHarvest", g.getYieldPerHarvest(),
                "seedCost", g.getSeedCost()
        )).toList());
    }

    /**
     * 所有建筑定义与生产配方（含用途 kind、住宅容量、采掘类所需矿脉，供客户端区分厂房 / 住宅 / 港口）。
     * <p>
     * 用 LinkedHashMap 而不是 Map.of：字段数早就超过 10 对，Map.of 的上限是 10。
     */
    @GetMapping("/buildings")
    public ApiResponse<Object> buildings() {
        return ApiResponse.ok(Arrays.stream(BuildingType.values()).map(b -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("code", b.name());
            m.put("label", b.getLabel());
            m.put("buildCost", b.getBuildCost());
            // 建造材料（纪元1800式）：与 /api/buildings/catalog 的 goodsCost 同源同格式
            m.put("goodsCost", b.getBuildGoods().entrySet().stream()
                    .map(e -> Map.of("good", e.getKey().name(), "label", e.getKey().getLabel(), "qty", e.getValue()))
                    .toList());
            m.put("durationSeconds", b.getDurationSeconds());
            m.put("kind", b.getKind().name());
            m.put("residentTier", b.getResidentTier() == null ? "" : b.getResidentTier().name());
            m.put("residentCapacity", b.getResidentCapacity());
            m.put("requiredFarmerPopulation", b.getRequiredFarmerPopulation());
            // 采掘类（黏土矿坑 / 铁矿）必须压在对应矿脉上；非矿给空串，免得客户端处理 null
            m.put("requiredOre", b.getOre() == null ? "" : b.getOre().name());
            // ---- 2026-09-25 扩表：分组 / 外观 / 解锁 / 地形 / 服务 ----
            m.put("group", b.getGroup().name());
            m.put("groupLabel", b.getGroup().getLabel());
            m.put("groupIcon", b.getGroup().getIcon());
            m.put("icon", b.getIcon());
            m.put("form", b.getForm().name());
            m.put("tint", b.getTint());
            m.put("requiredTier", b.getRequiredTier() == null ? "" : b.getRequiredTier().name());
            m.put("requiredPopulation", b.getRequiredPopulation());
            m.put("terrain", b.getGround().name());
            m.put("coastal", b.isCoastal());
            m.put("service", b.getService() == null ? "" : b.getService().name());
            m.put("serviceLabel", b.getService() == null ? "" : b.getService().getLabel());
            m.put("serviceRadius", b.getServiceRadius());
            m.put("serviceValue", b.getServiceValue());
            m.put("inputs", b.getInputs().entrySet().stream()
                    .collect(Collectors.toMap(e -> e.getKey().name(), e -> e.getValue())));
            m.put("outputs", b.getOutputs().entrySet().stream()
                    .collect(Collectors.toMap(e -> e.getKey().name(), e -> e.getValue())));
            return m;
        }).toList());
    }

    /** 在线玩家 ID 列表（联机大厅） */
    @GetMapping("/players")
    public ApiResponse<Object> players() {
        return ApiResponse.ok(hub.onlinePlayerIds().stream().sorted().toList());
    }
}
