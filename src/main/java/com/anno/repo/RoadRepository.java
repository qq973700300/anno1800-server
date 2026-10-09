package com.anno.repo;

import java.util.List;

import com.anno.domain.RoadEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RoadRepository extends JpaRepository<RoadEntity, Long> {

    List<RoadEntity> findByIslandId(Long islandId);

    boolean existsByIslandIdAndCellXAndCellZ(Long islandId, int cellX, int cellZ);

    /** 按格取路（路面改造 / 拆路退款要用这段路自己的种类） */
    java.util.Optional<RoadEntity> findByIslandIdAndCellXAndCellZ(Long islandId, int cellX, int cellZ);

    /** 拆路：返回删除行数，0 表示本来就没有路 */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    int deleteByIslandIdAndCellXAndCellZ(Long islandId, int cellX, int cellZ);

    @Query("select count(r) from RoadEntity r where r.islandId = :islandId")
    long countByIsland(@Param("islandId") Long islandId);
}
