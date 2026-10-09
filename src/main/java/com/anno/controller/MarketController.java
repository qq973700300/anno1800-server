package com.anno.controller;

import java.util.List;
import java.util.Map;

import com.anno.config.DbRetry;
import com.anno.domain.Good;
import com.anno.dto.ApiResponse;
import com.anno.dto.Requests;
import com.anno.dto.Views;
import com.anno.service.InventoryService;
import com.anno.service.MarketService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 商品贸易：行情 / 买卖 / 仓库 */
@RestController
@RequestMapping("/api/market")
public class MarketController {

    private final MarketService marketService;
    private final InventoryService inventoryService;
    private final DbRetry dbRetry;

    public MarketController(MarketService marketService, InventoryService inventoryService,
                            DbRetry dbRetry) {
        this.marketService = marketService;
        this.inventoryService = inventoryService;
        this.dbRetry = dbRetry;
    }

    /** 全部商品行情（含涨跌幅） */
    @GetMapping
    public ApiResponse<List<Views.MarketRow>> snapshot() {
        return ApiResponse.ok(marketService.snapshot());
    }

    /** 向 NPC 市场买入（撞上死锁时自动重试，不让玩家看到 500） */
    @PostMapping("/buy")
    public ApiResponse<Map<String, Object>> buy(@RequestBody Requests.MarketRequest req) {
        return ApiResponse.ok(dbRetry.run("市场买入",
                () -> marketService.buy(req.playerId(), Good.of(req.good()), req.quantity())));
    }

    /** 向 NPC 市场卖出 */
    @PostMapping("/sell")
    public ApiResponse<Map<String, Object>> sell(@RequestBody Requests.MarketRequest req) {
        return ApiResponse.ok(dbRetry.run("市场卖出",
                () -> marketService.sell(req.playerId(), Good.of(req.good()), req.quantity())));
    }

    /** 分时行情：最近 seconds 秒的价格点，画分时图用 */
    @GetMapping("/history")
    public ApiResponse<List<Views.PricePoint>> history(@RequestParam String good,
                                                      @RequestParam(defaultValue = "3600") long seconds) {
        return ApiResponse.ok(marketService.history(Good.of(good), seconds));
    }

    /** K 线：period 秒一根蜡烛（如 60=1分钟线），画股票式蜡烛图用 */
    @GetMapping("/kline")
    public ApiResponse<List<Views.Candle>> kline(@RequestParam String good,
                                                 @RequestParam(defaultValue = "60") long period,
                                                 @RequestParam(defaultValue = "120") int limit) {
        return ApiResponse.ok(marketService.kline(Good.of(good), period, limit));
    }

    /** 玩家仓库 */
    @GetMapping("/stock/{playerId}")
    public ApiResponse<List<Views.StockView>> stock(@PathVariable Long playerId) {
        return ApiResponse.ok(inventoryService.list(playerId));
    }
}
