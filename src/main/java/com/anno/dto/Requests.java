package com.anno.dto;

import java.util.List;

/** 客户端请求体合集 */
public final class Requests {

    private Requests() {
    }

    public record RegisterRequest(String name) {
    }

    /**
     * 开岛。
     *
     * @param flat 铺一座**一整片平原的平岛**（没有水、没有山、没有矿脉），给自动化测试与调试用。
     *             随机岛形没法让脚本写死坐标，而回归测试要的恰恰是"同样的输入、同样的结果"。
     *             省略 / false 就是正常的随机岛（由岛屿 id 决定种子）。
     */
    public record IslandRequest(Long playerId, String name, Boolean flat) {
        public boolean isFlat() { return Boolean.TRUE.equals(flat); }
    }

    /** 播种：x / z 是网格坐标，玩家自己在空地上选一格种 */
    public record PlantRequest(Long playerId, Long islandId, Integer x, Integer z, String crop, Long buildingId) {
    }

    public record PlotActionRequest(Long playerId, Long plotId) {
    }

    /**
     * 建造：x / z 是旋转后占地矩形的**左上角**，必须紧邻马路。
     * <p>
     * rotation 可选（0/90/180/270，超出范围会归一到最近的 90°）：
     * <b>不传就按"外圈马路在哪边"自动吸附大门朝向</b>，这也是客户端的默认行为；
     * 玩家手动转了方向才需要显式传。
     */
    public record BuildRequest(Long playerId, Long islandId, String type, Integer x, Integer z,
                               Integer rotation) {
    }

    /** 旋转建筑：绕占地中心原地转 90°（只转朝向，不搬家） */
    public record RotateRequest(Long playerId) {
    }

    /** 修路 / 拆路：x / z 是网格坐标；kind 是路面种类（RoadKind 名，缺省土路） */
    public record RoadRequest(Long playerId, Long islandId, Integer x, Integer z, String kind) {
    }

    /** 批量格子：批量修路 / 批量播种共用（上限 400，与客户端划矩形的上限一致） */
    public record CellRef(Integer x, Integer z) {
    }

    /** 一条龙修路：cells 是这条线上的全部格子，服务端逐格修、撞第一个障碍就停；整条一种路面 */
    public record RoadBatchRequest(Long playerId, Long islandId, List<CellRef> cells, String kind) {
    }

    /** 路面改造：把已有路格换成另一种路面，收差价 */
    public record RoadRestyleRequest(Long playerId, Long islandId, String kind, List<CellRef> cells) {
    }

    /** 一片播种：同一格 crop，cells 是矩形里能种的全部格子 */
    public record PlantBatchRequest(Long playerId, Long islandId, List<CellRef> cells, String crop, Long buildingId) {
    }

    public record UpgradeRequest(Long playerId, Long buildingId) {
    }

    public record MarketRequest(Long playerId, String good, int quantity) {
    }

    public record OfferRequest(Long playerId, String side, String good, int quantity, double unitPrice) {
    }

    public record AcceptRequest(Long takerId) {
    }

    /**
     * 组建远征队：destination 是目的地 key（GREEN_ISLES 普通航线 / SKULL_ISLAND 骷髅岛），
     * name 可省略（默认"目的地+远征队"）。shipId 是出发用的船（player_ship.id），
     * 省略时服务端自动挑本岛最早下水的闲置船 —— 没有闲置船会被拒。
     */
    public record ExpeditionRequest(Long playerId, Long islandId, String destination, String name, Long shipId) {
    }

    /** 远征事件选择：optionIndex 对应事件卡上的按钮序号（0 号永远是保守项） */
    public record ExpeditionChoiceRequest(Long playerId, Integer optionIndex) {
    }

    /** 造船厂开工：shipType 是船型 key（SLOOP / TRADE_SHIP / GALLEON），开工即扣钱扣料 */
    public record ShipBuildRequest(Long playerId, Long islandId, String shipType) {
    }
}
