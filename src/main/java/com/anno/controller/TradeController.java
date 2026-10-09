package com.anno.controller;

import java.util.List;

import com.anno.config.DbRetry;
import com.anno.domain.Good;
import com.anno.domain.TradeOfferEntity;
import com.anno.dto.ApiResponse;
import com.anno.dto.Requests;
import com.anno.dto.Views;
import com.anno.service.TradeService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 玩家间贸易：挂单 / 接单 / 撤单 */
@RestController
@RequestMapping("/api/trade")
public class TradeController {

    private final TradeService tradeService;
    private final DbRetry dbRetry;

    public TradeController(TradeService tradeService, DbRetry dbRetry) {
        this.tradeService = tradeService;
        this.dbRetry = dbRetry;
    }

    /** 挂单：side = SELL(卖) / BUY(买) */
    @PostMapping("/offers")
    public ApiResponse<Views.OfferView> create(@RequestBody Requests.OfferRequest req) {
        return ApiResponse.ok(dbRetry.run("挂单", () -> tradeService.create(req.playerId(),
                TradeOfferEntity.Side.valueOf(req.side().trim().toUpperCase()),
                Good.of(req.good()), req.quantity(), req.unitPrice())));
    }

    /** 撮合大厅，可用 ?good=WOOL 过滤 */
    @GetMapping("/offers")
    public ApiResponse<List<Views.OfferView>> openOffers(@RequestParam(required = false) String good) {
        return ApiResponse.ok(tradeService.openOffers(good == null ? null : Good.of(good)));
    }

    @GetMapping("/offers/mine")
    public ApiResponse<List<Views.OfferView>> myOffers(@RequestParam Long playerId) {
        return ApiResponse.ok(tradeService.myOffers(playerId));
    }

    /** 接单成交（条件原子 UPDATE，两人同抢一单只有一个成功） */
    @PostMapping("/offers/{id}/accept")
    public ApiResponse<Views.TradeResult> accept(@PathVariable Long id,
                                                 @RequestBody Requests.AcceptRequest req) {
        return ApiResponse.ok(dbRetry.run("接单", () -> tradeService.accept(id, req.takerId())));
    }

    /** 撤单，托管资源原路退回 */
    @PostMapping("/offers/{id}/cancel")
    public ApiResponse<Views.OfferView> cancel(@PathVariable Long id,
                                               @RequestBody Requests.AcceptRequest req) {
        return ApiResponse.ok(dbRetry.run("撤单", () -> tradeService.cancel(id, req.takerId())));
    }
}
