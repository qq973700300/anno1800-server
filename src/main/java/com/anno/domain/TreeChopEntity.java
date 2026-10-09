package com.anno.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

/**
 * 树木砍伐记录：哪座岛的哪一格树被砍掉了。
 * <p>
 * 【为什么只记砍掉的、不记全部树】树的位置是<b>确定性推导</b>的：客户端
 * {@code buildTrees()} 和服务端 {@code TreeService} 用同一套「岛 id 种子 + 逐格哈希」
 * 算出同一片初始森林，不需要落库。真正会变的只有"哪些格子被砍了" ——
 * 一条砍伐记录一个格子，存档轻、老档零迁移。
 * <p>
 * 【树会复育】纪元式补种林业：砍掉一格后，树苗会在 {@link #regrowAt} 时刻长回成树
 * （一行 = "这格在复育时刻之前没有树"，时刻一过这格重新算有树，行不删除 ——
 * 存档轻、同一格历史只有一条）。伐木场不用搬家，轮伐即可永续。
 */
@Entity
@Table(name = "tree_chop",
        uniqueConstraints = @UniqueConstraint(name = "uk_tree_chop_island_cell", columnNames = {"island_id", "cell_x", "cell_z"}))
public class TreeChopEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "island_id", nullable = false)
    private Long islandId;

    @Column(name = "cell_x", nullable = false)
    private int cellX;

    @Column(name = "cell_z", nullable = false)
    private int cellZ;

    @Column(nullable = false)
    private long choppedAt;

    /** 树苗长回成树的时刻（ms 纪元）。老档迁移补 0 = 早已复育 */
    @Column(nullable = false)
    private long regrowAt;

    protected TreeChopEntity() {
    }

    public TreeChopEntity(Long islandId, int cellX, int cellZ, long regrowAt) {
        this.islandId = islandId;
        this.cellX = cellX;
        this.cellZ = cellZ;
        this.choppedAt = System.currentTimeMillis();
        this.regrowAt = regrowAt;
    }

    public Long getId() { return id; }
    public Long getIslandId() { return islandId; }
    public int getCellX() { return cellX; }
    public int getCellZ() { return cellZ; }
    public long getChoppedAt() { return choppedAt; }
    public long getRegrowAt() { return regrowAt; }
}
