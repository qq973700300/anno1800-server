package com.anno.repo;

import java.util.List;
import java.util.Optional;

import com.anno.domain.Good;
import com.anno.domain.StockEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface StockRepository extends JpaRepository<StockEntity, Long> {

    List<StockEntity> findByPlayerId(Long playerId);

    Optional<StockEntity> findByPlayerIdAndGood(Long playerId, Good good);

    /**
     * 现量直读（原生标量查询）：**绕开一级缓存**。
     * <p>
     * 同一个事务里"先扣减后查询"时，实体查询（{@code findByPlayerIdAndGood}）虽然会打数据库，
     * 但 Hibernate 对已在持久化上下文里的实体**不会用 DB 行的新值覆盖内存旧值** ——
     * 查回来还是扣减前的数。血案现场：磨坊 A 扣完小麦，磨坊 B 的 {@code hasEnough}
     * 读到旧值放行，条件 UPDATE 对着空库存打空 → 抛"库存不足：需要 2，现有 2"，
     * 还把整轮岛屿结算炸回滚。标量投影不进一级缓存，永远拿 DB 现值，此路必须走原生 SQL。
     */
    @Query(value = "select quantity from stock where player_id = :pid and good = :good", nativeQuery = true)
    Integer rawQuantity(@Param("pid") Long pid, @Param("good") String good);

    // ==================================================================
    // 库存同样属于高频累加字段：工厂每秒扣料产出、玩家同时挂单买卖。
    // 原理同 PlayerRepository —— 用带 delta 的原子 UPDATE 绕开乐观锁，
    // 扣减时带 quantity >= :qty 条件，影响行数 0 即"库存不足"。
    //
    // 【性能】这里只用 flushAutomatically，不用 clearAutomatically：
    // clear 会在每次出入库后清空整个持久化上下文，把本 tick 里已加载的建筑、
    // 地块实体全部 detach，后续 save 又要重新 merge —— 心跳里几十次出入库
    // 就是几十次"清空+重挂"，实测能把一个 tick 拖到 1.4 秒。
    // 我们从不加载 StockEntity 实体做修改，所以清不清上下文都不影响正确性。
    // ==================================================================

    /** 出库：库存足够才扣，返回影响行数，0 即库存不足（或没有这行） */
    @Modifying(flushAutomatically = true)
    @Query("update StockEntity s set s.quantity = s.quantity - :qty "
            + "where s.playerId = :pid and s.good = :good and s.quantity >= :qty")
    int takeQuantity(@Param("pid") Long pid, @Param("good") Good good, @Param("qty") int qty);

    /**
     * 出库（有多少扣多少）：扣 {@code min(当前库存, qty)}，永远不因库存不足而失败。
     * <p>
     * 居民消费用这条 —— 仓库里只剩 3 个土豆、居民要 10 个时，正确行为是
     * "把 3 个都吃掉、满足度打折"，而不是抛"库存不足"把整轮结算打断。
     * 用 {@code least()} 在 SQL 里一次算完，避免"先查再扣"之间的竞态把库存扣成负数。
     * 返回影响行数（该玩家该商品的行存在则为 1）。
     */
    @Modifying(flushAutomatically = true)
    @Query(value = "update stock set quantity = quantity - least(quantity, :qty) "
            + "where player_id = :pid and good = :good", nativeQuery = true)
    int takeUpTo(@Param("pid") Long pid, @Param("good") String good, @Param("qty") int qty);

    /**
     * 预建空库存行（quantity=0）。
     * <p>
     * 玩家注册时把 17 种商品的行一次性建好，之后出入库就永远是 UPDATE。
     * 这样并发时不会再出现 INSERT 的间隙锁与别人的 UPDATE 互相等待，
     * 从根上消掉 "Deadlock found when trying to get lock" 的大多数场景。
     */
    @Modifying(flushAutomatically = true)
    @Query(value = "insert ignore into stock (player_id, good, quantity, version) "
            + "values (:pid, :good, 0, 0)", nativeQuery = true)
    int createRowIfAbsent(@Param("pid") Long pid, @Param("good") String good);

    /**
     * 把低于基准线的存量一次性抬到基准线（不足才改，幂等）。
     * <p>
     * 开局赠料的**存量补偿**用：纪元1800式建房要木头之后，老档玩家仓库里 0 木头会
     * 卡死"建房要料 → 没人口 → 伐木场没工人 → 没木头"的自举链，所以每次启动把
     * 木材/木板不足基准线的玩家补到基准线。
     */
    @Modifying(flushAutomatically = true)
    @Query("update StockEntity s set s.quantity = :qty "
            + "where s.playerId = :pid and s.good = :good and s.quantity < :qty")
    int topUpTo(@Param("pid") Long pid, @Param("good") Good good, @Param("qty") int qty);

    /** 全部商品的总囤货量（仓库容量判定用：总囤货 ≤ Σ仓库容量） */
    @Query("select coalesce(sum(s.quantity), 0) from StockEntity s where s.playerId = :pid")
    long totalQuantity(@Param("pid") Long pid);

    /**
     * 入库：一条语句搞定「没有就插入，有就累加」。
     * <p>
     * 如果写成「先 UPDATE，0 行再 INSERT」两步，两个事务同时给同一个玩家
     * 新增不同商品时，INSERT 的间隙锁会和对方的 UPDATE 互相等待，MySQL 直接抛死锁。
     * ON DUPLICATE KEY UPDATE 把两步合成一次原子操作，把这个窗口消掉。
     */
    @Modifying(flushAutomatically = true)
    @Query(value = "insert into stock (player_id, good, quantity, version) "
            + "values (:pid, :good, :qty, 0) "
            + "on duplicate key update quantity = quantity + :qty",
            nativeQuery = true)
    int upsertAdd(@Param("pid") Long pid, @Param("good") String good, @Param("qty") int qty);
}
