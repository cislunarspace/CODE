# 更新日志

> 自 4.8.3 起版本小节纯中文；GitHub Release 正文由对应小节生成。历史小节保持写成时的双语不动。

## 4.9.0 (2026-09-06)

### 功能

- **AI 会话以 omp 为基座（ADR 0030）**：助手边栏的会话、模型调用、思考过程与 agent loop 改由随应用分发的 omp（ACP 协议）承载——模型服务与 API key 由 omp 原生配置管理，应用不再保存 base URL/model/key（旧 assistant.json/assistant.key 只检测存在并提示迁移）；多会话历史由 omp 会话目录管理（应用侧不再维护会话 JSONL）；中断为真 ACP 取消（cancelled），废除"插入普通消息续跑"假中断；思考三档固定映射 omp 原生值（off/medium/high）。
- **工具桥接**：omp 经应用二进制的 MCP 桥接模式发现并调用 e2m2e 工具与宿主情景工具（scenario_write/scenario_list 语义不变）；只读白名单（catalog_query/catalog_get/scenario_list）免确认直跑，其余工具一律审批卡片（Approve/Deny）；审批协议不携带改后参数，改参入口随协议事实移除（参数全文展示供审阅）。
- **助手中文领域指令**：每轮 session/prompt 正文前置固定中文领域指令（角色边界、工具纪律、结果与引用规范，始终简体中文回答）；omp 回放的用户气泡在事件转换层剥离指令与画布选择信封，只显示原始消息。
- **界面固定简体中文（ADR 0031）**：删除中英语言切换与英文词典（顶栏切换按钮、tod-lang 持久化一并移除），`<html lang>` 恒为 zh-CN；工具卡片拒绝态随协议事实收敛为失败态（Deny 走 failed 终态并显示拒绝原因）。

### 工程

- 删除自建 LLM 客户端与协议适配（SSE 解析/provider 方言/系统提示组装/结果投影/会话存储，约 1200 行），新增 ACP 客户端 + MCP 桥接 + 事件转换层（acp/omp/bridge/events 四模块）；工具卡片进度条降级为耗时指示（omp 更新流不带分数制进度）。
- 发布流水线钉版分发 omp（资源 binaries/，不依赖用户预装）；开发构建走 TOD_OMP_BIN/PATH。scripts/smoke_omp_acp.py 为真实链路冒烟（握手/桥接/白名单/审批/取消/回放）。
- 评审修复：状态面（空态判定/路径展示/setup 按钮）改用启动时注册的 omp 命令（发布构建不再漏查资源目录）；tool_done 终态事件回填工具名（AI 产物登记的 recordId+tool 配对恢复完整）；会话缓存重放经 scratch 缓冲隔离（切走再切回不串台、不翻倍），切换失败时恢复原会话显示；omp setup 终端命令对含空格安装路径加引号；删除 wait_closed 死接口。
- 事件模型收敛：用户气泡与回放统一走 assistant-event 流（新增 user_message/reset），前端不再解析任何历史文件格式；回放（session/load）与实时流同一折叠路径。

## 4.8.3 (2026-09-04)

### 功能

- **项目树分组与过滤栏回显（#468）**：树按产物类型分组，分组头文字 + 计数徽标（空组徽标置灰），叶子第二行挂结构化摘要（成员序号 / 平动点 / Jacobi，缺字段不渲染），虚拟滚动受控展开，过滤栏过滤条件与仅星标状态显式回显。
- **会合视图显示感知修复（#469，ADR 0028）**：会合视图保留质心归一原点（"地球不在原点"是 CR3BP 规范约定的显示感知问题，不做地心化平移）；原点加地月质心圆环标记，天体显示尺寸按真实半径 ×3 放大。
- **deb/rpm 应用内更新（#471）**：deb/rpm 安装从"禁用更新、引导手动下载"改为应用内下载完整安装包并经系统包管理器安装；手动更新链路安全加固（下载 URL 白名单只认本仓 Release、版本解析与资产架构匹配校验）。
- **画布按需渲染修帧率（#472）**：画布只在数据、视图与设置变化时重绘，时间轴播放与动画导出逐帧推进，修交互帧率低。
- **轨道信息页签（#476）**：画布轨道清单点击联动详情，中栏设计工具 / 轨道信息并列页签；duration 提交单位改为秒（修"1 个月生成 1 点星历段"）；画布装配补回段角色。
- **惯性视图理想化几何（#477）**：惯性视图画理想化惯性几何与理想化圆月，候选 gcrs、state_frame 与受控星历前端接线。
- **内容切换聚焦按身份迁移（#479）**：切换绘制内容时聚焦行按身份（层对象 + 层内行号）决定去向，被裁段明确清除不静默丢。
- **采纳 e2m2e 5.9.4（#486）**：pin 升 >=5.9.4（上游 read_raw_frame 多维帧修复随 5.9.4）；catalog 五法与族生成改经 facade().catalog（e2m2e 接口类分家）；一轨一记录——族成员各自成记，family_id / member_index 贯通 Python 引擎、Rust 壳与前端，catalog_promote 调用面全删。

### 修复

- **栏折叠再展开把助手边栏顶出窗口（#462 回归）**：右栏 flex: 1 未设 min-width: 0，WebGL 画布的 px 内联宽度抬高 min-content 下限，折叠再展开后右栏窄不回去、助手边栏被永久推出窗外；现声明 minWidth: 0，宽度交回 flex 分配。
- **库记录的星历轨道画不出来、绘制内容切换无效**：get_artifact 通道的星历段 synodic_position 是 (3n,) 平铺而前端只认 (n,3) 嵌套，平铺一律静默丢弃；绘制所选装配结果层整体漏拼 roles（连带 jacobi、inertialGeometries）。现解析兼容两种形状、逐层拼齐行对齐数组。

### 工程

- **贡献流程（ADR 0029）**：CONTRIBUTING、五类 Issue 模板、type/kind/area 标签体系、与 e2m2e 共用的七态推进面板；AGENTS.md 立 issue / PR / 评论格式规约（含 AI 生成标识与 issue 创建入板方法）。
- **文档全面中文化**：README 撤销双语只留中文主文档；Sphinx 英文翻译（docs/source/locale/en 与英文站构建）撤销；CHANGELOG 自本版起版本小节纯中文。

## 4.8.2 (2026-09-01)

### 功能 / Features

- **画布轨迹拾取与图例联动（#452、#460）**：悬停画布轨迹或图例项即预览对应轨迹（其余淡出，预览级不锁定），点击聚焦、再点解除；聚焦态图例色样描边标记，画布与图例双向同步；拾取阈值随轨道包围盒自适应，数据替换时预览与聚焦清除。高亮用透明度而非线宽（WebGL 忽略 linewidth），不引 fat lines。
  **Canvas trajectory picking linked with the legend (#452, #460)**: hovering a trajectory or a legend item previews it (the rest dim, preview-only), clicking focuses, clicking again releases; the focused legend swatch carries a 1px outline and canvas/legend stay in sync; the pick threshold scales with the orbit bounding box; wholesale data replacement clears preview and focus. Highlighting works through opacity, not line width (WebGL ignores linewidth) — no fat-lines dependency.
- **AI 会话中断与续跑（#453、#461）**：回复生成中发送按钮变停止按钮，后端在最近安全点停下（流事件间、轮次边界、工具排队、确认等待）——已流出正文保留入历史、排队工具补占位结果保持 OpenAI tool_calls 成对契约、挂起确认卡按拒绝落定；中断界限落盘，重启后可回放；最后一个中断标记旁出「继续」按钮，以固定引导文本作为普通用户消息一键续跑（后端零改动，从旧断点续跑的歧义不提供）。
  **AI assistant interrupt and continue (#453, #461)**: while generating, the send button becomes a stop button and the backend stops at the nearest safe point (between stream events, at round boundaries, queued tools, or pending confirmations) — received text is kept in history, queued tools get placeholder results preserving the OpenAI tool_calls pairing, and a pending confirmation settles as rejected; the interrupt boundary is persisted and replayed after restart; a "continue" button beside the last interrupt marker sends a fixed guided text as an ordinary user message (zero backend change; continuing from older breakpoints is intentionally not offered).
- **栏宽拖拽与折叠（#454、#462）**：左栏（220–420px）与中栏（240–440px）右缘可拖拽调宽，实时跟手、松手持久化；两栏可各自折叠成全画布模式，原位置窄条一键还原，折叠态持久化、展开还原折叠前宽度；助手边栏拖宽逻辑收编为共享手柄，三处手感一致。折叠/展开均无过渡动画。
  **Pane resizing and collapse (#454, #462)**: the left (220–420px) and middle (240–440px) panes resize from their right edge with live tracking and persist on release; each pane can collapse into a full-canvas mode with a slim restore strip at its original spot; the collapsed state persists and expanding restores the pre-collapse width; the assistant sidebar's resize logic is folded into a shared handle for one consistent feel. No transition animations on either toggle.
- **动画导出增强（#455）**：导出前弹设置框选模式（视角自转/时间轴播放）与时长（2–30 秒，默认 8）；时间轴播放把时刻从量程起点匀速扫到终点，时刻标记与机动事件红点随时刻演进，录制中忽略用户时刻输入，结束恢复录制前时刻；量程不可用时时间轴模式禁用并注明原因。
  **Animation export enhancements (#455)**: exporting now opens a settings dialog for the mode (view spin / timeline playback) and duration (2–30 s, default 8); timeline playback sweeps the moment evenly from the range start to its end — time markers and maneuver-event pips evolve with the moment — ignoring user moment input while recording and restoring the pre-recording moment afterwards; the timeline mode is disabled with a reason when no range exists.
- **画布 PNG 静态图导出（#450）**：工具栏新增导出图片按钮，当前画布所见即所得存为 PNG 文件，直接贴进报告。
  **PNG still-image export (#450)**: the toolbar gains an export-image button that saves the current canvas as a PNG, ready for reports.

### 修复 / Fixes

- **深色模式助手边栏样式（#450）**：边栏、会话视图与工具卡片引用的 `--tod-*` 主题变量全仓库只有引用没有定义，深色模式下永远落到浅色 fallback；现由 App 根容器随主题注入整套变量（边框/面板/气泡/卡片底/代码底），浅色值即既有 fallback，浅色零回归。
  **Assistant sidebar styling in dark mode (#450)**: the `--tod-*` theme variables referenced by the sidebar, chat view and tool cards had no definition anywhere, so dark mode always rendered the light fallbacks; the app root now injects the full set per theme (border/panel/bubbles/card/code backgrounds) with light values equal to the old fallbacks — zero light-mode regression.
- **语言切换覆盖不全（#450）**：左栏页签、工具面板标题、执行按钮、画布工具栏、时间轴与图表设置弹窗的硬编码中文全部收进词典（中文文案逐字不变），并补词典 zh/en 键对齐守卫测试。
  **Incomplete language coverage (#450)**: hard-coded Chinese in the pane tabs, tool-panel title, run button, canvas toolbar, timeline and the chart-settings dialog now all live in the dictionary (Chinese strings unchanged verbatim), with a zh/en key-parity guard test added.
- **AI 会话交互修正（#450）**：发送命令异常时草稿回填输入框（不覆盖等待期的新输入）；流式回复仅贴底时自动跟随，上翻看历史不再被拽回底部；清空会话需确认；中文输入法选词回车不误发送的行为补回归测试钉住。
  **Chat interaction fixes (#450)**: a failed send restores the draft (never overwriting newer input); streaming no longer yanks scrolling users to the bottom — auto-follow only when stuck to the bottom; clearing a session asks for confirmation; the IME composition Enter behavior is pinned by a regression test.
- **计算错误提示可读（#450）**：工具执行失败的 toast 优先取错误的 message 字段，不再把整个错误对象 JSON 序列化甩给用户。
  **Readable computation errors (#450)**: failure toasts now prefer the error's message field instead of dumping the whole JSON-serialized object.

## 4.8.1 (2026-09-01)

### 功能 / Features

- **任务轨道设计参数面板补预置参数**：orbit_type 原为手填文本框，15 种轨道类型需手工准确输入大写英文（如 NRHO）才能联动分支参数，现改为预置下拉（中文标签，如「NRHO 近直线晕轨道」）；轨道族生成同步补上文档承诺的八族下拉。面板打开时除轨道类型分支默认值外，同时填入 schema 模型默认值——历元、输出步长、引力场阶数、修正方法、修正圈数等此前空白的公共字段直接显示内置默认，面板打开即可运行；转移设计（停泊轨道高度等）、轨道保持（蒙特卡洛样本数等）的带默认值字段一并显示。只补空位不覆盖已填值；duration 等由上游按轨道类型填充的空默认仍留白；分支键不注入没有 orbit_type 的工具，避免被 additionalProperties: false 拒收。
  **Preset parameters in the task-orbit-design panel**: orbit_type used to be a hand-typed text box — all 15 orbit types had to be typed exactly (e.g. NRHO) to trigger the per-type parameter branches; it is now a preset dropdown with Chinese labels. Family generation gains its documented eight-family dropdown as well. On open, the panel fills schema model defaults on top of the orbit-type branch defaults: epoch, output step, gravity-field degrees, correction method and revolutions — common fields that used to be blank now show their built-in values, so the tool runs out of the box; transfer design (parking altitude etc.) and station keeping (Monte-Carlo count etc.) benefit alike. Only empty slots are filled, entered values are never overwritten; null defaults such as duration stay blank for upstream per-type filling; the branch key is not injected into tools without orbit_type, which additionalProperties: false would reject.
- **星历轨道惯性几何上画布**：星历段 GCRS position_km 经 get_artifact 透传（行齐才携带，旧记录缺位降级灰显），÷DU_KM 归一沿 #428 inertialGeometries 通道随行——惯性视图下星历轨道以真实地心惯性几何绘制（豁免灰显、图例与标注切地心惯性、时刻标记沿惯性几何走查），会合视图行为不变。画布工具栏新增绘制内容切换（全部/CR3BP/星历）：双段并存的产物按段角色过滤，转移弧/预报/族成员等无段语义产物不受影响；图例「星历段（会合系）」改「星历段」，系归属由数据系标注表达；时刻标记缩小（0.015→0.006 DU，原为月球 3 倍余偏大）；图表设置弹窗双列栅格紧凑化（450→430px，高度约减半）。
  **Ephemeris orbits drawn with true inertial geometry**: the ephemeris segment's GCRS position_km now flows through get_artifact (carried only when rows align; legacy records degrade to grey), normalized by DU_KM along the #428 inertialGeometries channel — in the inertial view, ephemeris orbits are drawn in true Earth-centered inertial geometry (grey-out exemption, legend and annotations switch to GCRS, the time marker walks the inertial geometry); the synodic view is unchanged. The canvas toolbar gains a draw-content switch (all / CR3BP / ephemeris) that filters dual-segment records by segment role, leaving products without segment semantics (transfer arcs, propagation, family members) untouched; the legend item "星历段（会合系）" becomes "星历段" — frame attribution is expressed by the data-frame annotation; the time marker shrinks (0.015→0.006 DU, it used to be 3× the Moon); the chart-settings dialog grid is compacted (450→430px, roughly half the height).

### 工程 / Engineering

- **发布流水线提速 39→18.5 分钟，并新增演练入口**：RPM 载荷压缩 gzip-6 改 zstd-3（tauri 的 rpm 打包走单线程 gzip，~400MB 星历+sidecar 在 arm 上占 26 分钟、x64 上约 12 分钟，为全流水线关键路径；zstd 需 rpm ≥ 4.14，RHEL8+/Fedora 29+/openSUSE 15+ 均支持）；lint 与 test 并行（构建仍同时以两者为闸）；clone 深度收窄到 1；apt 加重试与超时。workflow_dispatch 演练入口让任意分支即可全链路构建验证，发布步骤仅在 tag 触发时执行。
  **Release pipeline 39 → 18.5 minutes, plus a rehearsal entry point**: RPM payload compression switches from gzip-6 to zstd-3 (tauri's rpm bundling used single-threaded gzip — ~400 MB of kernels plus sidecar took 26 minutes on arm and ~12 on x64, the critical path of the whole pipeline; zstd requires rpm ≥ 4.14, available on RHEL8+/Fedora 29+/openSUSE 15+); lint and test run in parallel (builds still gate on both); clone depth narrowed to 1; apt gains retries and timeouts. A workflow_dispatch entry lets any branch rehearse the full build chain; publishing steps run only on tag pushes.

## 4.8.0 (2026-08-31)

### 功能

- **发布多平台安装包**：Linux 增加 arm64（原生 arm runner 现场构建 sidecar 与 AppImage/deb/rpm，PyInstaller 不支持交叉编译）与 rpm 格式；Windows 增加 MSI 安装包（更新通道仍走 NSIS 瘦身包）。发布流水线对齐 altgo/freetex 的闸口设计：打 tag 先校验四处版本（pyproject/Cargo/tauri.conf/frontend）与 CHANGELOG 小节一致；Release 正文改由 CHANGELOG 对应小节生成；收尾作业核对各平台产物数量、生成 `checksums.txt`、合成含 windows-x86_64 与 linux-x86_64/linux-aarch64 三平台的 `latest.json`。Windows 不发 arm64：sidecar 的原生依赖（e2m2e/spiceypy/calcephpy）均无 win_arm64 轮子。

## 4.7.0 (2026-08-31)

### 功能

- **增量更新——应用内更新不再重下星历（瘦身更新通道）**：全量安装包 255MB 中 171MB 是基本不变的 SPICE 星历（de430.bsp 等随包 kernels/），每次更新重下是纯浪费。发布流水线每平台增建瘦身包（不含 kernels/，约省 170MB，资产名 `*-setup-slim` / `*-slim.AppImage`），`latest.json` 更新通道指向瘦身包；全量包仅供新装用户，命名不变。NSIS 覆盖安装不动既有文件，装机端星历原地复用。注意：星历自身刷新（如时敏的 earth_latest_high_prec.bpc）不随应用内更新下发，需手动跑一次全量包。
- **更新弹窗显示下载大小与速度**：updater 的 Started/Progress 事件本就携带 contentLength/chunkLength，此前只显示百分比。现增显示「已下载 x / 总量（速度）」，速度用指数移动平均平滑避免跳变；服务器未给总量时退化为只显示已下载。

### 修复

- **应用内更新自 4.6.0 起静默失败（更新签名链断裂）**：v2 迁移时 `bundle.createUpdaterArtifacts` 未开（schema 默认 false），`.sig` 从未生成，`latest.json` 签名字段一直为空，应用内更新验签必败。修复：开启该开关；发布流水线三处签名闸（.sig 缺失或签名为空即红）；轮换 updater 密钥对（旧私钥已丢失，新公钥 95D18C2B 随包分发，dev 配置同步补齐）。存量 4.6.0/4.6.1 需手动安装一次新版以携带新公钥，此后应用内更新恢复可用。

## 4.6.1 (2026-08-31)

### 修复

- **语言切换按钮失效（#447）**：`useTranslation()` 在每个调用组件内各自持有独立的 `lang` state，顶栏切换只改所在组件，其余已挂载区域（项目树、参数面板、助手边栏等）钉死旧语言。改为应用根部挂 `I18nProvider` 共享语言状态（localStorage 持久化与 `<html lang>` 同步副作用随迁）；`useTranslation()` 返回形状不变，约 11 个调用方零改动。
- **安装版 design_orbit 报 "No ephemeris files are opened"（sidecar 打包漏收 R2S2 包数据）**：PyInstaller spec 只收集 e2m2e 的 data 文件，R2S2 轮子自带的月球精密星历 lte440.bsp/lte440.tpc 未进包；design_orbit 等星历链路工具懒加载 R2S2 时在模块导入期 CalcephBin.open 打不到文件而全数失败（报错文案来自 CALCEPH，与 SPICE 内核无关，SPICE_KERNEL_DIR 配置无涉）；轨道库查询等纯 CR3BP 链路不触发该 import，故仅星历类工具异常。修复：spec 补 collect_data_files("R2S2")；发布流水线（Windows/Linux）在 sidecar 构建后新增真调用冒烟（scripts/smoke_mcp_serve.py 参数化），拦截坏包。

### 文档

- **README 主语言反转为英文（#446）**：对齐 e2m2e 惯例，`README.md` 改为英文主文档，中文版固定命名 `README.zh-CN.md`（原 `README.en.md` 退役）；两个版本顶部语言切换行同步改写（粗体标当前语言）。Sphinx 中文叙事页的 README include 改指 `README.zh-CN.md`，英文 `.po` 同步更新切换行与 `docs/development.md` 多语言 README 命名约定。两版本正文内容不变。

## 4.6.0 (2026-08-31)

### 功能

- **惯性视图第一步——视图系切换贯通（#428，PR #442）**：画布新增「会合系/惯性 (GCRS)」视图系切换，整屏一致：惯性下地球居原点、月球经 spacetime_transform 取 SPICE 真实月历随时间轴移动，会合系数据系产物（族成员等）灰显＋图例注记，平动点/分区图层/月心与 L1/L2 居中隐藏或禁用；切换不改 et 时刻、播放状态与任何数据（正交性测试保障）。
- **情景 v1——序列化格式与回放（#429，PR #442）**：情景 = 固定层记录集（catalog record_id 引用）＋参考历元（et 或 UTC，et 为唯一绝对基准）＋播放配置（速率/循环/起点偏移）的可交换 JSON 文件（`tod-scenario` v1，未知版本拒绝加载）；工具栏保存（仅 et 钟模式且固定层非空）/打开（逐引用重建固定层，缺失跳过列出、超上限截断，时间轴校准到参考历元）；时间轴播放配置化（速率档位＋循环开关）。
- **转移弧惯性视图 gcrs 段（#428 第二步）**：e2m2e 5.9.1 的 trajectory_gcrs_km 惯性段随主几何同行携带，惯性视图下转移弧（HMN/LGA/WSB）以真实地心惯性几何绘制（线、时刻标记、视图适配同源切换），会合视图逐项不变；gcrs 缺位（low_thrust/零结果/旧记录）降级灰显＋注记；转移记录的 transfer/ 段经 get_artifact 新增转移段通道解析（修复旧记录 km 值不归一误画与 eph 段帧配对错位——serde_json 开 preserve_order 保留 sidecar 契约的占位键序）。
- **top-N 可行解多解同屏（#430）**：transfer_design 开启 top_n 后非选中候选入候选会话层随固定层同屏对比（受固定层上限约束，超限截断提示；无轨迹候选不上画布仅面板列参数）；详情面板「可行解对比」并列各候选 Δv/TLI/TOF 与选中/精化口径；时间轴为每个候选加 TLI 时刻 chip；恰一候选退化为单解现状。
- **AI 助手宿主内置情景工具（#444，ADR 0027）**：助手工具来源从仅 MCP 扩为 MCP＋宿主内置——scenario_write（结构化参数按 v1 规则序列化写情景固定目录，同名覆盖，走确认链）/scenario_list（列情景目录全文，进只读白名单免确认）；修改情景 = 读原文＋整体重写；完成卡新增「应用情景」按钮，按路径直读并复用手动打开的解析/软失败路径；手动「打开情景」对话框默认定位情景目录；系统提示同步工具规则。

### 其他

- **依赖 e2m2e 升至 ≥5.9.1（#428/#430/#444）**：top-N 可行解契约（e2m2e#597）、转移弧 gcrs_km 段（e2m2e#591）；toolSchemas 重导出（transfer_design 增 top_n）。
- **结果层/固定层双层画布与 et 两级时刻基准（#427）**：画布内容分结果层（当前计算产物，随计算替换）与固定层（项目树钉住的库记录，5 条上限＋色环图例）双层模型；轨迹位置按「et 秒 / 历元 UTC」两级时刻基准解析；修复轨道预报 GCRS 惯性 km 被按会合无量纲误画（#421，÷DU_KM＋et 基准）；时间轴新增 Δv 事件 chip。
- **地月空间分区图层（#432）**：e2m2e `spatiography_boundaries` 工具（Rosengren et al. 2026 Primer §5 五省分区）返回的边界几何——地心 Laplace 半径、地球/月球 SOI 与 Hill 圆族、Battin 非对称闭合曲线、Chebotarev 圆、L3–L5 平动点标记——经 km→DU 归一后作为固定参照层上画布，不参与取景适配；图表设置新增分区图层开关（持久化）。
- **画布图例标注各轨迹数据系（#431 余项）**：结果层/固定层每条图例项附带数据系标签（CONTEXT.md「数据系」措辞：会合系无量纲 / 会合系物理 km / 地心惯性 km），与视图系（用户显示选择）相区分；标签随轨迹解析层逐条携带（CR3BP 段＝会合系无量纲、转移弧＝会合系物理 km、预报弧＝地心惯性 km、星历段＝会合系无量纲），中英同步。

- **依赖 e2m2e 升至 ≥5.9.0（#431）**：最低版本覆盖 state_frame 数据系标注（5.8.10，e2m2e#572）与地月空间分区解析三工具（5.9.0，e2m2e#577）。`toolSchemas/` 全量重导出校准：`transfer_design` 补齐 low_thrust 参数（engine_config/initial_mass 等）与目标星历坐标系契约描述，`catalog_query` 增转移记录过滤器（transfer_type/tli_epoch），`spacetime_transform` 的 times 字段改为双单位契约描述，新增 `spatiography_classify`/`spatiography_scales`；助手摘要层同步转移契约——`trajectory_times` 大数组与 `trajectory` 同规则省略，`state_frame` 标注小字段透传进上下文供模型解读数据系。

## 4.5.0 (2026-08-30)

### 功能

- **AI 助手（LLM+MCP，ADR 0022/0023）**：新增右侧可折叠、可拖宽的助手边栏。模型服务走 BYOK——设置面板"AI 助手"分区填入 OpenAI 兼容协议的 base URL、模型名与 API key（云端 DeepSeek/通义/Kimi 或本地 Ollama/LM Studio 一套协议覆盖），key 只存系统凭据管理器、不进界面 JS 上下文。后端 agent loop 经标准 MCP 拉起独立的 `mcp-serve` 进程调用 e2m2e 工具，与画布计算的 `serve-stdio` 链路互不阻塞。工具调用分级确认：只读查询（catalog_query/catalog_get）免确认直接执行，计算与改库工具先出"工具卡片"待用户确认/编辑参数/拒绝。回复以 markdown 流式呈现；轨迹等大数据不进上下文，只带 record_id 与诊断摘要，产物经工具卡片"查看产物"自动入项目树并上画布（与手动运行同语义）。已知限制：mcp-serve 不转发进度事件（长计算显示不定态指示）且不支持取消（上游 e2m2e 后续跟进）。
- **严肃视觉语言做实（ADR 0020 增补）**：首版仅圆角与主色两组 token，观感与 antd 默认无差别；补齐四项深定制——`motion: false` 关全部过渡动画、`wireframe` 平面化去渐变 + 一层浅投影、控件高度 32/24/40 收紧到 26/22/30、Segoe UI/雅黑系统字体栈。
- **转移设计结果轨迹上画布（#420）**：`transfer_design` 计算完成后的转移轨迹按 e2m2e ADR 0040 契约（会合系质心原点物理 km/km/s、TLI 起算秒）解析，位置 ÷DU_KM 归一后叠加到画布，`trajectory_times` 接时间轴走查；HMN 转移为两体几何的相位对齐显示约定。
- **转移设计 LGA/WSB 目标注入与类型联动（#422）**：参数面板按 transfer_type 联动显隐（HMN 显目标地心半径，默认 384400 km 环月演示）；LGA/WSB 提交时自动取选中轨道工件的 CR3BP 状态末行换算到会合系物理单位注入 target_ephemeris（e2m2e#516 坐标系契约），未选中工件时拦截提交并提示；LGA 无显式搜索参数时默认注入加密相位网格（360 点）。
- **轨道库多选绘制与记录备注（#419）**：项目树支持多选库记录同屏绘制，记录可写备注、加星标。（详见 #419，本条为随版收录。）

### 其他

- **依赖 e2m2e 升至 ≥5.8.9**：transfer_design 下发 `trajectory`/`trajectory_times`（ADR 0040 转移轨迹契约）的最低版本，GUI 画转移轨迹所必需。

## 4.4.0 (2026-08-25)

### 功能

- **严肃视觉语言（ADR 0020，#409）**：全局圆角收至 2px 直角，主色从亮蓝收敛为深蓝，界面用色限定黑/白/灰/红/蓝/绿/橙七色语义色板（红=错误、绿=成功、橙=警告、蓝=主色/信息）；主题 token 抽到独立模块可单独验证。
- **画布工具栏归拢（#410）**：原分居画布两角的悬浮层（投影/中心选择 + 适配/导出动画/图表设置）合并为一条停靠在画布上方的工具栏，操作集中且不再遮挡 L1/L2 平动点标记。
- **参数提交防呆（#411）**：执行前前置校验必填与数值范围（含独占边界），问题一次列全并在参数面板内联标红，不通过不提交；执行按钮保持可点击，改参数即清标红。
- **时间轴真实数据驱动（#412）**：轨迹解析同源产出时刻数组（period 均匀合成 / epochs / 行序兕底），计算完成或加载记录后时间轴立即可用，播放/拖动驱动画布上的时刻标记沿轨迹走查；无时刻数据时诚实禁用。

### 修复

- **关于弹窗版本号硬编码**：AboutModal 版本号从 4.2.0 起一直显示 v4.1.2（#403 引入时的默认值，App 从未传入真实值），导致"装了新版仍显示旧版"的误判；改为从 Tauri 运行时 `getVersion()` 取真实版本，prop 保留为测试注入口。

## 4.3.0 (2026-08-25)

### 功能

- **matplotlib 科研风画布与 NASA 真实地月贴图（#407）**：地月改用 Blue Marble / LROC 公有领域贴图 + Phong 光照与晨昏线，天体半径取真实比例；轨道色循环换 seaborn muted 低饱和配色，背景中性灰。
- **坐标轴图层（#406）**：XYZ 三轴箭头 + 轴名标注 + 轨道面网格与 0.5 DU 刻度数字，图表设置可开关；量程（网格半宽）0.5–3.0 DU 可调。
- **居中与视图控制（#406/#407）**：居中选项改为直列按钮组并新增地心；3D 旋转方向对齐旧 PyQt 画布拖拽习惯（场景跟随光标）；画布背景可调（跟随主题/白/深灰/黑），网格与标注颜色随背景亮度自适应；UI 默认白底黑字日间主题，夜间模式保留。
- **星历自动配置（#407）**：SPICE 内核（含 de440s/de430 行星历）随 git（Git LFS）与安装包分发，应用启动自动设 SPICE_KERNEL_DIR，免下载引导零配置；设置面板显示内核就绪状态。

### 修复

- **画布渲染层系列 bug（#406）**：修复场景无限重建导致的轨道丢失、天体堆原点并平移场景、视图适配混入标注、中心切换被重新适配抵消（无法切回质心视角）四个连环 bug。
- **关闭应用后 sidecar 进程残留（ADR 0019，#408）**：计算中途关窗后 e2m2e 进程留在后台继续运行。Windows 上把 sidecar 子树划入 kill-on-close Job Object，应用无论怎么退出（关窗、崩溃、被杀、更新重启）都由内核终结整棵树，覆盖 dev（uv→python）与分发（onefile bootloader→python）两种形态。
- **Windows 构建告警（#407）**：lib 更名 `transfer_orbit_design_lib`，消除 bin/lib 在 MSVC 工具链下 PDB 文件名归一化互撞的输出冲突。

## 4.2.0 (2026-08-24)

### 功能

- **桌面端自动更新（#403, #404）**：接入 Tauri Updater，应用内检查并安装新版本。

### 修复

- **画布轨迹解析与积分渲染（#405）**：修复轨道生成与库记录加载时的轨迹解析，消除整除歧义与缺 period 时的单点轨迹。
- **README 开发环境命令**：`cargo tauri dev` 改为 `npx --prefix frontend tauri dev`，无需全局安装 cargo-tauri。

### 其他

- **应用产物改名**：`tod` → `transfer-orbit-design`，安装包、应用 ID（`com.cislunarspace.transfer-orbit-design`）、sidecar 与打包链路同步更新。

## 4.1.2 (2026-08-24)

### 修复

- **Linux AppImage 全局卡顿修复**：在 Linux 入口默认设置 `WEBKIT_DISABLE_DMABUF_RENDERER=1`，规避 WebKitGTK 2.40+ 在 Linux（NVIDIA/Wayland/Mesa）下的硬件加速合成器驱动冲突，恢复流畅交互。

## 4.1.1 (2026-08-24)

### 打包与分发

- **Linux 直接运行版本与安装包（ADR 0017）**：新增 Linux 平台自动化打包，提供 **AppImage**（免安装单文件直接运行）与 **.deb**（Debian/Ubuntu 系统安装包）；CI 发布工作流接入 `build-linux` 任务，产物直传 GitHub Release。

## 4.1.0 (2026-08-24)

### 功能

- **GUI 功能补齐与 Ant Design 美化（#401, #402）**：补齐 PyQt 遗留功能与参数体系，全面接入 Ant Design 紧凑主题。新增轨道库多维过滤栏（CatalogFilterBar）、参数覆盖映射机制（paramOverlay）、产物记录详情面板（RecordDetailPanel）、轨道保持配置模态框（StationKeepingModal）、时间轴播放控制栏（TimelineBar）以及项目树上下文操作。

### 文档

- **标点与规范清理（#400）**：清理文档中的破折号、引号与直角引号。
- **现状校准**：对照 v4 架构与能力范围修正架构文档、轨道族分类、快速上手与内核指南中的过时描述。

## 4.0.1 (2026-08-22)

### 功能

- **通用工具执行通道（#399）**：工具面板接入全部七个工具：轨道族生成、任务轨道设计、轨道保持、轨道预报、转移轨道设计、轨道稳定性、时空坐标转换。参数表单由各工具的 JSON Schema 自动生成，经 Rust `run_tool` 命令直达 sidecar；工具结果轨迹按返回结构自适应渲染（JSON 数组或二进制帧），无需逐工具写画布代码。

### 修复

- **`cargo tauri dev` 启动失败**：`beforeDevCommand` 工作目录已在 `frontend/`，命令里的 `--prefix frontend` 造成双重前缀（`frontend/frontend/package.json` 不存在）。dev/build 两条命令同步修正。
- **release 安装器不经 artifact 中转，直传 GitHub Release**（随 v4.0.0 后修复 CI）。

### 文档

- README 中英双语同步更新：删除已过时的尚未接线段落，SPICE 内核需求按工具区分。

## 4.0.0 (2026-08-22)

### GUI 架构切换：PyQt → Tauri（ADR-0014，#397）

- **不可逆切换**：v4.0.0 起唯一 GUI 是 Tauri 2 桌面应用：Rust 壳承担进程编排与落盘，React/TypeScript 前端承担全部控件，e2m2e 以 sidecar 子进程运行（stdin/stdout JSON 行 + 二进制帧协议，e2m2e ADR 0035）。旧 PyQt UI（src/view、src/app，约 1.2 万行）整体删除；Python 侧保留纯领域资产（src/engine、src/commons、src/model）。
- **本版界面能力范围**：轨道族生成（Halo/NRHO/Axial/Lissajous/SPO/LPO/Horseshoe/DRO，JSON Schema 自动表单 + 进度条）、轨道库浏览（多维过滤、选中联动画布）、Three.js 画布（视图适配与保持、地月与平动点标注）、i18n 中英切换、图表设置持久化、webm 动画导出。v3.2.3 已发布的其余工具界面（轨道设计、轨道保持、轨道预报、转移设计、时间轴等）尚未在新 UI 接线，14 个工具 schema 已全部导出待逐工具回归，需要这些工具的用户请继续使用 v3.2.3。
- **打包分发**：Windows 产物改为 NSIS 安装器（currentUser 模式免管理员）；e2m2e 运行时经 PyInstaller 打包为 tod-sidecar 单文件随安装器分发；SPICE 小内核（.bpc/.tls/.tpc/.tf）随包，星历 .bsp 内核沿用下载脚本按需获取（同 v3.2.3 口径）。旧 pyinstaller GUI 打包链（TransferOrbitDesign.spec）随 PyQt UI 退役。
- **sidecar 崩溃自愈**：坏帧不再 panic，请求中崩溃、空闲期崩溃两种时序均自动重拉 sidecar 并重试一次，连续失败才上抛（评审阻塞项修复，附集成测试）。
- **依赖**：e2m2e ≥5.8.5 必需（#522 serve-stdio 修复、#525/#526 族成员 period/mu 与 catalog_get 帧映射）；主版本号因 GUI 框架不可逆切换与界面能力范围变化而升。

### 3.2.3 之后的引擎层增强（随本版发布）

- **转移轨道设计（#394）**：FacadeBridge 接入 HMN/LGA 两类转移；目标态会合系物理单位换算、TLI 历元转 ISO、LGA 注入 360 点加密相位网格（默认 50 点漏可行窗口）；结果落 output/transfer/ 并入项目分区。
- **轨道预报桥接（#389/#392）**：orbit_propagation 经 Facade 调用；GCRS 星历走四槽位画布契约，会合系位置经 SynodicJ2000System 批量转换；星历落 JSON 到 output/propagation/ 经 discovery 恢复。
- **轨道库 catalog（#375/#376）**：产物自动入库与多维过滤、谱系指针（input_record_id / source_record_id）持久化；design_orbit / control_orbit 切回 Facade 门面，persistence.py 手写落盘退役。
- **DRO 轨道族（#383/#384/#385）**：月心族不绑平动点，FamilyResultData.liberation_point 改可空，成员参数无平动点时不再 KeyError。
- **族生成契约泛化（e2m2e 5.7.1 适配）**：FamilyResultData 增加 family_type / periodicity / member_parameters / status_message；周期族成员按周期重采样供画布渲染；e2m2e.api.OrbitError 在 Facade 接缝透传错误码与消息。
- **e2m2e 升级链**：5.7.1 七族统一族生成 → 5.7.3 NRHO 默认路径收敛（恢复完整设计路径）→ 5.8.0 轨道库 catalog → 5.8.1 DPO 自动重定向 segmented（默认场景收敛）→ 5.8.2 DRO 与 Axial 默认收敛恢复 → 5.8.5 sidecar 契约。

## 3.2.3 (2026-08-14)

### 修复

- **短弧轨道保持默认值**：GUI 轨道保持面板改用 0.25 天控制间隔与 0.125 天反馈弧，覆盖 120 次控制约 29.6 天；此前沿用上游多年星历的 30 天/28 天默认值，用户设计 Halo 短弧后直接运行必被覆盖校验拦截。上游算法默认值保持不变，较长任务仍可在面板调整。
- **防止默认 Lissajous 轨道发散**：e2m2e 5.6.9 仅对 Halo/NRHO 自动改走 segmented 分段修正，Lissajous 沿用 standard/two_level 时，一圈修正后的自由外推沿不稳定流形发散，标称星历整段越飘越远。GUI 不暴露 segmented 选项，桥接层对 Lissajous 固定注入 segmented，保持整段星历有界；附默认 Lissajous 星历有界回归测试，工具文档同步说明。
- **窗口取消最大化后无法再次全屏**：画布工具栏所有控件单行排列，Qt 把累积最小宽度（2029 px）传播给主窗口，窄屏下布局约束无法满足，窗口有响应但不能恢复最大化。改为多行 QGridLayout 后最小宽度降至 936 px（回归测试锁定 ≤960 px），启动入口改 `showMaximized()` 默认最大化。

### 功能

- **轨道保持识别、停止与图例**：选中 Halo/NRHO 后，特征点模式自动设为 ẋ=0 且 ż=0；运行区新增停止按钮，当前数值调用返回后丢弃已取消结果；画布各视图自动显示轨道、初猜与星历的图例。

### e2m2e 5.6.9 适配

- **升级依赖**：最低版本升为 `e2m2e>=5.6.9`，`uv.lock` 同步。获得 Halo/NRHO 长弧段分段打靶与 Rust 并行修复（#404），以及 FiniteBurn 恒质量 Rust 传播（#420）。
- **轨道设计参数收口**：移除上游已删除的 `correction_velocity_tolerance`；修正方法下拉移除已不存在的 `homotopy`，保留公开契约中的 `standard` / `two_level`，Halo/NRHO 继续自动使用 `segmented`。旧 `UnsupportedCorrectorMethodError` 类型随上游 `ephemeris_correction` 包删除，非法修正方法统一按 `INVALID_PARAMS` 翻译。
- **轨道族接入公开契约**：删本地 `FamilyGenerationRequest`，改用上游模型的平动点与折叠点振幅校验；桥接层委托 `design_halo_family`。GUI 保持 Halo 北族入口，隐藏模型中的族类型字段并在调用时固定注入 `HALO`。
- **轨道保持面板对齐模型**：`control_interval` / `feedback_arc` 改由 `ControlOrbitRequest` 自动生成；新增的控制迭代、测定轨与推力误差、真实力模型字段补齐中文标签，分入控制、仿真与误差、力模型、角动量管理四组。
- **工具状态派生**：`TOOL_REGISTRY` 改从 `tool_inventory()` 读取 facade 工具状态，灰显工具不再维护已实现/占位的本地判断。

### 功能（右边栏更新）

- **参数分组与工具说明**：参数面板按组展示（轨道设计：形状/传播/修正参数；轨道保持：控制/仿真与误差/角动量管理；族生成：族参数），组表头 + 分隔线，轨道类型切换时整组隐藏；工具选择器下方新增工具说明（`ToolSpec.description`）；运行按钮旁新增重置参数按钮（重建面板恢复默认值）。
- **整数枚举改下拉**：`collinear_point`（L1/L2/L3）、`north_south`（北族/南族）、`control_mode`（1-6 带角动量管理语义）、`is_nrho`、`special_mode`、`libration_point` 由裸 spinbox 改为带中文标签的 QComboBox（值存 itemData，收集按数据取值）。
- **范围占位提示**：数值控件框内文本清空时显示约束范围（placeholder），tooltip 附描述+范围；切单位后提示同步刷新。全约束显示 min~max，单侧 `gt/lt` 显示 >/<，无约束字段如实显示无范围约束（不拿 Qt 兜底值冒充）。JSON 文本框（perturbation/dyb/engine_layout）为空时给格式示例提示。模型缺上界的 int 字段（num_controls/num_monte_carlo）用 GUI 临时上界兜底并注明。
- **单位换算全覆盖**：所有可换算参数都提供国际单位与归一化单位切换：距离 km/m/DU（amplitude/amplitude_in/amplitude_out/perilune_height/semi_major_axis/max_amplitude_km）、相位 周期份额/度/弧度、角度 度/rad、时间 duration 年/月/日/时/秒/TU、output_step 秒/时/日/TU、control_interval/feedback_arc/momentum_interval 天/秒/TU、srp_offset_m 列表容器 m/DU；5.6.9 起 control_interval/feedback_arc 由模型自动生成并按显示单位换算。多次切单位精确往返（换算缓存，30 天→TU→秒→天无舍入漂移）。
- **facade 工具清单对齐**：`TOOL_REGISTRY` 从 `e2m2e.api.Facade.mcp_tools()` 自动派生全量清单：已接入的轨道设计/轨道保持/轨道族生成 enabled，e2m2e 已实现但 GUI 未接入的（转移设计/轨道预报/时空坐标转换）与 e2m2e 占位的（转移搜索/小推力设计/不变流形分析/低能转移/相对运动）灰显并附工具说明；e2m2e 新增工具时清单零改动跟随。稳定性分析保持右键入口（下拉灰显）。
- **新增轨道类型**：轨道设计支持 e2m2e 5.6.8 全部周期轨道类型，新增 DPO、Axial、L4_SPO、L5_SPO、L4_LPO、L5_LPO、L4_HORSESHOE、L5_HORSESHOE（默认值对齐 `DesignOrbitRequest` model_validator）。
- **补全字段标签与 JSON 接口**：perturbation/dyb/earth_degree/moon_degree/correction_revolutions 与轨道保持字段全部换中文标签（此前裸显字段名）。`engine_layout` 的有效 JSON 文本现会解析为 `EngineLayout`，角动量管理模式 4-6 可实际使用；非法 JSON 与非布局 JSON 均给出 `INVALID_PARAMS` 明确错误。

### 工程

- **CI/release 一致性与效率**：PR CI 补全 headless GUI 测试，不再等到发布 tag 才首次执行；静态检查、测试、文档和 Windows 打包均改用 `uv.lock` 的冻结安装，避免 `pip` 和临时 PyInstaller 版本漂移；静态检查跳过本项目安装，docs/release 取消无用的 e2m2e 源码 clone。runner 固定为 Ubuntu 24.04 / Windows 2025，uv 缓存按 `uv.lock` 失效，checkout 不保留凭据；发布 token 收敛到创建 GitHub Release 的 job，Windows 产物缺失会立即失败。PyInstaller 构建组纳入锁文件，并移除 e2m2e 5.6.8 已删除的 `tools.viz` hidden import。

### 上游问题跟踪

- 向 e2m2e 提交 5 条 issue（右边栏无法在本仓解决的问题）：#408（ControlOrbitRequest 是算法层签名子集且缺约束/单位说明）、#409（DesignOrbitRequest 分支范围不可机器读取）、#410（correction_velocity_tolerance 死参数）、#411（orbit_family_generation 无 Request 模型）、#412（facade 工具清单状态不可机器读取）。

## 3.2.2 (2026-08-13)

适配 e2m2e 5.6.8：上游修复 segmented 逐段积分的位置-时间错位（#398）。`ForceModel._prepare_t_eval` 会在 `t_eval` 末尾自动追加段终点，逐段积分把每段多出的端点状态拼进星历，位置数组比时间网格多出段数个点，`batch_j2000_to_synodic` 按索引配对，错位逐段累积，会合系曲线一圈一圈偏离 Halo 轨道（GUI 观感慢慢发散）。同版为 GUI 补上 SPICE 内核引导（首次启动探测不到内核自动弹窗，可一键下载或指定已有目录），并修复轨道保持三处可用性问题（mu 透传崩溃、engine_layout 字符串崩溃、仿真时长超出星历覆盖致全样本失败）。

### 功能

- **启动时内核缺失引导（#366）**：`main()` 启动时探测可用内核目录（`$SPICE_KERNEL_DIR` → 配置记录 → 仓库 `kernels/` → 用户数据目录 → 同级 e2m2e 源码仓库），缺失则弹窗三选一：
  - **下载内核**：后台线程从 e2m2e `kernels-v1` release 下载到用户数据目录（`~/.local/share/transfer-orbit-design/kernels`，Windows 为 `%LOCALAPPDATA%`，跨版本共享），模态进度条显示逐文件进度，可取消（已下载文件保留，重试幂等续传）；
  - **指定已有目录**：文件选择对话框选目录，校验含行星历 `.bsp` 与闰秒 `.tls` 后写入配置文件（`~/.config/transfer-orbit-design/kernels_dir.txt`），下次启动自动探测；
  - **暂时跳过**：本次不准备，功能用时再报错。
- **下载逻辑抽为 `src/commons/kernels.py`**：`download_kernels`（幂等 + 进度回调）、`kernel_dir_usable`（行星历 `.bsp` + 闰秒 `.tls` 完整性判断）、`user_kernel_dir`；`scripts/download_kernels.py` 改为其 CLI 包装（命令行行为不变）。

### 修复

- **轨道保持 mu 透传崩溃**：参数面板按 `ControlOrbitRequest` 字段收集 `mu`（e2m2e 的响应透传字段，画地月标注用，算法函数签名无此参数），facade 以 `**params` 展开调用 `control_orbit()` 直接 `TypeError`（GUI 报 UNKNOWN_ERROR，轨道保持完全不可用）。修复：面板隐藏 mu（与 `input_ephemeris` 同构，由源 Artifact 注入 `source_mu`），facade 接缝处 `pop(mu)` 防回归。新增 3 项测试（面板不含 mu、params 不含 mu、算法层收不到 mu）。
- **轨道保持 engine_layout 字符串崩溃**：面板把 `engine_layout` 建成 JSON 文本框（Any 字段），用户随手填 4，e2m2e 对非 None 布局无条件 `validate`（访问 `.E_r`），字符串直接 `AttributeError`（GUI 报 UNKNOWN_ERROR）。修复：facade 规范化，`control_mode < 4`（无角动量管理）时忽略置 None；`>= 4` 时 dict 构造 `EngineLayout` 实例、空串归一 None（走 e2m2e 清晰报错）、其余值报 INVALID_PARAMS 明确提示输入格式。新增 3 项测试（低模式忽略、dict 构造实例、无效值清晰报错）。
- **轨道保持全样本失败（仿真时长超出星历覆盖）**：`ControlOrbitRequest` 模型未暴露 `control_interval`/`feedback_arc`，面板没有这两个字段，e2m2e 默认 30 天/次 × 119 次 + 28 天反馈弧 ≈ 3598 天，而 GUI 设计默认星历仅 30 天，控制律目标点全部超出标称星历覆盖，5 个蒙特卡洛样本必然全部失败（Δv=0、无机动，GUI 无任何提示）。修复：面板补充 `control_interval`/`feedback_arc` 字段（默认对齐 e2m2e 签名，`collect_params` 支持模型外补充字段）；`_run_control` 运行前校验仿真时长 ≤ 星历覆盖，超出则拦截并提示调整参数或延长标称轨道。实测 30 天 Halo 用 0.25 天/次 + 0.125 天反馈弧 → 4/5 样本成功。新增 3 项测试（面板含补充字段、超出拦截、覆盖内放行）。
- **matplotlib 3.11 兼容（画布轨道族渲染）**：`matplotlib.cm.get_cmap` 自 3.7 弃用、3.11 移除，画布按图表设置取色（`_orbit_color`）与轨道族 3D/2D 渲染在 matplotlib>=3.11 下直接 `AttributeError`（CI 全新安装即触发，本地旧版只告警不报错）。改用 `matplotlib.colormaps[...]`（3.5+ 可用，与 `src/commons/viz` 的 `PlotConfig.get_cmap` 一致）。

### 工程

- **pin e2m2e>=5.6.8**：含 segmented 星历对齐修复的最低版本（上游 #398，5.6.8 同时收尾圈终点覆盖与 ELFO 截断对齐），uv.lock 同步（5.6.7 → 5.6.8）。
- **新增测试**：下载幂等/进度/资产过滤、可用性判断、用户目录探测、配置读写、弹窗三分支（可用直返/下载/指定/跳过）共 34 项。

## 3.2.1 (2026-08-12)

适配 e2m2e 5.6.7：上游删除 `tools/viz` 模块（各自实现绘图）并统一结果契约（#351，`success`/`converged` 方言废除，改 `status`/`cause`/`message`），本项目收编绘图代码、迁移收敛判定，并把新增的类型化异常接入错误翻译层。5.6.6 发布物漏打包 `constants.toml`（安装后 import 即 `FileNotFoundError`），由上游 5.6.7 修复（文件收进 `e2m2e/data/constants/` 包内），故下限直接钉 5.6.7。

### 修复

- **收编 e2m2e `tools/viz` 为 `src/commons/viz`**：e2m2e 5.6.6 删除整个 `tools/viz` 模块（上游 #391），GUI 画布的地月标注/平动点绘制（viz_adapter）与 plot/ 脚本的 FamilyPlotter/PlotConfig 全部 `ModuleNotFoundError`（34 项测试挂）。将 5.6.5 的 base/config/family/icons 四件套收编进 `src/commons/viz`（Apache-2.0，内部相对导入改绝对导入，剔除未用的 TransferPlotter），由本项目自维护。
- **收敛判定迁移统一结果契约**：e2m2e 5.6.6 起 `EphemerisCorrectionResult.converged` 废除（上游 #351），facade 的 `result.correction.converged` 会 AttributeError。改为 `status is ConvergenceState.CONVERGED`；顺带修了 ELFO 场景 `correction=None` 时的既有 AttributeError 隐患（现视为未收敛）。
- **plot/ 脚本导入修正**：`from e2m2e.transfer import ...`（5.6.5 下即不存在的顶层模块，既存错误）改为 `e2m2e.algorithm.transfer`；`Orbit`/`OrbitFamily` 不再由 `e2m2e.algorithm.dynamics` 转发、`CR3BP_System`/`SynodicJ2000System` 不再由 `e2m2e.data.types.orbit` 转发，统一改从定义处导入（`e2m2e.data.types.orbit` / `e2m2e.algorithm.dynamics` / `e2m2e.algorithm.coordinate.synodic_j2000`）。

### 功能

- **异常翻译接入 5.6.6 新类型化异常**：`PropagationFailure`（传播失败，上游 #349，取代错误消息前缀匹配）映射为新错误码 `PROPAGATION_FAILED`；`RustExtensionUnavailableError`（Rust 内核缺失不再静默回退 Python，上游 #378）映射为 `BACKEND_UNAVAILABLE`；`DesignNotConvergedError` 消息附带上游 `FailureCause`，失败原因可定位。

### 工程

- **pin e2m2e>=5.6.7**：结果契约迁移后的最低可用版本（5.6.6 发布物漏打包 `constants.toml`，安装后 import 即 `FileNotFoundError`，上游 5.6.7 已修复），uv.lock 同步。
- **常数注释同步上游单一来源化（#377）**：`CR3BP_System` 默认尺度变化（DU 384405.0→384400.0 km、TU 4.33030→4.34248 天、VU 1027.30→1024.55 m/s），与 `data.templates` 特征尺度对齐，units.py 中两者不一致的历史警告移除；同时纠正 constants.py 行内注释的单位误标（TU 属性返回天、VU 返回 m/s，非 s/km/s，消费方用法本就与天/m/s 一致，仅注释错）。
- **已知上游问题（5.6.7 已修复，本条留档）**：e2m2e 5.6.6 发布物（sdist/wheel）漏打包 `constants.toml`，安装后 import 即 `FileNotFoundError`（loader 按 site-packages 根寻址）；5.6.7 将文件收进 `e2m2e/data/constants/` 包内并改包内寻址，问题消除，本地不再需要桥接。
- **清理 release lint job 的 e2m2e clone（dcc6602）**：08c6bb1 已把 test/build job 改用 PyPI e2m2e，lint job 里遗留的 `git clone ../e2m2e` 纯属闲置（lint 只跑 ruff），删除。
- **重新生成 uv.lock（7531c03）**：v3.2.0 发布途中 rebase 冲突残留了 `<<<<<<<` 标记，`uv lock` 重新生成以清掉，当前文件已无冲突标记。

## 3.2.0 (2026-08-10)

3.1.3 之后适配 e2m2e 5.6.5：恢复 Halo/NRHO 设计端到端可用（e2m2e 自动走 segmented 星历修正，修多圈发散），并修复 e2m2e 5.6.4 起 `design_orbit` 入口的签名与参数模型 breaking。后者自 5.6.4 起让 GUI 任何轨道设计都 TypeError，因测试全 mock 未暴露。

### 功能

- **Halo/NRHO 设计端到端可用（e2m2e 5.6.5，docs 73d1ff6）**：two_level 的修正 1 圈 + 自由外推对不稳定轨道（STM ~1e7/圈）必发散；e2m2e 5.6.5 对 Halo/NRHO 自动重定向 segmented（全程分段打靶，不依赖外推）。GUI 设计 Halo（amp=30000、L2、30 天）~9 s 收敛，三圈会合系 x∈[1.085, 1.187] 紧邻 L2。圈间漂移是固有准周期特征，由 station_keeping 处理，设计阶段不压。

### 修复

- **适配 design_orbit 入口签名 + duration 单位（27eda00）**：e2m2e 5.6.4 起 `design_orbit` 首参从散字段改为 `DesignOrbitRequest`（`extra=forbid`），facade 的 `**kwargs` 转发会 TypeError、GUI 设计全挂；`duration` 单位从年改秒，facade 加 `* SECONDS_PER_YEAR` 换算（不修则 1 年当 1 秒、et_grid 只剩 1 点）。改为构造 request 调用。此前测试全 mock（伪造 kwargs 签名）掩盖了断裂，本次把 mock 改回真签名 + 加 `@pytest.mark.spice` 真 smoke 守住接缝。
- **params_panel 适配新参数模型（27eda00）**：`DesignOrbitRequest` 从 14 字段扩到 23（ELFO 根数 inclination 与摄动/修正字段 dyb 等新增），duration 改 Optional。`ORBIT_TYPE_DEFAULTS` 补 ELFO 分支与新 Optional 默认值；orbit_type 下拉原从 description split（5.6.4 改全大写 + 含 ... 占位符，得 HALO 与 key Halo 不匹配），改从 `ORBIT_TYPE_DEFAULTS` key 取。

### 工程

- **pin e2m2e>=5.6.5（e00b64f）**：含 Halo segmented 修复的最低版本，uv.lock 同步。

## 3.1.3 (2026-08-09)

3.1.2 之后的星历模型可视化改造：星历结果获得会合系（质心归一，自洽）/ 地心惯性系双视图与 GIF 动画导出，轨道设计标称星历进画布，修复星历产物与地月标注的原点偏移，并为画布接入真物理时间轴。约定见 ADR 0013。

### 功能

- **轨道设计标称星历进入画布（#359）**：轨道设计产物此前在画布上只能看到 CR3BP 周期初猜，真实星历模型下的标称星历（拟周期、跨整个 duration）一直埋在 Artifact 的 `extra[ephemeris]`。画布新增绘制内容维度（初猜 / 星历 / 叠加，默认叠加），与会合系/惯性系正交。叠加视图初猜用实线、星历用虚线，TAB10 相邻色区分。两份轨迹从 `_artifact_for_id` 显式平级进画布（`initial_guess_states` / `ephemeris_synodic` / `ephemeris_position_km` / `ephemeris_times_et` 四槽），不嵌套、不靠隐式 fallback。惯性系下初猜灰显（CR3BP 无量纲无惯性系表示）；control_orbit 产物无初猜，初猜恒灰显。导出动画跟随绘制内容：初猜模式无物理时间轴，明确拒绝导出。从磁盘恢复的历史 design_orbit Artifact 也支持（NPZ 已存全字段）。ADR 0013 范围从 control_orbit 受控星历扩到 design_orbit 标称星历 + control_orbit 受控星历。
- **星历模型坐标系切换与惯性系视图（#358 P1，93977fa）**：画布新增会合系 / 地心惯性系（GCRS）切换。惯性系视图以地球为原点、月球按 SPICE 真实轨迹移动、轨迹用 GCRS km、不画平动点；会合系维持 CR3BP 旋转系 + 地月 + L1-L5。脉动-旋转系为 cislunar 可视化主流（Folta 2022、Park 2025），瞬时平动点在该系与 CR3BP 几何一致（Boudad 2022）。
- **GIF 动画导出（#358 P2，93977fa）**：新增独立导出动画工具，按时间等分采样逐帧渲染、Pillow 合成 GIF（不依赖 ffmpeg）。支持累积 / 滑动窗口、UTC 帧时间戳、坐标系随当前视图。

### 修复

- **control_orbit 星历的原点偏移（#358 P0，d0e1449）**：受控星历的会合系位置是地心归一（月球 +1），画布标注按质心归一（月球 1−μ），相差 μ·DU ≈ 4690 km。提取时减 source_mu 对齐；同源 GCRS 位置 km 与由 UTC 重建的 ET 秒一并透传到画布接口，为惯性系视图与动画铺路。
- **design_orbit 产物按轨道类型分目录落盘（8a2925e）**：`save_artifact` 曾无条件写 `output/dro/dro_<ts>`，Halo/NRHO/Lissajous 等非 DRO 轨道被存成 DRO 文件；discovery 按目录+前缀分类，读取时误当作 DRO，画布四槽数据契约因此失效。改为按 `orbit_type` 归一化派生目录名与文件名前缀，DRO 保持既有布局向后兼容；discovery 改为目录名 → 轨道类型映射 + 文件名前缀校验分类，兼容 `halo_north_L1.json` 等旧手工命名。新增回归测试覆盖保存、roundtrip 分类与多类型混存。
- **锁定 e2m2e==5.6.3（778f66d）**：5.6.1 的 two_level 修正把位置(km)与速度(km/s)混在同一残差向量取范数，速度项被量级淹没，求解器停在位置连续、速度跳变数十 m/s的局部极小，L1 Halo 长期预报发散。5.6.3 含上游 Rust 打靶速度加权修复；pyproject 从 `>=5.6.0` 收紧为 `==5.6.3` 精确锁定。
- **无标称星历时明确提示（cdaeae1）**：design_orbit 产物无标称星历时，此前会合系下画布静默只画初猜、无任何提示。新增 `_warn_missing_ephemeris`，与 `_warn_missing_mu` 并列在选中 Artifact 时提示（设计正常总有星历，仅防御异常/旧产物）。
- **discovery 合并嵌套 if 过 ruff（786f4c1）**：8a2925e 引入的 `parent == dro` 嵌套 if 触发 ruff SIM102（CI `ruff check .` 会红）。合并为单 if，纯风格、语义等价。

### 工程

- **从 git 移除论文版 PNG（f1b6cc1）**：删除 `figures/结果` 下的论文版 PNG，改由 `plot/` 脚本现算现出，避免大二进制文件进版本库。

## 3.1.2 (2026-08-08)

3.1.1 之后的 CI 修复补丁：修复 release 流程中 headless 环境的 GUI 测试崩溃。

### 修复

- **修复 release CI 的 headless 测试配置（88ae7f9）**：`release.yml` 的 test job 在 ubuntu-latest 跑 GUI 测试时，`tests/app/test_context_menu.py` 等处的 `qapp` fixture 直接 `QApplication([])`，无显示服务器即 SIGABRT（exit 134，第一个 GUI 测试就崩）。给 Run tests 步骤加 `env: QT_QPA_PLATFORM: offscreen`。本仓 `ci.yml` 只有 lint、无 test job，此缺陷一直未暴露，直到 v3.1.1 release 才触发。

## 3.1.1 (2026-08-08)

3.1.0 之后的小幅修订：GUI 默认 DRO 振幅调到典型中等量级，新增轨道保持专题文档，并修正随 e2m2e 改 PyPI 安装而过时的说明。

### 修复

- **GUI 默认 DRO 振幅 10000→60000 km（02e5bca）**：默认 10000 km 产出贴月的近月紧凑 DRO，在地月尺度画布上只是一个点；改到 60000 km（距月 5.4-6.6 万 km，ARTEMIS/Gateway 量级），打开即见典型中等 DRO。e2m2e 兜底仍为 10000（DFH 黄金样本）。文献里大幅 DRO 比小幅更稳（Zhang & Wang 2022：72000 km 年均保持 0.82 m/s vs 34000 km 1.96 m/s），选 60000 不牺牲稳定性。注：e2m2e 对大幅 DRO 的星历传播有 bug（cislunarspace/e2m2e#324），修复前该默认的星历会漂移；画布画 CR3BP 周期轨道，形状观察不受影响。

### 文档

- **新增轨道保持专题（fb85d1a）**：`docs/source/narrative/station-keeping.md` 给出 DRO/NRHO/halo/Lissajous 在真实星历里的稳定性差异与保持代价基准（Zhang & Wang 2022 全星历 2 年 Monte-Carlo）。如实标注当前软件限制（e2m2e#323 Lissajous 发散、#324 大幅 DRO 星历传播 bug），修复前哪些流程不可用。
- **修正 e2m2e 改 PyPI 安装后的过时描述（ad8edf4）**：README/README.en/architecture.md 删除手动克隆 ../e2m2e + editable 安装 + 改 tool.uv.sources 路径步骤，改为 PyPI 依赖（e2m2e>=5.6.0）由 `uv sync` 一并安装，补充 SPICE 内核自动探测说明。ADR 0012 增补后续更新：冻窗已随 5.6.0/5.6.1 根治，QMovie 缓解作废。

## 3.1.0 (2026-08-08)

本版本收尾 3.0.0 GUI 架构重写：修复默认轨道设计的界面冻窗、参数面板补单位切换与 duration 默认下调、e2m2e 改 pip 安装并自动探测 SPICE 内核，并退役旧架构 `tod/` 完成 `src/` 单轨迁移。

### 修复

- **GUI 轨道设计冻窗（#357）**：默认参数设计 DRO 时界面卡死数十秒、无法完成计算与可视化。根因是 e2m2e 5.5.0 两处死持 GIL：CR3BP 族延拓走 scipy `solve_ivp`（设计阶段，约 70s，与 duration 无关）和长期预报 `propagate_compiled`（随 duration 增长）。升级 e2m2e 5.5.0→5.6.1（约束 `>=5.6.0`），两层分别由 5.6.0（`dee042d`，切 Rust `propagate_cr3bp_stm_py`）与 5.6.1（补 `allow_threads`）修复；默认 DRO + 1 月路径由约 88s 冻死降至约 23s、零冻窗。

### 体验

- **参数面板按字段切换显示单位（#351）**：振幅 km↔DU、时间年↔TU、秒↔TU，切换显示单位保持物理量不变。
- **duration 默认下调至 1 个月并新增月/日显示单位（#355、#356）**：短弧设计更顺手，同时压低长期预报时长以减轻冻窗（配合 #357 根治）。

### 分发

- **e2m2e 改 pip 安装并自动探测 SPICE 内核目录（#353，ADR 0012）**：e2m2e 由 editable 指向本地改为 pip 正式安装；启动时探测内核目录并设 `SPICE_KERNEL_DIR`，避免闰秒内核 `SPICE(NOLEAPSECONDS)`。

### 退役

- **删除 `tod/`（136 .py）与 `tests/tod/`（81 文件）**：旧 GUI（mixin 架构）、`generates/transfers/scripting` 脚本层、`commons/e2m2e_compat` 旧路径兼容 shim 全部移除。脚本工作流的算法逻辑本就属于 e2m2e，CLI 用户改经 e2m2e CLI 使用（ADR 0006）。
- **`tod/commons/` 迁入 `src/commons/`**：`constants.py`（CR3BP 惰性常量 MU/DU/TU/VU）、`orbits.py`（GEO/LEO 圆轨道几何）、`input_contract.py`（输入文件选择契约）、`paths.py`（OUTPUT_DIR + find_project_root + safe_resolve_within + ensure_output_dir 合并）。
- **`tod/plot/` 提升为顶层 `plot/`**：内部 import 改 `src.commons.*`，剥离 `tod.scripting`（SCRIPT_ENTRY 机制废弃），`load_search_results` 与 `find_latest_single_dro` 提取为 `plot/_io_utils.py`、`plot/_artifact_helpers.py`。绘图脚本作为独立命令行工具保留，供高级用户使用。
- **`tod/gui/i18n` 迁入 `src/app/i18n`**：`.qm`/`.json` 资源随 package-data 路径同步更新。

### 变更

- **入口扶正**：`transfer-orbit-design` 命令从 `tod.gui.main:main` 改为 `src.app.main:main`，移除 `-v2` 别名。
- **PyInstaller spec**：datas 收 `src/` + `plot/` 取代 `tod/`；注释更新为新 GUI QThread 直调模型（不再依赖磁盘脚本扫描）。
- **README**：移除 `-v2` 命令与 `tod/` 引用，CLI 脚本工作流指向 e2m2e CLI。
- **CI/lint**：ruff `exclude` 移除 `tod/`（全仓纳入扫描）；`docs.yml` 触发路径移除 `tod/**`、增加 `plot/**`。
- **Sphinx 文档**：删除 `docs/source/tod/`（101 RST，含 `automodule:: tod.*`）与对应 locale `.po`（137 文件），`index.rst` 移除 `tod/index` toctree。
- **扫描结论**：`tod/transfers`、`tod/generates` 经核查均为 e2m2e algorithm 层的薄封装 + argparse CLI，无非薄封装的编排逻辑需迁移；等价覆盖由 e2m2e 自身测试承担。

### 验证

- 测试基线随 `tod/` 移除从 ~1290 降至 232；本版本含后续补丁，发布前 `uv run pytest` 243 passed、`uv run ruff check .` 0 error。

## 3.0.0 (2026-08-05)

本版本主线是 **GUI 架构重写**：把脚本任务范式整体重写为 Project/Artifact 数据模型架构（`src/` 四层），轨道设计与轨道保持经 QThread 直接调用 e2m2e 算法层，结果以 JSON+NPZ 双文件持久化并支持启动扫描恢复。

### 新增

- **src/ 四层架构 GUI**：`src/model`（Project/Artifact 数据模型）、`src/engine`（FacadeBridge 薄封装 + QThread worker + 结果持久化）、`src/view`（内嵌 matplotlib 画布、项目树、Pydantic 自动参数面板、日志）、`src/app`（三栏主窗口组装）（1400a90）。
- **两个启用工具**：轨道设计（`design_orbit`）与轨道保持（`control_orbit`，蒙特卡洛仿真），经 `TOOL_REGISTRY` 注册；轨道族生成、稳定性分析为灰显占位（8359419、0060c73）。
- **可视化**：内嵌 matplotlib 画布，支持 3D/XY/XZ/YZ 投影切换、地月天体与 L1-L5 平动点图层开关、多轨道叠加渲染（d362edf、34f413d）。
- **Artifact 持久化闭环**：结果以 `dro_<ts>.json`（标量元数据）+ `.npz`（states/times/ephemeris 数组）双文件落盘，启动时扫描 `output/` 重建 Project，NPZ 数组懒加载（9121cd0、ea8e5e0、db05f74）。
- **Pydantic 自动参数面板**：参数面板由工具绑定的 Request 模型动态生成（1e772f7）；e2m2e 异常经 `translate_exception` 翻译为结构化错误（8359419）。
- **项目树右键菜单**：右键删除 Artifact、从树直接触发轨道保持（#340）（0060c73）。

### 变更

- **打包切新 GUI**：PyInstaller spec 入口从 `tod.gui.main` 改为 `src.app.main`，datas 收集 `src/` 取代 `tod/`，hiddenimports 补 `e2m2e.algorithm.station_keeping`。
- **README 重写**：README.md / README.en.md 只描述新 GUI（`uv run python -m src.app.main`），移除旧 GUI 入口与 `gui_defaults.json` 语言切换说明；CLI 脚本工作流保留。
- **CONTEXT.md 恢复并更新**：从 git 历史恢复，更新 GUI 相关术语（工具注册、任务范式、设置/主题、图层/标注）以对齐新 GUI。
- 适配 e2m2e v5.4 迁移（96439fc）；新 GUI 架构设计文档与可运行原型（444f0b0）。

### 修复

- 测试隔离：MainWindow 初始化不再读取真实 `output/` 目录（db05f74）。

### 验证

- 全套测试 `pytest tests/ -m not spice` 1290 passed, 5 skipped, 33 deselected；ruff（src/）与 pyright 0 error。

## 2.2.0 (2026-07-29)

本版本主线是**可分发性**：PyInstaller 打包的 Windows 便携包首次真正可用（此前 exe 检测不到任何脚本），并打通了 SPICE 内核免配置分发；同时落地 DRO→GEO 星历修正闭环与配套分析脚本，完成一轮大规模重构与类型修复。

### 新增

- **Windows 便携包（PyInstaller 扁平布局）**：`tod/` 源码、`pyproject.toml`、`data/cr3bp_data` 种子数据与 exe 平级打包，脚本扫描（33 个注册脚本）、子进程执行、multiprocessing spawn 在 frozen 环境全部打通；消除 onefile/onedir 双份产物（去掉 286 MB 冗余）。
- **SPICE 内核免配置**：exe 旁存在 `kernels/` 目录时自动设为 `SPICE_KERNEL_DIR`（显式环境变量优先）；内核与 MICE 工具包经独立 `spice-data-v1` release 分发。
- DRO→GEO 转移星历修正闭环：分段打靶拼接法（8a495bf）；DRO→GEO 小推力转移简单验证（ae279aa）。
- DRO→GEO 期刊仿真分析脚本（仿真 4/5/10）（f3e9d69）。
- i18n：`cli_chip_params` 翻译支持（#284），`cli_params` 与 `group_label` 英文翻译补齐（#283）。
- 参数参考文档（#282）。

### 变更

- PyInstaller spec 移至 `packaging/`；`.vscode/`、`MagicMock/`、`.zcode/`、`.mimocode/` 及 AI 工作文档（AGENTS.md、CONTEXT.md 等）移出 git 跟踪。
- README 多语言化（新增 README.en.md）并补齐脚本清单；安装指引对照 e2m2e v5.3.0 更新，SPICE kernels 改指 GitHub Release 打包下载。
- Sphinx 文档删除 `narrative/context`、`narrative/domain` 两个失效壳页面。
- 大规模重构：脚本注册表统一为 `ScriptEntry` 单一直接产出；`EphemerisConversionAdapter` 类取代闭包工厂；MainWindow mixin 覆盖改为钩子回调；ParamValueStore 拆分三 store；plot config/orchestrator 按关注点拆分；`cli/` → `commons/` 命名重组；删除 CR3BP 8 个 stub 族与两个浅模块；GEO/LEO 返回类型统一为 `Orbit`。
- GUI 亮暗双主题 QSS 重写，统一设计语言。

### 修复

- **frozen exe stdout/stderr 退化为 GBK + 块缓冲**（PyInstaller 嵌入式解释器不响应 `PYTHONUNBUFFERED`/`PYTHONIOENCODING`）：GUI 长任务无流式输出、中文全乱码。改为 frozen 初始化时强制 utf-8 + 行缓冲（6b17ba3）。
- **multiprocessing spawn worker 反序列化失败**：CPython 在 win32 下把 frozen 视为 WINEXE，不向子进程传 `init_main_from_path`；解释器分支显式置回 False（34a0e60）。
- windowed spawn 子进程 `sys.stdout/stderr` 为 None 导致 bootstrap 二次崩溃：补 devnull 兜底。
- pyright 在 CI 严格模式下累计 40+ 处类型错误（50871a4、b7a41d4、f46e9a2、e26f04a）。
- registry fixture 截断 sys.path 导致 e2m2e 不可导入（0681c8a）；33 个 halo ephemeris 集成测试失败（3d457f7）；`gui_defaults` 测试缺键失败（0979c8e）。
- 批量修复 review 问题 #295、#297、#298、#302、#304、#305、#312-#319。

### 验证

- frozen 包内实测：33 个脚本扫描发现、ProcessPoolExecutor spawn、SPICE 星历查询（de430.bsp + naif0011.tls）、stdout utf-8 行缓冲流式输出、显式 `SPICE_KERNEL_DIR` 优先级。
- 全套测试 1098 passed, 5 skipped；pyright 0 errors；CI（ubuntu/windows/macOS × Python 3.13 + docs）全绿。

## 2.1.0 (2026-07-10)

随 e2m2e v5.3.0 上游变更同步适配，并在项目内重建 GEO/LEO 圆轨道几何能力。

### 新增

- `tod/commons/orbits.py`：GEO/LEO 圆轨道几何工具模块。因 e2m2e 误删 `e2m2e.orbits` 包（tod 13 个文件依赖它），在 tod 内重建：移植原 geo/leo 的纯几何函数，复用 `tod.commons.constants` 的归一化常量。同时整合去重了项目内 4 处 `compute_departure_velocity` 重复副本，全仓现仅 1 个定义。

### 变更

- 适配 e2m2e v5.3.0 破坏性变更：
  - `SynodicJ2000Transformation` → `SynodicJ2000System`（6 文件改名，API 兼容）。
  - `EphemerisDynamics` 不再从 `e2m2e.core` 公开导出，改从 `e2m2e.core.ephemeris_dynamics` 导入。
  - 13 个文件的 `from e2m2e.orbits.geo/leo import` → `from tod.commons.orbits import`。

### 修复

- `tests/tod/gui/test_script_registry.py` 漏 `import pytest`（`pytest.skip` 报 `NameError`）。
- `tests/tod/gui/conftest.py` 的 `qapp` fixture 创建 `QApplication` 前未设 `AA_ShareOpenGLContexts`，导致 `test_doc_window_import_order` 全套跑时 `import QtWebEngineWidgets` 报 `ImportError`。与 `tod.gui.main` 对齐，在模块顶部设此属性。

### 验证

- 全套测试 1156 passed, 0 failed（适配前因 e2m2e.orbits 断裂导致 23 failed + 3 collection error）。

## 2.0.0 (2026-06-19)

这个版本把脚本注册方式从集中式改为由实现脚本自声明、扫描器自动发现，同时补全了地月转移的星历转换链路，因此升级为主版本。

### 新增

- DRO→GEO 转移轨迹的星历转换脚本，以及一个通用星历转换 CLI，用于把 CR3BP 设计结果接入 N 体星历动力学。
- DRO→GEO 搜索与绘图脚本支持论文版配图，并可通过 `--caption` 添加图注。
- PyQt6 GUI 的脚本扫描器，自动从 `tod/generates/`、`tod/plot/`、`tod/transfers/` 加载脚本底部的 `SCRIPT_ENTRY`。

### 变更

- 项目描述更新为：地月空间转移轨道设计与分析脚本工具集，提供 CR3BP 轨道生成、转移设计、绘图和星历转换能力。
- `SCRIPT_ENTRY` 注册机制重构：原来由单一文件集中维护注册信息，现在由各实现脚本底部声明，扫描器按路径哈希生成唯一模块名加载，避免同名脚本冲突。
- 随 e2m2e 上游重构同步更新依赖路径与导入方式。

### 修复

- QtWebEngine OpenGL 上下文初始化失败。
- 星历转换脚本中坐标、时间与状态索引的处理错误。
- 测试断言使用 `assertRaises` 掩盖真实异常类型的问题。
- 扫描器将模块加载失败与模块未声明 SCRIPT_ENTRY 混为一谈的问题，并为加载失败补充日志。

### 文档

- 新增 ADR-0005，说明 `SCRIPT_ENTRY` 注册机制的设计决策。
- 更新 `CONTEXT.md`，补充星历转换领域术语与 Phase 3 上下文。
- 将 `CLAUDE.md` 与 `docs` 中的英文内容翻译为中文。
- 更新 README 星历转换章节。