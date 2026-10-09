package com.anno.repo;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

import com.anno.domain.TreeChopEntity;

/** 树木砍伐记录（见 {@link TreeChopEntity}：只记被砍的格子，初始树集是确定性推导的） */
public interface TreeChopRepository extends JpaRepository<TreeChopEntity, Long> {

    List<TreeChopEntity> findByIslandId(Long islandId);

    boolean existsByIslandIdAndCellXAndCellZ(Long islandId, int cellX, int cellZ);

    long countByIslandId(Long islandId);
}
