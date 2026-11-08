# dsh-memory-sync

[![npm version](https://img.shields.io/npm/v/dsh-memory-sync.svg)](https://www.npmjs.com/package/dsh-memory-sync)
[![CI](https://github.com/QIC-9821/dsh-memory-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/QIC-9821/dsh-memory-sync/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](package.json)

> 在两台机器之间同步 `~/.dsh/memories`：局域网 HTTP 快照、完全离线文件、或 SSH 对端脚本。电脑有设置页，平板有插件设置表单。

English: [README.en.md](README.en.md) · 简短说明书: [MANUAL.md](MANUAL.md)

## 三种通路

| 通路 | 适合 | 要点 |
| --- | --- | --- |
| 双方插件 · 局域网直连 | 两台机器在同一 Wi-Fi / 热点 | 两端装插件、同一个 `memSecret`、互相填 `peerUrl`；不需要外网 |
| 双方插件 · 离线快照 | 完全不在同一网络 | 导出 `.json.gz`，拷到另一端导入；先预览再合并 |
| 单方插件 · SSH | 只有一端装插件 | 本机 SSH 登录对端执行同步脚本；对端只需可写记忆目录 + 裸仓/脚本 |

## 安装

```bash
dsh plugin add dsh-memory-sync
```

本机开发用 `link:`：

```json
"dsh-memory-sync": "link:D:/dsh-plugins/dsh-memory-sync"
```

平板装自包含 zip：`dsh-memory-sync-0.3.0-tablet.zip`（根目录有 `package.json`、无 BOM、已把 schemastery 打进 `dist/index.js`）。

## 设置页

### 电脑：设置 → 记忆同步

- 测试连接 / 立即双向同步 / 仅推送 / 仅拉取
- 双方插件直连、离线快照、SSH 三段式
- 自定义同步规则
- 日志、快照列表与恢复

保存写到 `~/.dsh/memory-sync/settings.json`，优先级高于 profile 的 `cordis.patch.yml`；点「恢复 profile 配置」可清掉本页覆盖。

### 平板：设置 → 扩展 → 已安装插件 → dsh-memory-sync

使用 `Config` schema 自动生成的表单，字段与电脑页一致。保存后写 profile 配置并重载。平板没有「立即同步」按钮，用 `memory_sync` 工具：

```json
{"action":"run","direction":"both"}
```

## 自定义同步规则

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `runOnStartup` | `true` | 启动时跑一次；热重载不算 |
| `intervalSendMinutes` | `0` | 每 N 分钟发送一次；0=关。HTTP 只推送，SSH 跑三段 |
| `conflict` | `peer` | 接收方决定：`local`=保本机较新内容，`peer`=保对端（覆盖前备份） |
| `replyOnReceive` | `false` | 收到并写入后回发一次合并快照；带 `no-reply` 防循环 |
| `autoApply` | `true` | 自动/定时推送是否落地；手动推送不受限制 |

手动推送带 `x-mem-apply: manual`，对端即使 `autoApply=false` 也会合并；定时/自动推送不带该头。

## 配置

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `repoPath` | `$DSH_HOME/memories` | 记忆目录 |
| `remote` / `branch` | `cloud` / `main` | SSH/git 地址与分支 |
| `enabled` | `true` | 总开关（不启动/不跑定时；手动仍可用） |
| `startupGraceSec` | `300` | 启动后多少秒内挂载算一次启动 |
| `transport` | `git` | `http` 或 `git` |
| `peerUrl` | 空 | 对端快照地址，如 `http://192.168.137.50:18792` |
| `memSecret` | 空 | 两端一致的共享密钥 |
| `machine` / `peerMachine` | 主机名 / 空 | 本机/对端名称 |
| `serve` | `true` | 是否开快照服务 |
| `listenHost` / `listenPort` | `0.0.0.0` / `18792` | 快照服务地址与端口 |
| `autoApply` | `true` | 收到自动/定时推送是否立即合并 |
| `keepSnapshots` / `maxSnapshotMB` | `5` / `100` | 快照保留与大小上限 |
| `peerHost` / `peerUser` / `peerPort` | 空 / 空 / `22` | SSH 模式目标 |
| `peerKeyPath` / `peerCommand` / `peerEnvName` | 空 / `/usr/local/bin/dsh-mem-sync` / `cloud` | SSH 模式密钥、对端脚本、环境名 |
| `retryDelaySec` / `healIntervalSec` | `60` / `600` | 失败重试/自愈间隔 |
| `intervalSendMinutes` / `conflict` / `replyOnReceive` | `0` / `peer` / `false` | 上面的自定义规则 |

状态、日志、设置、快照都在 `$DSH_HOME/memory-sync/`：`last-run.json`、`sync.log`、`settings.json`、`snapshots/`、`exports/`。

## 工作方式

- 记忆写入照常实时落盘；同步只是在需要时生成快照并合并。
- HTTP 手动同步：push（带 manual 头）→ pull；只推送/只拉取可单独选。
- 定时：HTTP 只 push；对端按 `autoApply` 决定是否合并。SSH：跑本地 push → 对端脚本 → 本地 pull。
- 合并规则：缺失文件补上；相同跳过；`conflict=local` 时本机较新不覆盖，`conflict=peer` 时对端覆盖；每日日志短的不覆盖长的；不删除；覆盖前写 `.bak-snapshot`。
- 回发：只在本轮真的写入且请求未带 `x-mem-no-reply: 1` 时回发一次，回发本身带 no-reply，避免循环。

## 工具

`memory_sync`：

- `{"action":"run","direction":"both|push|pull"}`：立刻同步。
- `{"action":"status"}`：上次结果、传输、角色、规则、定时、对端。
- `{"action":"list"}`：本地/对端快照。
- `{"action":"restore","snapshot":"<id>"}`：恢复快照。
- `{"action":"export","path":"..."}`：导出离线快照。
- `{"action":"import","path":"...","dryRun":true}`：预览/导入离线快照。

## 设置 API

`/memory-sync/api/state|config|reset|sync|test|logs|snapshots|restore|export|import`，只允许本机/同源请求；state/config 不回显 `memSecret`。

## 安全

- 设置 API 只允许本机/同源；密钥不回显。
- 共享密钥等同写权限；快照是明文 gzip，不要放密码。
- 覆盖前自动备份；不删除文件。
- 安全漏洞请走 [SECURITY.md](SECURITY.md)，不要开公开 issue。

## 开发

```bash
npm test          # node --test test/*.test.mjs
node --check index.js
node --check client.js
```

平板包构建见 `scripts/build-tablet.mjs`（esbuild 打 `dist/index.js`，把 schemastery 打进去；根目录 package.json，无 BOM）。

## 许可

MIT。变更记录见 [CHANGELOG.md](CHANGELOG.md)。
