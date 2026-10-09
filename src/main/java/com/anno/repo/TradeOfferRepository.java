package com.anno.repo;

import java.util.List;

import com.anno.domain.Good;
import com.anno.domain.TradeOfferEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TradeOfferRepository extends JpaRepository<TradeOfferEntity, Long> {

    List<TradeOfferEntity> findByStatusOrderByCreatedAtDesc(TradeOfferEntity.Status status);

    List<TradeOfferEntity> findByPlayerIdOrderByCreatedAtDesc(Long playerId);

    /** 买单取价格最高的优先匹配，卖单取价格最低的优先匹配 */
    List<TradeOfferEntity> findByStatusAndSideAndGoodOrderByUnitPriceDesc(
            TradeOfferEntity.Status status, TradeOfferEntity.Side side, Good good);

    List<TradeOfferEntity> findByStatusAndSideAndGoodOrderByUnitPriceAsc(
            TradeOfferEntity.Status status, TradeOfferEntity.Side side, Good good);

    // ==================================================================
    // 成交/撤单同样用「条件原子 UPDATE」：where status = OPEN。
    // 两个人同时点"接单"时，只有一个能把 OPEN 改成 FILLED，另一个影响行数 0，
    // 直接报错回滚 —— 资金和货物跟着回滚，不会出现一单卖两次。
    // ==================================================================

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update TradeOfferEntity o set o.remaining = 0, o.status = :filled, o.counterpartyId = :taker "
            + "where o.id = :id and o.status = :open")
    int fill(@Param("id") Long id, @Param("taker") Long taker,
             @Param("filled") TradeOfferEntity.Status filled,
             @Param("open") TradeOfferEntity.Status open);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update TradeOfferEntity o set o.remaining = 0, o.status = :cancelled "
            + "where o.id = :id and o.playerId = :pid and o.status = :open")
    int closeByOwner(@Param("id") Long id, @Param("pid") Long pid,
                     @Param("cancelled") TradeOfferEntity.Status cancelled,
                     @Param("open") TradeOfferEntity.Status open);
}
