package com.anno.repo;

import java.util.List;
import java.util.Optional;

import com.anno.domain.ResidentEntity;
import com.anno.domain.ResidentTier;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ResidentRepository extends JpaRepository<ResidentEntity, Long> {

    List<ResidentEntity> findByIslandId(Long islandId);

    Optional<ResidentEntity> findByIslandIdAndTier(Long islandId, ResidentTier tier);

    /**
     * 只改人数与满足度：一条 UPDATE 落库，不经过实体。
     * <p>
     * 理由同 {@code BuildingRepository.updateProgress} —— 心跳里如果"改实体再 save"，
     * 会话里挂住的脏实体会被后续每次出入库的 flush 顺带写出去，变成 N 次无谓的写库。
     */
    @Modifying(flushAutomatically = true)
    @Query("update ResidentEntity r set r.population = :pop, r.satisfaction = :sat, "
            + "r.carrySeconds = :carry, r.lastTax = :tax where r.id = :id")
    int updateSettlement(@Param("id") Long id, @Param("pop") int pop, @Param("sat") double satisfaction,
                         @Param("carry") double carry, @Param("tax") double tax);
}
