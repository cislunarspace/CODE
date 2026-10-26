.. image:: _static/logo.png
   :align: center
   :width: 200

CODE 文档
==========================

CODE 是 `e2m2e <https://github.com/cislunarspace/CODE-core>`_ 的 GUI 前端。e2m2e 提供地月空间轨道设计所需的动力学模型与算法，本仓库把它们封装成可视化桌面应用。界面层为 React 前端与 Tauri 2 的 Rust 壳，算法层以 sidecar 子进程运行。八个工具已接通，轨道库的查询、标注、导出与删除操作可用。画布采用结果层与固定层双层模型，附时间轴走查与地月空间分区图层。内嵌 AI 助手经 MCP 调用同一套工具，会话跨重启持久化。

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
