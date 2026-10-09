package com.anno.controller;

import java.util.List;
import java.util.Map;

import com.anno.config.DbRetry;
import com.anno.dto.ApiResponse;
import com.anno.dto.Requests;
import com.anno.dto.Views;
import com.anno.service.RoadService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 马路：路网是产业链的骨架，建筑必须沿路建造 */
@RestController
@RequestMapping("/api/roads")
public class RoadController {

    private final RoadService roadService;
    private final DbRetry dbRetry;

    public RoadController(RoadService roadService, DbRetry dbRetry) {
        this.roadService = roadService;
        this.dbRetry = dbRetry;
    }

    /** 岛上全部马路 */
    @GetMapping
    public ApiResponse<List<Views.RoadView>> roads(@RequestParam Long islandId) {
        return ApiResponse.ok(roadService.roads(islandId));
    }

    /** 修一格马路：{playerId, islandId, x, z, kind?}（kind = 路面种类，缺省土路） */
    @PostMapping
    public ApiResponse<Views.RoadView> build(@RequestBody Requests.RoadRequest req) {
        return ApiResponse.ok(dbRetry.run("修路",
                () -> roadService.build(req.playerId(), req.islandId(), req.x(), req.z(), req.kind())));
    }

    /** 一条龙修路：{playerId, islandId, cells:[{x,z}...], kind?}（≤400 格），一次往返铺完整条，
        撞第一个障碍就停（部分成功，响应 stop 里带原因） */
    @PostMapping("/batch")
    public ApiResponse<Map<String, Object>> buildBatch(@RequestBody Requests.RoadBatchRequest req) {
        return ApiResponse.ok(dbRetry.run("批量修路",
                () -> roadService.buildBatch(req.playerId(), req.islandId(), req.cells(), req.kind())));
    }

    /** 路面改造：{playerId, islandId, kind, cells:[{x,z}...]} —— 把已有路格换成另一种路面，收差价 */
    @PostMapping("/restyle")
    public ApiResponse<Map<String, Object>> restyle(@RequestBody Requests.RoadRestyleRequest req) {
        return ApiResponse.ok(dbRetry.run("改铺路面",
                () -> roadService.restyle(req.playerId(), req.islandId(), req.kind(), req.cells())));
    }

    /** 拆一格马路，返还一半造价 */
    @DeleteMapping
    public ApiResponse<String> remove(@RequestBody Requests.RoadRequest req) {
        dbRetry.runVoid("拆路", () -> roadService.remove(req.playerId(), req.islandId(), req.x(), req.z()));
        return ApiResponse.ok("已拆除");
    }
}
