package com.anno.controller;

import java.util.List;
import java.util.Map;

import com.anno.domain.BuildingType;
import com.anno.dto.ApiResponse;
import com.anno.dto.Requests;
import com.anno.dto.Views;
import com.anno.service.ProductionService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 建筑：图鉴 / 建造 / 升级 / 旋转 / 拆除 */
@RestController
@RequestMapping("/api/buildings")
public class BuildingController {

    private final ProductionService productionService;
    private final com.anno.config.DbRetry dbRetry;

    public BuildingController(ProductionService productionService, com.anno.config.DbRetry dbRetry) {
        this.productionService = productionService;
        this.dbRetry = dbRetry;
    }

    /**
     * 建筑图鉴：每种的造价、生产周期、**占地尺寸**与配方。
     * 客户端建造面板照这份数据渲染，省得把造价/占地硬编码在客户端、改服务端时忘了同步。
     */
    @GetMapping("/catalog")
    public ApiResponse<List<Views.BuildingTypeView>> catalog() {
        return ApiResponse.ok(productionService.catalog());
    }

    /**
     * 建造。
     * <p>
     * type 传 LUMBERJACK / SAWMILL / STEEL_WORKS ...；
     * x/z 是**旋转后**占地矩形的左上角（x/z 最小的那格），建筑实际占 sizeW × sizeH 格。
     * 占地必须整块在岛内、不压作物/马路/其他建筑，且外圈至少一格临路。
     * <p>
     * rotation 可不传（0/90/180/270）：不传就自动把大门吸附到旁边那条马路；
     * 传了 90/270 就是"竖着摆"，占地宽高会对调（4×3 的纺织厂变成占 3×4）。
     */
    @PostMapping
    public ApiResponse<Views.BuildingView> build(@RequestBody Requests.BuildRequest req) {
        return ApiResponse.ok(dbRetry.run("建造", () -> productionService.build(
                req.playerId(), req.islandId(), BuildingType.of(req.type()), req.x(), req.z(),
                req.rotation())));
    }

    /**
     * 原地旋转 90°（只转朝向，不搬家）。
     * <p>
     * 绕占地中心转，所以建筑还在原地；转完新占地若压到马路/作物/别的建筑会明确报错。
     */
    @PostMapping("/{id}/rotate")
    public ApiResponse<Views.BuildingView> rotate(@PathVariable Long id,
                                                 @RequestBody Requests.RotateRequest req) {
        return ApiResponse.ok(dbRetry.run("旋转", () -> productionService.rotate(req.playerId(), id)));
    }

    @PostMapping("/{id}/upgrade")
    public ApiResponse<Views.BuildingView> upgrade(@PathVariable Long id,
                                                   @RequestBody Requests.UpgradeRequest req) {
        return ApiResponse.ok(productionService.upgrade(req.playerId(), id));
    }

    /** 拆除建筑：返还一半造价，占地整块释放 */
    @DeleteMapping("/{id}")
    public ApiResponse<Map<String, Object>> demolish(@PathVariable Long id, @RequestParam Long playerId) {
        return ApiResponse.ok(dbRetry.run("拆除", () -> productionService.demolish(playerId, id)));
    }
}
