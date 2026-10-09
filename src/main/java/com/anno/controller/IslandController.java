package com.anno.controller;

import java.util.List;

import com.anno.domain.IslandEntity;
import com.anno.dto.ApiResponse;
import com.anno.dto.Requests;
import com.anno.dto.Views;
import com.anno.service.FarmService;
import com.anno.service.IslandService;
import com.anno.service.IslandSimService;
import com.anno.service.PopulationService;
import com.anno.service.ProductionService;
import com.anno.service.ShipService;
import com.anno.service.TreeService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 岛屿 + 农田 + 建筑查询 */
@RestController
@RequestMapping("/api/islands")
public class IslandController {

    private final IslandService islandService;
    private final IslandSimService islandSimService;
    private final FarmService farmService;
    private final ProductionService productionService;
    private final PopulationService populationService;
    private final ShipService shipService;
    private final TreeService treeService;

    public IslandController(IslandService islandService, IslandSimService islandSimService,
                            FarmService farmService,
                            ProductionService productionService,
                            PopulationService populationService,
                            ShipService shipService, TreeService treeService) {
        this.islandService = islandService;
        this.islandSimService = islandSimService;
        this.farmService = farmService;
        this.productionService = productionService;
        this.populationService = populationService;
        this.shipService = shipService;
        this.treeService = treeService;
    }

    /**
     * 开新岛：随机地形（海面 / 平原 / 山地 / 矿脉），肥力随机。
     * <p>
     * 传 {@code flat: true} 会得到一座**一整片平原的平岛** —— 没有水、没有山、没有矿，
     * 地形不再干扰坐标，给自动化测试与调试用。
     * 响应里带 <b>terrain</b>（每格一个字符的地形串，长度 = gridSize²），客户端照它画岛形。
     */
    @PostMapping
    public ApiResponse<Views.IslandView> create(@RequestBody Requests.IslandRequest req) {
        return ApiResponse.ok(islandService.view(
                islandService.create(req.playerId(), req.name(), req.isFlat())));
    }

    /**
     * 拉岛视图前先推进一次模拟（{@link IslandSimService#advance}，水位线幂等：
     * 在线时 wall≈一个 tick 间隔、近乎空转）。
     * <p>
     * 【为什么必须】模拟是"懒结算"——只有 WS 在线玩家的岛会被 tick 推进；玩家离线时
     * 水位线不动，离线时长就一直没人折进 frozenMs。而游戏时刻（clockHour）是按
     * "墙钟 - frozenMs" 现算的：不折的话，隔夜回来第一眼（登录拉岛列表、恰好是客户端
     * 对表的那一刻）拿到的是"把离线时长全算进去"的时刻，等 WS 首拍把离线折掉，
     * 服务端时刻回跳、客户端却只在换岛时对表 —— 昼夜显示与经济时间线就永久偏差了。
     * 先 advance 再拼视图，保证任何一次 GET 拿到的都是折叠后的正确时刻。
     */
    @GetMapping
    public ApiResponse<List<Views.IslandView>> list(@RequestParam Long playerId) {
        islandSimService.advance(playerId, System.currentTimeMillis());
        return ApiResponse.ok(islandService.list(playerId));
    }

    /** 岛上所有农田地块及生长进度 */
    @GetMapping("/{id}/plots")
    public ApiResponse<List<Views.PlotView>> plots(@PathVariable Long id) {
        return ApiResponse.ok(farmService.plots(id));
    }

    /** 岛上所有建筑及生产进度 */
    @GetMapping("/{id}/buildings")
    public ApiResponse<List<Views.BuildingView>> buildings(@PathVariable Long id) {
        return ApiResponse.ok(productionService.buildings(id));
    }

    /**
     * 岛上人口：各阶层人数 / 住宅容量 / 满足度 / 每分钟税收，以及每种需求品的消耗与库存。
     * <p>
     * 这是"居民经济"跑没跑起来的唯一数据源：人口涨说明需求被满足，
     * 满足度掉说明某项物资断了，税收则是这条循环的产出。
     */
    @GetMapping("/{id}/population")
    public ApiResponse<Views.PopulationView> population(@PathVariable Long id) {
        return ApiResponse.ok(populationService.population(id));
    }

    /**
     * 岛上的树：静态树集（确定性推导，纯地形）+ 砍伐记录（每行 = 一格永远没树）。
     * <p>
     * 客户端进岛加载时拉这份账，把已砍格子从渲染的森林里剔掉；之后跟着
     * TREE_CHOPPED 事件逐棵移除。验证脚本也用它和 {@code __annoTreePositions()}
     * 做"服务端 ↔ 客户端"树集全等对拍。
     */
    @GetMapping("/{id}/trees")
    public ApiResponse<TreeService.TreeInfo> trees(@PathVariable Long id) {
        return ApiResponse.ok(treeService.info(id));
    }

    /**
     * 岛上的商船：每个贸易站一条，自动跑外海市场。
     * <p>
     * 联机时这份数据跟着个人快照走（{@code snapshot} 消息），
     * 这个接口是**断线兜底**用的 —— 客户端连不上 websocket 时靠它把船补上。
     */
    @GetMapping("/{id}/ships")
    public ApiResponse<List<Views.ShipView>> ships(@PathVariable Long id) {
        return ApiResponse.ok(shipService.shipsOf(id));
    }
}
