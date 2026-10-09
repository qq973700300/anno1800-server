package com.anno.repo;

import java.util.List;

import com.anno.domain.BuildingEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface BuildingRepository extends JpaRepository<BuildingEntity, Long> {

    List<BuildingEntity> findByIslandId(Long islandId);

    /* 注意：没有 existsByIslandIdAndGridXAndGridZ —— 建筑占地可能是 4×4，
       只比锚点那一格会让马路/作物"穿"进厂房。冲突校验一律用
       BuildingEntity.covers(x,z) / overlaps(...) 按整块占地判。 */

    /**
     * 只推进进度：一条 UPDATE 落库，不经过实体。
     * <p>
     * 心跳里如果走「改实体 → save」，会话里会挂住几十个脏建筑；而每次出入库的
     * @Modifying 查询都会先 flush 一次全会话，于是 N 座建筑 × N 次 flush = O(N²) 条 SQL，
     * 实测一个 tick 要 2 秒。改成实体只读、进度用这条语句单独写，就变回 O(N)。
     */
    @Modifying(flushAutomatically = true)
    @Query("update BuildingEntity b set b.elapsed = :elapsed, b.stalled = :stalled, "
            + "b.pendingQty = :pending where b.id = :id")
    int updateProgress(@Param("id") Long id, @Param("elapsed") double elapsed,
                       @Param("stalled") boolean stalled, @Param("pending") int pendingQty);

    /**
     * 工人分配结果落库：只在"分到 / 没分到"翻转的那一拍才调用（不是每拍都写），
     * 平时这条 UPDATE 根本不会出现在 SQL 日志里。
     */
    @Modifying(flushAutomatically = true)
    @Query("update BuildingEntity b set b.noWorkers = :noWorkers where b.id = :id")
    int updateNoWorkers(@Param("id") Long id, @Param("noWorkers") boolean noWorkers);
}
