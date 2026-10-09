package com.anno.repo;

import java.util.Optional;

import com.anno.domain.PlayerEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PlayerRepository extends JpaRepository<PlayerEntity, Long> {

    Optional<PlayerEntity> findByName(String name);

    Optional<PlayerEntity> findByToken(String token);

    boolean existsByName(String name);

    // ==================================================================
    // 原子增减（网络游戏核心做法）
    //
    // 金库/声望属于"高频累加型"字段：世界心跳每秒都在给玩家加声望，
    // 玩家自己也在同时买卖。如果用「读实体 -> 改字段 -> save」的写法，
    // 只要两边撞上就会触发 @Version 乐观锁冲突，整条心跳事务回滚，
    // 世界直接停摆（作物不长、工厂不产、价格不动）。
    //
    // 改成 JPQL 批量更新后：
    //   1. UPDATE 语句带 delta，由数据库保证原子性，不会覆盖别人的写入；
    //   2. 完全不触碰 version 字段，因此不存在锁冲突；
    //   3. 扣款用 where treasury >= :amt 做条件更新 —— 影响行数 0 就是余额不足，
    //      天然防住并发超扣，比「先查余额再扣」更可靠。
    //
    // flushAutomatically：执行前先把本事务里未落库的改动刷出去，保证读到最新值；
    // clearAutomatically：执行后清空一级缓存，下次读取必定重新查库（否则会读到旧值）。
    // ==================================================================

    /** 加钱（收款、卖出所得、撤单退款） */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update PlayerEntity p set p.treasury = p.treasury + :delta where p.id = :id")
    int addTreasury(@Param("id") Long id, @Param("delta") double delta);

    /**
     * 扣钱：余额足够才扣，返回影响行数。
     * 0 行 = 余额不足（或玩家不存在），调用方据此抛"资金不足"。
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update PlayerEntity p set p.treasury = p.treasury - :amt where p.id = :id and p.treasury >= :amt")
    int trySpend(@Param("id") Long id, @Param("amt") double amt);

    /** 加声望（声望不会为负） */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update PlayerEntity p set p.reputation = p.reputation + :delta "
            + "where p.id = :id and p.reputation + :delta >= 0")
    int addReputation(@Param("id") Long id, @Param("delta") long delta);

    /** 上下线心跳：只改在线状态与最后活跃时间，不参与 version 竞争 */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update PlayerEntity p set p.online = :online, p.lastSeenAt = :ts where p.id = :id")
    int touch(@Param("id") Long id, @Param("online") boolean online, @Param("ts") long ts);
}
