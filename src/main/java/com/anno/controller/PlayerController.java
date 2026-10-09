package com.anno.controller;

import java.util.List;

import com.anno.domain.PlayerEntity;
import com.anno.dto.ApiResponse;
import com.anno.dto.Requests;
import com.anno.dto.Views;
import com.anno.service.InventoryService;
import com.anno.service.IslandService;
import com.anno.service.PlayerService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 玩家：注册 / 查询 */
@RestController
@RequestMapping("/api/players")
public class PlayerController {

    private final PlayerService playerService;
    private final IslandService islandService;
    private final InventoryService inventoryService;

    public PlayerController(PlayerService playerService, IslandService islandService,
                            InventoryService inventoryService) {
        this.playerService = playerService;
        this.islandService = islandService;
        this.inventoryService = inventoryService;
    }

    /** 注册，返回 token 给客户端保存 */
    @PostMapping("/register")
    public ApiResponse<Views.PlayerView> register(@RequestBody Requests.RegisterRequest req) {
        PlayerEntity p = playerService.register(req.name());
        return ApiResponse.ok(playerService.view(p));
    }

    @GetMapping("/{id}")
    public ApiResponse<Views.PlayerView> get(@PathVariable Long id) {
        return ApiResponse.ok(playerService.view(playerService.require(id)));
    }

    /** 用 token 登录 */
    @GetMapping("/me")
    public ApiResponse<Views.PlayerView> me(@RequestParam String token) {
        return ApiResponse.ok(playerService.view(playerService.byToken(token)));
    }

    /** 玩家完整档案：基本信息 + 岛屿 + 仓库 */
    @GetMapping("/{id}/profile")
    public ApiResponse<java.util.Map<String, Object>> profile(@PathVariable Long id) {
        PlayerEntity p = playerService.require(id);
        return ApiResponse.ok(java.util.Map.of(
                "player", playerService.view(p),
                "islands", islandService.list(id),
                "stock", inventoryService.list(id)));
    }

    /** 在线玩家列表（联机用） */
    @GetMapping
    public ApiResponse<List<Views.PlayerBrief>> all() {
        return ApiResponse.ok(playerService.onlineList());
    }
}
