package com.anno.controller;

import java.util.List;
import java.util.Map;

import com.anno.dto.ApiResponse;
import com.anno.dto.Requests;
import com.anno.dto.Views;
import com.anno.service.ExpeditionService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 远征探险：组建（扣金币 + 扣仓库补给）→ 航行（随岛屿心跳推进）→
 * 途中事件选择 → 结算（金币 / 稀有物品 / 图鉴）。
 * <p>
 * 进行中的远征不在快照里（避免每 3 秒白查一遍），客户端开远征弹层时拉一次列表 +
 * 订阅 {@code expedition} 的 WS 推送（事件卡 / 结算都会即时推给本人）。
 */
@RestController
@RequestMapping("/api/expeditions")
public class ExpeditionController {

    private final ExpeditionService expeditionService;

    public ExpeditionController(ExpeditionService expeditionService) {
        this.expeditionService = expeditionService;
    }

    /** 我的所有远征（含已结算，新的在前） */
    @GetMapping
    public ApiResponse<List<Views.ExpeditionView>> list(@RequestParam Long playerId) {
        return ApiResponse.ok(expeditionService.list(playerId));
    }

    /** 探险图鉴：已点亮的发现物（骷髅岛 / 金刚神像……） */
    @GetMapping("/discoveries")
    public ApiResponse<List<Map<String, String>>> discoveries(@RequestParam Long playerId) {
        return ApiResponse.ok(expeditionService.discoveries(playerId));
    }

    /** 组建远征队（shipId 可省略：自动用本岛最早下水的闲置船） */
    @PostMapping
    public ApiResponse<Views.ExpeditionView> create(@RequestBody Requests.ExpeditionRequest req) {
        return ApiResponse.ok(expeditionService.create(req.playerId(), req.islandId(),
                req.destination(), req.name(), req.shipId()));
    }

    /** 事件选择：optionIndex 是事件卡上的按钮序号（0 号 = 保守项） */
    @PostMapping("/{id}/choice")
    public ApiResponse<Views.ExpeditionView> choice(@PathVariable Long id,
                                                    @RequestBody Requests.ExpeditionChoiceRequest req) {
        return ApiResponse.ok(expeditionService.choice(req.playerId(), id, req.optionIndex()));
    }
}
