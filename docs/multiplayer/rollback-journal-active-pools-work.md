# TH09MP 回滚日志优化：活跃自机子弹池

## 目标与当前范围

目标是双端桌面 Chromium 都使用 CDP 4× CPU 限速时，保留 D0/H8 预测回滚和低输入延迟，减少正常游玩的长帧及恢复成本。触控负载由桌面上的连续移动序列产生，不操作或测试手机。

正常暂停导致另一端缺少新输入并停止推进，是预期的信息边界。本轮不会绕开这个边界。网络突增导致的平滑降速可以接受；稳定连接本来就需要的预测深度，不应被当成突增反复制动。

本文件随当前验证更新。公开 GitHub 内容仍须用户先审阅；此处仅保留本地修改和证据。

本轮结论：PlayerShots日志优化已形成独立、可复核的生产补丁。两轮固定工作量CPU4诊断对照支持可重复局部收益：Save+Restore合并减少12.85%，包含初始前向和重演的四阶段合计减少6.44%。真实双端发布版四轮对照全部通过正确性与测量资格，但整体流畅性仍未达标，不能承诺稳定60Hz或消除大停顿。

## 工作目录与固定基线

- 当前修改：`D:/workspace/eagler/worktrees/th09-journal-active-pools-4x`
- 分支：`experiment/journal-active-pools-4x`
- 基础提交：`63127575d43ea5ef35b317ff8137b00a1ab5b1cc`
- 此前触控/浏览器调查：`D:/workspace/eagler/worktrees/th09-managed-touch-4x`
- 固定 A 诊断构建：`D:/workspace/eagler/worktrees/th09-mobile-rollback-4x/th09_web/artifacts/mobile-rollback-live-matched`
- A 诊断 WASM SHA-256：`f0fe104e03cf4c10617c16c8c08897784a83b02d5e8eeeabf8c2ee1e7e9e58cb`
- 固定 A 发布构建：同一旧工作树下 `th09_web/artifacts/mobile-rollback-release-matched`
- A 发布 WASM SHA-256：`037c9cd52e70e2c8e8ee516cf15b6aee7f0de5951f88d519b2311cc1c5def373`
- B 诊断构建：当前树 `th09_web/artifacts/journal-active-pools-live-c1`
- B 诊断 WASM SHA-256：`04f4c7086a427440911b6288a359212e5d936860500a462baf6c2308628c16e0`
- B 发布构建：当前树 `th09_web/artifacts/journal-active-pools-release-c1`
- B 发布 WASM SHA-256：`ad3476706c8dc1a196bf1d2d65f7e0840ad07ba9632548ec1ba3678db6df3409`

旧路径中的 mobile 仅是已有目录名称。当前全部验证在桌面进行。

## 纠正此前报告的遗漏

此前阶段总结过度聚焦最近的触控输入和 rAF 调查，遗漏了已经做过、且当前源码中仍存在的核心回滚优化。不能把近期阶段缺乏新的稳定 FPS 结论，表述成整个项目从未优化日志。

此前主工作树的下列材料记录了实际改动和阶段性结果：

| 阶段 | 真实工作 | 当时测得的结果 | 适用边界 |
| --- | --- | --- | --- |
| 初期稀疏日志 | 活跃 Enemy/Bullet 视觉状态，冷槽首次写入 | Capture+Restore −73.48%；Capture+Forward+Restore −58.92% | 同 WASM、同输入 dense/sparse/dense；不是双端 4× FPS |
| owning 容量与连续 Bullet 区间 | 保留拥有对象容量，缩减 per-slot Touch 登记 | 八步 correction 总量 373.785→342.880 ms，−8.27% | 阶段硬件 A/B/B/A；不是最大卡顿保证 |
| Effect/Attack 首写 | 活跃/预留/哨兵边界与 first-write | 合并成本 371.910→330.573 ms，−11.11% | 独立阶段基线 |
| Bullet POD 稀疏区间 | live runs、冷生成/reset/hazard 保护 | 合并成本 362.570→317.675 ms，−12.38% | 固定工作负载；尾部未同步改善 |
| per-VM 与调度组合 | 五个 VM 分别首写、时间余量/重试处理 | 一次对应对照 P2 rAF p99 33.33→16.67 ms | 只有 P2 2×，且是组合改动 |
| J4× 组合 | 不可变模板省存、背景连续区间、渲染批次 | 对应 P2 p99 从约394/594降到约79/79 ms | 只有 P2 4×，仍约31 Hz；不是双端60帧验收 |
| VM 固定页 | 完整 VM 676 B，64个一页，惰性保留 | 正确性与结构落地；稳定耗时收益未证明 | 一次受控结果反而增加8.15%，不能称为已证实加速 |
| Enemy 固定槽索引 | 两个 owner 范围和位图，未知范围保留 fallback | 代码落地 | 整体 FPS 和最长卡顿收益未证明 |

原始依据位于此前主工作树的 `docs/multiplayer/rollback-evidence.md`、`rollback-pc-evidence.md`、`rollback-owning-evidence.md`、`rollback-smoothness-work.md`、`rollback-4x-performance.md`、`rollback-responsive-work.md`、`rollback-chain-work.md` 及 `AGENT-HANDOFF.md`。这些阶段使用不同基线，百分比不能相加，也不能用历史结果冒充本轮双端4×验收。

## 本轮生产修改

此前每次快照无条件保存两侧各128个 PlayerShot。实际编译得到：

- `sizeof(PlayerShot) = 1,144` 字节。
- 两池固定负担：`2 × 128 × 1,144 = 292,864` 字节，即286 KiB。
- 新版保存初始活跃槽的连续区间；初始冷槽在本 checkpoint 中首次实际写入之前保存完整原值。
- 完整槽包含 VM、光束 trail、资源指针和 padding；不是仅保留可见字段。

生产变更为六个文件：

- `th09_web/cpp/game/PoolCheckpoint.hpp`：增加 PlayerShot 首写入口。
- `th09_web/cpp/game/PlayerShots.hpp`：observer、before_write 和 deactivate_all。
- `th09_web/cpp/game/PlayerShots.cpp`：在真实创建的最早写入处保护冷槽；覆盖 Marisa initialize 前字段；无写入失败/effect-only 分支保持零槽保存。
- `th09_web/cpp/game/Player.cpp`：回合重置通过受保护的 deactivate_all。
- `th09_web/cpp/multiplayer/WorldState.hpp`：两侧 SparsePoolCapture 与 owner 范围。
- `th09_web/cpp/multiplayer/WorldState.cpp`：稀疏 live-run 保存、首写与解绑；dense/hash 继续完整记录全部槽。

update、hit、draw 的活跃循环没有增加逐对象 observer 检查。普通无 checkpoint 路径在真正出生时多一次空指针判断；这不是绝对零开销，需同时报告普通块与有快照块的计时。

beam 指针、beam_time、areas 等控制字段仍按原顺序单独保存。候选没有改变输入 D、H8、子弹数量、固定逻辑步长或预测规则。

独立只读审查未找到新增生产阻断缺陷。所确认的是写入与生命周期合同，不能替代实测性能。

## 已完成的构建与组件验证

诊断构建通过，包装器记录源文件在构建期间保持不变。

组件命令：

`node th09_web/tests/multiplayer/journal-run.mjs th09_web/tests/multiplayer/run-tests.mjs shot-capture enemy-capture bullet-snapshot`

保留标签：`journal-active-pools-components-c1`。

| 组件 | 结果 | 实际证明 |
| --- | --- | --- |
| PlayerShot | 99项通过 | 七种占用程度、冷创建、完整槽字节、Marisa提前字段、Lyrica无写入路径、两种draw、回合重置、同槽复用、1/2/8跨tick及1/2/8层历史 |
| Enemy 首写 | 118项通过 | 新 observer 接口没有破坏现有 Enemy 用例 |
| Bullet 稀疏保存 | 600项通过 | 完整池恢复/重演/reset/reuse/overflow原有用例保持通过 |

PlayerShot 用例在 Restore 后立即比较完整字节，再运行重演并比较最终字节，防止漏存被重演碰巧覆盖。48个合成 span 用例的有效 shot payload 合计从14,057,472 B降到963,248 B（约减少93.15%）。这是特定合成工作量的复制计数，不能换算成FPS提升。

该组件直接调用生产 WorldState/PlayerShots 方法，但绕过完整 GameSession 构造，且使用受控资源/VM动作；不能把99项称为99场真实完整游戏。真实资源和生产驱动由后续浏览器验证补齐。

诊断构建的275个源条目相同；六处生产文件变化之外，PerformanceDiagnostics.hpp有一处CRLF/LF字节差异。只读内容比较已确认规范化换行后完全一致，原始身份仍分别保留。

## 完整世界诊断对照

`journal-paired-browser.mjs` 在同一 Chromium 的两个隔离页面串行交替AB/BA。每个块使用相同输入、8个逻辑tick和一个checkpoint。它不是真正8层逐帧回滚，也不是rAF/FPS测试。

所有有效块均检查：

1. Restore后、重演前完整dense状态hash与快照前相等。
2. 重演后完整状态与最初forward结果相等。
3. 两构建的portable网络hash、48个审计字段和完整PNG相同。
4. 运行前后构建、loader、harness身份保持不变。

计时同时报告 Capture、原始Forward（包括延迟首写）、Restore、Resim8，以及四者合计 totalMeasured。不能只报道Capture下降，把首写转移成本漏掉。

诊断/profile构建保留开发断言；这些数字不能替代发布构建。hash、审计、PNG读回和页面切换在计时外，但可能影响下一块环境；AB/BA顺序与所有原始样本都保留。

### 尝试记录和批量调整

- `journal-active-pools-paired4-c1`：原200块方案达到包装器540秒限制，退出失败，源身份未变。没有完整报告，不能用于性能承诺。
- `journal-active-pools-paired4-c2`：增加阶段输出与单次操作期限。进度证明已持续通过测量块60（40个普通块与至少21个checkpoint块）；20个checkpoint pair的墙钟约75.2秒，照原批量会再次超限。因此通过nig终止本人持有的命令，保留日志。不是因观察到不利性能而删样本。
- `journal-active-pools-paired4-c3`：将现有受支持的批量设为80，其余输入、CPU4、hardware路径、逐块oracle与顺序保持相同。398.156秒完成，完整正确性通过、sourceStable=true、host-load记录有效；最终帧1140。

缩减批量的原因是固定时间预算；不减少每一保留块的校验。真实8层压力将单独跑生产peer驱动。

### 第一轮完整计时（c3）

下表为全部80个checkpoint块的计时总和，单位ms。不能读成单次恢复延迟。

| 阶段 | 固定A | 候选B | 变化 |
| --- | ---: | ---: | ---: |
| Capture | 495.285 | 441.755 | −10.81% |
| Forward8，含首写 | 2755.215 | 2643.870 | −4.04% |
| Restore | 276.075 | 249.130 | −9.76% |
| Resim8 | 2538.050 | 2461.940 | −3.00% |
| Capture+Restore | 771.360 | 690.885 | −10.43% |
| 四阶段合计 | 6064.625 | 5796.695 | −4.42% |

普通无checkpoint的40个块为1851.220→1845.745ms（−0.30%），不能据此称普通游戏显著加速。全部块初始Save载荷均值1162877.9→891449.6B，−23.34%；它不包括随后首写，也不等于保留容量。

总工作在两种块顺序下分别减少6.99%和1.63%；Capture两种顺序均减少。各阶段的最大值并非都改善：Capture最大14.680→15.670ms、Restore最大12.230→14.875ms、Resim8最大68.375→94.485ms。因此第一轮不能承诺消除长尾或rAF停顿。

完整来源：`th09_web/artifacts/multiplayer-tests/journal-active-pools-paired4-c3-report.json`；按固定WASM身份归一化的汇总：`docs/multiplayer/rollback-journal-active-pools-paired4-c3-summary.json`。

`journal-active-pools-paired4-swapped-c4`已交换页面/构建身份完成80块，385.395秒，完整正确性、sourceStable及host-load记录均通过。其A页面装载候选，B页面装载基线；汇总按WASM身份重新归类。

### 交换身份的复测与当前可支持结论

| 阶段（c4全部80块总ms） | 固定基线 | 候选 | 变化 |
| --- | ---: | ---: | ---: |
| Capture | 464.015 | 409.865 | −11.67% |
| Forward8，含首写 | 2773.290 | 2547.075 | −8.16% |
| Restore | 266.805 | 208.430 | −21.88% |
| Resim8 | 2433.725 | 2267.225 | −6.84% |
| Capture+Restore | 730.820 | 618.295 | −15.40% |
| 四阶段合计 | 5937.835 | 5432.595 | −8.51% |

复测普通无checkpoint40块为1607.500→1649.240ms（+2.60%）。不能声称普通路径没有代价或全面加速。初始Save载荷与c3逐块一致，均减少23.34%。

两次共160个有效checkpoint pair全部通过恢复前后完整状态、portable audit及PNG检查；合并Capture+Restore减少12.85%，四阶段合计12002.460→11229.290ms，减少6.44%。四个“运行×先后顺序”小组的总工作方向均为改善。由此支持这项改动在该固定CPU4诊断场景下的可重复局部耗时收益，尚不等于发布版FPS或rAF长等待承诺。

长尾仍不单调：c4 Capture最大17.690→19.015ms，Resim8最大56.605→68.295ms；总块最大148.470→122.600ms。全部数值、顺序分组和raw SHA保留在`rollback-journal-active-pools-paired4-c3-c4-summary.json`，不删除不利阶段。

发布版A/B/B/A的参数与评估口径在运行前保存于`rollback-journal-active-pools-release-protocol-c1.json`。

## 生产驱动与发布版验收

- 两次完整80块对照与交换身份复测已完成，全部阶段与不利长尾已保留。
- 真实逐帧历史环的CPU4深度8验证、发布构建和真实回合切换验证均已完成（见下）。
- 同源码发布构建已完成双端4×、120Hz Page-clock 连续触控、D0/H8、relay39±5ms的串行A/B/B/A。所有输入产生、rAF/逻辑推进和长间隔分开报告。
- 真实触控对照是同模式墙钟输入，不自动等于相同捕获输入tape。没有这种因果控制时，不对小幅FPS差异给出确定百分比归因。

### 生产历史环：CPU4、强制深度8、600帧

`journal-active-pools-deep8-cpu4-c1`通过，运行140.599秒且sourceStable=true。三个世界共享一个CDP限速4的Chromium renderer，采用固定frontier-delay=8、D0、方向/聚焦强制变化；它是生产历史环与包/输入路径的正确性验证，不是真实网络rAF吞吐测量。

- 两个预测端完成600帧，分别598/597次纠正、4755/4751个重演tick。
- 暖机后每端均记录420次真实请求深度8的恢复；最大恢复深度均为8。
- 三份世界network hash均为750422264，48字段审计、完整PNG与1085字节录像相同。
- 预恢复输入发布被实际覆盖（592/579次）；完整600帧捕获序列与物理意图一致。
- 此场景只到phase 1，两端峰值Bullet各11、Enemy各19；不能称为高弹幕密度吞吐验收。
- 该诊断构建中的恢复经常分多次调用完成；暖机后完整8层在一次调用完成的数量仅2/5。native调用p99约42.85/42.98ms、最大68.85/70.10ms。不能把“恢复正确”写成“8层稳定60帧”，也不能把这批调用时间当发布构建结果。
- 收尾文件记录complete=true。原始逐调用样本、capture trace及身份均在对应report/cleanup/invocation文件中。

### 真实回合切换

`journal-active-pools-round-reset-c1`通过，运行86.408秒且sourceStable=true。使用真实资源的`world-browser.mjs --round-reset`推进1800帧，完成270个checkpoint、每个跨6tick，覆盖600帧处的真实回合结束及后续回合生命周期。Restore后立即完整状态hash相同，重演后的状态与完整PNG也相同；pool、bullet、recording边界用例各1项通过。

这是回合生命周期正确性验证。该driver不设置CPU限速，本次也未使用native GPU计时配置，因此不用于CPU4性能承诺。

### 发布构建身份

候选发布构建已完成（57.764秒，sourceStable=true）。固定A与候选B均为`TH09_DEVELOPMENT_HARNESS=0`；编译参数、导入导出、音频SIMD选项一致。候选发布版与已验证诊断版的生产源文件身份一致，差别是预先记录的发布/诊断编译配置。

275项源条目比较仍只有上述六个语义生产变更，以及已确认规范化后完全相同的PerformanceDiagnostics.hpp换行差异。构建身份保留在`rollback-journal-active-pools-build-release-c1.json`，运行前参数与顺序保留在`rollback-journal-active-pools-release-protocol-c1.json`。

### 发布版双端连续触控：完整A/B/B/A结果

四轮均使用两个独立的正常Chrome进程、native GPU、双端CDP CPU4、D0/H8、持续joystick输入和独立relay；39±5ms是注入的包延迟，不是实测RTT。音频输出关闭。实验期间没有同时编译、运行第二项浏览器测试或CPU profiler。

四轮raw均passed，四轮汇总资格均通过，10个确认hash点均一致，sourceStable和teardownClean均为true。每端窗口从第一次跨过180至第一次跨过1200的原生prediction frontier，未使用回退游标或观察到的最大next作为替代。四轮finalComparable均为false，不能把不同未确认尾端的最终speculative hash当成对齐世界比较。

下表为正文新状态区间。新状态Hz是提交了更新逻辑状态的频率，不是物理屏幕光子FPS；rAF与Page时钟同时保留。加入结束边界后，表中max和>50ms计数均未变，未出现被删去的无新状态收尾等待。

| 运行 / 端 | logic Hz | 新状态 Hz | rAF p99 ms | rAF max ms | Page max ms | >50ms次数 rAF / Page |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A1 原版 P1 | 38.24 | 35.53 | 84.78 | 91.18 | 91.88 | 68 / 69 |
| A1 原版 P2 | 38.13 | 38.13 | 54.48 | 78.76 | 83.24 | 11 / 16 |
| B1 优化 P1 | 37.87 | 37.88 | 48.51 | 109.01 | 119.15 | 9 / 13 |
| B1 优化 P2 | 37.79 | 34.52 | 84.71 | 169.49 | 168.46 | 69 / 75 |
| B2 优化 P1 | 57.59 | 57.51 | 30.31 | 36.38 | 46.38 | 0 / 0 |
| B2 优化 P2 | 57.59 | 57.59 | 24.30 | 30.29 | 36.77 | 0 / 0 |
| A2 原版 P1 | 56.64 | 56.62 | 30.31 | 42.43 | 45.88 | 0 / 0 |
| A2 原版 P2 | 56.60 | 56.62 | 24.51 | 42.28 | 45.88 | 0 / 0 |

B1两端各有2/4次>100ms的新状态间隔，两个时钟计数相同；四轮均无>250ms正文新状态间隔。这不能证明以前的477.630ms已登记rAF等待已经消失。

原版自身也由约38Hz变成约56.6Hz，优化版自身由约38Hz变成约57.6Hz。不能把前后半段的改善归给这项代码修改，也不把B2比A2约1Hz的差别称为确定的整体收益。所有控制身份除预期变化的WASM/loader以外均相同，但墙钟输入的实际捕获tape、世界进展和调度不等同于严格配对的固定工作量实验。

### 负载与输入分母

| 运行 | Save端点差 P1 / P2 | 纠正次数 P1 / P2 | 重演tick P1 / P2 | native callback p99 ms P1 / P2 |
| --- | ---: | ---: | ---: | ---: |
| A1 | 254 / 3646 | 185 / 609 | 233 / 3388 | 36.96 / 10.14 |
| B1 | 3456 / 254 | 541 / 211 | 3118 / 255 | 9.94 / 40.51 |
| B2 | 1720 / 3598 | 810 / 833 | 1679 / 3586 | 14.07 / 10.35 |
| A2 | 1695 / 3488 | 779 / 831 | 1626 / 3469 | 13.67 / 10.69 |

较慢端在A1为P1、B1为P2，且都只有254次Save。A1 P1的网络制动scale始终为1；B1 P2的中位数和p99也为1，仅一次小区间升至1.213。另一端则分别有6帧的缺口中位数、1.413/1.493的制动中位数。这证明不能把整场约38Hz统一解释成主动网络降速，也不能用Save多的一端callback中位数很低来证明每逻辑帧很快。native callback记录的是同步调用的墙钟时间，包含潜在GPU等待，不是CPU self time。

正文输入按事件到期的Page时间归属，包括合并和未提交事件：

| 运行 / 端 | 到期 | 已提交 | 提交前合并 | 未提交 | 条件关联到呈现 |
| --- | ---: | ---: | ---: | ---: | ---: |
| A1 P1 | 3248 | 770 | 2475 | 3 | 565 |
| A1 P2 | 3276 | 2641 | 635 | 0 | 956 |
| B1 P1 | 3278 | 2743 | 535 | 0 | 1019 |
| B1 P2 | 3308 | 743 | 2563 | 2 | 481 |
| B2 P1 | 2155 | 1434 | 721 | 0 | 990 |
| B2 P2 | 2171 | 1593 | 578 | 0 | 959 |
| A2 P1 | 2191 | 1432 | 759 | 0 | 981 |
| A2 P2 | 2207 | 1547 | 660 | 0 | 896 |

各行到期数=已提交+合并+未提交。条件关联到呈现只是已提交中的一个子集；未关联事件不自动判为成功或失败动作，合并MOVE不等于网络丢包。B2的submit→render条件p99为29.88/25.12ms，而B1为33.42/80.48ms；这些分位数不能覆盖全部到期输入，且不是实体触屏到屏幕的延迟。八个正文窗口均由输入源完整覆盖，窗口内部future-censored事件为0；B2 P2与A2 P1各有1个到期于正文、稍后才提交的事件，仍保留在分母中。

### 169.49ms区间的具体性质

B1 P2最大新状态rAF区间为sample394→398。该对端点的Page间隔为159.90ms；上表Page最大168.46ms来自另一对端点。它并非单个rAF等了169ms：期间有四次后续callback。

- 起点前沿/next均为357，presentation计数357；随后出现一次纠正，next退到353。
- 三次恢复callback依次将next推进至353、355、357，native墙钟分别为39.39、19.56、9.31ms，presentation计数一直为357。
- 后一次callback耗时11.11ms，前沿推进至358，presentation才增至358。
- 从sample396开始缺失网络输入已经为0、网络scale回到1；之后仍需完成剩余重演。整个区间实际Save累计计数一直为107，没有新的WorldState Save。

这是恢复尚未追到新前沿而没有新画面的实证，需继续优化Restore/重演及调度成本。它不能被笼统算作网络信息不足，也不能仅靠减少该区间的Save次数解决。原始相邻样本和raw身份保留在`rollback-journal-active-pools-release-b1-gap-c1.json`。此前477.630ms的已注册rAF等待是另一个仍未关闭的问题，两个指标不能混用。

完整四轮raw位于`D:/workspace/eagler/worktrees/th09-managed-touch-4x/th09_web/artifacts/multiplayer-tests/journal-active-pools-release-relay39-{a1,b1,b2,a2}-report.json`。本树保留每轮invocation/process log及`rollback-journal-active-pools-release-abba-c1-summary.json`。汇总schema /2明确区分ms、frames、ratio；旧A1 schema /1的原始汇总也保留，资格结论未改变。

### 最终源码与产物核对

`rollback-journal-active-pools-final-integrity-c1.json`记录最终只读核验：275个发布构建源条目的当前SHA均与构建时一致，四个冻结WASM和两个发布loader均未变化，四轮raw身份与运行顺序正确，非WASM/loader控制身份无差异，`git diff --check`通过。

当前为未提交的本地改动，基础HEAD仍为63127575d43ea5ef35b317ff8137b00a1ab5b1cc。跟踪文件diff是六个生产文件和两个测试接入文件；新组件测试、配对driver、离线汇总器、执行记录器及报告为本树新增文件。没有push、合并、部署或公开发布。

## 后续决策

本轮先把PlayerShot日志优化验证成可审查、可复现的独立改动。另一个已定位但尚未实现的固定成本是每次Save销毁并重建21个vector快照、10个Replay sizes缓冲及字符串闭包；可按固定typed slots复用容量，同时保持原undo顺序。不能把“56条undo记录”直接称为“56次malloc”。

已对照`D:/workspace/eagler/th06-eagler/src/netplay/Th06RollbackState.cpp`和`D:/workspace/eagler/th07-eagler/src/netplay/Th07RollbackState.cpp`：两者主状态通过统一g_Journal保存，特殊效果使用ScreenEffectFrame/BombFrame等明确类型；TH06 checkpoint跨2个逻辑帧，TH07跨度可配置。两者仍有新建效果向量和Restore中的owning副本，不能称为零分配；Replay提交语义也与TH09不同，不能直接删掉TH09的录像长度恢复。可借鉴的是固定类型和可复用载荷；本轮没有把多帧checkpoint跨度搬到TH09，也没有运行新的TH06/TH07性能对照。

具体后续工作应围绕已观察到的瓶颈推进：先对169.49ms恢复区间的Restore、单tick重演、draw/submit与回调等待分段归因，确保优化最终缩短无新画面的持续时间；再把已定位的固定vector快照改为保留容量的类型化槽并重新做严格配对。不得仅把长恢复拆成更多回调，就认定玩家已获得连续的新画面。

JS侧也有独立候选：此前主树`th09_web/sdl-runtime/managed.mjs`的onGameFrame两次完整status()在只需要title的情况下构造6个临时TypedArray view、6个数组和2个对象，并重复调用12次getter；可改为一次title读取所需标量，保留网络pump、状态响应和生命周期时序。这个managed路径没有进入本轮隔离driver，不能用它解释本轮长间隔。共享journal的bulk copy直接使用HEAPU8.copyWithin，不存在每块新建subarray的事实；网络发送slice则有独立所有权理由，不能直接删除。

连接降速当前仍是Mode0固定免罚4帧，公式为 `1 + clamp((B-4)/3, 0, 1)`。用户提出的稳定连接预测基线尚未实现。后续应把正常post-Pump缺口N与额外缺帧区分，冻结已可信测量的N，防止降速自身污染学习；先证明N=2时B<=2无新增制动、B=3开始渐进。启动测量和Hybrid目前是另一条路径，不能冒充Mode0已经有自适应基线。

此前记录过约477.6ms的已注册rAF等待，后续回调游戏计算几乎为零。此次减少CPU与日志负担不自动证明浏览器调度长等待已经消失。最终只承诺实测支持的改善范围。

## 可交付与承诺边界

- 可以交付这项PlayerShots生产补丁及其完整验证证据；它消除了空闲自机弹槽每次固定全拷贝的负担，保留完整状态与首次写入原值。
- 可承诺的已证实范围是上述固定CPU4诊断工作量中的可重复成本下降：Save+Restore两轮为10.43%/15.40%，四阶段为4.42%/8.51%；23.34%指初始Save有效载荷，不是总内存减少。
- 组件、真实H8逐帧回滚、回合切换和发布版确认点均已通过所列一致性检查；这些是明确覆盖范围，不能扩展成对所有角色、所有高弹幕场景的无缺陷保证。
- 当前仍不能承诺双端4×稳定60Hz、不出现100ms级停顿、手机实机表现、direct与relay全部网络情形，或连接正常预测基线已自适应实现。本轮新发布对照只覆盖独立relay；以前direct相关材料不冒充本轮候选的direct验收。

