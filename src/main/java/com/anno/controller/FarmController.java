package com.anno.controller;

import java.util.Map;

import com.anno.domain.Good;
import com.anno.dto.ApiResponse;
import com.anno.dto.Requests;
import com.anno.dto.Views;
import com.anno.service.FarmService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 种植：播种 / 收获 / 清理 */
@RestController
@RequestMapping("/api/farm")
public class FarmController {

    private final FarmService farmService;

    public FarmController(FarmService farmService) {
        this.farmService = farmService;
    }

    /** 播种（纪元1800式）：**从农场拉田** —— buildingId 必填（能拉田的农场：马铃薯/粮食/啤酒花），
        crop 由农场类型决定，可不传；田格必须在农场占区 ≤3 格内 */
    @PostMapping("/plant")
    public ApiResponse<Views.PlotView> plant(@RequestBody Requests.PlantRequest req) {
        return ApiResponse.ok(farmService.plant(req.playerId(), req.islandId(),
                req.x(), req.z(), Good.of(req.crop()), req.buildingId()));
    }

    /** 一片拉田：{playerId, islandId, buildingId, cells:[{x,z}...]}（≤400 格），一次往返种完整片，
        撞第一个障碍就停（部分成功，响应 stop 里带原因） */
    @PostMapping("/plant-batch")
    public ApiResponse<Map<String, Object>> plantBatch(@RequestBody Requests.PlantBatchRequest req) {
        return ApiResponse.ok(farmService.plantBatch(req.playerId(), req.islandId(),
                req.cells(), req.crop(), req.buildingId()));
    }

    /** 收获成熟作物，产物直接进仓库，该格随即空出来 */
    @PostMapping("/harvest")
    public ApiResponse<Map<String, Object>> harvest(@RequestBody Requests.PlotActionRequest req) {
        return ApiResponse.ok(farmService.harvest(req.playerId(), req.plotId()));
    }

    /** 清理枯萎作物，该格随即空出来 */
    @PostMapping("/clear")
    public ApiResponse<Map<String, Object>> clear(@RequestBody Requests.PlotActionRequest req) {
        return ApiResponse.ok(farmService.clear(req.playerId(), req.plotId()));
    }

    /** 铲除作物（任意状态，铲除工具用）：格子空出来，种子钱不退 */
    @PostMapping("/remove")
    public ApiResponse<Map<String, Object>> remove(@RequestBody Requests.PlotActionRequest req) {
        return ApiResponse.ok(farmService.removePlot(req.playerId(), req.plotId()));
    }
}
