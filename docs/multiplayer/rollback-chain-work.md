# TH09 预测回滚：传输、浏览器调度与普通帧优化

状态：进行中。工作树：`D:/workspace/eagler/worktrees/th09-rollback-4x`，分支 `experiment/rollback-4x`。

目标是保留 D=0 的本地预测和完整回滚，让玩家持续看到新的游戏状态。网络信息不足时允许渐进降速；秒级静止与突然大卡顿仍是未通过项。TH06MP / TH07MP 的成果继续作为参考。环境操作均通过 nig；本轮已保存诊断基线 `65e5ada`、输入发送合并 `17077dd79291a8c157253b0ea1cf3d11658536e9` 及其 common 提交 `512353cab9eaa4f6744f867b0eb07c61ee7f2b0e`，均为本地提交。

## 当前结论

- 发布版在 headed 4× 对照中已多次接近 60 Hz，包含未改游戏代码的原 P 和输入合并 B；实际本机 RTC direct 也达到 59.98 Hz。输入发送合并在真实包记录中验证成功，但稳定 CPU 收益仍未证实。整体目标尚未验收：1,800 帧独立 relay39 运行仍出现两端约 1.4 秒的 active rAF 缺派发。
- 新增 B 的每方向 125±5 ms / 1,800 帧 / CPU[1,4] / D=0 运行，按连续 180→1800 边界重算为 40.608 / 40.616 Hz，最长新状态间隔 41.135 / 44.695 ms；状态检查通过。P2 正式 161 条组合输入中 160 条被采样并呈现，中间一条仅保持 4.840 ms 的“左移且低速”组合被后续“左移”替代；左键按下仍被后续采样。完整响应与缺项一并保留，不能只展示成功延迟。
- 有界 Chrome 追踪经过保留失败的两次校准后，在第三次 360 帧短窗取得两端完整 trace、时钟和 active 覆盖。该次没有复现秒级停顿；有效采集是后续定位基础，不是生产修复。报告另纠正了旧 frame-filter 在回卷尾部拼接非相邻样本的统计问题，原始报告保持不变。
- 真实游戏在 P2 CPU 4×、同步发送、中继无注入延迟时，复现约 2.19 秒的新状态显示间隔。主要空档发生在已请求的游戏 rAF 尚未被派发期间；独立网络 pump、收发事件和音频输出回调仍在运行。
- 对端所缺的 P2 frame 283 输入在 rAF 恢复后的本地 capture 才生成。实际 WebSocket 发送至 P1 JS transport poll-copy 约 3.600 ms；这次两秒等待在该包生成之前。
- 音频回调持续，但抽样输出出现连续零值块，不能当成声音连续的验收。这里是 SDL 输出抽样，并非声学测量。
- 普通帧也有独立问题。严格筛出的 609 个回调均为一次 callback、一次前进，没有 Save / checkpoint / restore / replay / correction。7 个超过 50 ms 的回调全部属于此类，且均发生 PCM 补队列。全量 SFX 共享输出 PCM 的方案未通过逐位等价检查，未采用；后续 live CPU profile 已将约 59.22% 的 mix 采样权重定位到 BGM Vorbis，WAV 相关读入仅约 4.77%。
- 五组无游戏传输对照均完成每向 1,440 个包的完整交付和逐字节校验。宿主安全软件注入资源令隔离判据均失败；RTC 阻塞组另有一个启动 selected pair 状态未 succeeded 的严格路径失败。原始失败记录保留。
- 先前真实游戏 RTC 启动追踪中，两端 RTCPeerConnection 原构造调用各阻塞约 4.7 秒，中继约 4.5 秒期限已先到达，最终退回 relay；这些失败未形成有效 direct tape，继续保留。新的 headed 发布运行已经验证实际 direct 成功；不能用这次成功删掉历史失败或推导公网可用性。已有 health 对照没有代理绕过差异。
- 关闭 live 成本探针的发布版基线也保留了一次开局失败：P1 最后 callback 约 10.34 ms，但下一 rAF pending 15.616 秒仍未派发，P2 最终因确认输入停止推进而关闭。该运行有持续 wasm-opt 编译 CPU 活动，不能称为空载基线，也不能仅据此归因游戏或 GPU。

输入发送合并已通过 channel / session / Adonis 检查，真实逐包记录也确认了预期行为。音频 SIMD 在 WASI 和实际 Emscripten 编译器下的同一组 84 个逐位组件用例均通过；构建选项和组件 gate 已保存为本地提交 `6a486298a731d4aff8ec8d2b19df605a98abf48e`。新组合的深 8 帧恢复和 7,200 帧生产画面对照已通过。实际 Emscripten 组件存在混音变慢的样本与汇总，SIMD 仍默认关闭。

新的 headed 发布控制已经改变了判断范围：原 P 两次约 59.99 / 59.92 Hz，输入合并标量版约 60.01 Hz，SIMD 版约 58.25 Hz。原 P 未改游戏代码即可跑近 60 Hz，且游戏窗口内仍观察到编译活动，因此不能将诊断版约 31 Hz 或单次停顿解释成设备算力必然不足。无注入延迟的低纠错样本不能代表深回滚性能；relay39 的秒级缺派发则需要继续定位。500 ms burst 响应运行约 58.42 Hz、最长新状态间隔 91.84 ms，仅代表该次运行没有再现秒级停顿。

## 冻结构建和计时边界

| 构建 | Wasm SHA-256 | 大小 |
|---|---|---:|
| 原 P 发布版及重新编译的隔离发布版 | `de1760ac76f3aaa8cd49c9f267f37f85e86c70d6bf251679a5c93fefacca9b68` | 2,826,832 B |
| 本轮 live 诊断版 | `7c8bdf579af8e18ace2208377d5a4f22a309eba9c1ec22f0248e252bd6f7deaa` | 3,153,996 B |
| 输入发送合并，标量发布版 | `47367732b9bc4972d8adf2ffc49ace32cf9eca4a3868ff73c9c6494a0de4df97` | 2,827,629 B |
| 输入发送合并 + AudioDevice SIMD，发布版 | `d27b812b0a10e73f2633598921ddfed4eae6097634a651ee2fba8dedebb94e4f` | 2,840,561 B |
| 输入发送合并 + AudioDevice SIMD，live 诊断版 | `2dc45fc83983243bda9390a6daabdc12c9c0e03f4e16a3e20e4d02172e85fb49` | 3,168,199 B |

新增 32 个阶段、29 个累计计数、3 个末次观察值，共 134 doubles / 1,072 B。发布构建移除了新增计时、计数、schema 和导出，Wasm 与原 P 发布版逐字节相同。这证明插桩未进入发布代码，不表示已经取得新的性能收益。记录：`th09_web/artifacts/multiplayer-tests/rollback4x-chain-build-gate.json`。

阶段计时是经过时间，可包含调度或驱动等待；inclusive 阶段相互嵌套，不能相加。JS onGameFrame 中的 play.frame 还可能额外进入 native network pump，所有相邻 exclusive 之和不必等于一次 C++ callback。

openProbe 先于 P2 CPU 限速，因此 before/after-open 属于 1×；之后网络对局准备和回调才使用 [1,4]。首次记录区间可能含多个 callback，不能将其中全部 startMatch 时间称为首个 callback。

### 帧调度与 TH07 对照

对当前源码及实际 SDK 的只读复核表明，TH09 用 callback 入口间的 timestamp 差累计时间；SDK 在 callback 返回后请求下一 rAF，TH07 的 SDL main-loop 也采用回调后 request，因此不能以“TH07 提前请求而 TH09 没有”解释差异。FrameSchedule 的单步完成路径保留小数债务，落后/预算退出路径另行处理；未找到固定 30 Hz 或工作后再固定等待 16.67 ms 的路径。两份 live 诊断的 P2 正式区间 networkScale 均为 1000，最新运行也没有恢复欠账，不能把约 31 Hz 归为网络制动。回调自身成本与退出后的 rAF 待派发分别保留，二者的独立中位数不能相加当作逐帧因果分解。完整证据 `rollback-chain-frame-schedule-evidence.json`，SHA `03008c8a5726f0b2e657164d87be65e3c78e155fb70c176936468891f8c4e1cb`。

### TH07 的可参考上限

历史 TH07MP 记录 `D:/workspace/eagler/th07-eagler/.codex-tmp/zero-responsive-final-cp3/audio-2p-slow4-defaults.json`（SHA `8467bb164fcc7c5c40c95a0f52a09816ecfaa610339280e08015a93bf6e755c3`）包含 3,600 帧、stage 6 Lunatic、OGG 音频、RTC、P2 CPU4、D=0、checkpoint 3 / window 12：P2 逻辑约 59.831 Hz，6,879 帧重演，新状态间隔 p99 / max 为 37.2 / 70.7 ms。它支持继续追求较深回滚下的连续游戏，不能用 TH09 一次繁忙宿主或诊断构建的结果否定目标。

这不是本轮同宿主、同输入、同计时口径的 TH09/TH07 A/B，不能计算跨游戏速度收益；也不应从当前 TH07 源码的音频选项反推历史运行模式。TH06MP 的成功经验同样保留为目标参考，本轮尚无与 TH09 同一套连续时间窗的实测对照。后续比较优先针对 checkpoint、历史窗口、恢复预算和正常帧开销的具体差别。

## 新候选：输入合并与音频 SIMD

### 同回调发送合并

旧 relay-none-02 正式区间重新逐包关联：P2 的 755 个 callback 内有 1,241 次 input intent，其中 519 对为先发旧尾部、随即发包含新采样的完整尾部；P1 对应 321 对。所有这些相邻对均满足连续 sequence、相同 ACK / frame advantage、后一包完整覆盖前一包输入。该观察不等于可直接省去相应比例的 CPU。

common 512353c 只在调用者明确保证即将捕获前沿输入时暂缓 ordinary input。暂缓发生在分配 sequence 和编码之前；新 LocalCaptured 合并尾部发送。due repair、ACK-only repair、历史窗口压力、背压和 Adonis 保留原路径。TH09 在成功捕获、捕获失败、未 Ready 和 Pump 失败的分支均清理暂缓状态，并在 Restore / Prepare / 预算退出前发送；独立 timer pump 不启用暂缓。采样位置、once-only 输入和预测上限没有变化。跳跃式安排输入的通用调用者必须在覆盖历史槽之前显式 flush。

`rollback4x-chain-input-batch-channel-01/report.json` 与 `rollback4x-chain-input-batch-components-01/` 已通过：包括序号、ACK、完整输入尾部、背压/失败、timer repair、partial replay、epoch 清理及原 Adonis 矩阵。报告里的旧 530→180 ms 修复政策测试不是这次合并带来的性能收益。

离线分析器 `analyze-input-send-batch.mjs` 采用完整 packet key 加 occurrence 关联；旧基线的两端 900 帧实际 wire tape 与 7 个 confirmed hash 已重新验证。现有记录没有原生采样完成时刻，因此 exact capture→intent 不可用；rAF 入口至首次入包只能作为另一个明确标注的边界。

新组合的真实 relay 诊断运行已完成：`rollback4x-chain-input-batch-simd-live-relay-none-01-report.json` 位于冻结 `th09-rollback-chain-profile` worktree，原始 SHA `6fd99bbb29d3244f67db2632468ced5b040a26a063f35bc70d1d53ad0c7a170d`。同一冻结逐包分析器显示 P2 旧尾→fresh 双发 519→0，P1 321→1。剩余 P1 组合符合 ACK 前沿停留 97.815 ms、超过 80 ms due-repair 的保守分支；原记录没有直接分支标记，不能宣称已证明具体分支执行。P2 另外 49 个多 intent 回调都是两次真正 fresh tick，frame/capture/latest 均依次增加。

两次完整 900 帧 wire tape、7 个同帧确认 hash 相同，未观察到发送 sequence 洞；2,502 个观测到的 WS send 全部匹配 relay。停止后的额外 relay 包、迟到 ACK 与已 receive 但未 poll-copy 的最后一个 ACK 均保留。新运行 P2 约 30.85 Hz、正式区间零纠错重演，最长新状态间隔 90.475 ms；诊断版、探针身份与 Wasm 均有明确差别，不能将未再现秒级空档当成修复，也不能用此计时给输入合并归因。完整精简证据 `rollback-chain-input-batch-live-evidence.json` 为 484,623 B，SHA `6191258e38b4e173b21ad92b9ad879deaf88f5158e87ab596a4a1566aab00d9f`。两个样本都走 relay，不能从 repairs=0 推导 RTC repair 已验证。

### 仅 AudioDevice 编译单元启用 SIMD

`TH09_AUDIO_SIMD=1` 为默认关闭的构建选项，仅 AudioDevice.cpp 添加 `-msimd128`。O2、`ffp-contract=off`、源音频实现、seek/loop、音量和队列策略保持原值；link 与其他编译单元没有全局 SIMD 或 fast-math 标志。两份实际发布产物共 114 个对象，只有 AudioDevice.o 及其缓存 key 变化，其余 113 个对象和 key 相同；275 份源/头文件记录一致。实际 SIMD 成品含 2,380 条 SIMD 指令，标量成品为零；最终 Binaryen 会移除 target_features，不能用最终该段不存在误判 SIMD 未生效。

WASI `rollback4x-chain-audio-simd-equivalence-03/report.json` 通过 84 case / 43,296 次操作；共比较 79,883,284 个 float（clamp 前后）与完整声明的状态，PCM / state / 返回值零差异。包含 39 WAV、两首默认联机 BGM 的完整流、全部 19 OGG 的边界，以及真正发生 loop 和 clipping 的 54 声部混音。保留 5,418 次 SIMD 较慢操作、7 个总时间较慢 case，不能选择性展示有利样本。

原 gate 使用 WASI clang 23。随后使用实际 Emscripten clang 24 / Binaryen 132、O2/g0 和 NodeFS 文件拉取运行同一 84-case 协议，`rollback4x-chain-audio-simd-emscripten-01/report.json` 再次逐位通过，原始 SHA 为 `553b4adb97ec5899ff13addc03a62e9777d156b8b6fd5005952af5ede4c36662`。本次 warm-mix 总时间却为 scalar 1,373.1189 ms / SIMD 1,489.1701 ms（约慢 8.45%），first-read / first-mix 也较慢；warm-continuous 和 clamp 较快。完整冷热及不利样本保留，不能用旧 WASI 的有利数值覆盖真实工具链的反向结果，也不能把这组 Node elapsed 当成 4× 发布收益。

这两组都是独立音频组件，未覆盖 SDL 4096/6144 队列滞回、最多六块补队列、输出设备重采样或物理扬声器时序。WASI 精简证据为 `rollback-chain-audio-simd-evidence.json`；两次早期编译/fixture 布局门槛失败原样保留。实际构建对象隔离另见 `rollback-chain-release-build-isolation-evidence.json`。

### 新组合的游戏正确性

| 验证 | 实际结果 | 边界 |
|---|---|---|
| 1,800 帧、D=0、frontier-delayed 深 8 帧回滚 | 两端各 1,799 次纠错、14,362 帧重演；正式区间各 1,620 次请求深度 8；各 1,800 次恰一次前沿捕获；三世界 hash 3545558762、48 项 audit、PNG、1,986 B Replay 一致 | 三个世界处于同一 Chrome 的受控交付，不是 CPU 4× 或真实网络吞吐；本用例只覆盖 phase 1 |
| 原 P 发布版→新组合发布版，7,200 帧 public spectator feed/tick | 73 点 hash/session/PNG 一致，全部 17 个 SDL 计数逐点一致；phase 1/3、暂停和结算已覆盖；最终 hash 763548183 | 公共发布接口、无 DEV 导出；不覆盖真实回滚传输或物理音频时序 |

前者原始报告 `rollback4x-chain-input-batch-simd-deep8-01-report.json` SHA `3021009617cb4fe125d34e145cf1c4263c8d4488cea8077055cf87b5e70d17ce`，后者 `rollback4x-chain-input-batch-simd-production-render-01-report.json` SHA `855045d078906c73ad8da95d9ce448081658348df12e88f776db713438f15d6c`。均位于主 worktree 的 `th09_web/artifacts/multiplayer-tests/`。这证明所列功能等价门槛通过，性能仍需单独判断。

## 发布版 4× 对照与实际网络验证

当前 headed/startup 控制已保存为本地提交 `83c447177b6da7f77429e35c97e2f35ec65f0245`。以下运行的 harness 均为 `a0ce03e2e79efaeab2f605c2e14f94415bce543cfdcb57d0e83eee4be4f34fef`，关闭 live 成本、V8 profiler 和逐包 browser trace，保留 rAF、host、SDL 音频输出及独立 relay 观察。两 owned browser 的实际可执行文件及参数验证通过。CIM 启动观察会改变预热；窗口 bounds 仍重叠，visible/focus 不证明物理可见或 scanout。已读到实际 Playwright 依赖在普通 main frame 启用 `Emulation.setFocusEmulationEnabled`，并带禁用后台限速的默认启动参数，因此 `hasFocus=true` 也不能证明操作系统前台焦点。不能把环境控制视作生产修复。

900 帧、无注入延迟、D=0、P1 1× / P2 4× 的 A/B/C/A 按执行顺序如下。表中 callback 成本只取 frontier 恰 +1、correction/resim 不增加的普通前进回调，排除了无前进等待。

| P2 | 逻辑 Hz | 新状态间隔 p99 / 最大 ms | 普通回调 p50 / p99 ms | 正式纠错 / 重演 |
|---|---:|---:|---:|---:|
| A1 原 P | 59.987 | 23.625 / 24.365 | 3.445 / 11.355 | 1 / 1 |
| B 输入合并标量版 | 60.009 | 23.850 / 30.770 | 3.045 / 8.245 | 2 / 3 |
| C 输入合并 + SIMD | 58.253 | 30.020 / 31.405 | 3.430 / 7.530 | 85 / 289 |
| A2 原 P 重复 | 59.921 | 23.615 / 30.545 | 3.035 / 5.980 | 35 / 35 |

四次 wire tape、7 个同帧 confirmed hash 全部一致。A2 自身也比 A1 成本低，C 的两端网络制动观察和纠错更多，故不能把顺序差异全部归代码。原 P 两次接近 60 Hz，支持继续优化，不能用旧诊断版约 31 Hz 否定算力目标；同样没有证明 B 或 C 带来稳定 CPU 收益。SIMD 默认关闭，后续主候选选 B。

随后采用 B 标量发布版运行真实网络条件，仍使用同一冻结 harness。独立 relay 是同机独立 Node 进程，不是异地独立主机或公网拥塞验收。raw 的 `passed=true` 是工作负载、状态与诊断有效性判据，**没有内置流畅度门槛**，不能直接称为性能验收通过。

| P2 条件 | 正式逻辑 Hz | 新状态间隔 p99 / 最大 ms | 正式纠错 / 重演 | 判断 |
|---|---:|---:|---:|---|
| 独立 relay 每方向 39±5 ms，1,800 帧 tape | 55.837 | 29.720 / 1,407.130 | 165 / 530 | 状态通过，秒级停顿未通过 |
| 上述延迟 + 500 ms 内额外 120 ms，1,800 帧 wall-clock 输入 | 58.425 | 30.660 / 91.840 | 132 / 391 | 本次没有 >100 ms 新状态间隔；输入响应另按完整记录判断 |
| 实际 RTC direct，无注入，900 帧 tape | 59.981 | 23.540 / 24.265 | 0 / 0 | 本机 host↔host UDP 直连通过；不是公网高延迟回滚验收 |

relay39 的 P1 同时出现 1,430.680 ms 新状态间隔。两端已经排队的 active rAF request 分别等待 1,429.935 / 1,409.780 ms，之前的 wrapper 只有 0.295 / 3.490 ms；缺口没有 pause/cancel。进入后的 wrapper 2.775 / 10.875 ms。两端共同空档在 relay 时钟 18,202.9189..19,611.3240 ms；中继继续 71 次 receive、71 次 schedule、77 次 send 和 13 次心跳。选取共同空档内被 schedule、且随后观察到 send 的包，两方向 schedule→send 最大 55.1099 / 54.9884 ms；这不是按 send 发生于该窗筛选。全部 5,602 个 planned delay 重算确为 34.0064..43.9986 ms。三个末尾未发送 ACK-only 和所有负 residual 仍保留。NETWORK_TRACE=0，因此没有浏览器 message/poll 的逐包时刻；中继记录不能冒充该边界。

这不能解释为中继排队了 1.4 秒。音频回调继续，但有连续零值输出块；同步 host 记录到 wasm-opt 实际 CPU 增长，仍不能据此判定具体宿主根因。headed 并未消除此类停顿，下一项诊断是有界的 Chrome scheduler/compositor/GPU trace。独立中继证据见 `rollback-chain-release-relay39-transport-evidence.json`，SHA `3450bd717d003060c32d5dd4f6574eddd25e5aff9459e66b918922f7c371a3b5`。

burst 响应探针按独立 wall-clock 提交输入。按本端正式窗口选择 scheduled intent 后，两端各 112 条，全部 submitted/captured/presented；schedule→首次包含该输入前沿的新状态提交观察，P1 p50/p95/p99/max 为 17.330/29.555/36.415/56.930 ms，P2 为 23.515/40.315/43.645/49.325 ms。这是游戏提交观察，不是显示器扫描或物理键盘测量。全程 P2 的唯一未捕获项是 warmup id2：计划 720 ms、实际提交 748.945 ms、750.580 ms 被下一意图覆盖，仅保持约 1.635 ms；仍保留此项，pendingAgeAtEnd 不是持续输入延迟。正式窗口始于本端响应时钟 3,099.460 ms。

55 个真实 burst 包覆盖双方 senderFrame 1193..1212，已发送包的 relay 等待最大 172.494/172.109 ms，计划值为 154..164 ms；不等于对端收到时刻。两端 networkScale 升至 2000 再恢复。P1 最大新状态间隔内有 9 次 callback、4 次 wait、累计 C++ 1.870 ms、零纠错；P2 对应 9 callback、4 wait、2 次纠错/12 帧重演，C++ 累计 55.230 ms、单次最大 15.725 ms。网络信息缺口和拆分恢复都应列出，不能把 91.84 ms 全部当作网络等待，也不能当作一次 C++ 长调用。完整响应证据为 `rollback-chain-release-burst-response-evidence.json`，SHA `b254a712a15f79205c96fc0e3517e7e9e5dc9a52db7cc4ba21478c95e554bac9`。

direct 两端的 selected candidate 均 succeeded、host↔host UDP，input lane 为 unordered/maxRetransmits=0，control lane 为 ordered，实际 route 为 rtc/direct。两份 900 帧 tape 与 7 个 confirmed hash 通过；结束前沿不同，不能用最终预测 hash 直接互比。正式游戏流畅，但两端 RTCPeerConnection 构造仍耗时 2,108.570 / 1,521.880 ms，P2 首两个逻辑帧的 native callback 为 127.255 / 62.255 ms；三个暂停状态下超过 250 ms 的启动 rAF 待派发区间全部保留。中继观察到第二个 player connection 后 2,220.2467 ms 发出首个 RTC route，观察点早于 canonical admission，不能称为原 4,500 ms 定时器的精确起止测量。

6 次客户端信令发送和 9 次浏览器信令接收均找到中继对应项；另有 2 条 player socket 的 RTC route 没有浏览器 message 记录，关闭边界保留。两端末尾多捕获的 6 / 5 帧、各一个 pending rAF，以及 P2 输入通道的 68 B bufferedAmount 也未剔除或宣称已排空。此结果没有修改原协商超时，不能覆盖公网 NAT、TURN、丢包或高回滚深度。完整 direct 证据 `rollback-chain-release-headed-direct-evidence.json`，SHA `4c6326cae31525aabfc4cce93a5b344ef071058af2cb4b1522fb1978585e4256`。

### 新增：125±5 ms 稳态网络延迟下的 4× 游戏

`rollback4x-chain-release-input-batch-headed-relay125-01` 使用同一 B 标量 Wasm、两个 owned headed Chrome、P1 1× / P2 4×、D=0、wall-clock 输入、1,800 帧，独立 relay 计划每方向延迟 125±5 ms；没有 burst 或丢包。关闭 live、V8 和 browser packet trace，开启原 rAF、host、relay、音频输出和响应观察。harness 是增加默认关闭 Chrome 追踪接点后的 `8c94c92453556670e9e748d3aca9edaf6b09402254e9864e80320b1b461f2f51`，本次 `CHROME_SCHED_TRACE=0`；不把它与先前 a0ce harness 的运行当作严格单变量速度对照。

运行原 workload/state gate 通过，15 个同帧 confirmed hash 一致；原始 report 28,866,220 B，SHA `d03833c48742160afa7956a70b4aa82f135069005e3b4b38422a6b3c08bca770`。两端结束时 next=1808、公开确认=1802，尚未完全确认的最终预测 hash 不同，不能用这两个 hash 直接互比。原 `passed=true` 不包含所有输入意图被采到或流畅度阈值，响应缺项仍单独保留。

本次另发现旧 summary 按可回卷的 next/cursor 筛 frame 180..1799，会拼接不相邻观察。P2 samples[5729..5738] 的 next 已在 1800..1802，被旧 filter 排除；随后回滚令 samples[5739] 的 next=1799 再入选，于是 raw 的 83.735 ms rAF 间隔及 99.180 ms Present 间隔都跨过十条实际连续回调，后一个点自身甚至没有新 Present。真实 rAF 回调没有相应的长空档。这些原值及全部尾部保留，不修改 raw 或冻结 harness。

新派生主口径定义为 **180→1800 边界推进**：P1 首次交叉索引 573→5745，P2 561→5729；本次 next 与单调预测前沿 F 的首次交叉恰好相同。推进率取端点时间差和 1,620 帧差；body 用半开连续窗口，终点跨界间隔和所有尾部单列，不能把前沿采样次数当作已经完成的模拟。独立复核如下：

| 连续边界指标 | P1 1× | P2 4× |
|---|---:|---:|
| 180→1800 elapsed | 39,893.165 ms | 39,885.905 ms |
| 逻辑推进率 | 40.608460 Hz | 40.615852 Hz |
| 端点 correction / resim 差 | 292 / 1,764 | 299 / 1,740 |
| 端点 capture 差 | 1,620 | 1,620 |
| 新状态间隔最大（含终点跨界） | 41.135 ms | 44.695 ms |
| 新状态采样时刻间隔最大 | 42.855 ms | 49.095 ms |
| 连续 callback 的 rAF timestamp 间隔最大 | 25.795 ms | 25.105 ms |
| 正式 callback native 最大 | 4.175 ms | 14.190 ms |

旧 body/filter 推进率 40.591767 / 40.509590 Hz 仍随原 summary 保存。新表不把过滤造成的跳跃称为卡顿，也不删除正式窗外的真实成本。P2 的 44.695 ms 最长新状态间隔包含 next 801→799→802 的拆分恢复、重演增量 +5/+2，以及一次约 21.840 ms 的已请求 rAF 等待；它既不是单次 44.695 ms C++ 调用，也不能全部归为网络等待。每次纠错的原始总深度未直接导出，不能把 125 ms、B 缺口或 resim 增量称为精确实测深度。

解释这次降速时，需使用已核对冻结 B 构建的合同：历史窗口为 8，F=max(next,replayEnd)，A 为已应用的连续远端实际输入 exclusive 前沿，B=max(F−A,0)。网络间隔目标在 B≤4 时为1，B=5/6时为4/3、5/3，B≥7时为2；按50 ms升1、150 ms降1的斜率渐变。当前 callback 末尾的 scale 观察不能直接当作入口采用的 scale；A 已追齐时仍可有先前制动的衰减和历史重演工作。内层8 ms、外层10 ms均是软预算，单个原子tick、Restore或随后音频可令整个 callback 超过该值。源码合同及13个相关源文件与冻结build身份的核验保存在 `rollback-chain-network-pacing-contract-evidence.json`，SHA `8dc3220dcb592af1492b9f348937e228f9d37c4b94bafea13f8504d1f9b0d532`。

本次正文的 B 确实持续处于 4..8，两侧均未观察到 A≥F。P1 的 5,172 条末尾网络 scale 全部大于1（1.133..2，中位1.473）；P2 为 5,144/5,168 条（1..2，中位1.340）。这支持持续的输入缺口制动，不能从末尾 scale 反推每次入口实际采用的时间比例。P2 同时有 243 个 `ok=2` 回调，全部存在重演进展；178 个末尾仍有 R=F−next 为1..5，65 个已追到F但尚未执行fresh tick。没有观察到正文中 `ok=2` 且零重演的硬窗口空等。网络信息不足和设备上执行恢复的贡献同时保留；该稳态高延迟运行没有覆盖信息完全恢复后的回到常速过程。

relay 的 6,257 次 receive/计划、6,250 次 send 全部关联，逐 sender 的 LCG 计划重算零差异。两方向实际 schedule→send 最大 151.963 / 160.417 ms，超过计划 due 的最大延后 27.526 / 33.470 ms；未见 throw、预算失败或 trace 溢出。末尾7个 pending 均为 inputCount=0 的 ACK-only，due 在停止观察后1.771..124.043 ms，保留为未排空边界，未称为已送达。100 ms relay 心跳实际最大间隔127.953 ms，最大迟到27.953 ms。浏览器逐包观察关闭，因此没有 message/poll-copy/native接受时延证据。

正文39个 host CPU 观测的总体 busy 中位19.492%、最大29.532%，8次进程快照只记录到所选 node/python 名称；这不能证明无竞争或把环境当作隔离实验。启动成本未筛掉：P2 preactive q5 已请求 rAF 等待374.455 ms，pause=1、frameCalls=0；active 早期 native最大65.065 ms，新状态间隔最大62.815 ms。整个测量集合的C++工作在prefix/body/tail三部分完整保留；两端包含终点callback的尾部各20条，P1/P2尾部native累计8.500/51.300 ms，包含造成旧筛选错觉的9.140 ms历史重演。采样时刻不是整段 JS observer 返回的时刻，完整工作量声明也只覆盖全部 measure.samples，之后更晚的 stats 快照另列。完整证据为 `rollback-chain-release-relay125-transport-evidence.json`，350,990 B，SHA `57942083c992c6fbf19a09092370541e41a3cf403e9ab8a7f218bfd0ae182972`。

#### relay125 的输入响应、音频及完整观察边界

以本端连续正式时间窗中的 **scheduled** 时刻选择意图，不先按成功结果筛选。两端各161条：P1全部完成，P2有160条被capture并进入新状态，下表P2分位数只来自这160条成功观察，缺失1条仍在161的分母中。单位ms，单元格依次为p50 / p95 / p99 / max：

| 阶段 | P1，161/161 | P2，160/161 |
|---|---|---|
| schedule→首次capture观察 | 20.220 / 33.435 / 42.715 / 45.280 | 24.395 / 41.215 / 49.585 / 50.775 |
| schedule→新状态观察 | 20.845 / 34.530 / 43.225 / 45.785 | 27.795 / 49.205 / 54.325 / 59.435 |
| submit→新状态观察 | 12.140 / 24.815 / 30.525 / 30.585 | 19.255 / 33.155 / 38.190 / 40.155 |

这证明所选意图参与新状态提交的观测，不是物理键盘到显示扫描的延迟。schedule指标包含独立输入timer被延迟的时间，submit指标则从实际应用held状态开始。原生capture的精确内部时刻没有被该观察器直接包围。热身每端20条均完成，P2热身schedule→新状态最大84.735 ms；尾部没有新计划意图，分布为空，不能称为零延迟。

P2未完成的id40计划9720 ms、实际提交9747.240 ms、9752.080 ms被id41替代，实际保持4.840 ms。id39=mask5（Z+Shift），id40=69（Z+Shift+Left），id41=65（Z+Left）；capture394在9737.185 ms仍为5，capture395在9767.505 ms已经为65。Left DOWN因此在后续采样出现，同时Shift释放；中间“向左且低速”组合没有形成独立采样帧。probe和生产hosted-key ABI更新当前held状态，游戏由相邻帧held生成pressed/released，没有每个跨键组合独占一帧的队列合同。完整mask覆盖仍为160/161，但不能把它误写为Left DOWN/UP短脉冲整条丢失，也没有为凑满成功率改变输入序列或gate。

两端各521个SDL输出抽样块、519/518个非零块，原音频输出门槛通过；零值仅最初2/3块，之后未观察到近零抽样块。该探针每块只抽样第0声道最多64个值，没有队列underrun标志，不能宣称物理输出或正式段绝对无欠载。完整host保留61个CPU样本（60个有效区间）、14次进程快照/402行，无采集错误和overflow；全采集期busy样本均值21.699%、最大47.835%，与上文正式窗口统计不同。响应及全部warmup/formal/tail、音频和host见 `rollback-chain-release-relay125-response-evidence.json`（1,446,645 B，SHA `471c6c02030dd94d3713f8e0c227a61a38fc236907643fbd48bde7f015209d3a`），准确输入合同和后续计时定义见 `rollback-release-response-acceptance.md`。

## Chrome 调度采集

首轮 `rollback4x-chain-release-input-batch-headed-relay39-scheduler-01` 采用相同 B 标量 Wasm、relay39、CPU[1,4]、1,800 帧 tape，仅增加有界 Chrome 观察。游戏工作负载通过，两端逻辑 59.818 / 59.848 Hz、新状态间隔最大 44.970 / 39.270 ms，15 个 confirmed hash 与完整 tape 通过；这次没有复现 active 秒级停顿。原始报告 20,748,287 B，SHA `1c1c677c7e2154787c50fcd207a3be206c4e317250521421d472470734491a94`。

追踪采集未通过：两端都在 `Tracing.end` 后 5 秒等待 `tracingComplete` 超时，只有 3,682 / 101,500 个净化事件，`collectionValid=false`、`activeWindowCovered=false`、时钟映射不成立。P1 仅有 armed 标记，非 metadata 事件跨 578.426 ms；P2 有 armed/first-active，跨 4,817.358 ms，均缺 capture-stop。二者完整页面采集窗实际约 36.7 秒，最后游戏样本至 capture-stop 还有约 5.51 秒的结果收集时间。不能用这些早期片段说明后续 renderer/GPU 活动或将缺事件解释为空闲。

两端 Chrome bufferUsage 在开始约 23–24 秒后都停在 0.9962451457977295，直到结束；未达到 helper 原来的 `>=1` 标志不证明原生缓冲仍完整。P2 的本地保守计数也已约 29.3 MB。因此仅延长回传等待不足以保证原长窗可用。首轮全部失败、原 helper（SHA `6e655330bf70f1434ce3044c544871462095728310cef7cd4f6bfef7c12b7637`）和净化 trace 均保留，没有改变原报告。

第二次采集明确收窄为 360 帧，覆盖此前长停附近的早期阶段。助手只将净化数据上限由 32 改为 64 MiB、回传完成等待由 5 改为 30 秒，Chrome 仍为 32 MiB、recordUntilFull、六固定类别、最多 250,000 事件与 90 秒截止；其余 CDP/页面等待仍为 5 秒，完整性和时钟门槛不变。15 项 helper mock 与 3 项 harness finalizer 合约通过，新增合约覆盖 12 秒后完成的回传及 late-start 的 owner-close 边界。这组工具保存为本地提交 `fd64e7eeb831ad2a7fe0ec23815b9d58680aa7cd`。短窗采集用于诊断，不能替代 1,800 帧或长场景的性能验收。

`rollback4x-chain-release-input-batch-headed-relay39-scheduler-short-02` 仍保留为失败：原音频采样 gate 要求超过 100 个非零输出块，360 帧短窗不满足。两端原 results 已在停止追踪前保存，之后 cleanup 的 partial 不能代替它们。trace 经过约 20.064 / 20.273 秒回传后均收到 complete、dataLoss=false，三个标记与时钟映射均通过，但 64 MiB 的本地保守预算触顶：raw 为 247,538 / 249,156 事件，只保留 234,451 / 234,205，故完整性和覆盖仍失败。原 failure 12,167,242 B，SHA `ff430e9d733fe5977619a37fbb9f5ae7837c0a1f82dd12f7477a523323f41ea8`。

第三次 `rollback4x-chain-release-input-batch-headed-relay39-scheduler-short-03` 完成了有界采集校准。helper 仅再将本地 padded 预算增至 96 MiB、事件上限增至 350,000，原 Chrome 32 MiB、30 秒回传等待、六类别、90 秒截止及完整性规则不变；15 个原 mock 全通过。这两个常量已保存为本地提交 `3e3df073daf07787c1dcb71aadf015fffd3246b8`；实际短03与relay125的运行HEAD仍为fd64e7，身份记录没有回写。运行仍为 360 帧，本次 `AUDIO_OUTPUT=0` 仅关闭输出块抽样，游戏音频和 `audio.advancedSeconds>1` 原门槛继续生效，没有放宽长场景音频断言。

两端 trace 均 `collectionValid=true`、`clockMapped=true`、`activeWindowCovered=true`，收到 complete 且 `dataLoss=false`，各保留 247,400 / 249,594 事件、零 overflow；各 27 个被排除项属于原过滤规则。三标记时钟交集宽约 0.215 / 0.218 ms，约 8.67 秒的实际采集窗覆盖了游戏测量；结束回传约 23.314 / 22.909 秒，不能计为游戏内帧间隔。源码身份前后稳定：helper `e15457ff9a36e15a49cbdfb7fdb762bbc4da819087991234c95040517a03db58`，harness `8c94c92453556670e9e748d3aca9edaf6b09402254e9864e80320b1b461f2f51`。

这次原游戏 gate 通过，3 个同帧 confirmed hash 与完整 tape 一致；正式区间逻辑 59.890 / 59.907 Hz，新状态最大间隔 23.555 / 24.070 ms，C++ callback 最大 2.000 / 6.465 ms。原始 report 5,061,969 B，SHA `cc99293e048bc5c6943f19b41f5f1e9200bc033c131bb3929f4350918a063393`；两个净化 trace 为 39,274,718 / 39,748,249 B，SHA `67d9341d2e4671cdba4239fe2b10341b9f1eb0c4e9cddeea53b7a05551566ad4` / `092e6bdda2f11734000ff9751398f0e2a08f281b963331b7cec4ec1053d6aaa0`。这只证明指定短窗采集可用且本次没有复现 active 秒级停顿；未采输出块，也不能据此验收长场景音频或宣布旧停顿已修复。

03 的启动记录也保留：P2 active 初期实际入口间隔最大 67.200 ms，native / wrapper 最大 61.620 / 62.160 ms；不能用正式三秒窗口内的较小数字覆盖启动成本。preactive q5 等待 313.355 ms，其中 renderer 主任务跨度 310.550 ms 完整位于等待内，结束距 rAF 进入约 0.288–0.506 ms。这是本次启动等待与长 renderer task 重合的正证据，仍不等于该任务全部是 CPU 运算，更不能回填旧 active 停顿的原因。另一个 336.639 ms renderer task 在游戏测量结束后，单列为收尾观察。

三次采集的原始失败、净化 trace 身份、所有 startup/active/tail、完整 host 与独立完整性重算已合并到 `rollback-chain-chrome-scheduler-evidence.json`（1,256,617 B，SHA `ccfa53516952d38f8634a8dac1e2b05f06401c5cccc5e9ad0b44530222f156fc`）。03 的 40 次 CPU 尝试、9 组 250 条进程行均保留，active 重叠采样的总体忙碌率约 13.65%–35.80%；所选进程名中未看到 compiler 不证明无竞争或单核/频率稳定。约 81.8% 事件仅保存未知名称 hash，线程与时间仍可用，但无法据此识别任务内部工作；没有物理 scanout 证据。本轮到此结束采集校准，后续如需定位偶发秒级缺派发，应针对异常触发有界保留，而非用短窗反复未复现代替修复。

早期阶段的相似性仅用于选择观察窗。四份实际 tape 的 frame 264..285 输入不变，下一次边沿在 286；旧诊断 frame 250..320 的纹理、程序编译、解码器打开和 textRender 累计计数也没有增加。原 P headed 和 B direct 已流畅经过同一段，不能建立“283 帧必停”的因果；计数不增加也不排除既有图元首用或异步 GPU 工作。样本 phase 只表示 SessionPhase::match，并非内部 MatchScene 的逐帧状态。精简上下文 `rollback-chain-early-stall-context-evidence.json`，SHA `8c6fa15bb79dabc23d6c175971929d56fe33baad2790dfe08fdb380c695efe18`。

## 历史：900 帧真实 relay 诊断对局

记录：`th09_web/artifacts/multiplayer-tests/rollback4x-chain-live-relay-none-02-report.json`。
SHA-256：`63a1997798609a598d5256e77775eb6df58b042ff7a810ef59ba00241c2b58a7`。

两独立 Chromium、原生 Intel GPU、D=0、P1 1× / P2 4×、固定输入 tape、同步 client.send、中继无延迟注入；开启 audio / rAF / host / network / live 成本观测。确认 hash、最终审计与诊断有效性通过，终点 hash 均为 1373367096。正式范围为游戏帧 180..899。

| 指标 | P1 | P2 |
|---|---:|---:|
| 逻辑前进速率 | 27.509 Hz | 26.969 Hz |
| C++ callback p50 | 0.020 ms | 16.310 ms |
| C++ callback p99 | 8.660 ms | 49.975 ms |
| C++ callback 最大 | 10.705 ms | 68.360 ms |
| 新状态显示间隔 p99 | 85.465 ms | 84.930 ms |
| 新状态显示间隔最大 | 2,068.545 ms | 2,186.730 ms |
| rAF 时间戳间隔最大 | 29.975 ms | 2,186.730 ms |

P1 中位数包含大量等待回调，不能当成完整普通帧成本。新状态显示间隔指伴随新 renderer 提交及新游戏帧的 rAF 间隔，不是物理 scanout。

### 两秒空档的因果链

P2 request 366 在 17,091.165 ms 已提出，19,268.460 ms 才进入，pending 2,177.295 ms。前一 wrapper 共 11.240 ms，onGameFrame 1.055 ms，其中 play.frame 0.205 ms；后一 wrapper 67.040 ms，其中 C++ callback 61.470 ms。附近无 pause / stop / cancel，生命周期 visible 且 focus=true。

真实缺 rAF 执行窗 2,176.870 ms：P2 无游戏 callback，但有 54 个 pump 观察、46 次 WS send、67 个 message、66 次正长度 poll-copy；P1 同窗有 280 个 rAF / game callback。不能把整段解释成主线程完全无法运行 JavaScript。

最早覆盖缺失 frame 283 的 P2 包为 seq 538、firstInputFrame 283、inputCount 1、ACK sequence 560、ACK frame 291、FNV32 2611395461。统一到 P1 的 performance 时间标尺：

| 边界 | 时间（ms） |
|---|---:|
| P2 send intent | 35,182.100 |
| P2 WebSocket.send 进入 | 35,182.135 |
| relay receive | 35,183.502 |
| relay send | 35,183.671 |
| P1 message 进入 | 35,185.390 |
| P1 正长度 poll-copy | 35,185.735 |
| P1 随后的安全前沿观察 | 35,187.820 |

跨进程通过 timeOrigin 映射，保留各端校准误差，不能冒充硬件同步抓包。poll-copy 是 JS transport dequeue，不是逐包 C++ ApplyInputPacket 的直接记录。

可提交的精简证据见 `docs/multiplayer/rollback-chain-transport-evidence.json`。完整派生文件 `rollback4x-chain-live-relay-none-02-active-transport-analysis.json` 保留全部配对、未配对、停止尾部与启动大间隔；其 SHA-256 为 `fa520fa5c49d276a41c49f79a684eb69f4dba8194c1840a9ef3606cec2002100`。不带 active 的派生草稿选到了启动最大间隔，不能替代正式游戏 episode。

## 普通帧与音频候选

609 个严格普通 callback 的 exclusive 总量：audioMix 2,841.635 ms，semanticDraw 2,425.270 ms，gpuSubmit 2,198.070 ms，Update 1,101.990 ms，confirmedPublish 34.205 ms。外部 network pump 不混入一次 callback 的归因。

341 个不补 PCM 的普通 callback 中位 13.920 ms、最大 44.630 ms；常见 3 / 4 块 PCM 回调中位约 26.2 / 26.8 ms。frame 847 另有 textRender 30.520 ms、textureUpload 8.625 ms，对应最大 callback 68.360 ms，仍是后续问题。

当前 TH09 有 54 个独立声部 decoder，共享 39 份 WAV。其中 33 份原始 22050 Hz、6 份 44100 Hz。参考 TH07 的预解码方法后，实际组件 gate 测得共享 f32 / stereo / 44100 PCM 为 15,635,416 B（约 14.91 MiB），原 WAV 为 2,420,704 B。组件一次性解码 150.7264 ms，不等于 4× live 或发布版启动耗时。

`rollback4x-chain-sfx-pcm-prospective-01-report.json` 的总 passed=false。连续读取 4,112,384 个 float 逐位一致；独立新建的 54 声部 mixed-zero case 直接调用真实 SoundEffects::process，仅使用生产中的 seek(0)，clamp 后仍有 1,062 个 float 不同、最大绝对差 0.191601545，首次发生在 step 3 的右声道 pcm[1]。另一个 source-seek0 汇总包含 nonzero→zero 历史，其 13,431 个差异不能全部称为日常重触发差异。

源码原因与反例吻合：miniaudio 的 ma_biquad_clear_cache 只清滤波状态数组的第一个声道，处理函数却逐声道访问；当前 seek/reset 会留下双声道重采样器的右声道历史。冷解码的共享 PCM 无法复制这类历史相关输出。没有修改第三方滤波器、重建 baseline 状态或放宽容差来消除失败。AudioDevice.cpp 保持诊断基线，没有采用 SFX 缓存优化。

非零 seek 的帧换算、转换器历史、返回状态和游标也需保留。mixed-after-clamp 的 cursorMismatches 未单独累加，不能拿其中的零作额外游标证明；应查看对应 before-clamp 项。BGM、触发时序、pan/volume、1024 帧块、4096/6144 滞回、最多六块补队列与 clamp 均保持原有语义。候选需先由 live profile 证明成本，再用同样严格的 gate 验证。

成本分析器为 `th09_web/tests/multiplayer/analyze-live-callback-costs.mjs`，对应 `rollback4x-chain-live-relay-none-02-cost-analysis.json`，保留全部相邻区间与分类，没有删除异常。

### 实际 V8 采样：热点与采样开销

冻结提交 65e5ada 的独立 worktree `D:/workspace/eagler/worktrees/th09-rollback-chain-profile` 运行了 `rollback4x-chain-live-relay-cpu-profile-01`，复用同一 live Wasm，900 帧 tape 与最终 hash 1373367096 两端一致。P2 为 4×，本次正式窗口约 28.792 Hz，0 correction / resimulation；没有复现两秒空档。它仍是带采样器和 live / packet 探针的定位运行，不是发布版性能验收。

P2 AudioDevice::pump 的采样子树共 4,057.893 ms，其中可明确归入 mix 的子树 3,678.508 ms。以下分类互斥，不能与其他 inclusive 表相加：

| mix 内部 | 采样权重 | mix 占比 |
|---|---:|---:|
| BGM Vorbis | 2,178.485 ms | 59.22% |
| 节点图与混音 | 584.718 ms | 15.90% |
| 线性重采样 / 内联 biquad | 527.011 ms | 14.33% |
| WAV 相关读入 | 175.353 ms | 4.77% |
| data source / decoder 框架 | 153.336 ms | 4.17% |
| 其余声道 / 格式转换 | 59.605 ms | 1.62% |

WAV 项还含接口工作，不能全当成样本格式转换的可省时间。SDL 的 ResampleFrame_Stereo 608.128 ms 在独立 onaudioprocess 栈中，不属于这张 mix 表。19 曲 OGG 与 thbgm.fmt 均为 stereo / 44100；本轮只有一个 music decoder open、没有同轨 restart，未证明存在可删除的重复 BGM 解码或源率转换。

完整 P2 采样权重 33,207.467 ms，保留 program 未知 7,574.567 ms、idle 2,080.282 ms、匿名 830.129 ms、GC 127.745 ms，没有把未知时间摊到音频。请求间隔 0.5 ms，实际后续样本间隔中位约 1.055 ms；第一个 983.489 ms 的 program 样本也保留。采样窗口未与 180..899 或 native 累计窗口精确同步，不能用于逐帧因果分摊。计时探针、send 和 packetId 本身有明显成本，因此验收必须关闭 CPU profiler / live 计时 / browser packet trace。

基于这份证据，停止复杂的 SFX native-format backend 缓存投入，随后将候选收窄为仅在 AudioDevice 编译单元启用标准 Wasm SIMD：保留 O2、ffp-contract=off、原 decoder / seek / 滤波历史。双工具链逐位检查现已完成，性能的不利样本与默认关闭的决定见前文；没有同时修改 Huffman、音频格式或队列策略。

分析记录：`th09_web/artifacts/multiplayer-tests/rollback4x-chain-live-relay-cpu-profile-01-audio-cost-analysis.json`，SHA-256 `1e1a2ef4a5938dad01dfa99be697ebab0f3709cd0ee5e22bc87d032a6d7fc82f`。原始 profile / report 保存在上述独立 worktree 的同名 artifacts 目录。

## 五组传输对照及宿主环境

| 组 | 完整交付 | 路径与 marker | 原始失败边界 |
|---|---|---|---|
| relay-none | 每向 1,440 个完整包 | 实际 WS relay | 外部安全软件页面注入请求 |
| rtc-none | 每向 1,440 个完整包 | 实际 host↔host / UDP RTC，无 relay 输入 | 外部注入请求 |
| relay-block | 每向 1,440 个完整包 | 实际 WS relay；P2 marker 400.335 ms | 外部注入请求 |
| rtc-block | 每向 1,440 个完整包 | 发送阶段观察为 succeeded host 直连；P2 marker 402.390 ms | 外部注入请求；发送前 ready 样本 pair.state=in-progress |
| relay-burst | 每向 1,440 个完整包 | 独立 relay 39±5 ms，短时增加 120 ms | 外部注入请求 |

原 health 报告总 passed 均为 false，并保留不变。完整交付、一致性、路径与 fixture 隔离分别报告。

health 调用真实 shared BrowserPeerTransport 的 EM_JS body 和真实 relay，但没有 Wasm、C++ SessionChannel、游戏、音频或绘制。control 对照经过可靠有序 DC，不覆盖专用 repair_to 的 32 KiB 门槛、背压和自动修复策略。两个浏览器在同一物理机；本机 RTC direct 不等于公网、跨 NAT 或 TURN 验收。

relay-none 的发送/排空窗口 CPU 完整采样加权忙碌率约 41.54%，有同 PID wasm-opt 的真实 CPU 时间增加；rtc-none 相应约 37.31%，完整快照中未观察到 compiler。真实游戏 relay 也记录到实际 wasm-opt 活动。不能由总体 CPU 或进程存在与否直接断定单个间隔的原因，也不按环境忙碌过滤异常。

## RTC 启动与发布版调度失败

真实游戏 direct 启动记录 `rollback4x-chain-live-rtc-startup-02`、`-03` 均未形成 direct 对局；两端最终 relay，输入 tape 为零。第二版启动观察器直接包围原 RTCPeerConnection 构造，保留原 receiver / newTarget / 异常，不改变 Promise、信令或超时。

`-03` 中，P1 message 至 constructor enter 为 0.480 ms，原构造调用耗时 4,775.845 ms；P2 对应 5.010 ms 与 4,708.295 ms。两调用都正常返回，其返回时点按 timeOrigin 映射相差约 2.960 ms。P1 随后的 data channel 创建只需 1.550 / 0.350 ms。relay 未收到 signal / rtc-ready / rtc-failed，初始 route 在约 4,507.77 ms 后退回 relay，符合既有 4,500 ms 协商期限；没有直接包围 relay 的 timer fire，因此“期限导致回退”仍标为时序推断。

这将等待定位到构造调用，但尚未证明具体浏览器服务、驱动或宿主进程是原因。1× 与 4× 两端耗时接近，也不支持把它直接归给游戏逻辑的 CPU 成本。已有 rtc-none / rtc-block health 原始参数均为 browserOnlyProxyBypass=false，无 --no-proxy-server；不能拿一个并不存在的代理绕过差异作解释。

无游戏 constructor-01 控制已完成：两端原构造调用 1,322.930 / 1,317.440 ms，结束时点相差 1.845 ms。每向 1,440 个包经实际 RTC 完整交付；原总失败保留 28 个外部资源请求及 P1 第 17 个 periodic RTC 样本的 pair.state=in-progress。该样本已在连接后的正常收发窗口，不能误称启动失败。

随后 constructor-gpu-02 仅给 health 显式追加与 live 相同的 `--enable-gpu --use-gl=angle --use-angle=d3d11`，仍无游戏、音频或 WebGL context，不能宣称实际 renderer 已验证。两端构造 1,290.770 / 1,288.210 ms，返回时点相差 0.555 ms；每向 API/send/message/poll-copy 均为 1,440 个严格恰一次包、sender/destination 正确、零异常，实际路径全部 RTC。本次严格 pair 检查无违规，原总失败仅余 27 个外部资源请求。约 1.29 秒与原 1.32 秒的单次差值不构成速度收益，也没有重现 live 的 4.7 秒。第一条 gpu-01 invocation 因漏传 --rtc 在浏览器启动前被参数断言拒绝，日志保留，不计为 RTC 运行。

两份精简记录为 `rollback-chain-health-constructor-01-evidence.json` 和 `rollback-chain-health-constructor-gpu-02-evidence.json`。构造观测包围捕获到的 NativePC，仍可能包含环境预装 wrapper；没有归因其内部等待。随后实施了较轻的 headed 控制，并进入有界 Chrome trace，当前结果见上文；控制条件的改善不计为生产代码优化收益。

精简启动证据：`rollback-chain-rtc-startup-02-evidence.json` SHA-256 `04996d834d011e2dfad913dc3db9ed7e81966b885376404fc0cac44c1b71996e`；`rollback-chain-rtc-startup-03-evidence.json` SHA-256 `8c820f85df9f8851093a95792fa22b193cfe93f255a52a7867c71d117ca24cf9`。它们位于本文件同目录；原 failure JSON 全部保留。

发布版 `rollback4x-chain-release-relay-baseline-01` 复用冻结 harness 和原 P Wasm，关闭 live / CPU profiler / browser packet trace，保留 rAF / host / audio / relay 观察。P1 最后提交到 frame 3，最后 C++ callback 10.340 ms；rAF #232 wrapper 10.630 ms，#233 在 31,904.250 ms 请求，到 47,519.980 ms 的快照仍未进入或取消，pending 15,615.730 ms。pause 请求发生在缺派发约 15.443 秒之后，不能解释起因。P2 继续 2,116 次游戏 callback，最后因 confirmed input 停在 frame 3 达到 watchdog 而关闭。

该记录还保留 P1 的 157 个音频回调、相对跨度 15,559.890 ms，抽样全部零幅度；音频无绝对 origin，不能逐毫秒对齐或称所有 JS 完全冻结。同期 wasm-opt PID 63812 的 CPU 累计从 722.84375 增至 948.125 秒，正式等待中仍增加；24 逻辑 CPU 总体忙度 34.84%–49.11%。这些环境条件不消除缺 rAF 派发的事实，也不足以把它归为纯游戏 / GPU 问题。原失败 SHA-256 `886b603d04d1e7968f7e400135be9977ba731618c9d5789b237fac01b4f3c1f2`，保存在冻结 `th09-rollback-chain-profile` worktree 的 artifacts。

## 下一阶段与验收顺序

1. **已完成并保留：** 输入合并的 common / TH09 边界 gate、真实逐包验证、深 8 帧状态/Replay，以及 7,200 帧生产画面对照。后续若修改发送或预测合同，再按具体风险增加验证；不重复无关 gate。
2. **保持默认选择：** B 输入合并标量发布版。SIMD 已通过两种工具链的完整逐位检查，但实际 Emscripten warm-mix 总耗时较差，A/B/C/A 又受宿主和网络状态变化影响，仍没有稳定性能收益证据。暂不投入大 PCM 缓存或变更音频历史状态的方案。
3. **当前首要未解决项：** relay39 的约 1.4 秒 active rAF 缺派发仍未定位；中继在该窗继续转发，新的完整短 trace 没有复现。下一项诊断应围绕实际异常触发有界保留，保住缺派发前后的 renderer、compositor、GPU 与已有网络/host 边界；有限短窗采集可用和生产问题修复分别判断。当前依据不足以归因某个宿主服务。
4. **输入与统计合同：** 125ms 样本的正式组合状态覆盖率是 P1 161/161、P2 160/161。先把完整 held-state 组合覆盖、具体按键按下/抬起、同键短 tap 三种含义核清，再决定是否需要输入层修改；此次 Left DOWN 被后续帧采到，不能直接加整条 mask 队列改变输入时序。新的连续时间窗派生已保存；后续正式汇总应显式采用固定边界和真实相邻回调，保留所有 startup/terminal/tail，不再用可回卷 cursor 逐行过滤后拼间隔。
5. **更深回滚与路线验证：** 125ms/4× 在本次工作量下持续出新状态，仍不等于实际深8每帧纠错或长场景验收。下一轮以 TH07 的 checkpoint/window 与恢复成本为具体参照，先量化真实重演的原子tick、Restore、确认副作用及普通帧音频/绘制成本，再按热点选择优化。路线侧继续覆盖独立 relay 的拥塞/丢包/背压与 RTC 的启动、修复通道；公网 NAT/TURN 和不同物理主机需独立证据。本机 direct 成功不覆盖这些条件。所有重运行继续串行并保存并发编译和不利样本。

## 本地保存核验

本轮报告、精简证据和离线分析器按46个显式任务路径保存；24份JSON均可解析，10项本轮关键harness/helper/analyzer/evidence身份已按冻结SHA重新核对。生产Wasm和旧burst原始记录没有改写。暂存 `git diff --cached --check` 报告8处文件末尾额外空行：`rollback-active-raf-trace-plan.md`、`transport-health-chain-work.md`、`analyze-chrome-scheduler.mjs`、`analyze-health-constructor.mjs`、`analyze-raf-timeout.mjs`、`analyze-relay-chain.mjs`、`compact-relay-chain.mjs`、`summarize-transport-health.mjs`。逐项核对后保留这些既有格式提示，以维持已引用分析源码的字节身份；没有通过重写冻结文件来消除提示，也未把该完整检查写成零告警通过。工具运行、语法、mock、实际采集及原始数据核验的结果分别见前文。

本报告会随上述 gate 和候选复验更新。先前 `rollback-responsive-work.md` 的原始结果仍保留，包括发布候选历史秒级停顿与受编译竞争影响的对照。
