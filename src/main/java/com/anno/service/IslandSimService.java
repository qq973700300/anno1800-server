package com.anno.service;

import java.util.List;

import com.anno.config.DbRetry;
import com.anno.config.GameProperties;
import com.anno.domain.IslandEntity;
import com.anno.repo.IslandRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * 岛屿模拟的唯一入口：把一座岛上的**作物 / 工厂 / 居民 / 商船**一起推进到"现在"。
 * <p>
 * 【为什么要有这一层】改造前，世界心跳每秒做一次全服扫描：
 * {@code ProductionService} 拉 {@code findAll()} 全库建筑、{@code FarmService} 拉全服所有
 * 生长中的作物再全量写回、{@code PopulationService} 拉全服居民行。开销与<b>注册玩家数</b>
 * 成正比 —— 玩家越多越慢，而其中绝大多数人根本没在看屏幕。
 * <p>
 * 【懒结算】现在改成按岛推进，而且**只在玩家在线时推进**：
 * <ul>
 *   <li>每座岛在 {@link IslandEntity#getLastSimAt()} 里记着"上次模拟到几点"（时间水位线）；</li>
 *   <li>玩家在线时，每次广播前把这座岛推进到当前时刻 —— 补算的就是这两次之间那点时间；</li>
 *   <li>玩家不在线时，这座岛<b>根本不会被调到</b>：作物不长、工厂不产、居民不吃不缴税、
 *       商船也不跑。所以 1 万在线就只有 1 万座岛在算，而不是 1 万份历史数据；</li>
 *   <li>回来时超出"离线宽限"的那段时间被记进 {@link IslandEntity#getFrozenMs()}，
 *       从模拟时钟里扣掉 —— 于是"离线完全冻结"对商船这种纯时间推导的系统同样成立。</li>
 * </ul>
 * <p>
 * 【为什么一次只推一座岛】一个事务里只有一座岛的数据，锁范围小、失败也只影响这一个玩家。
 * 万一撞上玩家正在同一毫秒点建造 / 买卖，{@link DbRetry} 会整体重试；
 * 重试仍失败就跳过这一轮 —— 水位线没被写下去，下次广播自然会把这段时间补上。
 */
@Service
public class IslandSimService {

    private static final Logger log = LoggerFactory.getLogger(IslandSimService.class);

    private final IslandRepository islandRepository;
    private final FarmService farmService;
    private final ProductionService productionService;
    private final PopulationService populationService;
    private final ShipService shipService;
    /** 远征探险：航行进度与事件倒计时也吃这套"游戏秒"时钟 */
    private final ExpeditionService expeditionService;
    /** 造船厂：船台工期同吃这套时钟（完工入舰队） */
    private final ShipyardService shipyardService;
    /** 公共服务 / 全岛加成：农机给作物提速、电厂给工厂提速 */
    private final IslandEffectsService islandEffects;
    private final GameProperties props;
    private final DbRetry dbRetry;

    public IslandSimService(IslandRepository islandRepository, FarmService farmService,
                            ProductionService productionService, PopulationService populationService,
                            ShipService shipService, ExpeditionService expeditionService,
                            ShipyardService shipyardService, IslandEffectsService islandEffects,
                            GameProperties props, DbRetry dbRetry) {
        this.islandRepository = islandRepository;
        this.farmService = farmService;
        this.productionService = productionService;
        this.populationService = populationService;
        this.shipService = shipService;
        this.expeditionService = expeditionService;
        this.shipyardService = shipyardService;
        this.islandEffects = islandEffects;
        this.props = props;
        this.dbRetry = dbRetry;
    }

    /**
     * 把某个玩家的所有岛推进到 {@code wallNow}，并返回这些岛（已就地更新水位线）。
     * <p>
     * 返回值给调用方接着拼快照用 —— 水位线刚被推进过，所以商船的相位要按
     * {@link IslandEntity#simClockAt(long)} 算，不能按墙上时间算。
     */
    public List<IslandEntity> advance(Long ownerId, long wallNow) {
        List<IslandEntity> islands = islandRepository.findByOwnerId(ownerId);
        for (IslandEntity island : islands) {
            try {
                dbRetry.runVoid("岛屿模拟#" + island.getId(), () -> advanceOne(island, wallNow));
            } catch (Exception e) {
                // 一座岛推进失败不该影响别的岛，也不该让广播挂掉：
                // 水位线没写下去，下次广播会拿更长的一段 delta 重试
                log.warn("岛 {} 本轮模拟推进失败，下次广播重试：{}", island.getId(), e.toString());
            }
        }
        return islands;
    }

    /**
     * 推进单座岛：算 delta → **先提交水位线** → 五个子系统各自独立事务推进。
     * <p>
     * 【为什么水位线必须先落袋】曾经整座岛跑在一个大事务里，生产 tick 一抛业务异常
     * （库存缓存过期导致的"库存不足"）就把水位线一起回滚 —— 下一拍原样重试、原样再炸，
     * 整座岛（作物 / 工厂 / 居民 / 商船相位）永久冻结，玩家只看到"船卡在港口"。
     * 现在水位线单独提交（save 自带事务），子系统各自用 {@link DbRetry} 开新事务：
     * 一个炸了只跳过它自己，下一拍从新水位继续，绝不连坐。
     * <p>
     * <b>顺序与旧的世界心跳保持一致</b>：种植 → 生产 → 人口 → 商船。
     * 人口必须排在**生产之后**（生产先把成品入库，居民这一拍才吃得到新货），
     * 商船排在最后（它按当前价卖货，晚一步拿到的是最新价）。
     */
    private void advanceOne(IslandEntity island, long wallNow) {
        long last = island.getLastSimAt();
        if (last <= 0) {
            // 老存档：这两列是后加的，第一次推进时就地初始化 —— 不做任何冻结，
            // 商船的相位因此与改造前完全一致，不会因为升级而"跳"到几十趟之后
            island.setLastSimAt(wallNow);
            islandRepository.save(island);
            return;
        }

        long wall = Math.max(0, wallNow - last);
        long gameMs = Math.min(wall, props.getOfflineGraceMs());
        // 超出宽限的部分 = 玩家不在线的那段时间：记进"冻结"，从模拟时钟里扣掉
        island.setFrozenMs(island.getFrozenMs() + (wall - gameMs));
        island.setLastSimAt(wallNow);
        islandRepository.save(island);   // 无外层事务：这条水位线立即提交，下面谁炸都冲不走它

        if (gameMs <= 0) return;
        double seconds = gameMs / 1000.0 * props.getTimeScale();
        Long islandId = island.getId();
        Long ownerId = island.getOwnerId();

        simStep("农田", islandId, () -> farmService.tickIsland(islandId, ownerId, seconds,
                islandEffects.farmMultiplier(islandId)));
        simStep("生产", islandId, () -> productionService.tickIsland(islandId, ownerId, seconds));
        simStep("人口", islandId, () -> populationService.tickIsland(islandId, ownerId, seconds));
        simStep("商船", islandId, () -> shipService.tickIsland(islandId, ownerId, island.simClockAt(wallNow)));
        simStep("远征", islandId, () -> expeditionService.tickIsland(islandId, ownerId, seconds));
        simStep("造船", islandId, () -> shipyardService.tickIsland(islandId, ownerId, seconds));
    }

    /** 一个子系统的独立推进：并发冲突自动重试，业务异常只记日志、不拖垮别的子系统 */
    private void simStep(String name, Long islandId, Runnable task) {
        try {
            dbRetry.runVoid(name + "#" + islandId, task);
        } catch (Exception e) {
            log.warn("岛 {} 的{}子系统本轮跳过（下个广播重试）：{}", islandId, name, e.toString());
        }
    }
}
