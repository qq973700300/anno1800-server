package com.anno.repo;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

import com.anno.domain.PlotEntity;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PlotRepository extends JpaRepository<PlotEntity, Long> {

    /** 一座岛上所有作物，按格子顺序返回（客户端照坐标画） */
    List<PlotEntity> findByIslandIdOrderByCellXAscCellZAsc(Long islandId);

    Optional<PlotEntity> findByIslandIdAndCellXAndCellZ(Long islandId, int cellX, int cellZ);

    /** 这格是否已经种了东西（修路 / 盖房前要查） */
    boolean existsByIslandIdAndCellXAndCellZ(Long islandId, int cellX, int cellZ);

    /** 推进一座岛的作物生长：只取这座岛上正在生长/已成熟的地块（枯萎的不必再推） */
    List<PlotEntity> findByIslandIdAndStateIn(Long islandId, Collection<PlotEntity.State> states);

    int countByIslandId(Long islandId);
}
