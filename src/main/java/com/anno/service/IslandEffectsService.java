package com.anno.service;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;

import com.anno.domain.BuildingEntity;
import com.anno.domain.BuildingType;
import com.anno.domain.ServiceType;
import com.anno.repo.BuildingRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 公共服务与全岛加成的**汇总处**：把岛上一百多座建筑里"不产东西的那七成"换算成具体数值。
 * <p>
 * 接进完整建筑表之后绝大多数建筑是没有配方的：教堂、学校、公园、消防站、炮台、银行……
 * 它们必须换算成对玩家**看得见的收益**，否则没人会建第二座。这里提供两类换算：
 * <ol>
 *   <li><b>居民服务覆盖率</b>（{@link #coverage}）：某一项服务覆盖到了多少比例的<b>住宅</b>。
 *       覆盖率进入 {@code PopulationService} 的满足度计算 —— 缺了本阶层非要不可的那几项，
 *       物资再足也只能拿到一半满足度。</li>
 *   <li><b>全岛加成</b>（{@link #effects}）：供电 / 仓储 / 农机 / 泊位不看位置，
 *       岛上有就算，效果累加并封顶（见下面的 cap 常量）—— 否则铺二十座仓库就能刷爆待运区。</li>
 * </ol>
 * <p>
 * 【性能】这些都按**岛**查询，而不是 findAll 全服扫描：
 * 一次结算只取这座岛的建筑表（几十行），每个结算周期每座岛各调一次。
 */
@Service
public class IslandEffectsService {

    /** 待运区上限加成封顶（格） */
    public static final int STOCK_CAP = 80;
    /** 生产提速封顶（百分比） */
    public static final double POWER_CAP = 36;
    /** 作物生长提速封顶（百分比） */
    public static final double FARM_CAP = 30;
    /** 税收加成封顶（百分比） */
    public static final double TAX_CAP = 45;

    private final BuildingRepository buildingRepository;

    public IslandEffectsService(BuildingRepository buildingRepository) {
        this.buildingRepository = buildingRepository;
    }

    /**
     * 全岛加成快照。
     *
     * @param pendingBonus  额外待运区上限（格）
     * @param powerPct      生产提速百分比
     * @param farmPct       作物生长提速百分比
     * @param taxPct        税收加成百分比
     * @param moorings      额外泊位数
     */
    public record Effects(int pendingBonus, double powerPct, double farmPct, double taxPct, int moorings) {

        public static final Effects NONE = new Effects(0, 0, 0, 0, 0);

        /** 生产速度倍率：1.0 = 没加成，1.36 = 电厂铺到加成上限 */
        public double speedMultiplier() { return 1.0 + powerPct / 100.0; }

        /** 作物生长倍率 */
        public double growthMultiplier() { return 1.0 + farmPct / 100.0; }

        /** 税收倍率 */
        public double taxMultiplier() { return 1.0 + taxPct / 100.0; }
    }

    /**
     * 这座岛的各项公共服务**覆盖了多少比例的住宅**（0~1）。
     * <p>
     * 【判定方式】服务半径是**建筑中心到住宅中心**的欧氏距离（按格算），
     * 只统计有坐标的建筑 —— 老存档里没有 gridX/gridZ 的住宅不计入分母，也不计入分子，
     * 这样"搬家到有坐标的新房子"不会突然把覆盖率拉低。
     */
    @Transactional(readOnly = true)
    public Map<ServiceType, Double> coverage(Long islandId) {
        return coverageOf(buildingRepository.findByIslandId(islandId));
    }

    /** 见 {@link #coverage}：给已经取过建筑表的地方用，避免重复查询 */
    public Map<ServiceType, Double> coverageOf(List<BuildingEntity> buildings) {
        Map<ServiceType, Double> out = new EnumMap<>(ServiceType.class);

        // 服务建筑的坐标与半径
        record Src(double x, double z, double r2, ServiceType s) { }
        List<Src> sources = new java.util.ArrayList<>();
        // 住宅坐标
        List<double[]> homes = new java.util.ArrayList<>();
        for (BuildingEntity b : buildings) {
            if (b.getGridX() == null || b.getGridZ() == null) continue;
            BuildingType t = b.getType();
            double cx = b.getGridX() + (t.effSizeW(b.getRotation()) - 1) / 2.0;
            double cz = b.getGridZ() + (t.effSizeH(b.getRotation()) - 1) / 2.0;
            if (t.isResidence()) homes.add(new double[]{cx, cz});
            else if (t.providesService() && t.getService().isAmenity() && t.getServiceRadius() > 0) {
                sources.add(new Src(cx, cz, (double) t.getServiceRadius() * t.getServiceRadius(), t.getService()));
            }
        }
        if (homes.isEmpty() || sources.isEmpty()) return out;

        int[] covered = new int[ServiceType.values().length];
        for (double[] h : homes) {
            boolean[] seen = new boolean[ServiceType.values().length];
            for (Src s : sources) {
                if (seen[s.s().ordinal()]) continue;
                double dx = h[0] - s.x(), dz = h[1] - s.z();
                if (dx * dx + dz * dz <= s.r2()) {
                    seen[s.s().ordinal()] = true;
                    covered[s.s().ordinal()]++;
                }
            }
        }
        for (ServiceType s : ServiceType.values()) {
            int n = covered[s.ordinal()];
            if (n > 0 || sources.stream().anyMatch(x -> x.s() == s)) {
                out.put(s, n / (double) homes.size());
            }
        }
        return out;
    }

    /** 这座岛的作物生长倍率（拖拉机谷仓之类的农机加成） */
    @Transactional(readOnly = true)
    public double farmMultiplier(Long islandId) {
        return effects(islandId).growthMultiplier();
    }

    /** 这座岛的全岛加成（供电 / 仓储 / 农机 / 税收 / 泊位） */
    @Transactional(readOnly = true)
    public Effects effects(Long islandId) {
        return effectsOf(buildingRepository.findByIslandId(islandId));
    }

    /** 见 {@link #effects}：给已经取过建筑表的地方用 */
    public Effects effectsOf(List<BuildingEntity> buildings) {
        int pending = 0, moorings = 0;
        double power = 0, farm = 0, tax = 0;
        for (BuildingEntity b : buildings) {
            BuildingType t = b.getType();
            if (!t.providesService()) continue;
            ServiceType s = t.getService();
            int v = t.getServiceValue();
            switch (s.getEffect()) {
                case PENDING -> pending += v;
                case PRODUCTION -> power += v;
                case FARM -> farm += v;
                case TAX -> tax += v;
                case MOORING -> moorings += v;
                case NONE -> { }
            }
        }
        return new Effects(Math.min(STOCK_CAP, pending),
                Math.min(POWER_CAP, power),
                Math.min(FARM_CAP, farm),
                Math.min(TAX_CAP, tax),
                moorings);
    }

    /**
     * 一个阶层当前享受到的<b>服务满足比例</b>（0~1）：它要的几项服务，平均覆盖了多少住宅。
     * <p>
     * 没有硬性服务需求的阶层（农夫）恒为 1 —— 他们本来就不挑。
     */
    public double factorFor(List<ServiceType> required, Map<ServiceType, Double> coverage) {
        if (required == null || required.isEmpty()) return 1.0;
        double sum = 0;
        for (ServiceType s : required) sum += coverage.getOrDefault(s, 0.0);
        return sum / required.size();
    }
}
