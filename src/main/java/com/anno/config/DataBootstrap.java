package com.anno.config;

import com.anno.repo.PlayerRepository;
import com.anno.service.InventoryService;
import com.anno.service.MarketService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 启动初始化：建立市场行情 + 补齐老玩家的库存行 */
@Configuration
public class DataBootstrap {

    private static final Logger log = LoggerFactory.getLogger(DataBootstrap.class);

    @Bean
    public ApplicationRunner marketBootstrap(MarketService marketService,
                                             PlayerRepository playerRepository,
                                             InventoryService inventoryService) {
        return args -> {
            marketService.init();
            // 老玩家（注册时还没做预建的那些）补齐空库存行，避免首次入库触发 INSERT 死锁
            int filled = 0;
            for (var p : playerRepository.findAll()) {
                inventoryService.initRowsForPlayer(p.getId());
                // 存量补偿：建房要木头后，老档 0 木头会卡死自举链 —— 不足基准线的一次补齐（幂等）
                inventoryService.topUpStarter(p.getId());
                filled++;
            }
            log.info("纪元1800 世界已就绪：{} 种商品行情已生成，{} 位玩家库存行已就绪",
                    com.anno.domain.Good.values().length, filled);
        };
    }
}
