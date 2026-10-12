# TH09 维护指南

## 职责与依赖

`th09_web/cpp/game/` 拥有本作游戏对象、固定逻辑步、菜单、Replay 和资源语义。平台适配提供渲染、输入、音频与文件访问。公共算法来自本作 `third_party/eagler-common` 的 Git 锁定；主项目根 common 更新不会自动改变这里的依赖。

游戏仓库只交付 Runtime。Web 页面、资源安装、房间界面和站点组装统一由主项目维护，不恢复旧 `launcher/` 副本。

## 构建输入与输出

实际入口是 `th09_web/scripts/build-sdl.mjs --release`。建议从主项目使用 `npm run runtime -- th09`，显式提供 Emscripten、Python、字体和资源；本地路径不提交到源码。普通构建及目录 Runtime 通过主项目登记的 build/package 链生成，打包核对实际文件清单。

项目默认 Runtime 输出位于 dist/runtime/th09/<variant>/。编译中间产物仍由本作脚本管理，最终受管目录以暂存、验证、切换的方式更新。

## 本轮验证

普通源码构建、目录 Runtime 打包与验证通过；产物仍声明 completeGame: false。

## 完成度与对战边界

Runtime 清单仍声明 `completeGame: false`。双场地、角色攻击、AI、菜单、Replay 等存在实现及开发对照工具，但本轮没有重跑其全部原版子系统比较，不能把过去的局部计数写成当前整作完成。

`th09_web/scripts/cpp/` 和 `th09_web/tests/` 保存诊断/测试入口。源码状态哈希、可运行测试场景与完整角色/模式验收分别记录。多人对战遵循花映塚自身规则，不套用其他作品的三人协作规则。

## 维护顺序

先复现问题并确定状态所有者，修改最小职责边界，再执行对应原生、Runtime 和浏览器验证。升级 common 时记录实际 gitlink 和影响的接口。跨作品抽取需核对实现、ABI 和消费者，不因文件同名就共用。

项目[能力进度](https://github.com/YomotsuHisami/eagler-touhou/blob/main/docs/TOUHOU_PROGRESS.md)区分实现、构建和实测。[输入与 Replay](https://github.com/YomotsuHisami/eagler-touhou/blob/main/docs/playbooks/input-replay.md)、[多人联机](https://github.com/YomotsuHisami/eagler-touhou/blob/main/docs/playbooks/multiplayer.md)说明进一步验证。

## 回归关注点

原生 Replay 的记录顺序、输入边界、对战双方状态和原版资源读取分别验证。旧源码包的部署说明、内嵌工具目录与站点发布器已退役；目录 Runtime 交给主项目组装。保留的局部 HTTP/原版诊断工具不属于正式站点发布入口。
