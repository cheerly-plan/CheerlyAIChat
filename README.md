# Cheerly · AI Chat 前端

一个自研的 AI 对话前端：会话管理、SSE 流式回答、研报任务卡片与预览审核、知识库切片浏览、知识图谱可视化、对话过程回看。
除 React 与 Lottie 外，路由、Markdown 渲染、虚拟滚动、力导向布局全部手写实现，没有引入
组件库 / 状态管理 / 请求库。

- 技术栈：React 19 + TypeScript + Vite 8
- 后端：独立服务（默认 `http://127.0.0.1:8000`），前端只做视图与交互
- 页面：`#/chat` 对话、`#/board` 管理员看板、`#/kb` 知识库、`#/trace` 对话过程

---

## 1. 快速开始

```bash
pnpm install
pnpm dev      # http://localhost:5173
pnpm build    # tsc -b && vite build → dist/
pnpm lint
```

开发服务器把三个前缀转发到本地后端（`vite.config.ts`）：

| 前缀 | 用途 |
| --- | --- |
| `/v1` | 业务接口（鉴权、会话、对话流、知识库、图谱、研报、过程回看） |
| `/user` | 用户信息 |
| `/health` | 健康检查 |

生产部署时由网关做同样的反代即可，前端不带任何写死的后端地址。

React Compiler 已启用（`@vitejs/plugin-babel` + `reactCompilerPreset`），因此组件里不需要
手写 `useMemo` / `useCallback` 做性能兜底，只在「引用相等即语义相等」的地方显式使用。

---

## 2. 目录结构

```
src/
├── main.tsx                 入口，挂载 <App/>
├── App.tsx                  鉴权门禁：checking / anonymous / authed；管理员登录先进看板
├── api.ts                   全部 HTTP + SSE 封装的唯一出口
├── types.ts                 共享数据结构（会话、消息、事件、引用、研报任务）
├── router.ts                极简 hash 路由（board / chat / kb / trace）
├── hooks/useChat.ts         对话状态机（本项目最核心的文件）
├── lib/
│   ├── markdown.ts          Markdown 解析器（块级 + 行内，纯函数）
│   └── sessionTurns.ts      消息流 → 轮次列表（会话大纲数据）
├── components/
│   ├── auth/                登录 / 注册
│   ├── board/               管理员看板（进知识库 / 对话过程 / 开对话）
│   ├── chat/                对话主界面
│   │   ├── Chat.tsx         布局壳：侧栏 + 头部 + 落地页/消息区 + 右侧预览
│   │   ├── Sidebar.tsx      会话列表、分组、重命名、删除
│   │   ├── ChatHeader.tsx   标题栏（含收起侧栏、审核入口）
│   │   ├── MessageList.tsx  滚动容器：贴底、分页、大纲、回到底部
│   │   ├── MessageItem.tsx  单条消息：气泡、操作、参考来源、研报卡片
│   │   ├── ReportJobCard.tsx      研报后台任务进度卡 + 下载链
│   │   ├── ReportPreviewPanel.tsx 底稿 / 深度层预览
│   │   ├── ReportReviewPanel.tsx  审核队列（批准 / 驳回 / 定稿）
│   │   ├── SourcePreviewPanel.tsx 参考来源右侧入流预览
│   │   ├── Markdown.tsx     Markdown → React，流式增量渲染
│   │   ├── Composer.tsx     输入框 + 智能搜索 / 知识检索开关
│   │   ├── SessionOutline.tsx  右侧轮次刻度条
│   │   ├── GlobeToggleIcon.tsx / BookToggleIcon.tsx  Lottie 开关图标
│   │   └── icons.tsx        手写 SVG 图标集
│   ├── kb/                  知识库与图谱
│   │   ├── KnowledgeBase.tsx   文件面板 + 切片列表（虚拟滚动）
│   │   ├── KbGraphPanel.tsx    图谱视图：检索栏 + 画布 + 证据
│   │   ├── KnowledgeGraph.tsx  力导向图谱渲染
│   │   ├── KgBuildDialog.tsx   建图配置（文档类型 / 抽取粒度）
│   │   ├── KbRetrieveDialog.tsx 检索演示弹窗
│   │   ├── FileEditDialog.tsx  文件名 + 标签一次改完
│   │   ├── ChunkContent.tsx / tableGrid.ts  表格还原成格子
│   │   └── chunkText.ts        切片字数与类型判断
│   ├── trace/               对话过程回看（按用户 / 会话 / 提问）
│   └── common/ConfirmDialog.tsx
└── index.css / *.css        全局变量与各模块样式
```

---

## 3. 启动链路与鉴权

`App.tsx` 是一个三态门禁，而不是在路由里做守卫：

```
令牌存在？ ── 否 ──> anonymous → LoginView
     │是
     └─> checking → fetchUserInfo()
             ├─ 成功 → authed
             │          ├─ 管理员 + 空 hash → navigate(#/board)
             │          └─ 按路由渲染 Board / Chat / KnowledgeBase / Trace
             └─ 失败 → 清令牌 → anonymous
```

几个刻意的处理：

- **用户信息复用**：`checking` 阶段拿到的 `UserInfo` 直接传给下游页面，`useChat` 不再重复请求
  `/user/info`，避免开屏两次用户查询。
- **登录后重建 Chat**：`chatEpoch` 作为 `<Chat key>`，登录 / 登出都让整棵对话子树重挂载，
  会话、消息、SSE 连接一并归零，不会残留上一个账号的数据。
- **权限以 `/user/info` 为准**：登录响应可能滞后（`is_admin` 缺失），因此登录后合并两侧结果，
  任一侧为管理员即放行入口；真正的权限校验在后端（前端 403 只是兜底提示）。
- **管理员先进看板**：登录成功且当前是空 hash 时 `navigate('board')`，对话 / 知识库 / 过程页从看板进入。
- **令牌失效全局处理**：`api.ts` 的 `authedFetch` 遇到 401 就清本地令牌并 `reload()`，
  门禁检测不到令牌会自然回落到登录页，业务代码无需各自处理。

令牌与偏好存储：

| Key | 位置 | 说明 |
| --- | --- | --- |
| `cheerly.auth_token` | localStorage | Bearer 令牌 |
| `cheerly.active_session:<userId>` | sessionStorage | 每个用户各自记住最后打开的会话 |
| `ai_chat.webSearch` | localStorage | 智能搜索开关，默认开 |
| `ai_chat.kb` | localStorage | 知识检索开关，默认关（检索有成本与延迟） |

所有 `localStorage` / `sessionStorage` 访问都包了 try/catch——隐私模式下写入会抛异常，
不能让它把整页打挂。

---

## 4. 对话核心：`useChat`

`useChat` 把「会话列表 + 当前会话消息 + 多条并行 SSE 流」收敛成一份对外状态。理解它只需要
抓住四个概念。

### 4.1 `LiveRun`：一次生成 = 一条可脱离视图存活的记录

```ts
type LiveRun = {
  controller: AbortController   // 只断这一条流
  assistantId: string           // 正在写入的消息 id
  messages: ChatMessage[]       // 该会话自己的消息快照
  pending: string               // 攒着还没刷进 state 的文本
  raf: number                   // requestAnimationFrame 句柄
  canResume / resumeRunId       // 断点续跑凭据
  hasMore / nextBeforeSeq       // 分页游标，跟着会话走
}
```

`runsRef: Map<sessionId, LiveRun>`。带来的直接效果：

- **切走会话不断流**：SSE 继续读完，文本写进该 run 的 `messages`，侧栏给这条会话显示 loading；
  切回来时直接铺回半截回答，而不是重新拉历史把它盖掉。
- **暂停只影响当前会话**：`stop()` 按 `sessionIdRef` 精确 abort，不会误杀后台会话。
- **多个会话可以同时生成**，互不干扰。

### 4.2 流式文本合帧

token 到达频率远高于渲染需要。`text` 事件只做 `run.pending += chunk`，同一帧内多次到达的
文本合并成一次 `setMessages`：

```ts
queueRunText(id, chunk)  →  pending += chunk
                         →  rAF 回调里 flushRun(id)  →  一次性 patch 消息
```

`tool_start` / `tool_end` / `done` 这类结构化事件到达时先 `flushRun`，再改状态，保证
「半截文本」和「工具结果」的顺序不会错乱。

### 4.3 事件协议

后端以 `text/event-stream` 返回，每帧 `data: {...}`，前端按 `ChatEvent` 分发：

| type | 处理 |
| --- | --- |
| `run_started` | 记下 `run_id`，作为断流后恢复的凭据 |
| `text` | 攒进 `pending`，按帧刷入当前助手气泡 |
| `tool_start` | 清空调用前的半截字，气泡只留写作光标（不展示工具过程） |
| `tool_progress` | 研报等长任务的进度文案，挂到当前助手气泡 |
| `report_job` | 记下 `job_id`，渲染 `ReportJobCard` 并轮询 `/v1/report/jobs/{id}` |
| `tool_end` | 若带 `sources`，挂到消息上 |
| `done` | 落 `sources`，收尾 |
| `error` | 置错误文案并点亮「继续生成」（若已有 `run_id`） |
| `title_updated` | 直接更新侧栏标题 |

`readSSE` 按空行分帧、只解析 `data: ` 行，单条坏 JSON 只跳过该条，不让整段流挂掉。

### 4.4 断点续跑

后端在 checkpoint 里保留 `failed` / `interrupted` 的 run。前端两条路径发现它：

1. **会话加载后**：`fetchPendingRun(sessionId)` → 有 `run_id` 就显示「继续生成」；
2. **流异常终止后**：`settleInterruptedStream` 先短轮询 5 次（每次 200ms），仍未拿到则等 4s
   再补查一次——覆盖「服务端刚重启、`running→interrupted` 收敛还没跑完」的场景。

恢复时后端是**整段重跑**而不是只发剩余 token，所以前端用首个 `text` 覆盖半截内容
（`resumeReplacePending`），之后才走正常的增量合帧。

若最后确认没有任何可恢复内容，才移除末尾的空气泡，避免留下一个残影。

### 4.5 标题生成

对话结束后后端异步生成标题，前端无法收到推送，于是轮询
`GET /v1/session/title`：每 2s 一次，最多 12 次，拿到非默认标题（`新会话`）即停。
轮询自带守卫——只在标题仍为默认值时应用结果，绝不覆盖用户手动改过的名字。

### 4.6 分页与「重新生成」的失败回滚

- 历史分页用 `before_seq` 游标，向上加载 20 条；`MessageList` 用 `useLayoutEffect` 比较
  「首条 id 变化 + 条数增加」判断是「前插」还是「追加」，前插时补偿 `scrollTop`，
  视觉上不会跳动。
- 「重新生成」会就地替换最后一条助手消息。如果后端返回 `error`，库里其实原样保留旧回答，
  前端会重新拉一次 `/v1/chat/memory` 把权威历史铺回来，避免界面上留下一个空回答。

---

## 5. 渲染层

### 5.1 自研 Markdown

`lib/markdown.ts` 是一个纯函数解析器，输出 `Block[]` / `Inline[]` 中间表示，由
`Markdown.tsx` 映射成 React 元素。支持：标题（h1–h4）、段落、有序/无序列表、围栏代码块、
引用、分隔线、管道表格、行内 `**粗体**` / `*斜体*` / `` `代码` `` / 链接 / 转义。

不支持 HTML 直出——唯一的例外是 `<table>`：模型偶尔会把 OCR 结果整段 HTML 表格吐出来，
`Markdown.tsx` 先用正则把 `<table>…</table>` 切出来交给 `HtmlTable` 还原成真实表格，其余部分
仍走安全解析。

**流式渲染的关键是 `splitClosed`**：把已接收内容分成「已闭合」和「末尾未闭合」两段。

- 末尾没有换行 → 最后一行是 pending，用行内渲染器即时显示（用户能看到正在打的这行字）；
- 围栏代码块未闭合 → 从 ``` 开始整段算 pending，按原文显示；
- 其余情况全部已闭合，直接按块解析。

这样既不会因为半行 Markdown 导致整段重排，也不会出现「表格解析到一半炸掉」。

### 5.2 表格还原

管道表格和 HTML 表格最终都铺成同一套格子（`tableGrid.ts`）：`colspan` / `rowspan` 展开、
分组标题只留第一列、表头重复字合并回跨列。`ChunkContent.tsx` 的 `DataTable` 负责绘制，
对话与知识库切片共用，保证同一张表在两处看起来一样。

### 5.3 参考来源

回答下方的引用是一排小卡片：编号 + 文件名 + 位置（`第3页` / `第134–135页` / `表2`）。
点任意一张展开原文摘录，章节名放在展开区（它比页码长得多，塞进卡片会把文件名挤没）。
跨页切片会额外提示页区间；图像识别来源标注「可能有误差」。

### 5.4 会话大纲

消息 ≥ 2 轮时右侧出现刻度条。`sessionTurns.ts` 把消息流配对成
`{ id, replyId, title, excerpt }`；`SessionOutline` 用 `getBoundingClientRect` +
`scroll` / `resize` / `ResizeObserver` 计算哪些轮次当前可见，悬停显示预览，点击跳转。
窗口失焦时主动清掉预览——`Cmd+Tab` 切走不会触发 `mouseleave`，否则会留下幽灵弹窗。

---

## 6. 输入区

`Composer` 是一个受控 `textarea`：`Enter` 发送、`Shift+Enter` 换行、高度随内容自适应
（先置 `auto` 再读 `scrollHeight`，并保持贴底）。流式回复期间发送键变成停止键。

两个开关（智能搜索 / 知识检索）只是把 `web_search` / `use_kb` 带进请求，后端据此决定给模型
挂哪些工具。图标是 Lottie 动画（`lottie-web` 的 light 构建）：开启正向播到末帧、关闭倒放回
首帧，与 DeepSeek 的同款交互一致；动画帧区间从 JSON 的 `ip` / `op` 推导，不硬编码帧号。

---

## 7. 路由与侧栏

`router.ts` 用 hash 而不是真实路径：刷新、直接分享链接都不需要服务端配置 SPA fallback。
`useSyncExternalStore` 订阅 `hashchange` / `popstate`，页面状态完全由 URL 决定。
路由四态：`board` / `chat` / `kb` / `trace`。

从知识库返回时优先 `history.back()`，避免浏览器后退键在页面之间来回弹；直接以 `#/kb`
打开（没有站内历史）时才就地 `replaceState` 到 fallback。

侧栏会话按 `今天 / 昨天 / 7天内 / 30天内 / 年-月` 分组，四态互斥渲染：骨架屏、加载失败
（带重试）、空态、分组列表。会话「更多」菜单用 `position: fixed` + 视口边界计算，
空间不够时向上弹，不会被列表容器裁掉。

### 7.1 研报预览与审核

聊天里提交研报后：

1. SSE `report_job` → `ReportJobCard` 轮询进度，完成后展示标题／校验摘要／下载链
2. 预览走 `fetchReportFile(href, { preview: true })`，区分底稿与深度层；响应头带出门禁状态
3. 审核面板拉取 `/v1/report/reviews`；生成者本人与管理员可批准／驳回／定稿
4. 交付文本写回消息后，刷新页面仍能直接渲染下载链接

参考来源点开后进入右侧 `SourcePreviewPanel`，窄面板下表格不再被挤成竖排。

---

## 8. 知识库（管理员）

`#/kb` 是整页视图，左侧文件面板、右侧切片或图谱。读写分离：普通用户只读（看列表、翻切片、
看图、检索），上传 / 删除 / 修订切片 / 建图只对 `is_admin` 出现——但后端 403 才是真防线。

### 8.1 上传

前端按 4MB 切片顺序上传，与后端 `kb_part_size_mb` 对齐：

```
POST /v1/kb/files              建档 → file_id
PUT  /v1/kb/files/{id}/parts/{i}  逐片上传（application/octet-stream）
POST /v1/kb/files/{id}/complete  触发解析 + 向量化
```

不做断点续传：任一步失败整体报错，用户重传整个文件——比维护半成品状态更简单可靠。

### 8.2 切片浏览

切片卡片高度随内容变化，因此虚拟滚动不能用固定行高：

- 每张卡片实际渲染后把高度写进 `heights: Map<seq, px>`；
- 布局用高度前缀和推算，未渲染的卡片按 `DEFAULT_ROW_H` 估算；
- 滚动分页逐步修正估算值，实测高度覆盖后布局立即纠正。

「跳到第 N 页」调 `/chunks/locate?page=N` 拿到目标切片序号，必要时先补加载到该位置，
再滚动并临时高亮 1.6s。PDF 类文件的页码标签可点，`openKbFileAtPage` 先同步 `window.open`
占位再取 blob 填入 `#page=N`——取 blob 是异步的，等回来了再开窗会被浏览器当作非用户手势拦截。

### 8.3 知识图谱

`KnowledgeGraph.tsx` 是一个手写的力导向画布：

- **布局**：先按权重分层撒点，再迭代「斥力 + 边弹簧 + 径向收缩」。权重综合提及次数与关系
  条数——提及多、连接多的实体压在内圈，图自然形成中心密、外围疏的层次。
  开屏前静默预热若干步，页面出现时已基本成形，不需要盯着它抖半分钟。
- **性能**：逐帧直接改 DOM `transform`，不走 React state；点数少时暴力两两算斥力，
  超过阈值改走网格只与邻近格子作用。枢纽模式默认最多渲染 100 个节点（`KG_HUB_CAP`），
  下钻时额外带上限的一跳邻居。
- **无边界**：图上一条边都没有时，力导向没有结构可表达，改为按实体类型分块的网格
  （small multiples），可扫读、可对照图例。
- **簇视图**：后端社区检测结果按规模降序，配色按社区编号轮转、色相刻意拉开，孤立点固定灰。
- **尺寸变化**：按比例挪点而不是重新力导向，避免窗口一拉整图跳到另一套布局。

`KbGraphPanel` 负责范围与检索：勾 1 个文件 = 单文件图，勾多个 = 合并图，全不勾 = 全库图；
检索带着同样的范围，筛出的子图与画布是同一批数据，不会出现「命中了却不在图上」。

建图配置（文档类型 / 抽取粒度）放在弹窗里而不是行内下拉：这是一次十几分钟的算力开销，
误点一下就换配置重抽代价太高，值得让人确认一遍。文档类型列表来自后端
`/v1/kg/doc-types`，前端不硬编码，加一种文档只改后端配置。

---

## 9. 接口清单

所有请求都收口在 `api.ts`，组件不直接 `fetch`。

**鉴权 / 用户**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/v1/auth/login` | 登录，返回 token + user |
| POST | `/v1/auth/register` | 注册并登录 |
| POST | `/v1/auth/logout` | 吊销令牌（失败不阻塞本地退出） |
| GET | `/user/info` | 权威用户信息（含 `is_admin`） |

**会话**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/v1/session/create` | 建会话，带 `idempotency_key` 防重复 |
| POST | `/v1/session/rename` | 重命名 |
| POST | `/v1/session/delete` | 删除 |
| GET | `/v1/session/list` | 列表 |
| GET | `/v1/session/title` | 轮询生成的标题，404 = 还没生成 |

**对话**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v1/chat/memory` | 历史消息，`limit` + `before_seq` 分页 |
| POST | `/v1/chat` | 发送消息，SSE 流式返回 |
| POST | `/v1/chat/resume` | 从 checkpoint 恢复被中断的 run |
| GET | `/v1/chat/pending_run` | 查询可恢复的 run_id |

**知识库**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/v1/kb/files` | 创建上传任务 |
| PUT | `/v1/kb/files/{id}/parts/{i}` | 上传分片 |
| POST | `/v1/kb/files/{id}/complete` | 触发解析 |
| GET / DELETE | `/v1/kb/files[/{id}]` | 列表 / 删除 |
| PATCH | `/v1/kb/files/{id}` | 重命名 |
| PATCH | `/v1/kb/files/{id}/tags` | 全量覆盖标签 |
| GET | `/v1/kb/files/{id}/download` | 下载原件（带鉴权头，先取 blob） |
| GET | `/v1/kb/files/{id}/chunks` | 切片分页 |
| GET | `/v1/kb/files/{id}/chunks/locate` | 按页码定位切片 |
| PATCH | `/v1/kb/files/{id}/chunks/{seq}` | 人工修订切片 |
| POST | `/v1/kb/search` | 检索演示 |

**知识图谱**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v1/kg/graph` | 全库或合并图（`file_ids`） |
| GET | `/v1/kg/files/{id}/graph` | 单文件图 |
| POST | `/v1/kg/graph/build` | 批量建图 |
| POST | `/v1/kg/files/{id}/rebuild` | 单文件重建（不带 body 则沿用已存配置） |
| GET | `/v1/kg/search` | 图谱检索（`q` / `top_k` / `depth` + 范围） |
| GET | `/v1/kg/entities/{id}/chunks` | 实体的原文依据 |
| GET | `/v1/kg/doc-types` | 可选的抽取配置 |

**研报**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v1/report/jobs/{id}` | 轮询研报后台任务 |
| GET | `/v1/report/files/{name}` | 附件下载；`?preview=1` 在线预览 |
| GET | `/v1/report/reviews` | 审核队列（管理员读） |
| GET | `/v1/report/reviews/{id}` | 单条审核详情 |
| POST | `/v1/report/reviews/{id}/decision` | 批准／驳回 |
| POST | `/v1/report/reviews/{id}/finalize` | 定稿 |

**对话过程（管理员）**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v1/inspect/users` | 可回看的用户列表 |
| GET | `/v1/inspect/sessions` | 某用户的会话 |
| GET | `/v1/inspect/turns` | 某会话每问的工具／技能／模型结果 |

---

## 10. 样式与响应式

没有 CSS-in-JS、没有 Tailwind，按模块拆样式表：`index.css`（reset + 字体）、
`chat.css`、`kb.css`、`auth.css`、`board.css`、`trace.css`。

主要断点：

| 断点 | 行为 |
| --- | --- |
| `max-width: 860px` | 侧栏变浮层 + 遮罩；知识库文件面板默认收起 |
| `max-width: 900px` / `640px` | 知识库双栏改为单栏、图谱控件收紧 |
| `hover: none` | 触屏隐藏悬停才出现的操作按钮（会话「更多」等） |
| `prefers-reduced-motion` | 关闭过渡与动画 |

字体优先 `PingFang SC`，容器统一 `box-sizing: border-box`，全站纯浅色主题。

---

## 11. 实现约定

- **状态不跨层**：`useChat` 只关心对话，`KnowledgeBase` / `Trace` / `Board` 各自管自己的页；
  靠 URL 切换，不共享业务状态。
- **请求全在 `api.ts`**：类型集中在 `types.ts`，返回值做一次形状归一（补默认值、滤空），
  组件里拿到的数据结构是可信的。
- **函数式纯逻辑单独成文件**：`lib/markdown.ts`、`lib/sessionTurns.ts`、`kb/tableGrid.ts`
  都不依赖 React，便于复用与验证。
- **注释写「为什么」**：代码里大量注释解释取舍（为什么不自动建图、为什么用 hash 路由、
  为什么恢复时覆盖而不是追加），改行为前先读注释。
- **所有浏览器 API 都要容错**：`localStorage`、`navigator.clipboard`、`window.open` 在隐私模式、
  非安全上下文、弹窗拦截下都可能失败，失败要降级而不是让页面崩掉。

---

## 12. 已知限制

- 知识库上传不支持断点续传，大文件失败需整体重传。
- 图谱检索依赖后端向量服务，`502` 时前端提示「向量化服务暂时不可用」，无本地缓存兜底。
- 会话搜索按钮（`ChatHeader`）目前只有图标占位，未接后端。
- 附件上传按钮同样为占位，尚未接入。
- `src/components/kb/ai_agent.code-workspace` 是误提交的编辑器工作区文件，可删除。
