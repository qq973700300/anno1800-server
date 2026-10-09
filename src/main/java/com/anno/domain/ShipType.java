package com.anno.domain;

import java.util.List;
import java.util.Map;

/**
 * 玩家可造的船型（纪元1800 式造船厂产物）。
 * <p>
 * 造船厂开工时一次性扣金币 + 仓库物资（木板是主料 —— 接锯木厂产业链，
 * 大船还要铁件与帆布），随岛屿心跳推进工期，完工后入玩家舰队。
 * <p>
 * 【 expeditionBonus】远征奖励加成：大船扛浪能力强、货舱深，
 * 同一趟远征带回来的收获按 (1 + bonus) 放大。
 */
public enum ShipType {

    /*                 名称        造价   工期(游戏秒) 远征加成  物料                       */
    SLOOP      ("小帆船",    800,  240, 0.00, Map.of(Good.TIMBER, 6)),
    TRADE_SHIP ("商运帆船", 1800,  480, 0.20, Map.of(Good.TIMBER, 12, Good.CLOTHES, 4)),
    GALLEON    ("大型商船", 4000,  720, 0.40, Map.of(Good.TIMBER, 20, Good.IRON, 8));

    public final String label;
    public final double coinCost;
    public final double buildSeconds;
    public final double expeditionBonus;
    public final Map<Good, Integer> goodsCost;

    ShipType(String label, int coinCost, int buildSeconds, double expeditionBonus,
             Map<Good, Integer> goodsCost) {
        this.label = label;
        this.coinCost = coinCost;
        this.buildSeconds = buildSeconds;
        this.expeditionBonus = expeditionBonus;
        this.goodsCost = goodsCost;
    }

    /** key 容错解析：客户端传来的字符串必须是合法船型名 */
    public static ShipType parse(String key) {
        if (key == null) throw GameErr();
        try {
            return valueOf(key);
        } catch (IllegalArgumentException e) {
            throw GameErr();
        }
    }

    private static com.anno.exception.GameException GameErr() {
        return com.anno.exception.GameException.of("未知的船型 —— 可选：SLOOP / TRADE_SHIP / GALLEON");
    }
}
