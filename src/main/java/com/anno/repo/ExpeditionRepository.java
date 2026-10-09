package com.anno.repo;

import java.util.List;

import com.anno.domain.ExpeditionEntity;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ExpeditionRepository extends JpaRepository<ExpeditionEntity, Long> {

    List<ExpeditionEntity> findByPlayerIdOrderByIdDesc(Long playerId);

    /** 心跳只推进"还在海上"的：航行中 + 等选择，结算完的行不再碰 */
    List<ExpeditionEntity> findByIslandIdAndStatusIn(Long islandId, List<String> statuses);

    long countByIslandIdAndStatusIn(Long islandId, List<String> statuses);
}
