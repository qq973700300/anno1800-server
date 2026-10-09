package com.anno.controller;

import java.util.List;

import com.anno.dto.ApiResponse;
import com.anno.dto.Requests;
import com.anno.dto.Views;
import com.anno.service.ShipyardService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 造船厂与舰队：开工（扣金币 + 木板等物料）→ 船台工期随岛屿心跳推进 →
 * 完工入舰队。闲置的船是远征的"门票"（一船一线，见 ExpeditionService）。
 */
@RestController
@RequestMapping("/api/ships")
public class ShipController {

    private final ShipyardService shipyardService;

    public ShipController(ShipyardService shipyardService) {
        this.shipyardService = shipyardService;
    }

    /** 船型目录：造价 / 物料 / 工期 / 远征加成 */
    @GetMapping("/types")
    public ApiResponse<List<Views.ShipTypeView>> types() {
        return ApiResponse.ok(shipyardService.catalog());
    }

    /** 我的舰队 + 各船台在建队列 */
    @GetMapping
    public ApiResponse<Views.FleetView> fleet(@RequestParam Long playerId) {
        return ApiResponse.ok(shipyardService.fleet(playerId));
    }

    /** 造船厂开工 */
    @PostMapping
    public ApiResponse<Views.ShipBuildView> build(@RequestBody Requests.ShipBuildRequest req) {
        return ApiResponse.ok(shipyardService.build(req.playerId(), req.islandId(), req.shipType()));
    }
}
