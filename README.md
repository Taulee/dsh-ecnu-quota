# dsh-ecnu-quota

把 **华东师范大学 Open API（chat.ecnu.edu.cn）的额度**显示在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）界面里：侧边栏底部一张常驻卡片，点开是额度明细面板。只读、不消耗额度、不上传任何数据。

![侧边栏底部卡片](docs/sidebar.png)

![详情面板](docs/quota-panel.png)

## 能做什么

- **侧边栏底部常驻卡片**：一行周额度，给出剩余量、总量与剩余百分比；侧边栏折叠时收成一个圆环按钮，悬停显示同样信息。
- **额度明细面板**：点卡片打开，给出剩余额度、占本轮总额度的百分比、本轮已用百分比与进度条、距离重置的倒计时，以及密钥来源与刷新状态。
- **自动刷新**：每 5 分钟拉一次；窗口重新获得焦点时若数据超过 1 分钟就顺手更新。面板上的「刷新」按钮跳过缓存立即取一次。
- **异常有话说**：密钥没配、被拒绝、限流、超时、网络不通、上游异常各自一句明确提示，不会只显示一个空白卡片。

## 安装

需要 DSH 桌面版，以及一枚 ECNU Open API 密钥（见下一节）。

1. 打开 DSH 设置里的插件市场，搜索 `ecnu-quota`。

2. 点安装。市场会把包装进 `~/.dsh/profiles/desktop`，并把 `dsh-ecnu-quota` 登记进 profile 的 `bundles`。

3. **完全退出并重新启动 DeepSeek Harness**（改 `bundles` 必须重启，见〈注意事项〉）。

4. 侧边栏底部出现 ECNU Chat 卡片即安装成功。没出现就看〈故障排查〉。

插件发布在 npm（包名 `dsh-ecnu-quota`），源码在 [github.com/Taulee/dsh-ecnu-quota](https://github.com/Taulee/dsh-ecnu-quota)。

## 需要什么密钥

插件读 `ECNUCHAT_API_KEY`，也就是 `ecnuchat` 模型路由用的那把 ECNU Open API 密钥。按下面的顺序找，用第一个找到的：

1. 启动 DeepSeek Harness 时的环境变量 `ECNUCHAT_API_KEY`；
2. DSH 的凭据存储（面板底部「密钥来源」会显示实际命中的是哪一层）；
3. 项目目录下的 `.env`；
4. DSH 主目录下的 `.env`。

在**用量控制台**（[aiconsole.ecnu.edu.cn](https://aiconsole.ecnu.edu.cn)）生成密钥。面板上只会显示密钥来源和末 4 位（如 `尾号 1a2b`），完整密钥既不写入日志也不出现在任何响应里。来源那一栏原样给出命中位置（`env` 是环境变量、`file` 是凭据文件），对不上就说明找错了地方。

你没配过这把密钥的话，卡片会显示「未配置 ECNU 密钥」，配好后自动恢复。

## 界面说明

**折叠时的圆环按钮**：侧边栏收起后卡片变成一个小圆环，环上亮起的比例就是剩余额度。鼠标悬停能看到「周额度 17,193.59 / 20,000 credits (86% 剩余) · 已用 2,806.41 credits · 更新于 22:54」这样一行摘要，点它打开面板。

**侧边栏卡片**（侧边栏展开时）：每个额度窗口一行，给出窗口名（如「每周额度」）、剩余 / 总量、剩余百分比和一条进度条。额度低于 20% 时进度条转为警示色，剩余量为 0 时仍会留一丝细条而不是彻底空掉。

**额度明细面板**：自上而下是

- **剩余** `17,193.59 / 20,000 credits`
- **占本轮总额度** `85.97%（17,193.59 / 20,000）`
- **本轮已用** `14.03%`，下面跟一条进度条
- **重置** · `6 天后重置`（不足一天会换成小时、分钟）
- 一行小字：`chatecnu · 密钥来源 env · 尾号 1a2b · 每 5 分钟自动刷新 · 缓存`

右上角有「用量控制台」（新标签页打开 ECNU 控制台）、「更新于 22:54」、「刷新」和关闭按钮。

侧边栏展开状态会被 DSH 记住：上次收起的话，刷新页面后看到的仍是圆环按钮，点一下侧边栏的展开按钮即可看到完整卡片。

## 配置

默认值一般不用改。需要改就在 profile 的 `cordis.patch.yml` 里给 `ecnu-quota` 那一行加 `config`，全部可省略：

```yaml
- id: ecnu-quota
  config:
    apiKeyEnv: ECNUCHAT_API_KEY                    # 凭据引用名
    quotaUrl: https://chat.ecnu.edu.cn/open/api/v1/quota
    consoleUrl: https://aiconsole.ecnu.edu.cn      # 面板上「用量控制台」的链接
    providerLabel: ECNU Chat                       # 卡片与面板上的显示名
    route: /plugins/dsh-ecnu-quota/quota           # 同源只读路由
    cacheMs: 15000                                 # 上游结果缓存时长
    timeoutMs: 15000                               # 上游请求超时
```

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `apiKeyEnv` | `ECNUCHAT_API_KEY` | 读取哪一条凭据。必须是合法的环境变量名（字母或下划线开头）。 |
| `quotaUrl` | `https://chat.ecnu.edu.cn/open/api/v1/quota` | 额度接口地址。 |
| `consoleUrl` | `https://aiconsole.ecnu.edu.cn` | 控制台链接；上游响应里带 `ops_console_url` 时以响应为准。 |
| `providerLabel` | `ECNU Chat` | 界面上的显示名，只影响观感。 |
| `route` | `/plugins/dsh-ecnu-quota/quota` | 浏览器读取额度用的同源路由，以 `/` 开头。 |
| `cacheMs` | `15000` | 缓存时长。多开标签页时靠它避免重复请求上游。 |
| `timeoutMs` | `15000` | 单次上游请求的截止时间。 |

客户端每 5 分钟刷新一次是固定值，不受 `cacheMs` 影响。

## 注意事项

- **改 `bundles` 必须重启应用。** DSH 的包解析不允许在运行中的进程里替换插件，只热更新是无效的；一定要完全退出再启动。装好之后，`lib/` 下的改动才是刷新页面就能生效。
- **额度数据不是实时值。** 客户端 5 分钟拉一次，宿主侧另有 15 秒缓存（`cacheMs`），面板上的「缓存」字样表示这次显示的是缓存结果。要立刻取最新值就点「刷新」。
- **本插件只读。** 它只发一个带密钥的 GET 请求并展示结果，不会签到、不会领取、不会消耗任何额度。
- **只覆盖 `ECNUCHAT_API_KEY`。** `chatecnu` / `CHATECNU_API_KEY` 属于另一套凭据，不在本插件范围内。
- **ECNU 目前只有一个每周窗口。** 上游只返回一个 `fixed_168h` 窗口且资源包列表为空，所以界面按「一个窗口、无资源包」呈现；上游将来吐出多个窗口时，卡片会逐行列出。
- **密钥只在本机流转。** 请求从 DSH 宿主进程直连 ECNU 接口，浏览器只读同源路由；完整密钥不写日志、不进响应，面板上最多露出末 4 位。
- **界面语言跟随 DSH**，提供简体中文与英文两套文案。

## 故障排查

卡片或面板上出现提示时，对照下表：

| 提示 | 含义 | 怎么办 |
| --- | --- | --- |
| 未配置 ECNU 密钥 | 上面四个位置都没有找到密钥 | 配好 `ECNUCHAT_API_KEY`，点「刷新」 |
| 密钥被拒绝 | 上游返回 401 / 403 | 到控制台确认密钥仍然有效，或在 DSH 里更新它 |
| 请求过于频繁 | 上游返回 429 | 稍等几分钟再点「刷新」 |
| 请求超时 | 上游在 `timeoutMs` 内没回应 | 检查网络或代理，必要时调大 `timeoutMs` |
| 网络不可用 | 连不上上游 | 检查网络；校园网之外可能需要代理 |
| 上游服务异常 | 上游返回 5xx 或响应异常 | 多半是上游临时故障，稍后重试 |
| 响应无法解析 | 上游返回的内容不是预期格式 | 上游可能改了接口，需要等本插件跟进 |
| 读取密钥失败 | 凭据存储读取报错 | 检查 DSH 的凭据配置 |
| 该密钥暂无可用的额度窗口 | 密钥有效，但上游没给任何窗口 | 到控制台确认这个账号是否已开通额度 |

整个插件都没出现（侧边栏没有卡片、`/plugins/dsh-ecnu-quota/quota` 返回 404）——逐项确认：市场里显示已安装、`~/.dsh/profiles/desktop/node_modules/dsh-ecnu-quota` 真的存在（`ls -l` 看是不是断掉的软链接）、`~/.dsh/profiles/desktop/package.json` 的 `bundles` 里有 `dsh-ecnu-quota`、改完是否**完全重启**过应用。断链是常见死因：源的目录被删或搬走后，运行中的应用启动时加载不到宿主插件，路由就 404。

## 出处与许可

界面与交互设计对齐社区插件 **[dsh-qoder-connect](https://github.com/masknull/dsh-qoder-connect)**（作者 corrinehu，MIT 许可），沿用它的卡片与面板布局、配色令牌与文案风格；本插件与 Qoder 官方无关，只是把同一套展示方式用在 ECNU 的额度接口上。

本项目按 [MIT](./LICENSE) 许可发布，第三方出处与许可见 [NOTICE.md](./NOTICE.md)。

## 免责声明

- 本插件是社区实现，与华东师范大学、Qoder、DeepSeek 官方均无关联。
- 额度接口来自 ECNU Open API，上游随时可能改动、限流或调整策略，届时本插件可能部分或全部失效，不保证兼容窗口。
- 显示结果仅供参考，请以官方用量控制台为准。
