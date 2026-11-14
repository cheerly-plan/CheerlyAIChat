/**
 * 全站图标。
 *
 * ## 统一规范
 *
 * 所有图标都走**同一套描边体系**：24×24 坐标系、`stroke-width: 1.75`、
 * 圆头圆角（`round` 端点与连接）、`currentColor` 跟随文字颜色。
 * 显示尺寸通过 `size` 属性指定，默认 16px，CSS 也可以覆盖。
 *
 * 为什么统一到 24 而不是 16：24 单位下 1.75 的线宽在 16px 显示时约合
 * 1.17px，既清晰又不显粗；16 单位下同样观感要画 1.17，取值别扭且缩放
 * 到 20/24px 时容易糊。统一坐标系后，任何尺寸下视觉重量都一致。
 *
 * 历史上这里混过三套 viewBox（16/24/14）和四种线宽（1.4~1.8），换算到
 * 实际像素是 1.06px~1.60px，同一行图标粗细不齐——这是本次统一的原因。
 *
 * ## 约定
 *
 * - 只用描边，不用实心填充（除少数必须实心才认得出的细节，如圆点）
 * - 不硬编码颜色，一律 `currentColor`，让图标跟随主题与交互状态
 * - 组件签名统一为 `({ size = 16 }: IconProps)`，需要额外状态的在前面
 */

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

type IconProps = { size?: number }

/** 所有图标的外壳。集中处理 viewBox、线宽、无障碍属性。 */
function Icon({ size = 16, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      {...STROKE}
    >
      {children}
    </svg>
  )
}

/* ============ 导航与布局 ============ */

/** 侧栏折叠 / 展开 */
export function PanelIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M9 4v16" />
    </Icon>
  )
}

/** 返回 */
export function BackIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="m15 5-7 7 7 7" />
    </Icon>
  )
}

export function ChevronDownIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  )
}

export function ChevronLeftIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="m14 6-6 6 6 6" />
    </Icon>
  )
}

export function ChevronRightIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="m10 6 6 6-6 6" />
    </Icon>
  )
}

export function ArrowRightIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </Icon>
  )
}

/** 跳转（外部 / 定位到条目） */
export function JumpIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M4 12h14" />
      <path d="m13 6 6 6-6 6" />
    </Icon>
  )
}

/* ============ 操作 ============ */

export function CloseIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  )
}

export function PlusIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  )
}

export function MoreIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </Icon>
  )
}

export function SearchIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4 4" />
    </Icon>
  )
}

export function UploadIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M12 16V5" />
      <path d="m7.5 9.5 4.5-4.5 4.5 4.5" />
      <path d="M4.5 15v2.5A2.5 2.5 0 0 0 7 20h10a2.5 2.5 0 0 0 2.5-2.5V15" />
    </Icon>
  )
}

export function DownloadIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M12 4v10" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M5 16.5v1.5A2 2 0 0 0 7 20h10a2 2 0 0 0 2-2v-1.5" />
    </Icon>
  )
}

export function TrashIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M4 7h16" />
      <path d="M9 7V5.2A1.2 1.2 0 0 1 10.2 4h3.6A1.2 1.2 0 0 1 15 5.2V7" />
      <path d="M6.5 7 5.3 19.2A2 2 0 0 0 7.3 21.5h9.4a2 2 0 0 0 2-2.3L18.5 7" />
      <path d="M10 11v5M14 11v5" />
    </Icon>
  )
}

export function CopyIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M15 6.5A2.5 2.5 0 0 0 12.5 4h-7A2.5 2.5 0 0 0 3 6.5v7A2.5 2.5 0 0 0 5.5 16" />
    </Icon>
  )
}

export function CheckIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="m4.5 12.5 5 5 10-11" />
    </Icon>
  )
}

export function RefreshIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v5h-5" />
    </Icon>
  )
}

export function EditIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M4 16.5V20h3.5L19 8.5 15.5 5 4 16.5Z" />
      <path d="M13.5 7 17 10.5" />
      <path d="M13 20h7" />
    </Icon>
  )
}

export function SendIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M12 20V5" />
      <path d="m6.5 10.5 5.5-5.5 5.5 5.5" />
    </Icon>
  )
}

export function StopIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <rect x="6" y="6" width="12" height="12" rx="3" fill="currentColor" stroke="none" />
    </Icon>
  )
}

export function PaperclipIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M19 11.5 11.6 19a4.6 4.6 0 0 1-6.5-6.5l8-8a3.1 3.1 0 0 1 4.4 4.4l-8 8a1.6 1.6 0 0 1-2.2-2.2l7.4-7.4" />
    </Icon>
  )
}

export function TagIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M3.5 12.2V5.5a2 2 0 0 1 2-2h6.7c.5 0 1 .2 1.4.6l6.3 6.3a2 2 0 0 1 0 2.8l-6.7 6.7a2 2 0 0 1-2.8 0l-6.3-6.3a2 2 0 0 1-.6-1.4Z" />
      <circle cx="8.3" cy="8.3" r="1.4" fill="currentColor" stroke="none" />
    </Icon>
  )
}

/* ============ 状态与提示 ============ */

export function WarningIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M12 4.5 21 20H3l9-15.5Z" />
      <path d="M12 10v4.5" />
      <circle cx="12" cy="17.5" r="0.9" fill="currentColor" stroke="none" />
    </Icon>
  )
}

/* ============ 功能入口 ============ */

/** 设置：齿轮（外圈带齿 + 中心孔，小尺寸清晰） */
export function SettingsIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M12 3.2a8.8 8.8 0 1 0 8.8 8.8A8.8 8.8 0 0 0 12 3.2Z" />
      <path d="M12 1.5v2.8M12 19.7v2.8M1.5 12h2.8M19.7 12h2.8M4.6 4.6l2 2M17.4 17.4l2 2M19.4 4.6l-2 2M6.6 17.4l-2 2" />
      <circle cx="12" cy="12" r="3.4" />
    </Icon>
  )
}

/** 记忆：书签 */
export function MemoryIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </Icon>
  )
}

export function LogoutIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M9.5 3.5H6a2.5 2.5 0 0 0-2.5 2.5v12A2.5 2.5 0 0 0 6 20.5h3.5" />
      <path d="M15.5 16.5 21 12l-5.5-4.5" />
      <path d="M21 12H9" />
    </Icon>
  )
}

/** 新建会话 */
export function NewChatIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M12 3.5a8.5 8.5 0 1 1-5.9 14.6" />
      <path d="M12 8v8M8 12h8" />
    </Icon>
  )
}

/** 过程追踪 */
export function TraceIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M5 6.5h9M5 12h14M5 17.5h9" />
      <circle cx="17.5" cy="6.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="17.5" r="1.3" fill="currentColor" stroke="none" />
    </Icon>
  )
}

/** 图谱重建进度 */
export function GraphRefreshIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v5h-5" />
    </Icon>
  )
}

/* ============ 过程追踪里的步骤图标 ============ */

export function MessageIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M21 17a2 2 0 0 1-2 2H7l-4 3.2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
    </Icon>
  )
}

export function WrenchIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M15 7a3.5 3.5 0 0 1 4.6-3.3l-2.3 2.3 1.7 1.7 2.3-2.3A3.5 3.5 0 0 1 17.8 10l-8.6 8.6a2.1 2.1 0 0 1-3-3Z" />
    </Icon>
  )
}

export function TerminalIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="m7.5 10 2.5 2.5-2.5 2.5" />
      <path d="M13 15h4" />
    </Icon>
  )
}

export function SparklesIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9Z" />
      <path d="M18.5 4v3M20 5.5h-3" />
    </Icon>
  )
}

/* ============ 业务模块（ai_agent_backend 四层模块） ============ */

/** 智能体：机器人头 + 天线 */
export function AgentIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <rect x="3.5" y="7" width="17" height="12.5" rx="3" />
      <path d="M12 7V4.6" />
      <circle cx="12" cy="3.6" r="1.4" />
      <circle cx="8.7" cy="12.8" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15.3" cy="12.8" r="1.2" fill="currentColor" stroke="none" />
      <path d="M9.5 16.2c1.4 1.2 3.6 1.2 5 0" />
    </Icon>
  )
}

/** 会话管理：消息气泡 + 会话 */
export function SessionIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M3 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3.5V16a2 2 0 0 1-2-2Z" />
      <path d="M7 7.5h10M7 11h6" />
      <circle cx="17" cy="11" r="1.3" fill="currentColor" stroke="none" />
    </Icon>
  )
}

/** 用户鉴权：用户 + 锁 */
export function AuthIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <circle cx="7.5" cy="7" r="2.8" />
      <path d="M2.5 19c0-3 2.2-5.5 5-5.5 1.8 0 3.4.8 4.3 2.1" />
      <rect x="13.5" y="13.5" width="7.5" height="6.5" rx="1.5" />
      <path d="M15.5 13.5v-2a1.8 1.8 0 0 1 3.6 0v2" />
      <circle cx="17.3" cy="16.8" r="1" fill="currentColor" stroke="none" />
    </Icon>
  )
}

/** 工具调用：芯片 + 闪电 */
export function ToolIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M10 7V4M14 7V4M10 17v3M14 17v3M7 10H4M7 14H4M17 10h3M17 14h3" />
      <path d="m12.8 9.5-2.6 3.1h1.7l-.6 2.4 2.9-3.3h-1.8z" fill="currentColor" stroke="none" />
    </Icon>
  )
}

/** 知识库：打开的书 */
export function KnowledgeBaseIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M12 6c-2-1.4-4.8-2-8-1.5V18c3.2-.5 6-.1 8 1.4 2-1.5 4.8-1.9 8-1.4V4.5c-3.2-.5-6 .1-8 1.5Z" />
      <path d="M12 6v13.4" />
      <path d="M6.5 8.5h3M6.5 11.5h3M14.5 8.5h3M14.5 11.5h3" />
      <path d="M15.5 2.5h3v4.3l-1.5-1-1.5 1z" />
    </Icon>
  )
}

/** 知识图谱：实体节点 + 关系边 */
export function GraphIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="m7.2 7.6 2.7 2.5M16.8 7.6l-2.7 2.5M12 15.2v1" />
      <circle cx="5.5" cy="6" r="2.2" />
      <circle cx="18.5" cy="6" r="2.2" />
      <circle cx="12" cy="18" r="1.8" />
      <circle cx="12" cy="12" r="3.1" />
    </Icon>
  )
}

/** 混合检索：漏斗 + 命中勾 */
export function HybridSearchIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M3.5 5h17L14 12.5V19h-4v-6.5Z" />
      <path d="M6.8 8.2h1.8M15.4 8.2h1.8" />
      <path d="m9.3 10.6 1.7 1.7 3.4-3.4" />
    </Icon>
  )
}

/** 向量数据库：存储桶 + 向量点 */
export function VectorStoreIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <ellipse cx="12" cy="5" rx="7" ry="2.5" />
      <path d="M5 5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V5" />
      <path d="M5 11.5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
      <circle cx="12" cy="8.2" r="1.5" />
    </Icon>
  )
}

/** 记忆系统：分层记忆 */
export function MemoryLayersIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <rect x="3" y="3.5" width="18" height="4.5" rx="1.5" />
      <rect x="3" y="9.5" width="18" height="4.5" rx="1.5" />
      <rect x="3" y="15.5" width="18" height="4.5" rx="1.5" />
      <path d="M6 5.75h5M6 11.75h5M6 17.75h5" />
      <circle cx="17.5" cy="5.75" r="1.3" fill="currentColor" stroke="none" />
    </Icon>
  )
}

/** 断点续跑：回环续播 */
export function ResumeIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M4.5 12a7.5 7.5 0 0 1 12.3-5.2" />
      <path d="m17.2 3.5 0 3.7-3.7 0" />
      <path d="M19.5 12a7.5 7.5 0 0 1-12.3 5.2" />
      <path d="m6.8 20.5 0-3.7 3.7 0" />
      <path d="m10.5 9.3 4.7 2.7-4.7 2.7z" fill="currentColor" stroke="none" />
    </Icon>
  )
}

/** 研报生成：文档 + 图表。开启时描边加粗一档以区分状态。 */
export function ReportGenerateIcon({ enabled = false, size }: IconProps & { enabled?: boolean }) {
  return (
    <Icon size={size}>
      <path d="M6 3.5h7l5 5v12a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20.5Z" strokeWidth={enabled ? 2 : 1.75} />
      <path d="M13 3.5v5h5" />
      <path d="M8 17.5v-3M12 17.5V12M16 17.5v-2.5" />
      <path d="m7.5 10.5 2.3-1.9 1.7 1 2-2.2" />
    </Icon>
  )
}

/** 审核门禁：文档 + 放行勾 */
export function ReviewGateIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H12l4 4.5V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 19Z" />
      <path d="M12 3v4.5h4" />
      <path d="M6 11h6M6 14h6M6 17h3" />
      <circle cx="17" cy="16.5" r="3.5" />
      <path d="m15.6 16.5 1.1 1.1 1.9-1.9" />
    </Icon>
  )
}

/** 异步任务：进度环 + 运行 */
export function AsyncTaskIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 8 8" />
      <path d="m10.5 8.7 5 3.3-5 3.3z" fill="currentColor" stroke="none" />
    </Icon>
  )
}

/** 评测基线：靶心 + 实测命中 */
export function EvalBaselineIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 12 14.2 9.8" />
      <circle cx="14.6" cy="9.4" r="1.6" />
    </Icon>
  )
}

/* ============ 带状态的开关（保留 Lottie 动画） ============ */

/** 知识库开关：合上的书 / 打开的书，动画与「智能搜索」地球开关同一套 Lottie 往返 */
export { BookToggleIcon as KbIcon } from './BookToggleIcon'
