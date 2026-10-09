package com.anno.domain;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Deque;
import java.util.List;
import java.util.Random;

/**
 * 一座岛的地形图：**每格一个字符**，长度 = size × size，行优先（{@code index = z * size + x}）。
 *
 * <p>字符表（客户端 {@code game.html} 的 {@code CELL_TYPE} 必须与此完全一致）：
 * <table border="1">
 *   <caption>地形字符</caption>
 *   <tr><td>{@code '.'}</td><td>平原</td><td>唯一能修路 / 种地 / 盖普通建筑的地</td></tr>
 *   <tr><td>{@code '~'}</td><td>水</td><td>海湾或岛外，不能修路 / 盖房 / 种地</td></tr>
 *   <tr><td>{@code '^'}</td><td>山地</td><td>盖不了房、修不了路、也种不了地</td></tr>
 *   <tr><td>{@code 'i'}</td><td>铁矿脉</td><td>{@link BuildingType#IRON_MINE} 只能建在这上面</td></tr>
 *   <tr><td>{@code 'c'}</td><td>黏土矿脉</td><td>{@link BuildingType#CLAY_PIT} 只能建在这上面</td></tr>
 * </table>
 *
 * <p>【为什么是字符串】一格一字符，落库、下发、肉眼调试都是同一份东西 ——
 * 服务端和客户端不必各写一套生成算法（两边各写一份 PRNG 迟早会漂移，
 * 上一版的"海岸带宽度"就是这个教训：定义只能有一份）。
 *
 * <p>【岛形是算出来的，不是画出来的】{@link #generate} 用
 * 「分位数阈值 + 径向衰减 + fbm 值噪声」生成不规则轮廓：噪声让岸线弯弯曲曲、
 * 不会是个圆，径向衰减保证它是**一坨**而不是散落的碎岛。同一个 {@code seed}
 * 永远得到同一座岛，所以地形不必落库也能复现（落库只是快照）。
 *
 * <p>【生成的岛必须"能玩"】随机地图最容易出的三种废图，生成时都会当场自检并退让：
 * <ol>
 *   <li><b>稀碎</b>：噪声抖出一堆互不相连的碎岛 -> 只保留最大的一块陆地；</li>
 *   <li><b>山把它切成两半</b>：平原被山脊割断，路修不过去 -> 平原最大连通块要占绝大多数，
 *       否则缩小山体再试（最多退让 3 次，最后可以退到没有山）；</li>
 *   <li><b>矿被山包死</b>：矿脉落在山坳里的孤立平地上，路根本进不去 -> 矿脉只撒在
 *       **主平原连通块**上，且离岸至少 2 格、彼此隔开。</li>
 * </ol>
 * 没有一个"能建港口（要挨着岸）、能修路（要平原连通）、能开矿（矿要有路可达）"的岛，
 * 玩家一进来就是死局 —— 那比地图难看严重得多。
 */
public final class TerrainMap {

    /** 平原：可修路 / 可种地 / 可盖普通建筑 */
    public static final char PLAIN = '.';
    /** 水：海湾或岛外 */
    public static final char WATER = '~';
    /** 山地：不可建、不可修路、不可种 */
    public static final char MOUNTAIN = '^';
    /** 铁矿脉 */
    public static final char IRON = 'i';
    /** 黏土矿脉 */
    public static final char CLAY = 'c';

    /** 四邻方向（上下左右）：地形连通、海岸距离、矿脉蔓延共用 */
    private static final int[][] DIRS = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};

    /** 内陆标记：离水远到不必再算（BFS 到这个值就停，避免无意义的全图扫描） */
    private static final int INLAND = 99;

    /** 山体退让次数：一直退到"平原不被切断"为止，最后一次几乎等于没有山 */
    private static final int MOUNTAIN_ATTEMPTS = 4;

    /**
     * 生成参数（全部来自 {@code anno.terrain.*}，改配置就能换岛的样子）。
     *
     * @param landRatio     目标陆地占比（占整张网格）—— 用分位数阈值精确命中，不是"试出来"的
     * @param mountainRatio 山地占陆地的比例（偏心山脉：峰心位置由种子决定，不固定在岛心）
     * @param ironVeins     铁矿脉数量（每条 4~8 格，会撒在山脚下）
     * @param clayVeins     黏土矿脉数量
     */
    public record Shape(double landRatio, double mountainRatio, int ironVeins, int clayVeins) {
        public static final Shape DEFAULT = new Shape(0.62, 0.13, 3, 3);
    }

    /** 洪水填充的结果：每格所属连通块编号（0 = 不属于要找的那类）+ 最大块的编号 */
    private record Groups(int[] label, int largest) {
    }

    private final int size;
    private final char[] cells;
    /** 每格离水的步数：水=0，紧贴水/网格外的陆地=1，越大越内陆 */
    private final int[] coastDist;

    private TerrainMap(int size, char[] cells, int[] coastDist) {
        this.size = size;
        this.cells = cells;
        this.coastDist = coastDist;
    }

    /* ==================================================================
       构造：解析 / 平岛 / 随机生成
       ================================================================== */

    /** 解析一份已落库 / 已下发的地形串（所有字符都认识的才算合法） */
    public static TerrainMap parse(String encoded, int size) {
        if (encoded == null || encoded.length() != size * size) {
            throw new IllegalArgumentException("地形串长度应为 " + (size * size) + "，实际 "
                    + (encoded == null ? "null" : encoded.length()));
        }
        char[] cells = encoded.toCharArray();
        for (char c : cells) {
            if (c != PLAIN && c != WATER && c != MOUNTAIN && c != IRON && c != CLAY) {
                throw new IllegalArgumentException("地形串里有不认识的字符：" + c);
            }
        }
        return new TerrainMap(size, cells, coastDistances(size, cells));
    }

    /** 一整片平原的"平岛"：没有水、没有山、没有矿 —— 测试与调试用（老版方形岛的等价物） */
    public static TerrainMap flat(int size) {
        char[] cells = new char[size * size];
        Arrays.fill(cells, PLAIN);
        return new TerrainMap(size, cells, coastDistances(size, cells));
    }

    /** 平岛的地形串（落库用，省得反复生成） */
    public static String flatString(int size) {
        char[] cells = new char[size * size];
        Arrays.fill(cells, PLAIN);
        return new String(cells);
    }

    /**
     * 生成一座随机岛。同一个 {@code seed} 必然生成同一座岛（无随机源、无系统时间）。
     *
     * <p>步骤见类注释；简单说就是：高度场 -> 取阈值定海陆 -> 只留最大陆地 ->
     * （按需退让地）堆山 -> 撒矿脉。
     */
    public static TerrainMap generate(long seed, int size, Shape shape) {
        double[] height = heightField(seed, size);
        char[] base = seaAndLand(size, height, shape.landRatio());

        char[] chosen = base;
        int[] chosenDist = coastDistances(size, base);
        for (int attempt = 0; attempt < MOUNTAIN_ATTEMPTS; attempt++) {
            char[] cells = base.clone();
            // 每次退让把山体砍掉一半多：0.13 -> 0.058 -> 0.026 -> 0.012，
            // 到最后一档基本只剩几处石丘，一定不会再把平原切断
            applyMountains(size, cells, shape.mountainRatio() * Math.pow(0.45, attempt), seed);
            int[] dist = coastDistances(size, cells);
            chosen = cells;
            chosenDist = dist;
            if (isPlayable(size, cells, dist)) break;
        }

        scatterOre(size, chosen, chosenDist, seed, shape);
        return new TerrainMap(size, chosen, coastDistances(size, chosen));
    }

    /** 高度场：径向衰减 + 4 层 fbm 值噪声 */
    private static double[] heightField(long seed, int size) {
        double[] h = new double[size * size];
        for (int z = 0; z < size; z++) {
            for (int x = 0; x < size; x++) {
                // 归一化到 -1 ~ 1：中心是 (0,0)，边中点是 ±1，角上是 ±1.41
                double nx = (x + 0.5) / size * 2 - 1;
                double nz = (z + 0.5) / size * 2 - 1;
                // ×0.93：让岛在方形网格里摊得更开一点，别一上来就把四角全判成水
                double d = Math.sqrt(nx * nx + nz * nz) * 0.93;
                double v = (1 - d) + fbm(nx * 1.75, nz * 1.75, seed) * 0.58;
                /* 【边界退让】陆地一旦压到网格边上，客户端那条边就是"直线切口"——
                   裙边 / 浅水只铺在网格内的水格上，压边的岸没有浪、没有沙滩坡，
                   就是一条被尺子切出来的直壁（截图里"连海浪都没有的直线"就是它）。
                   在边界 4 圈内按距离扣高度：最靠边 -4.8，无论噪声怎么抖都是深水，
                   岛永远缩进网格里，海岸裙边能完整闭环。陆地占比由分位数阈值保证，
                   不受这圈扣减影响（岛只是整体往里收了 4 格）。 */
                int edge = Math.min(Math.min(x, z), Math.min(size - 1 - x, size - 1 - z));
                if (edge < 4) v -= (4 - edge) * 1.2;
                h[z * size + x] = v;
            }
        }
        return h;
    }

    /**
     * 定海陆：把高度排序取分位数当阈值 —— 陆地占比直接等于配置值，
     * 不用"先生成、再看差多少、回头调阈值"那种反复试跑。
     * 之后只保留最大的一块陆地，其余还原成水（碎岛会让玩家"看得见、走不到"）。
     */
    private static char[] seaAndLand(int size, double[] height, double landRatio) {
        int n = size * size;
        double[] sorted = height.clone();
        Arrays.sort(sorted);
        int landTarget = Math.max(1, (int) Math.round(n * clamp(landRatio, 0.20, 0.85)));
        double threshold = sorted[Math.max(0, n - landTarget - 1)];

        char[] cells = new char[n];
        Arrays.fill(cells, WATER);
        for (int i = 0; i < n; i++) {
            if (height[i] > threshold) cells[i] = PLAIN;
        }
        keepLargestGroup(size, cells, PLAIN);
        return cells;
    }

    /**
     * 挑山体：与定海陆的高度场<b>解耦</b>。
     *
     * <p>旧版直接拿高度场排序取最高的格子 —— 而高度场 = 径向衰减 (1-d) + 噪声，
     * 最高点必然在岛心，于是<b>每座岛的山都压在正中央</b>，像靶心。
     * 新版给山单独打分：
     * <ol>
     *   <li><b>偏心主峰</b>：峰心由种子确定性推出（可偏离岛心 ±0.5 归一化半径），
     *       每座岛的山长在哪都不一样，且不在玩家每次都撞上的正中央；</li>
     *   <li><b>一主一次</b>：主峰 + 一个较小的次峰，两团高斯包络叠低频 fbm 脊线，
     *       长出"主山脉 + 侧岭"的自然山势，而不是一坨圆包；</li>
     *   <li>分数只在<b>陆地格</b>里算：包络伸进海里也无所谓，山不会长进水里；</li>
     *   <li>依旧取分数最高的 target 格当山，{@link #isPlayable} 退让机制照旧兜底。</li>
     * </ol>
     */
    private static void applyMountains(int size, char[] cells, double mountainRatio, long seed) {
        List<Integer> land = new ArrayList<>();
        for (int i = 0; i < cells.length; i++) {
            if (cells[i] == PLAIN) land.add(i);
        }
        if (land.isEmpty()) return;
        int target = (int) Math.round(land.size() * clamp(mountainRatio, 0, 0.30));
        target = Math.min(target, (int) (land.size() * 0.30));
        if (target <= 0) return;

        // 峰心由种子派生：主峰 ±0.5、次峰 ±0.55（归一化 -1..1 坐标），同一座岛永远同一位置
        Random rnd = new Random(seed ^ 0x4D595DF5C1A7L);
        double m1x = (rnd.nextDouble() * 2 - 1) * 0.50, m1z = (rnd.nextDouble() * 2 - 1) * 0.50;
        double m2x = (rnd.nextDouble() * 2 - 1) * 0.55, m2z = (rnd.nextDouble() * 2 - 1) * 0.55;
        // 半径取随机的一档：大山 / 小山丘各有风情
        double s1 = 0.20 + rnd.nextDouble() * 0.08;      // 主峰 σ（归一化）
        double s2 = 0.12 + rnd.nextDouble() * 0.05;      // 次峰 σ

        double[] score = new double[cells.length];
        for (int i : land) {
            double nx = (i % size + 0.5) / size * 2 - 1;
            double nz = (i / size + 0.5) / size * 2 - 1;
            double g1 = Math.exp(-((nx - m1x) * (nx - m1x) + (nz - m1z) * (nz - m1z)) / (2 * s1 * s1));
            double g2 = Math.exp(-((nx - m2x) * (nx - m2x) + (nz - m2z) * (nz - m2z)) / (2 * s2 * s2));
            // 低频脊线：让山体边界犬牙交错、内部有垄有谷，不是一坨光滑的圆包
            double ridge = fbm(nx * 1.4, nz * 1.4, seed ^ 0x51ED270B);
            score[i] = g1 + g2 * 0.55 + ridge * 0.35;
        }
        land.sort((a, b) -> Double.compare(score[b], score[a]));   // 分高的在前
        for (int k = 0; k < target; k++) cells[land.get(k)] = MOUNTAIN;
    }

    /**
     * 这座岛"能玩"吗 —— 随机地图的三种废图在这里被挡住：
     * <ol>
     *   <li>平原被山割断：主平原连通块至少要占平原的六成，否则路网连不起来；</li>
     *   <li>没有像样的海岸：港口要建在沙滩上，沿岸可用的平地太少就干脆开不了局；</li>
     *   <li>平原本来就少：陆地占比配置过低时的兜底。</li>
     * </ol>
     */
    private static boolean isPlayable(int size, char[] cells, int[] dist) {
        int plain = count(cells, PLAIN);
        int n = cells.length;
        if (plain < n * 0.10) return false;

        Groups groups = labelGroups(size, cells, PLAIN);
        int largest = 0;
        for (int label : groups.label()) {
            if (label == groups.largest()) largest++;
        }
        if (largest < plain * 0.60) return false;

        int coastPlain = 0;
        for (int i = 0; i < n; i++) {
            if (cells[i] == PLAIN && dist[i] <= 1) coastPlain++;
        }
        return coastPlain >= 12;
    }

    /** 只保留最大的那块该类地形，其余改回水（用于"去掉碎岛"） */
    private static void keepLargestGroup(int size, char[] cells, char type) {
        Groups groups = labelGroups(size, cells, type);
        if (groups.largest() == 0) return;
        for (int i = 0; i < cells.length; i++) {
            if (cells[i] == type && groups.label()[i] != groups.largest()) cells[i] = WATER;
        }
    }

    /** 4 邻域洪水填充：返回每格的连通块编号（0 = 不属于 {@code target}）与最大块的编号 */
    private static Groups labelGroups(int size, char[] cells, char target) {
        int n = cells.length;
        int[] label = new int[n];
        Deque<Integer> queue = new ArrayDeque<>();
        int groups = 0, bestGroup = 0, bestCount = 0;

        for (int start = 0; start < n; start++) {
            if (cells[start] != target || label[start] != 0) continue;
            groups++;
            int count = 0;
            label[start] = groups;
            queue.add(start);
            while (!queue.isEmpty()) {
                int i = queue.poll();
                count++;
                int x = i % size, z = i / size;
                for (int[] d : DIRS) {
                    int nx = x + d[0], nz = z + d[1];
                    if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
                    int j = nz * size + nx;
                    if (cells[j] != target || label[j] != 0) continue;
                    label[j] = groups;
                    queue.add(j);
                }
            }
            if (count > bestCount) { bestCount = count; bestGroup = groups; }
        }
        return new Groups(label, bestGroup);
    }

    /**
     * 每格离水的步数（多源 BFS）。
     * <p>
     * <b>网格之外也算水</b>：贴着网格边的陆地因此得到距离 1。这一条让"整片平原的平岛"
     * 自动得到和老版"最外一圈是沙滩"完全一致的判定 —— 换地形之后老存档的海岸带不会漂移。
     */
    private static int[] coastDistances(int size, char[] cells) {
        int n = size * size;
        int[] dist = new int[n];
        Arrays.fill(dist, INLAND);
        Deque<Integer> queue = new ArrayDeque<>();

        for (int i = 0; i < n; i++) {
            if (cells[i] == WATER) { dist[i] = 0; queue.add(i); }
        }
        for (int z = 0; z < size; z++) {
            for (int x = 0; x < size; x++) {
                int i = z * size + x;
                if (cells[i] == WATER) continue;
                if (x == 0 || z == 0 || x == size - 1 || z == size - 1) {
                    dist[i] = 1;
                    queue.add(i);
                }
            }
        }
        while (!queue.isEmpty()) {
            int i = queue.poll();
            int x = i % size, z = i / size, d = dist[i];
            if (d >= INLAND) continue;
            for (int[] dir : DIRS) {
                int nx = x + dir[0], nz = z + dir[1];
                if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
                int j = nz * size + nx;
                if (cells[j] == WATER) continue;
                if (dist[j] > d + 1) {
                    dist[j] = d + 1;
                    queue.add(j);
                }
            }
        }
        return dist;
    }

    /* ==================================================================
       矿脉
       ================================================================== */

    private static void scatterOre(int size, char[] cells, int[] dist, long seed, Shape shape) {
        // 矿脉总共最多吃掉 10% 的平原：矿是稀缺资源，但也不能把可建地吃光
        int budget = (int) (count(cells, PLAIN) * 0.10);
        // 只撒在**主平原连通块**上：山坳里那些孤立的小块平地是进不去的，
        // 在那儿放矿等于放了一个永远开不了的矿点。
        Groups plain = labelGroups(size, cells, PLAIN);
        boolean[] used = new boolean[cells.length];
        Random rnd = new Random(seed * 6364136223846793005L + 1442695040888963407L);
        budget -= scatterVeins(size, cells, dist, plain, rnd, used, IRON, shape.ironVeins(), budget);
        scatterVeins(size, cells, dist, plain, rnd, used, CLAY, shape.clayVeins(), budget);
    }

    /**
     * 撒一种矿脉。
     * <p>
     * 【为什么以 2×2 为单位挑落点】矿场（黏土矿坑 / 铁矿）本身就占 2×2 格。
     * 如果只保证"矿脉格在平原上"，完全可能出现一格孤零零的矿、四周全是山 ——
     * 玩家看得见矿，却怎么都摆不下矿场，那就是个死点。
     * 所以先挑一个**四格都能建**的 2×2 方块占住，再向外蔓延成 3~9 格的矿脉：
     * 矿脉里因此至少含一整块 2×2，矿场永远放得下。
     * <p>
     * 顺带还解决了"路修不进去"：这块 2×2 的四格都在主平原连通块里，
     * 那它外圈八格里至少有一格是平原（否则这四格自己就是一个连通块，不可能属于主块），
     * 路一定能修到矿脚下。
     * <p>
     * 落点优先选<b>挨着山地</b>的方块：山脚下有矿，符合直觉，也逼玩家把路修进山里。
     *
     * @return 实际消耗的格数
     */
    private static int scatterVeins(int size, char[] cells, int[] dist, Groups plain, Random rnd,
                                    boolean[] used, char ore, int veins, int budget) {
        if (veins <= 0 || budget <= 0) return 0;

        List<Integer> sites = new ArrayList<>();         // 所有可用的 2×2 落点（存左上角格子的下标）
        List<Integer> foothills = new ArrayList<>();     // 其中贴着山地的那些
        for (int az = 0; az + 1 < size; az++) {
            for (int ax = 0; ax + 1 < size; ax++) {
                if (!blockBuildable(size, cells, dist, plain, used, ax, az, 2, 2)) continue;
                sites.add(az * size + ax);
                if (touchesMountain(size, cells, ax, az, 2, 2)) foothills.add(az * size + ax);
            }
        }
        List<Integer> pool = foothills.isEmpty() ? sites : foothills;
        if (pool.isEmpty()) return 0;
        shuffle(pool, rnd);

        int spent = 0, placed = 0;
        int mainBefore = largestPlainCount(size, cells);
        for (int anchor : pool) {
            if (placed >= veins || spent >= budget) break;
            int ax = anchor % size, az = anchor / size;
            if (tooCloseToOre(size, cells, anchor)) continue;
            if (!blockBuildable(size, cells, dist, plain, used, ax, az, 2, 2)) continue;

            // 先占住这 2×2，再四邻蔓延
            List<Integer> blob = new ArrayList<>();
            for (int x = ax; x < ax + 2; x++) {
                for (int z = az; z < az + 2; z++) {
                    int i = z * size + x;
                    used[i] = true;
                    blob.add(i);
                }
            }
            int want = 4 + rnd.nextInt(5);      // 4 ~ 8 格
            for (int k = 0; k < blob.size() && blob.size() < want; k++) {
                int i = blob.get(k);
                int x = i % size, z = i / size;
                int[] order = {0, 1, 2, 3};
                shuffleInts(order, rnd);
                for (int d : order) {
                    if (blob.size() >= want) break;
                    int nx = x + DIRS[d][0], nz = z + DIRS[d][1];
                    if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
                    int j = nz * size + nx;
                    if (cells[j] != PLAIN || used[j] || dist[j] < 2) continue;
                    if (plain.label()[j] != plain.largest()) continue;
                    if (tooCloseToOre(size, cells, j)) continue;
                    used[j] = true;
                    blob.add(j);
                }
            }

            // 试落：先把矿脉放下去，看平原主连通块是不是只少了矿脉本身那么多格。
            // 少了更多 = 这块矿脉把小片平地封死了（或者堵住了某条两格宽的走廊），
            // 那片地从此无人能到 —— 撤销，换下一个落点。
            for (int i : blob) cells[i] = ore;
            int mainAfter = largestPlainCount(size, cells);
            if (mainAfter < mainBefore - blob.size()) {
                for (int i : blob) {
                    cells[i] = PLAIN;
                    used[i] = false;
                }
                continue;
            }
            mainBefore = mainAfter;
            spent += blob.size();
            placed++;
        }
        return spent;
    }

    /** 平原最大连通块的格数（矿脉试落前后各算一次，用来判断有没有把小片平地封死） */
    private static int largestPlainCount(int size, char[] cells) {
        Groups groups = labelGroups(size, cells, PLAIN);
        if (groups.largest() == 0) return 0;
        int n = 0;
        for (int label : groups.label()) {
            if (label == groups.largest()) n++;
        }
        return n;
    }

    /** 这块 w×h 能不能当矿脉底：四格都是**主平原上的内陆平地**、没被别的矿占住 */
    private static boolean blockBuildable(int size, char[] cells, int[] dist, Groups plain,
                                          boolean[] used, int ax, int az, int w, int h) {
        for (int x = ax; x < ax + w; x++) {
            for (int z = az; z < az + h; z++) {
                int i = z * size + x;
                if (cells[i] != PLAIN || used[i]) return false;
                if (dist[i] < 2) return false;                       // 离岸 2 格内不放矿：沙滩留给港口
                if (plain.label()[i] != plain.largest()) return false; // 山坳里的孤立平地：路进不去
            }
        }
        return true;
    }

    /** 这块地的外圈有没有山地（用来优先把矿撒在山脚下） */
    private static boolean touchesMountain(int size, char[] cells, int ax, int az, int w, int h) {
        for (int x = ax - 1; x <= ax + w; x++) {
            for (int z = az - 1; z <= az + h; z++) {
                if (x < 0 || z < 0 || x >= size || z >= size) continue;
                if (cells[z * size + x] == MOUNTAIN) return true;
            }
        }
        return false;
    }

    /** 这一格周围 2 格内已经有别的矿脉了吗 —— 保证每条矿脉是一座独立矿点，不连成一片 */
    private static boolean tooCloseToOre(int size, char[] cells, int index) {
        int x = index % size, z = index / size;
        for (int dx = -2; dx <= 2; dx++) {
            for (int dz = -2; dz <= 2; dz++) {
                int nx = x + dx, nz = z + dz;
                if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
                char c = cells[nz * size + nx];
                if (c == IRON || c == CLAY) return true;
            }
        }
        return false;
    }

    private static void shuffle(List<Integer> list, Random rnd) {
        for (int i = list.size() - 1; i > 0; i--) {
            int j = rnd.nextInt(i + 1);
            Integer t = list.get(i);
            list.set(i, list.get(j));
            list.set(j, t);
        }
    }

    private static void shuffleInts(int[] a, Random rnd) {
        for (int i = a.length - 1; i > 0; i--) {
            int j = rnd.nextInt(i + 1);
            int t = a[i];
            a[i] = a[j];
            a[j] = t;
        }
    }

    /* ==================================================================
       噪声：确定性哈希值噪声 + fbm。不用随机数生成器，纯粹是坐标与种子的函数
       ================================================================== */

    private static double fbm(double x, double y, long seed) {
        double sum = 0, amp = 1, norm = 0, freq = 1;
        for (int octave = 0; octave < 4; octave++) {
            sum += amp * valueNoise(x * freq, y * freq, seed + octave * 7919L);
            norm += amp;
            amp *= 0.5;
            freq *= 2.05;
        }
        return sum / norm;      // ≈ -1 ~ 1
    }

    private static double valueNoise(double x, double y, long seed) {
        int xi = (int) Math.floor(x), yi = (int) Math.floor(y);
        double xf = x - xi, yf = y - yi;
        double u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);   // smoothstep
        double a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed);
        double c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
        return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    }

    /** 坐标 + 种子 -> [-1,1] 的稳定哈希（splitmix 收尾，避免相邻格子出现肉眼可见的条纹） */
    private static double hash(int x, int y, long seed) {
        long k = x * 0x9E3779B97F4A7C15L ^ y * 0xC2B2AE3D27D4EB4FL ^ seed * 0x165667B19E3779F9L;
        k ^= k >>> 33;
        k *= 0xFF51AFD7ED558CCDL;
        k ^= k >>> 33;
        k *= 0xC4CEB9FE1A85EC53L;
        k ^= k >>> 33;
        return ((k >>> 11) / (double) (1L << 53)) * 2 - 1;
    }

    private static double clamp(double v, double lo, double hi) {
        return v < lo ? lo : Math.min(v, hi);
    }

    /* ==================================================================
       查询
       ================================================================== */

    public int size() { return size; }

    /** 地形串（落库 / 下发用的原始形态） */
    public String encode() { return new String(cells); }

    public boolean inGrid(int x, int z) {
        return x >= 0 && z >= 0 && x < size && z < size;
    }

    /** 这一格的地形字符；出网格当作水（岛外都是海） */
    public char at(int x, int z) {
        return inGrid(x, z) ? cells[z * size + x] : WATER;
    }

    public boolean isWater(int x, int z) { return at(x, z) == WATER; }
    public boolean isMountain(int x, int z) { return at(x, z) == MOUNTAIN; }

    /** 陆地 = 平原 + 山地 + 矿脉（山与矿也算岛的一部分，只是不能随便盖） */
    public boolean isLand(int x, int z) {
        return at(x, z) != WATER;
    }

    /** 能修路 / 能种地的地：只有平原 */
    public boolean isPlain(int x, int z) { return at(x, z) == PLAIN; }

    /** 这一格是不是某种矿脉 */
    public char oreAt(int x, int z) {
        char c = at(x, z);
        return (c == IRON || c == CLAY) ? c : PLAIN;
    }

    /** 商品 -> 它对应的矿脉字符（不是矿就返回 {@link #PLAIN}）。矿脉与商品的对应关系只此一处 */
    public static char oreCharFor(Good good) {
        if (good == Good.CLAY) return CLAY;
        if (good == Good.IRON) return IRON;
        return PLAIN;
    }

    /** 地形字符 -> 中文名（提示语 / 图鉴用） */
    public static String oreLabel(char type) {
        return switch (type) {
            case IRON -> "铁矿脉";
            case CLAY -> "黏土矿脉";
            case MOUNTAIN -> "山地";
            case WATER -> "水面";
            default -> "平原";
        };
    }

    /** 离水的步数（水=0，紧贴水/网格外的陆地=1） */
    public int coastDistance(int x, int z) {
        return inGrid(x, z) ? coastDist[z * size + x] : 0;
    }

    /**
     * 这一格在不在海岸带（离水不超过 {@code coastWidth} 步的陆地）。
     * <p>
     * 老版是"网格最外 N 圈"，现在换成"离水 N 步以内" —— 岛形不规则之后前者已经没有意义，
     * 而后者对整片平原的平岛会退化成完全一样的结论（网格外算水），老存档的沙滩不会漂移。
     */
    public boolean isCoast(int x, int z, int coastWidth) {
        if (coastWidth <= 0 || !inGrid(x, z)) return false;
        return isLand(x, z) && coastDist[z * size + x] <= coastWidth;
    }

    /** 某类地形的格数（图鉴 / 日志 / 测试用） */
    public int count(char type) { return count(cells, type); }

    private static int count(char[] cells, char type) {
        int n = 0;
        for (char c : cells) if (c == type) n++;
        return n;
    }

    /** 一行摘要，写日志时一眼看出这座岛长什么样 */
    public String describe() {
        return String.format("陆地 %d（平原 %d / 山地 %d）、水 %d、铁矿脉 %d、黏土矿脉 %d",
                count(PLAIN) + count(MOUNTAIN) + count(IRON) + count(CLAY),
                count(PLAIN), count(MOUNTAIN), count(WATER), count(IRON), count(CLAY));
    }
}
