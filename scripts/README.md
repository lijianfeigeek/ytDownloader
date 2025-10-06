# 离线依赖设置脚本

## 概述

`setup-offline.js` 是一个自动化的依赖管理脚本，用于设置 YTDownloader 的离线运行时环境。它会自动检测缺失的依赖并从官方源下载最新的稳定版本。

## 功能特性

### ✨ 自动依赖管理
- **yt-dlp**: 从 GitHub releases 下载最新版本
- **ffmpeg**: 跨平台下载并自动解压
- **whisper.cpp**: 下载平台特定版本（支持 macOS Metal）
- **Whisper 模型**: 自动下载 Large V3 Turbo 量化模型

### 🌐 跨平台支持
- **Windows**: 支持 `.exe` 二进制文件和 ZIP 解压
- **macOS**: 支持 Intel 和 Apple Silicon，包含 Metal 加速
- **Linux**: 支持标准二进制文件和 tar.xz 解压

### 📊 实时进度显示
- 下载进度条（百分比 + 速度 + 剩余时间）
- 自动重定向处理
- 错误重试机制
- 详细的完成报告

### 🔒 安全性
- 自动设置 Unix 系统执行权限
- 临时文件管理
- SHA256 校验（可扩展）
- 仅从官方源下载

## 使用方法

### 快速开始
```bash
npm run setup-offline
```

### 手动运行
```bash
node scripts/setup-offline.js
```

## 目录结构

设置完成后，依赖将按以下结构组织：

```
resources/runtime/
├── bin/
│   ├── yt-dlp          # 视频下载器
│   └── ffmpeg          # 媒体处理器
├── whisper/
│   ├── whisper          # Linux 二进制
│   ├── whisper-macos    # macOS Metal 版本
│   └── models/
│       └── ggml-large-v3-turbo-q5_0.bin  # Whisper 模型
└── manifest.json       # 依赖清单文件
```

## 下载源

| 依赖 | 平台 | 下载源 |
|------|------|---------|
| yt-dlp | 所有平台 | GitHub releases (yt-dlp/yt-dlp) |
| ffmpeg | Windows | GitHub releases (BtbN/FFmpeg-Builds) |
| ffmpeg | macOS | evermeet.cx (官方构建) |
| ffmpeg | Linux | GitHub releases (BtbN/FFmpeg-Builds) |
| whisper.cpp | Windows | GitHub releases (ggml-org/whisper.cpp) |
| whisper.cpp | macOS | 需要手动编译 (支持 Metal) |
| whisper.cpp | Linux | GitHub releases (ggml-org/whisper.cpp) |
| Whisper 模型 | 所有平台 | Hugging Face (ggerganov/whisper.cpp) |

## 故障排除

### 网络问题
如果遇到下载失败，可以设置代理：
```bash
export HTTPS_PROXY=http://proxy:port
export HTTP_PROXY=http://proxy:port
npm run setup-offline
```

### 权限问题
如果遇到执行权限问题，手动设置：
```bash
chmod +x resources/runtime/bin/*
chmod +x resources/runtime/whisper/*
```

### 下载超时
默认下载超时为 60 秒，对于大文件（如 Whisper 模型）可能需要调整：
- 检查网络连接稳定性
- 确保有足够的磁盘空间
- 重新运行脚本继续下载

### 手动下载
如果自动下载失败，可以手动下载：

1. **yt-dlp**: https://github.com/yt-dlp/yt-dlp/releases
2. **ffmpeg**: 根据平台从官方源下载
3. **whisper.cpp**:
   - Windows/Linux: https://github.com/ggml-org/whisper.cpp/releases
   - macOS: 需要手动编译，见下面的指导
4. **Whisper 模型**: https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin

### macOS whisper.cpp 编译指导

对于 macOS，whisper.cpp 需要手动编译以获得 Metal 加速支持：

```bash
# 克隆仓库
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp

# 编译（支持 Metal）
make WHISPER_METAL=1

# 复制到项目目录
cp ./build/bin/whisper-cli resources/runtime/whisper/whisper-macos

# 清理（可选）
cd .. && rm -rf whisper.cpp
```

## 验证安装

运行脚本后会生成详细的报告。所有依赖状态应为 `✅ Found` 或 `✅ Downloaded`。

### 检查文件
```bash
# 检查二进制文件
ls -la resources/runtime/bin/
ls -la resources/runtime/whisper/

# 检查模型文件
ls -lh resources/runtime/whisper/models/

# 验证版本
./resources/runtime/bin/yt-dlp --version
./resources/runtime/bin/ffmpeg -version
```

## 集成到应用

脚本设置的依赖会被 `src/renderer.js` 自动检测：

```javascript
// runtime binaries directory
const runtimeBinDir = path.join(__dirname, '..', 'resources', 'runtime', 'bin');

// bundled paths
const bundledYtDlp = process.platform === 'win32'
    ? path.join(runtimeBinDir, 'yt-dlp.exe')
    : path.join(runtimeBinDir, 'yt-dlp');
```

## 更新依赖

重新运行脚本会跳过已存在的依赖。如需更新：
```bash
# 删除特定依赖
rm resources/runtime/bin/yt-dlp

# 重新运行脚本
npm run setup-offline
```

## 日志和调试

脚本提供详细的输出信息：
- 📁 目录创建
- 📥 下载进度
- 📦 解压过程
- ✅ 成功/失败状态
- 💡 错误提示和建议

## 技术细节

- **语言**: 纯 Node.js，无外部依赖
- **网络**: 使用内置 `https/http` 模块
- **解压**: 平台原生工具（PowerShell/tar/unzip）
- **权限**: Unix 系统自动设置 755 权限
- **临时文件**: 下载时使用 `.tmp` 后缀，完成后重命名

## 许可证

本脚本遵循项目的 GPL-3.0 许可证。