# 架构决策记录（ADR）

架构决策记录（Architecture Decision Record）逐项记录项目的关键架构决策：
背景、决策、后果。编号越大越新。以下列表按编号排列，全文见对应页面。

.. toctree::
   :maxdepth: 1

   adr-0037-ui-ldc-visual-language
   adr-0028-synodic-display-perception-fixes
   adr-0027-assistant-host-scenario-tools
   adr-0026-assistant-thinking-level
   adr-0025-assistant-session-history
   adr-0024-record-user-metadata-in-catalog
   adr-0023-ai-assistant-architecture
   adr-0022-ai-assistant-llm-mcp
   adr-0021-canvas-timeline
   adr-0020-serious-semantic-ui-visual-language
   adr-0019-sidecar-subtree-lifetime
   adr-0018-tauri-desktop-auto-update
   adr-0017-linux-appimage-and-deb-packaging
   adr-0016-feature-parity-and-catalog-distribution
   adr-0015-ui-framework-and-parameter-overlay
   adr-0014-migrate-ui-to-tauri
   adr-0013-ephemeris-visualization-conventions
   adr-0012-defer-gil-and-facade-to-upstream
   adr-0011-algorithm-layer-direct-call
   adr-0010-embedded-visualization
   adr-0009-autogen-params-from-pydantic
   adr-0008-output-as-persistence
   adr-0007-big-bang-gui-replacement
   adr-0006-e2m2e-gui-frontend
   adr-0005-script-registration-consolidation
   adr-0004-job-status-dispatch-result
   adr-0003-run-preflight-confirmation
   adr-0002-dro-catalog-seed-gui-v1
   adr-0001-ui-i18n-zh-en

## 阅读指引

- **当前架构**以 :doc:`architecture` 为准；ADR 记录决策的**历史语境**，
  两者不一致时以架构文档为准。
- ADR-0001 至 0005 记录旧 GUI（`tod/gui/`）时代的决策，相关机制
  （ScriptEntry 脚本注册、JobStatus、运行前确认弹窗）已随 ADR-0007 的
  大爆炸替换废弃，仅作历史参考。
- ADR-0006 起为现行 GUI 的决策：e2m2e 前端定位（0006）、大爆炸替换
  （0007）、output/ 持久化（0008）、Pydantic 自动参数面板（0009）、
  内嵌可视化（0010）、算法层直调（0011）、卡顿与接口边界依赖上游
  （0012）、星历可视化坐标与时间约定（0013）、UI 迁移到 Tauri（0014）、
  UI 组件库与参数覆写层（0015）、功能补齐与 catalog 分布（0016）、
  Linux 打包（0017）、桌面自动更新（0018）、sidecar 子树生命周期
  （0019）、严肃语义色板视觉语言（0020）、主画布时间轴（0021，
  原与 0014 同号，已改编）、AI 助手定位与模型服务策略（0022）、
  AI 助手架构（0023）、记录用户元数据归属 catalog 记录字段（0024）、
  助手会话历史与多会话（0025）、思考等级与过程展示（0026）、助手宿主内置工具——情景生成/修改（0027）、会合视图保留质心原点与显示层感知修复（0028）。界面视觉语言自 ADR 0037 起改为
  LDC 风格（zinc 灰阶、中性主色、8–16px 圆角），取代 0020 的直角口径。
