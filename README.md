# Ymd

Ymd 是面向 macOS arm64 和 Windows x64 的本地 Markdown 编辑器。「我的文档」默认使用 `~/.ymd`，可在「设置 → 文档库」更改。侧栏的「本机文件」保留最近打开的文件和文件夹。文件树显示 `.md` 与 `.excalidraw`。同一份 Markdown 可以切换到实时渲染、大纲和思维导图视图。

## 开发

```sh
npm ci
npm run dev
npm run check
npm run build
```

`npm run dist:mac` 输出 macOS arm64 DMG，`npm run dist:win` 输出 Windows x64 NSIS 安装包。开发机安装 Node.js 22.12 或更新的受支持版本。

## 发布

推送与 `package.json` 版本一致的 `v<版本>` 标签会触发 GitHub Actions，两个平台构建成功后发布 Release。

## 文档

以下模块规格仅在本地开发工作区提供。

- [架构、数据流和实施顺序](docs/architecture.md)
- [工作区与文件](docs/modules/workspace.md)
- [窗口、侧栏和设置](docs/modules/shell.md)
- [界面设计基准](docs/design.md)
- [实时 Markdown](docs/modules/markdown.md)
- [大纲](docs/modules/outline.md)
- [思维导图](docs/modules/mind-map.md)
- [Excalidraw](docs/modules/excalidraw.md)
- [构建与验收](docs/modules/release.md)
