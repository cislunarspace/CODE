.. image:: _static/logo.png
   :align: center
   :width: 200

Transfer Orbit Design 文档
==========================

Transfer Orbit Design 是 `e2m2e <https://github.com/cislunarspace/CODE-core>`_ 的
GUI 前端：e2m2e 提供地月空间轨道设计所需的动力学模型与算法，本仓库把它们封装
成可视化桌面应用（Tauri 2：Rust 壳 + React 前端 + e2m2e sidecar）。八个工具
（含参数空间扫描与分区边界）与 catalog 的标注/提升/导出/删除操作均已可用；
画布为结果层/固定层双层模型，附时间轴走查与地月空间分区图层；内嵌 AI 助手
（LLM+MCP）可对话式发起计算，会话跨重启持久化。

.. toctree::
   :maxdepth: 2
   :caption: 入门

   narrative/readme
   guide/quickstart

.. toctree::
   :maxdepth: 2
   :caption: 使用指南

   guide/gui
   guide/tools
   guide/visualization
   guide/output
   guide/kernels

.. toctree::
   :maxdepth: 2
   :caption: 领域知识

   concepts/orbit-families
   concepts/ephemeris
   concepts/station-keeping

.. toctree::
   :maxdepth: 2
   :caption: 开发

   narrative/development
   dev/architecture
   dev/adr

索引
====

* :ref:`genindex`
* :ref:`modindex`
* :ref:`search`
