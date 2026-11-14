# Ymd 开发约定

- 实现功能前打开 [模块规格索引](README.md#文档)。涉及进程边界、持久化或跨视图写入时，先读 [架构](docs/architecture.md)。
- Markdown 文本和 Excalidraw 场景 JSON 分别是对应文件的源数据。跨视图写入通过共享文档会话，保留视图职责以外的内容。保存冲突保留磁盘版本和内存草稿。
- 文件系统、原生窗口和菜单属于 Electron 主进程。渲染进程使用 preload 的具体操作，通过主进程授权的文档或目录访问真实文件。
- 模块变更需通过 `npm run check`，并从正常入口执行相关功能的最小冒烟验证。新增用例优先覆盖数据丢失、结构回写和关键流程回归。
- 构建目标为 macOS arm64 和 Windows x64。参考软件的交互或源码出处记录在对应模块规格。按用户要求将此次改动留在工作区。

<!-- CODEGRAPH_START -->
## CodeGraph

仓库根目录已有 `.codegraph/` 时，先用 MCP `codegraph_explore` 或 `codegraph explore "<符号或问题>"` 定位代码，之后按需使用 `rg` 和文件读取。没有索引时直接使用普通工具，索引由用户决定。
<!-- CODEGRAPH_END -->
