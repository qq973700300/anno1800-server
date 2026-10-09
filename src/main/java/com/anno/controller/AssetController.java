package com.anno.controller;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import com.anno.dto.ApiResponse;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 静态资源清单：告诉客户端"哪些 3D 模型已经就位"。
 * <p>
 * 为什么要这个接口：客户端本来可以自己拿 HEAD 逐个探测 models/*.glb，
 * 但每缺一个模型浏览器就会往控制台丢一条 404，12 种建筑就是 12 条噪音。
 * 服务端直接扫一遍 classpath 目录，一次请求给出清单，客户端就安静了。
 * <p>
 * 注意用的是 {@code classpath*:} 通配：打成 jar 后静态资源在 BOOT-INF/classes 里，
 * 普通 classpath: 拿不到目录列表，classpath*: 才能跨 jar 条目扫描。
 */
@RestController
@RequestMapping("/api/assets")
public class AssetController {

    private static final String MODEL_DIR = "classpath*:/static/models/*.glb";

    /** 已就位的模型清单（返回建筑类型名，如 LUMBERJACK），客户端据此决定用模型还是程序化厂房 */
    @GetMapping("/models")
    public ApiResponse<List<String>> models() throws IOException {
        List<String> out = new ArrayList<>();
        for (Resource r : new PathMatchingResourcePatternResolver().getResources(MODEL_DIR)) {
            String name = r.getFilename();
            if (name != null && name.toLowerCase().endsWith(".glb")) {
                out.add(name.substring(0, name.length() - 4).toUpperCase());
            }
        }
        return ApiResponse.ok(out.stream().sorted().distinct().toList());
    }
}
