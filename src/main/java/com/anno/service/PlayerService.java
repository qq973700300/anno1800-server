package com.anno.service;

import java.util.List;
import java.util.UUID;

import com.anno.config.GameProperties;
import com.anno.domain.PlayerEntity;
import com.anno.dto.Views;
import com.anno.exception.GameException;
import com.anno.repo.PlayerRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 玩家：注册 / 登录 / 资金变动 */
@Service
public class PlayerService {

    private final PlayerRepository playerRepository;
    private final InventoryService inventoryService;
    private final GameProperties props;

    public PlayerService(PlayerRepository playerRepository, InventoryService inventoryService,
                         GameProperties props) {
        this.playerRepository = playerRepository;
        this.inventoryService = inventoryService;
        this.props = props;
    }

    @Transactional
    public PlayerEntity register(String name) {
        if (name == null || name.isBlank()) {
            throw GameException.of("玩家名不能为空");
        }
        String trimmed = name.trim();
        if (playerRepository.existsByName(trimmed)) {
            throw GameException.of("玩家名已被占用：" + trimmed);
        }
        PlayerEntity p = new PlayerEntity(trimmed, UUID.randomUUID().toString().replace("-", ""),
                props.getStartTreasury());
        PlayerEntity saved = playerRepository.saveAndFlush(p);
        // 预建 17 条空库存行：后续出入库全是 UPDATE，避开 INSERT 间隙锁死锁
        inventoryService.initRowsForPlayer(saved.getId());
        // 开局赠料（纪元1800式旗舰带料）：建房要木头后没有它，自举链会死锁
        inventoryService.grantStarter(saved.getId());
        return saved;
    }

    @Transactional(readOnly = true)
    public PlayerEntity require(Long playerId) {
        return playerRepository.findById(playerId)
                .orElseThrow(() -> GameException.of("玩家不存在：" + playerId));
    }

    @Transactional(readOnly = true)
    public PlayerEntity byToken(String token) {
        return playerRepository.findByToken(token)
                .orElseThrow(() -> GameException.of("登录凭证无效"));
    }

    @Transactional(readOnly = true)
    public List<Views.PlayerBrief> onlineList() {
        return playerRepository.findAll().stream()
                .map(p -> new Views.PlayerBrief(p.getId(), p.getName(), p.isOnline(),
                        p.getTreasury(), p.getReputation()))
                .toList();
    }

    /**
     * 收款：原子 UPDATE，不参与乐观锁竞争。
     * 世界心跳给玩家结算、卖给 NPC、撤单退款都走这里。
     */
    @Transactional
    public void addTreasury(Long playerId, double delta) {
        if (delta == 0) return;
        if (playerRepository.addTreasury(playerId, delta) == 0) {
            throw GameException.of("玩家不存在：" + playerId);
        }
    }

    /**
     * 扣款：条件原子 UPDATE（where treasury >= amt）。
     * 影响行数 0 即余额不足 —— 比"先查再扣"更可靠，并发下不会超扣。
     */
    @Transactional
    public void spend(Long playerId, double amount, String reason) {
        if (amount <= 0) return;
        if (playerRepository.trySpend(playerId, amount) > 0) return;
        // 扣款失败：区分是"玩家不存在"还是"钱不够"，给前端一个能看懂的原因
        PlayerEntity p = playerRepository.findById(playerId).orElse(null);
        if (p == null) throw GameException.of("玩家不存在：" + playerId);
        throw GameException.of("资金不足，" + reason + " 需要 " + round2(amount)
                + "，现有 " + round2(p.getTreasury()));
    }

    /** 声望：原子累加，心跳里每轮生产都会调用，绝不能撞乐观锁 */
    @Transactional
    public void addReputation(Long playerId, long delta) {
        if (delta == 0) return;
        playerRepository.addReputation(playerId, delta);
    }

    /** 上下线：只改状态字段，同样走原子 UPDATE */
    @Transactional
    public void touch(Long playerId, boolean online) {
        playerRepository.touch(playerId, online, System.currentTimeMillis());
    }

    public Views.PlayerView view(PlayerEntity p) {
        return new Views.PlayerView(p.getId(), p.getName(), p.getToken(), p.getTreasury(),
                p.getReputation(), p.isOnline());
    }

    private static double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }
}
