package com.anno.service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.anno.domain.Good;
import com.anno.domain.TradeOfferEntity;
import com.anno.dto.Views;
import com.anno.exception.GameException;
import com.anno.repo.PlayerRepository;
import com.anno.repo.TradeOfferRepository;
import com.anno.ws.GameSocketHub;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 玩家间贸易：挂单 + 接单。
 * <p>
 * 挂卖单时货物会被托管（先从仓库扣除），挂买单时金币会被冻结（先从金库扣除），
 * 因此不会出现"卖空"或"买空"；撤单会原路退回。
 */
@Service
public class TradeService {

    private final TradeOfferRepository tradeOfferRepository;
    private final PlayerRepository playerRepository;
    private final InventoryService inventoryService;
    private final PlayerService playerService;
    private final GameSocketHub hub;

    public TradeService(TradeOfferRepository tradeOfferRepository, PlayerRepository playerRepository,
                        InventoryService inventoryService, PlayerService playerService, GameSocketHub hub) {
        this.tradeOfferRepository = tradeOfferRepository;
        this.playerRepository = playerRepository;
        this.inventoryService = inventoryService;
        this.playerService = playerService;
        this.hub = hub;
    }

    /** 挂单 */
    @Transactional
    public Views.OfferView create(Long playerId, TradeOfferEntity.Side side, Good good, int qty, double unitPrice) {
        if (qty <= 0) throw GameException.of("数量必须大于 0");
        if (unitPrice <= 0) throw GameException.of("单价必须大于 0");

        if (side == TradeOfferEntity.Side.SELL) {
            inventoryService.remove(playerId, good, qty);       // 托管货物
        } else {
            playerService.spend(playerId, unitPrice * qty, "挂买单冻结资金"); // 冻结金币
        }

        TradeOfferEntity offer = tradeOfferRepository.save(
                new TradeOfferEntity(playerId, side, good, qty, unitPrice));
        hub.broadcast("event", Map.of("type", "TRADE_OFFER", "serverTime", System.currentTimeMillis(),
                "payload", Map.of("offerId", offer.getId(), "side", side.name(),
                        "good", good.name(), "quantity", qty, "unitPrice", unitPrice)));
        return view(offer);
    }

    /** 接单（整单成交） */
    @Transactional
    public Views.TradeResult accept(Long offerId, Long takerId) {
        TradeOfferEntity offer = tradeOfferRepository.findById(offerId)
                .orElseThrow(() -> GameException.of("挂单不存在：" + offerId));
        if (offer.getStatus() != TradeOfferEntity.Status.OPEN) {
            throw GameException.of("挂单已关闭：" + offer.getStatus());
        }
        if (offer.getPlayerId().equals(takerId)) {
            throw GameException.of("不能和自己交易");
        }
        Good good = offer.getGood();
        int qty = offer.getRemaining();
        double total = offer.getUnitPrice() * qty;

        // 统一加锁顺序：先动库存，再动金币（与心跳里的 库存→玩家 一致，避免 AB-BA 死锁）
        if (offer.getSide() == TradeOfferEntity.Side.SELL) {
            // 卖家挂卖单：接单方付钱拿货，卖家收钱
            inventoryService.add(takerId, good, qty);
            playerService.spend(takerId, total, "接单买入" + good.getLabel() + "x" + qty);
            playerService.addTreasury(offer.getPlayerId(), total);
        } else {
            // 买家挂买单：接单方出货拿钱（钱在挂单时已冻结）
            inventoryService.remove(takerId, good, qty);
            inventoryService.add(offer.getPlayerId(), good, qty);
            playerService.addTreasury(takerId, total);
        }

        // 条件原子成交：status 仍是 OPEN 才改成 FILLED，防止两个人同时抢一单
        int filled = tradeOfferRepository.fill(offerId, takerId,
                TradeOfferEntity.Status.FILLED, TradeOfferEntity.Status.OPEN);
        if (filled == 0) {
            throw GameException.of("挂单已被抢先成交或已关闭：" + offerId);
        }

        playerService.addReputation(takerId, 2);
        playerService.addReputation(offer.getPlayerId(), 2);

        hub.broadcast("event", Map.of("type", "TRADE_FILLED", "serverTime", System.currentTimeMillis(),
                "payload", Map.of("offerId", offerId, "side", offer.getSide().name(), "good", good.name(),
                        "quantity", qty, "unitPrice", offer.getUnitPrice(), "takerId", takerId)));
        return new Views.TradeResult(offerId, offer.getSide().name(), good.name(), qty,
                offer.getUnitPrice(), round2(total), round2(playerService.require(takerId).getTreasury()));
    }

    /** 撤单并退回托管资源 */
    @Transactional
    public Views.OfferView cancel(Long offerId, Long playerId) {
        TradeOfferEntity offer = tradeOfferRepository.findById(offerId)
                .orElseThrow(() -> GameException.of("挂单不存在：" + offerId));
        if (!offer.getPlayerId().equals(playerId)) {
            throw GameException.of("只能撤销自己的挂单");
        }
        if (offer.getStatus() != TradeOfferEntity.Status.OPEN) {
            throw GameException.of("挂单已关闭：" + offer.getStatus());
        }
        if (offer.getSide() == TradeOfferEntity.Side.SELL) {
            inventoryService.add(playerId, offer.getGood(), offer.getRemaining());
        } else {
            playerService.addTreasury(playerId, offer.getUnitPrice() * offer.getRemaining());
        }
        // 同样用条件原子 UPDATE，避免重复撤单导致资源退两次
        int closed = tradeOfferRepository.closeByOwner(offerId, playerId,
                TradeOfferEntity.Status.CANCELLED, TradeOfferEntity.Status.OPEN);
        if (closed == 0) {
            throw GameException.of("挂单已被成交或已关闭：" + offerId);
        }
        offer.setRemaining(0);
        offer.setStatus(TradeOfferEntity.Status.CANCELLED);
        return view(offer);
    }

    @Transactional(readOnly = true)
    public List<Views.OfferView> openOffers(Good good) {
        List<TradeOfferEntity> list = tradeOfferRepository.findByStatusOrderByCreatedAtDesc(
                TradeOfferEntity.Status.OPEN);
        List<Views.OfferView> views = new ArrayList<>();
        for (TradeOfferEntity o : list) {
            if (good != null && o.getGood() != good) continue;
            views.add(view(o));
        }
        return views;
    }

    @Transactional(readOnly = true)
    public List<Views.OfferView> myOffers(Long playerId) {
        return tradeOfferRepository.findByPlayerIdOrderByCreatedAtDesc(playerId).stream()
                .map(this::view).toList();
    }

    public Views.OfferView view(TradeOfferEntity o) {
        String playerName = playerRepository.findById(o.getPlayerId())
                .map(p -> p.getName()).orElse("未知");
        return new Views.OfferView(o.getId(), o.getPlayerId(), playerName, o.getSide().name(),
                o.getGood().name(), o.getGood().getLabel(), o.getQuantity(), o.getRemaining(),
                o.getUnitPrice(), o.getStatus().name(), o.getCreatedAt());
    }

    private static double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }
}
