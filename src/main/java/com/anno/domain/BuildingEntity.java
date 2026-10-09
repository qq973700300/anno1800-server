package com.anno.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** 建筑：产业链的一环，按配方把输入库存转成输出库存 */
@Entity
@Table(name = "building")
public class BuildingEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "island_id", nullable = false)
    private Long islandId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private BuildingType type;

    /** 等级，每级产量 +100% */
    @Column(nullable = false)
    private int level = 1;

    /** 本轮生产已进行的游戏秒数 */
    @Column(nullable = false)
    private double elapsed;

    /**
     * 占地矩形的左上角格子（x/z 最小的那格；旧建筑可能为 null，客户端按老布局兜底摆放）。
     * <p>
     * 【注意】占地的宽高**不落库**，由 {@link BuildingType#effSizeW(int)/effSizeH(int)}
     * 结合 {@link #rotation} 推导 —— 这样以后调平衡改尺寸不用动数据，老存档自动跟着变。
     * 锚点始终是"旋转之后"那块占地的左上角。
     */
    @Column(name = "grid_x")
    private Integer gridX;

    @Column(name = "grid_z")
    private Integer gridZ;

    /**
     * 朝向，单位度，只取 0 / 90 / 180 / 270：
     * 0=门朝南(+z)、90=门朝东(+x)、180=门朝北(-z)、270=门朝西(-x)。
     * <p>
     * 它同时决定了**占地怎么摆** —— 90°/270° 会把宽高对调，于是 4×3 的纺织厂
     * 既能横着占 4×3，也能竖着占 3×4。和宽高一样，占地尺寸不落库：
     * 由 {@link BuildingType#effSizeW(int)/effSizeH(int)} 按朝向推导，
     * 这样以后调平衡改尺寸不用动数据，老存档自动跟着变。
     * <p>
     * 默认 0：老存档没有这一列时按"门朝南、不旋转"处理，行为与改造前一致。
     */
    @Column(nullable = false)
    private int rotation = 0;

    /** 是否因缺料而停工 */
    @Column(nullable = false)
    private boolean stalled;

    /**
     * 待运区：产出的货先堆在厂里，等马车运到港口才真正进玩家仓库。
     * <p>
     * 【为什么是 int 就够】每座生产建筑的配方只产出一种商品（见 BuildingType 的 outputs），
     * 所以不用建"商品 -> 数量"的映射，一个数量就描述完整。
     */
    @Column(nullable = false)
    private int pendingQty;

    /**
     * 是否因缺工人而停工（全岛劳动力被先建的厂分完了）。与 {@link #stalled}（缺料）
     * 是两个独立的停工原因，客户端用不同颜色 / 文案提示。
     */
    @Column(nullable = false)
    private boolean noWorkers;

    /**
     * 这艘商船**已经结算过的航次数**（只有贸易站用得上，其它建筑恒为 0）。
     * <p>
     * 【为什么只有它要落库】船的航行位置是纯时间函数 —— 由 {@link #getCreatedAt()}
     * 推出的相位，客户端自己插值画（见 {@code ShipService} 的说明），不需要每拍存盘。
     * 但"这一趟该不该结算"必须记住：否则服务端一重启，按时间算出来的旧航次
     * 会被重新结算一遍，等于白送金币。用"已结算到第几趟"当水位线，
     * 重启后只会补算真正漏掉的那几趟。
     */
    @Column(nullable = false)
    private int shipCycle;

    @Column(nullable = false)
    private long createdAt;

    protected BuildingEntity() {
    }

    public BuildingEntity(Long islandId, BuildingType type) {
        this(islandId, type, null, null, 0);
    }

    public BuildingEntity(Long islandId, BuildingType type, Integer gridX, Integer gridZ, int rotation) {
        this.islandId = islandId;
        this.type = type;
        this.gridX = gridX;
        this.gridZ = gridZ;
        this.rotation = BuildingType.normalizeRotation(rotation);
        this.createdAt = System.currentTimeMillis();
    }

    public Long getId() { return id; }
    public Long getIslandId() { return islandId; }
    public BuildingType getType() { return type; }
    public int getLevel() { return level; }
    public void setLevel(int level) { this.level = Math.max(1, level); }
    public double getElapsed() { return elapsed; }
    public void setElapsed(double elapsed) { this.elapsed = elapsed; }
    public boolean isStalled() { return stalled; }
    public void setStalled(boolean stalled) { this.stalled = stalled; }
    public int getPendingQty() { return pendingQty; }
    public void setPendingQty(int pendingQty) { this.pendingQty = Math.max(0, pendingQty); }
    public boolean isNoWorkers() { return noWorkers; }
    public void setNoWorkers(boolean noWorkers) { this.noWorkers = noWorkers; }
    public int getShipCycle() { return shipCycle; }
    public void setShipCycle(int shipCycle) { this.shipCycle = Math.max(0, shipCycle); }
    public long getCreatedAt() { return createdAt; }
    public Integer getGridX() { return gridX; }
    public Integer getGridZ() { return gridZ; }
    public int getRotation() { return rotation; }
    public void setRotation(int rotation) { this.rotation = BuildingType.normalizeRotation(rotation); }
    public void setGridX(Integer gridX) { this.gridX = gridX; }
    public void setGridZ(Integer gridZ) { this.gridZ = gridZ; }

    /* ---------------- 占地（由类型 + 朝向推导，不落库） ---------------- */

    /** **旋转后**的占地宽（格）：90°/270° 时与 {@link #getBaseW()} 互换 */
    public int getSizeW() { return type.effSizeW(rotation); }

    /** **旋转后**的占地高（格） */
    public int getSizeH() { return type.effSizeH(rotation); }

    /** 占地格数（旋转不改变格数） */
    public int getSizeCells() { return type.getSizeCells(); }

    /** 未旋转时的占地宽（画"原始体量"或做朝向无关的判断时用） */
    public int getBaseW() { return type.getSizeW(); }

    /** 未旋转时的占地高 */
    public int getBaseH() { return type.getSizeH(); }

    /** 这格是否被本建筑占着（没有坐标的老建筑一律返回 false） */
    public boolean covers(int x, int z) {
        return gridX != null && gridZ != null && type.covers(gridX, gridZ, rotation, x, z);
    }

    /** 拟建建筑占地（bw×bh 是对方旋转后的尺寸）与本建筑是否重叠 */
    public boolean overlaps(int ax, int az, int bw, int bh) {
        return gridX != null && gridZ != null && type.overlaps(gridX, gridZ, rotation, ax, az, bw, bh);
    }

    /** 本轮生产进度 0~1 */
    public double progress() {
        int d = type.getDurationSeconds();
        return d <= 0 ? 1.0 : Math.min(1.0, elapsed / d);
    }
}
