# Ymd

Ymd 是面向 macOS arm64 和 Windows x64 的本地 Markdown 编辑器。它可以打开应用维护的「我的文档」、用户选择的项目目录和临时打开的本机文件。文件浏览器显示 `.md` 与 `.excalidraw`。同一份 Markdown 可以切换到实时渲染、大纲和思维导图视图。

## 开发

```sh
npm ci
npm run dev
npm run check
npm run build
```

`npm run dist:mac` 输出 macOS arm64 DMG，`npm run dist:win` 输出 Windows x64 NSIS 安装包。开发机安装 Node.js 22.12 或更新的受支持版本。

## 文档

- [架构、数据流和实施顺序](docs/architecture.md)
- [工作区与文件](docs/modules/workspace.md)
- [窗口、侧栏和设置](docs/modules/shell.md)
- [界面设计基准](docs/design.md)
- [实时 Markdown](docs/modules/markdown.md)
- [大纲](docs/modules/outline.md)
- [思维导图](docs/modules/mind-map.md)
- [Excalidraw](docs/modules/excalidraw.md)
- [构建与验收](docs/modules/release.md)
