# 技术架构说明（ARCHITECTURE）

> 版本 v1.0（迭代 1 引擎、迭代 2 前端 UI、迭代 3 单机 AI、迭代 4 存档/悔棋/阵型库、迭代 5 视听打磨、迭代 6 离线签名 APK 已落地）。本文为权威架构说明；与代码如有偏差以代码为准并回写本文。

---

## 1. 设计原则

1. **规则引擎与 UI 彻底解耦**：引擎是纯逻辑、无 DOM 依赖，可在 Node 下单测；UI 只负责绘制与命中测试。
2. **规则不硬编码**：所有可变规则收敛到 `defaultRules` 配置对象（见规则说明第 7 节）。
3. **棋盘几何冻结**：连通图在初始化时一次生成，运行期只读。
4. **信息隔离在引擎层**：视野过滤由引擎提供 `viewFor(side)`，UI 拿不到不该看的数据，避免"界面藏了但数据泄露"。
5. **状态可序列化**：整局状态是纯 JSON，天然支持存档、悔棋、回放、AI 自对弈。

## 2. 分层与模块

```
board.js  ── 棋盘静态几何：格位类型、铁路/公路邻接表（不随对局变化）
pieces.js ── 棋子定义、军衔表、军队生成、吃子结算（纯函数）
engine.js ── 对局状态机：初始化、走法生成、执行、胜负判定、视野过滤（核心）
ai.js     ── 走子决策：只消费 engine.viewFor(side) 的可见信息
ui.js     ── Canvas 绘制 + 像素→格位命中测试
app.js    ── 界面流程（首页 → 布阵 → 对局 → 结算）+ 事件绑定 + 存档
```

依赖方向单向：`app → ui / engine / ai → pieces / board`，禁止反向依赖。
模块通过 `window.Junqi`（Node 下 `globalThis.Junqi`）命名空间协作，同时 `module.exports` 便于测试。

## 3. 数据模型

### 3.1 棋子
```js
{
  id: "black-9-0",        // 唯一 id：阵营-军衔-序号
  side: "black",          // black | red
  kind: "commander",      // commander/general/.../engineer/mine/bomb/flag
  rank: 9,                // 军衔值；mine/bomb/flag 为 null
  revealed: false,        // 是否已对双方揭示
  alive: true,
  cell: 12                // 格位索引 r*5+c；阵亡为 null
}
```

### 3.2 对局状态
```js
{
  version: 1,
  mode: "flip" | "hidden",
  phase: "layout" | "playing" | "over",
  opponent: "ai" | "human",
  aiLevel: 1 | 2 | 3,
  rules: { ...defaultRules },
  turn: "black" | "red",
  board: Array(60),             // 每格 pieceId 或 null
  pieces: { [pieceId]: Piece },
  moveCount: 0,
  movesSinceBattle: 0,
  history: [ Move ],            // 供悔棋与回放
  lastMove: { from, to } | null,
  result: null | { winner, reason }   // reason: flag | nomove | draw | resign
}
```

### 3.3 走法与战斗结果
```js
Move  = { from, to, type: "move" | "flip", pieceId, battle: BattleResult | null }
Battle= { attacker: pieceId, defender: pieceId, outcome: "attackerDies" | "defenderDies" | "both" | "flagCaptured" }
```

## 4. 引擎 API（对外契约）

| 方法 | 说明 |
| --- | --- |
| `createGame(opts)` | 按玩法与规则创建对局；翻棋直接随机扣放，暗棋进入 `layout` 阶段 |
| `applyLayout(side, layout)` | 提交布阵，内部执行 L-1..L-6 校验，返回 `{ ok, errors[] }` |
| `randomLayout(side)` | 生成合法随机阵型 |
| `legalMoves(pieceId)` | 单枚棋子的合法落点列表 |
| `allLegalActions(side)` | 该方全部合法行动（翻棋含 flip 动作），AI 与"无合法行动"判定共用 |
| `applyAction(action)` | 执行行动，返回 `{ ok, move, battle, result }` |
| `undo()` | 回退一个 Move（悔棋 / 测试用） |
| `viewFor(side)` | 返回该方视角的脱敏状态（隐藏未揭示敌子的 kind/rank） |
| `serialize() / load(json)` | 存档与读档 |

**约定**：引擎绝不抛异常表达业务失败，全部通过返回值 `{ ok:false, reason }`；异常仅代表程序 bug。

## 5. AI 设计（迭代 3 落地）

| 难度 | 策略 |
| --- | --- |
| 简单 | 合法走法中随机，轻微偏好吃子 |
| 普通 | 一层评估：子力价值 + 吃子收益 + 位置权重（护旗、控铁路、占行营）+ 风险惩罚 |
| 困难 | 有限深度搜索（对未知信息做概率估计，Expectiminimax 或蒙特卡洛采样），带时间上限 |

硬性约束：AI 只能读 `viewFor(aiSide)`，代码层面禁止访问完整 `pieces`（迭代 3 增加单测断言）。
AI 计算放 `requestIdleCallback` / `setTimeout` 分片，避免阻塞主线程导致掉帧。

## 6. 渲染

- 单个 `<canvas>`，逻辑坐标系固定（如 500×1200），按 `devicePixelRatio` 与容器尺寸缩放，保证不同屏幕一致。
- 分层绘制顺序：棋盘底 → 铁路/公路线 → 行营/大本营标记 → 上一手标记 → 棋子 → 选中/落点高亮 → 提示层。
- 命中测试：像素 → 逻辑坐标 → 格位索引，单一入口函数 `hitTest(x, y)`。
- 重绘策略：状态变更驱动整帧重绘（棋盘元素少，无需局部脏矩形）；动画期间用 `requestAnimationFrame`。

## 7. 测试策略

| 层级 | 内容 | 工具 |
| --- | --- | --- |
| 单元测试 | 吃子表 12 组合、铁路/公路走法、工兵转弯、行营保护、大本营锁定、布阵校验、胜负判定 | `node:test` |
| 属性测试 | 随机对局 1000 局不抛异常、必然终局（夺旗/无路/判和） | 自写循环 |
| 视野测试 | `viewFor` 输出中不含未揭示敌子的 kind/rank | `node:test` |
| DOM 冒烟 | 无头 DOM 驱动完整对局（首页→布阵→对局→结算） | 轻量 DOM stub |
| 真机验收 | 安装 APK 完成两种玩法各一局 | 手工 |

## 8. 打包与发布

### 8.1 离线原生 WebView 方案（当前采用，迭代 6）
因本机 npm registry 不可达，标准 Capacitor + Gradle 路线无法离线进行。改用**原生 WebView 封装**：一个 `MainActivity` 用 `WebView` 加载 `file:///android_asset/www/index.html`，把整个 `www/` 作为 assets 打进 APK。逻辑全部复用既有 HTML5 引擎，零代码改写，确定可离线产出可安装、可签名的 APK。

构建链路（`android/build.sh`，纯用本地 Android SDK 工具链）：
1. python 生成启动图标 `res/drawable/ic_launcher.png`
2. `javac -cp $ANDROID_HOME/platforms/android-34/android.jar` 编译 `MainActivity.java`
3. `d8` 将 class 转 `classes.dex`
4. `aapt2 compile --dir res` + `aapt2 link -I android.jar`（产出含资源但无代码/ assets 的底座 APK）
5. 把 `assets/www`（整份 `www/`）与 `classes.dex` 注入底座 APK
6. `zipalign -p 4` 对齐
7. 首次 `keytool` 生成 `build/release.keystore`，随后 `apksigner` 以 v1/v2/v3 签名 → `build/junqi-release.apk`

关键 API 与约束：
- `WebSettings`：启用 JS、`DomStorageEnabled`（localStorage/存档依赖）、`allowFileAccess`。
- `WebViewClient.shouldOverrideUrlLoading` 仅放行 `file:///android_asset/` 本地资源，阻止外跳。
- `onKeyDown(BACK)` 在页内历史回退，避免误退出。
- `AndroidManifest`：包名 `com.junqi`、minSdk 21 / targetSdk 34、`screenOrientation=portrait`、LAUNCHER 入口 `exported=true`。
- **不申请网络权限**，纯离线。

### 8.2 标准 Capacitor 方案（联网环境备选）
1. `npm i @capacitor/core @capacitor/cli @capacitor/android`
2. `npx cap init` → `npx cap add android` → `npx cap sync`
3. **本机 Android SDK 已就绪**（来源：planet-pk 项目，路径 `/Users/brhon/android-sdk`）。包含 cmdline-tools/latest、platform-tools（adb/fastboot）、platforms android-34/android-36、build-tools 34.0.0/35.0.0、已接受全部 licenses。构建前只需 `export ANDROID_HOME=/Users/brhon/android-sdk`。
4. `cd android && ./gradlew assembleRelease`（或 `npx cap build android`）。Gradle 用 wrapper（gradle-8.14.3），无需全局安装。
5. **签名**：生成自有 keystore：`keytool -genkey -v -keystore ../junqi-release-key.keystore -alias junqi -keyalg RSA -keysize 2048 -validity 10000`，并在 `app/build.gradle` 的 release 块引用。keystore 不得入库。
6. 权限清单只保留必需项，**不申请网络权限**。

## 9. 目录规划

```
docs/            文档（当前唯一内容）
www/             index.html + css/ + js/（board/pieces/engine/ai/ui/app）
test/            engine.test.js / ai.test.js / integration.test.js / iteration4.test.js / smoke_dom.js
android/         原生 WebView 包装（app/ 源码 + build.sh）；build/ 由 .gitignore 忽略
package.json
```

## 10. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 棋盘连通性理解有误（规则说明 D-1/D-2） | 走法全错，返工大 | 迭代 1 先出连通图可视化自检页，与实体棋盘图逐条比对 |
| 暗棋信息泄露（DOM / 存档 / AI） | 玩法失效 | 视野过滤在引擎层 + 专门的视野单测 |
| AI 强度不足 | 单机可玩性差 | 分档实现，普通档先保证不送子，困难档独立迭代 |
| 本机 Android SDK | 已就绪（复用 planet-pk 的 `/Users/brhon/android-sdk`，含 android-34/36、build-tools 34/35、已接受 licenses、JDK 17） | 迭代 1–5 浏览器验证；迭代 6 直接打包，仅需补 release keystore |
| 规则争议（各地变体不同） | 反复改 | 全部走规则开关，不做二选一的硬编码 |
