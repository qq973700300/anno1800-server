package com.anno.service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;

import com.anno.domain.ExpeditionEntity;
import com.anno.domain.Good;
import com.anno.domain.IslandEntity;
import com.anno.domain.PlayerEntity;
import com.anno.domain.ShipEntity;
import com.anno.domain.ShipType;
import com.anno.dto.Views;
import com.anno.exception.GameException;
import com.anno.repo.ExpeditionRepository;
import com.anno.repo.IslandRepository;
import com.anno.repo.ShipRepository;
import com.anno.ws.GameSocketHub;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 远征探险：组建远征队 → 航行（随岛屿心跳推进）→ 途中文字事件（玩家选择）→ 结算。
 * <p>
 * 【时钟】tick 拿到的 seconds 是已经过离线冻结 / 时间倍率折算的<b>游戏秒</b>，
 * 与作物 / 工厂 / 商船同一套时钟 —— 离线远征照样冻结，不会"挂机回来全船喂鱼"。
 * <p>
 * 【事件在出发时就掷定】{@code plan} 是逗号分隔的事件 key 序列，按进度阈值依次触发；
 * 重启 / 重连都不会让"同样的进度弹出不同的事件"，也不存在每拍重掷的竞态。
 * <p>
 * 【选择不暂停游戏】事件卡 30 游戏秒倒计时，超时自动走 0 号"保守项"
 * （约定：每个事件的 0 号选项永远是代价温和的那一个）。
 * <p>
 * 【骷髅岛】目的地 SKULL_ISLAND 固定三连事件（雾墙 → 骸骨海岸 → 峡谷巨猿），
 * 通关点亮玩家图鉴（discoveries）并带回"金刚神像"传说奖励。
 */
@Service
public class ExpeditionService {

    private static final Logger log = LoggerFactory.getLogger(ExpeditionService.class);

    /** 解锁人口：岛上总居民达到这个数才让组远征队（有港口是另一条硬条件） */
    public static final int UNLOCK_POPULATION = 50;
    /** 事件卡选择窗口（游戏秒） */
    private static final double CHOICE_WINDOW = 30;

    /* ---------------- 目的地 ---------------- */

    private record Dest(String key, String label, int durationSec, double coinCost,
                        List<Map.Entry<Good, Integer>> goodsCost) {
        static final Dest GREEN_ISLES = new Dest("GREEN_ISLES", "绿屿群礁", 180, 1200,
                List.of(Map.entry(Good.SCHNAPPS, 8), Map.entry(Good.BREAD, 10)));
        static final Dest SKULL_ISLAND = new Dest("SKULL_ISLAND", "骷髅岛", 300, 4000,
                List.of(Map.entry(Good.SCHNAPPS, 25), Map.entry(Good.BREAD, 30), Map.entry(Good.BEER, 15)));
    }
    private static final Map<String, Dest> DESTS = Map.of(
            Dest.GREEN_ISLES.key, Dest.GREEN_ISLES, Dest.SKULL_ISLAND.key, Dest.SKULL_ISLAND);

    /* ---------------- 事件定义 ---------------- */

    /** 一个选项：label 给按钮，morale/supplies 是施加的增量（负数=消耗），needMorale 是门槛 */
    public record EventOption(String label, String hint, double morale, double supplies, double needMorale) {
    }
    private record EventDef(String key, String title, String text, List<EventOption> options) {
    }

    private static final Map<String, EventDef> EVENTS = new LinkedHashMap<>();

    private static void def(EventDef e) { EVENTS.put(e.key(), e); }

    static {
        /* ---- 通用事件池（普通航线从中随机抽 2 个）---- */
        def(new EventDef("STORM", "风暴来袭", "乌云压顶，浪头比桅杆还高，主帆已经发出不堪重负的呻吟。",
                List.of(new EventOption("收帆减速，稳住船身", "耗补给", 0, -12, 0),
                        new EventOption("顶风全速冲过去", "耗士气", -20, 0, 0))));
        def(new EventDef("FOG", "浓雾迷航", "海雾把星空和罗盘一起吞了，舵手看不见船头。",
                List.of(new EventOption("下锚，等雾散", "耗补给", 0, -10, 0),
                        new EventOption("摸黑硬闯", "耗士气", -15, 0, 0))));
        def(new EventDef("DRIFTWOOD", "漂流的水手", "瞭望员发现一块破碎的船板，上面趴着一个还有气的人。",
                List.of(new EventOption("照自己的航线走", "士气小挫", -6, 0, 0),
                        new EventOption("偏航搜救", "耗补给、大涨士气", 16, -14, 0))));
        def(new EventDef("SIRENS", "海妖的歌声", "夜里有歌声从浪那头飘来，掌舵的水手眼神开始发直。",
                List.of(new EventOption("堵住耳朵继续赶路", "士气小挫", -8, 0, 0),
                        new EventOption("顺着歌声查探", "有风险也有惊喜", 14, -16, 0))));
        def(new EventDef("PIRATES", "海盗纵帆船", "一面黑旗从下风处升了起来，吃水很深，跑是跑不过的。",
                List.of(new EventOption("交出部分货物买路", "耗补给", 0, -22, 0),
                        new EventOption("升起战旗，炮战！", "耗士气", -18, 0, 0))));
        def(new EventDef("ALBATROSS", "信天翁", "一只白鸟绕着桅杆盘旋不肯走，老水手说这是远方的信使。",
                List.of(new EventOption("撒些口粮喂它", "小耗补给、大涨士气", 12, -6, 0),
                        new EventOption("拿望远镜看看它落脚在哪", "士气微涨", 6, 0, 0))));

        /* ---- 骷髅岛专属三连（固定顺序）---- */
        def(new EventDef("MIST", "骷髅雾墙", "海图上没有的雾墙拦在船头，雾里传来骨头互相摩擦的声音。",
                List.of(new EventOption("沿雾墙外海绕行", "耗补给", 0, -20, 0),
                        new EventOption("穿雾而入", "耗士气", -15, 0, 0))));
        def(new EventDef("BONES", "骸骨海岸", "白色的骸骨堆成山脊，像巨兽的肋骨一路排到天上。",
                List.of(new EventOption("派小队沿海岸侦察", "耗补给", 0, -16, 0),
                        new EventOption("全员登岸", "耗士气与补给", -12, -6, 0))));
        def(new EventDef("APE", "峡谷里的巨猿", "山谷深处传来砸断树木的巨响——它出现了，比房子还高。",
                List.of(new EventOption("献上物资，安静退避", "大量耗补给", 0, -30, 0),
                        new EventOption("与巨猿对峙", "需要高昂士气", -10, 0, 55))));
    }

    /* ---------------- 图鉴定义 ---------------- */

    private static final Map<String, String[]> DISCOVERIES = Map.of(
            "SKULL_ISLAND", new String[]{"骷髅岛", "骸骨海岸与峡谷巨猿盘踞的传说之岛，海图上拒绝标注它。"},
            "KONG_IDOL",    new String[]{"金刚神像", "骷髅岛深处寻获的巨大石像，眼窝里嵌着两颗海蓝宝石。"});

    private final ExpeditionRepository repo;
    private final IslandRepository islandRepository;
    private final PlayerService playerService;
    private final InventoryService inventoryService;
    private final PopulationService populationService;
    private final ShipRepository shipRepository;
    private final GameSocketHub hub;

    public ExpeditionService(ExpeditionRepository repo, IslandRepository islandRepository,
                             PlayerService playerService, InventoryService inventoryService,
                             PopulationService populationService, ShipRepository shipRepository,
                             GameSocketHub hub) {
        this.repo = repo;
        this.islandRepository = islandRepository;
        this.playerService = playerService;
        this.inventoryService = inventoryService;
        this.populationService = populationService;
        this.shipRepository = shipRepository;
        this.hub = hub;
    }

    /* ================= 查询 ================= */

    @Transactional(readOnly = true)
    public List<Views.ExpeditionView> list(Long playerId) {
        List<Views.ExpeditionView> out = new ArrayList<>();
        for (ExpeditionEntity e : repo.findByPlayerIdOrderByIdDesc(playerId)) out.add(view(e));
        return out;
    }

    /** 图鉴：玩家已点亮的发现物（含名称与描述） */
    @Transactional(readOnly = true)
    public List<Map<String, String>> discoveries(Long playerId) {
        PlayerEntity p = playerService.require(playerId);
        List<Map<String, String>> out = new ArrayList<>();
        for (String key : parseDiscoveries(p)) {
            String[] d = DISCOVERIES.get(key);
            if (d != null) out.add(Map.of("key", key, "label", d[0], "desc", d[1]));
        }
        return out;
    }

    /* ================= 组建 ================= */

    @Transactional
    public Views.ExpeditionView create(Long playerId, Long islandId, String destination, String name,
                                       Long shipId) {
        playerService.require(playerId);
        IslandEntity island = islandRepository.findById(islandId)
                .orElseThrow(() -> GameException.of("岛屿不存在"));
        if (!island.getOwnerId().equals(playerId)) throw GameException.of("这不是你的岛");
        Dest dest = DESTS.get(destination);
        if (dest == null) throw GameException.of("未知的目的地：" + destination);

        Views.PopulationView pop = populationService.population(islandId);
        if (!pop.hasTradingPost()) throw GameException.of("组建远征队需要先建贸易站（港口）");
        if (pop.totalPopulation() < UNLOCK_POPULATION)
            throw GameException.of("人口不足：远征需要 " + UNLOCK_POPULATION + " 名居民，现有 " + pop.totalPopulation());

        /* 【船就是远征名额】一艘闲置船 = 一条可出发的远征：出发占用、归来释放。
           没有船就一条远征都开不了 —— 先去造船厂造船（这正是造船厂的价值）。 */
        ShipEntity ship = pickShip(playerId, islandId, shipId);
        if (ship == null)
            throw GameException.of("没有闲置的船可派 —— 先在造船厂造一艘（点岛上的造船厂开工）");

        playerService.spend(playerId, dest.coinCost(), "远征");
        for (Map.Entry<Good, Integer> c : dest.goodsCost()) inventoryService.remove(playerId, c.getKey(), c.getValue());

        String plan = dest == Dest.SKULL_ISLAND ? "MIST,BONES,APE" : pickGenericPlan();
        ExpeditionEntity e = new ExpeditionEntity(playerId, islandId,
                name == null || name.isBlank() ? dest.label() + "远征队" : name.trim(),
                dest.key(), plan, System.currentTimeMillis());
        e.setShipId(ship.getId());
        e.setShipType(ship.getType());
        ship.setState("AWAY");
        shipRepository.save(ship);
        e.setResultLog("远征船「" + ShipType.parse(ship.getType()).label + "」从港口启航，目标是" + dest.label() + "。");
        repo.save(e);
        push(e, "created");
        return view(e);
    }

    /**
     * 挑一艘出发的船：玩家在远征面板里指定就用那艘（校验归属 / 本岛 / 闲置），
     * 没指定就自动用本岛最早下水的那艘闲置船（省得玩家每次都得选）。
     */
    private ShipEntity pickShip(Long playerId, Long islandId, Long shipId) {
        if (shipId != null) {
            ShipEntity s = shipRepository.findById(shipId).orElse(null);
            if (s == null || !s.getPlayerId().equals(playerId)) throw GameException.of("没有这艘船");
            if (!s.getIslandId().equals(islandId)) throw GameException.of("这艘船停在别的岛上");
            if (!"IDLE".equals(s.getState())) throw GameException.of("这艘船不在港里（正在海上）");
            return s;
        }
        return shipRepository.findByIslandIdAndStateOrderByIdAsc(islandId, "IDLE").stream()
                .findFirst().orElse(null);
    }

    /** 普通航线：从通用池里抽 2 个不重复的事件，按出发时序排好 */
    private String pickGenericPlan() {
        List<String> pool = new ArrayList<>(List.of("STORM", "FOG", "DRIFTWOOD", "SIRENS", "PIRATES", "ALBATROSS"));
        java.util.Collections.shuffle(pool, ThreadLocalRandom.current());
        return pool.get(0) + "," + pool.get(1);
    }

    /* ================= 玩家选择 ================= */

    @Transactional
    public Views.ExpeditionView choice(Long playerId, Long expeditionId, int optionIndex) {
        ExpeditionEntity e = repo.findById(expeditionId).orElseThrow(() -> GameException.of("远征队不存在"));
        if (!e.getPlayerId().equals(playerId)) throw GameException.of("这不是你的远征队");
        if (!"EVENT".equals(e.getStatus())) throw GameException.of("当前没有待处理的事件");
        EventDef def = EVENTS.get(e.getCurrentEvent());
        if (def == null) throw GameException.of("未知的事件：" + e.getCurrentEvent());
        if (optionIndex < 0 || optionIndex >= def.options().size()) throw GameException.of("无效的选项");

        EventOption opt = def.options().get(optionIndex);
        if (opt.needMorale() > 0 && e.getMorale() < opt.needMorale())
            throw GameException.of("士气不足：" + opt.label() + " 需要 " + (int) opt.needMorale() + " 士气");
        if (opt.supplies() < 0 && e.getSupplies() + opt.supplies() < 0)
            throw GameException.of("补给不足，走不了这一步");
        applyChoice(e, optionIndex, false);
        repo.save(e);
        return view(e);
    }

    /* ================= 心跳推进（IslandSimService 每拍调） ================= */

    @Transactional
    public void tickIsland(Long islandId, Long ownerId, double seconds) {
        List<ExpeditionEntity> actives = repo.findByIslandIdAndStatusIn(islandId, List.of("VOYAGING", "EVENT"));
        if (actives.isEmpty()) return;
        for (ExpeditionEntity e : actives) {
            try {
                advance(e, seconds);
                repo.save(e);
            } catch (Exception ex) {
                // 单支远征出问题不拖垮整座岛的结算
                log.warn("远征 {} 推进失败：{}", e.getId(), ex.toString());
            }
        }
    }

    private void advance(ExpeditionEntity e, double seconds) {
        /* 1) 事件卡倒计时：归零自动走保守项（0 号） */
        if ("EVENT".equals(e.getStatus())) {
            e.setChoiceLeft(e.getChoiceLeft() - seconds);
            if (e.getChoiceLeft() <= 0) {
                applyChoice(e, 0, true);
                repo.save(e);
                if (!"VOYAGING".equals(e.getStatus())) return;   // 士气崩了已终局
            } else {
                return;                                          // 还在等选择，进度不动（原作式：事件里时间凝滞）
            }
        }

        /* 2) 航程推进 */
        Dest dest = DESTS.get(e.getDestination());
        e.setProgress(Math.min(100, e.getProgress() + seconds / dest.durationSec() * 100));

        /* 3) 过阈值触发下一个事件 */
        String[] plan = e.getPlan().split(",");
        if (e.getStage() < plan.length && e.getProgress() >= threshold(e.getStage(), plan.length)) {
            triggerEvent(e, plan[e.getStage()]);
            return;
        }

        /* 4) 到港结算 */
        if (e.getProgress() >= 100) resolve(e);
    }

    /** 第 stage 个事件的触发阈值：把航程均分成 n+1 段，事件落在每段末尾 */
    private static double threshold(int stage, int n) {
        return (stage + 1) * 100.0 / (n + 1);
    }

    private void triggerEvent(ExpeditionEntity e, String key) {
        EventDef def = EVENTS.get(key);
        if (def == null) {           // 兜底：池子改了名字也不至于卡死在海上
            e.setStage(e.getStage() + 1);
            return;
        }
        e.setStatus("EVENT");
        e.setCurrentEvent(key);
        e.setChoiceLeft(CHOICE_WINDOW);
        e.setResultLog(appendLog(e.getResultLog(), "【" + def.title() + "】" + def.text()));
        push(e, "event");
    }

    /** 执行选项并落账：auto=true 表示倒计时归零的自动保守项 */
    private void applyChoice(ExpeditionEntity e, int idx, boolean auto) {
        EventDef def = EVENTS.get(e.getCurrentEvent());
        if (def == null) return;
        EventOption opt = def.options().get(Math.max(0, Math.min(idx, def.options().size() - 1)));
        // 自动选择时不因补给不够而炸：有多少花多少
        double supplies = opt.supplies() < 0 ? Math.max(opt.supplies(), -e.getSupplies()) : opt.supplies();
        e.setMorale(clamp(e.getMorale() + opt.morale()));
        e.setSupplies(clamp(e.getSupplies() + supplies));
        e.setStage(e.getStage() + 1);
        e.setCurrentEvent(null);
        e.setChoiceLeft(0);
        e.setStatus("VOYAGING");
        String line = "选择「" + opt.label() + "」" + (auto ? "（超时自动）" : "")
                + " → 士气 " + fmtDelta(opt.morale()) + "，补给 " + fmtDelta(supplies);
        e.setResultLog(appendLog(e.getResultLog(), line));
        if (e.getMorale() <= 0) fail(e, "士气崩溃，水手们哗变夺船，掉头返航。");
    }

    private void resolve(ExpeditionEntity e) {
        Dest dest = DESTS.get(e.getDestination());
        ThreadLocalRandom rnd = ThreadLocalRandom.current();
        /* 大船跑远征带得多：奖励按船型加成放大（小帆船 0% / 商运 20% / 大型商船 40%） */
        double bonus = expeditionBonus(e);
        double coin;
        String text;
        if (dest == Dest.SKULL_ISLAND) {
            coin = Math.round(5000 * (1 + bonus));
            addDiscovery(e.getPlayerId(), "SKULL_ISLAND");
            addDiscovery(e.getPlayerId(), "KONG_IDOL");
            playerService.addReputation(e.getPlayerId(), 200);
            text = "🏆 传奇远征成功！远征队从骷髅岛带回「金刚神像」，全城沸腾。奖励 ¥" + (long) coin
                    + (bonus > 0 ? "（大船加成 +" + Math.round(bonus * 100) + "%）" : "")
                    + "，声望 +200，图鉴已点亮。";
        } else {
            coin = Math.round((400 + rnd.nextInt(500)) * (1 + bonus));
            text = "⚓ 远征归来！从" + dest.label() + "带回珍奇货物与航海图，入账 ¥" + (long) coin + "。";
            if (rnd.nextDouble() < 0.35) {
                Good bonusGood = rnd.nextBoolean() ? Good.STEEL : Good.CLOTHES;
                inventoryService.add(e.getPlayerId(), bonusGood, 2);
                text += " 另有 " + bonusGood.getLabel() + " ×2 入仓。";
            }
        }
        playerService.addTreasury(e.getPlayerId(), coin);
        releaseShip(e);
        e.setStatus("DONE");
        e.setEndedAt(System.currentTimeMillis());
        e.setReward(text);
        e.setResultLog(appendLog(e.getResultLog(), text));
        push(e, "resolved");
    }

    private void fail(ExpeditionEntity e, String why) {
        releaseShip(e);
        e.setStatus("FAILED");
        e.setEndedAt(System.currentTimeMillis());
        e.setReward("💔 远征失败：" + why + " 一无所获。");
        e.setResultLog(appendLog(e.getResultLog(), e.getReward()));
        push(e, "resolved");
    }

    /** 船随远征终局归港：释放回 IDLE，又是下一条远征的名额 */
    private void releaseShip(ExpeditionEntity e) {
        if (e.getShipId() == null) return;
        shipRepository.findById(e.getShipId()).ifPresent(s -> {
            s.setState("IDLE");
            shipRepository.save(s);
        });
        e.setShipId(null);
    }

    private static double expeditionBonus(ExpeditionEntity e) {
        try {
            return e.getShipType() == null ? 0 : ShipType.valueOf(e.getShipType()).expeditionBonus;
        } catch (IllegalArgumentException ex) {
            return 0;
        }
    }

    /* ================= 图鉴写回 ================= */

    /** 图鉴存玩家行的 JSON 数组串里（手拼，不引 JSON 库）：["A","B"] */
    private void addDiscovery(Long playerId, String key) {
        PlayerEntity p = playerService.require(playerId);
        List<String> keys = parseDiscoveries(p);
        if (keys.contains(key)) return;
        keys.add(key);
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < keys.size(); i++) {
            if (i > 0) sb.append(',');
            sb.append('"').append(keys.get(i)).append('"');
        }
        p.setDiscoveries(sb.append(']').toString());
    }

    private static List<String> parseDiscoveries(PlayerEntity p) {
        String raw = p.getDiscoveries();
        List<String> out = new ArrayList<>();
        if (raw == null || raw.length() < 2) return out;
        for (String s : raw.replaceAll("[\\[\\]\"]", "").split(",")) {
            if (!s.isBlank()) out.add(s.trim());
        }
        return out;
    }

    /* ================= 视图与推送 ================= */

    public Views.ExpeditionView view(ExpeditionEntity e) {
        Dest dest = DESTS.get(e.getDestination());
        String eventKey = e.getCurrentEvent();
        String title = null, text = null;
        List<Views.ExpeditionOptionView> options = List.of();
        if ("EVENT".equals(e.getStatus()) && eventKey != null) {
            EventDef def = EVENTS.get(eventKey);
            if (def != null) {
                title = def.title();
                text = def.text();
                options = def.options().stream()
                        .map(o -> new Views.ExpeditionOptionView(o.label(), o.hint(), o.morale(), o.supplies(),
                                o.needMorale(),
                                o.needMorale() <= 0 || e.getMorale() >= o.needMorale(),
                                o.supplies() >= 0 || e.getSupplies() + o.supplies() >= 0))
                        .toList();
            }
        }
        return new Views.ExpeditionView(e.getId(), e.getIslandId(), e.getName(),
                e.getDestination(), dest == null ? e.getDestination() : dest.label(),
                e.getStatus(), e.getProgress(), e.getMorale(), e.getSupplies(),
                eventKey, title, text, options, Math.max(0, e.getChoiceLeft()),
                e.getResultLog(), e.getReward(), e.getCreatedAt(), e.getEndedAt());
    }

    private void push(ExpeditionEntity e, String kind) {
        try {
            hub.sendToPlayer(e.getPlayerId(), "expedition",
                    Map.of("kind", kind, "expedition", view(e)));
        } catch (Exception ex) {
            log.warn("远征推送失败：{}", ex.toString());
        }
    }

    private static double clamp(double v) { return Math.max(0, Math.min(100, v)); }

    private static String fmtDelta(double v) {
        return (v >= 0 ? "+" : "") + (int) v;
    }

    /** 航行日志追加：条数多了掐头（保留最近 6 条），防止 2048 上限爆列 */
    private static String appendLog(String log, String line) {
        String[] parts = (log == null || log.isBlank() ? "" : log).split("\n");
        List<String> keep = new ArrayList<>();
        for (String p : parts) if (!p.isBlank()) keep.add(p);
        keep.add(line);
        while (keep.size() > 6) keep.remove(0);
        return String.join("\n", keep);
    }
}
