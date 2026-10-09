package com.anno.repo;

import java.util.List;

import com.anno.domain.ShipEntity;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ShipRepository extends JpaRepository<ShipEntity, Long> {

    List<ShipEntity> findByPlayerIdOrderByIdAsc(Long playerId);

    List<ShipEntity> findByIslandIdAndStateOrderByIdAsc(Long islandId, String state);

    long countByIslandIdAndState(Long islandId, String state);
}
