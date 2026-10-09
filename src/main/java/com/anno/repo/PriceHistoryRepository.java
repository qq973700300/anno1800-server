package com.anno.repo;

import java.util.List;

import com.anno.domain.Good;
import com.anno.domain.PriceHistoryEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PriceHistoryRepository extends JpaRepository<PriceHistoryEntity, Long> {

    List<PriceHistoryEntity> findByGoodAndTsGreaterThanEqualOrderByTsAsc(Good good, long ts);

    /** 删除过期快照，避免时序表无限膨胀 */
    @Modifying
    @Query("delete from PriceHistoryEntity p where p.ts < :ts")
    int deleteOlderThan(@Param("ts") long ts);

    long countByGood(Good good);
}
