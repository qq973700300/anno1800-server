package com.anno.config;

import java.util.function.Supplier;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 并发失败重试器 —— 联机游戏的必备兜底。
 * <p>
 * 数据库在高并发下会抛两类"可以重试"的错误：
 * <ul>
 *   <li><b>死锁</b>（MySQL 1213：Deadlock found when trying to get lock）：
 *       两个事务互相等对方的行锁，MySQL 会挑一个杀掉。不是 bug，重试就能成。</li>
 *   <li><b>乐观锁冲突</b>（@Version 版本不匹配）：有人抢先改了同一行。</li>
 * </ul>
 * 这两类在 Spring 里都继承自 {@code ConcurrencyFailureException}，统一捕获重试即可。
 * 重试必须开<b>新事务</b>（REQUIRES_NEW）：原事务已经被标记回滚，在里面重跑 SQL 只会有去无回。
 */
@Component
public class DbRetry {

    private static final Logger log = LoggerFactory.getLogger(DbRetry.class);
    private static final int MAX_ATTEMPTS = 3;

    private final TransactionTemplate txNew;

    public DbRetry(PlatformTransactionManager txm) {
        this.txNew = new TransactionTemplate(txm);
        this.txNew.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public <T> T run(String name, Supplier<T> task) {
        for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                return txNew.execute(status -> task.get());
            } catch (ConcurrencyFailureException e) {
                if (attempt == MAX_ATTEMPTS) {
                    log.warn("[{}] 并发冲突重试 {} 次仍失败，放弃：{}", name, MAX_ATTEMPTS, e.toString());
                    throw e;
                }
                log.info("[{}] 第 {} 次并发冲突，重试：{}", name, attempt, e.toString());
                // 退避后再试，避免两边又撞在同一毫秒
                try {
                    Thread.sleep(30L * attempt);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw e;
                }
            }
        }
        throw new IllegalStateException("unreachable");
    }

    public void runVoid(String name, Runnable task) {
        run(name, () -> {
            task.run();
            return null;
        });
    }
}
