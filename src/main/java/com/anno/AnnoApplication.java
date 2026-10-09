package com.anno;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 纪元1800 风格手游后端启动类。
 * 开启 EnableScheduling 用于世界心跳：作物生长 / 建筑生产 / 价格波动。
 */
@SpringBootApplication
@EnableScheduling
public class AnnoApplication {

    public static void main(String[] args) {
        SpringApplication.run(AnnoApplication.class, args);
    }
}
