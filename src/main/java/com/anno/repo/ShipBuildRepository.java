package com.anno.repo;

import java.util.List;

import com.anno.domain.ShipBuildEntity;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ShipBuildRepository extends JpaRepository<ShipBuildEntity, Long> {

    List<ShipBuildEntity> findByIslandId(Long islandId);

    List<ShipBuildEntity> findByPlayerId(Long playerId);
}
