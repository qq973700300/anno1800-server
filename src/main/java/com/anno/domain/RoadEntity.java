package com.anno.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

/**
 * 马路：岛屿网格上的一格路。
 * <p>
 * 建筑必须建在马路旁（四邻至少一格是路），所以马路是产业链的"骨架"——
 * 先规划路网，再沿路铺工厂，这是纪元系列布局玩法的核心。
 */
@Entity
@Table(name = "road",
        uniqueConstraints = @UniqueConstraint(name = "uk_road_island_cell", columnNames = {"island_id", "cell_x", "cell_z"}))
public class RoadEntity {

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
    private long createdAt;

    /** 路面种类（{@link RoadKind} 名）；老存档 null 在读取时回落土路 */
    @Column(name = "kind", length = 31)
    private String kind;

    protected RoadEntity() {
    }

    public RoadEntity(Long islandId, int cellX, int cellZ) {
        this(islandId, cellX, cellZ, RoadKind.DIRT);
    }

    public RoadEntity(Long islandId, int cellX, int cellZ, RoadKind kind) {
        this.islandId = islandId;
        this.cellX = cellX;
        this.cellZ = cellZ;
        this.kind = (kind == null ? RoadKind.DIRT : kind).name();
        this.createdAt = System.currentTimeMillis();
    }

    public Long getId() { return id; }
    public Long getIslandId() { return islandId; }
    public int getCellX() { return cellX; }
    public int getCellZ() { return cellZ; }
    public long getCreatedAt() { return createdAt; }
    /** null 安全的路面种类：老存档没这一列值时回落土路 */
    public RoadKind getKind() { return RoadKind.of(kind); }
    public void setKind(RoadKind kind) { this.kind = (kind == null ? RoadKind.DIRT : kind).name(); }
}
