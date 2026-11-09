import { useEffect, useMemo, useState } from 'react'
import { fetchReportJob } from '../../api'
import type { ReportJob } from '../../types'
import { DownloadIcon } from './icons'
import { resolveReportFilePath, useReportPreview } from './ReportPreviewContext'

// 深度层约 5–8 分钟：3s 一轮够快，也不会把后端打满
const POLL_INTERVAL_MS = 3000
// 兜底上限：任务表在内存里，异常任务不该被无限轮询
const POLL_TIMEOUT_MS = 40 * 60 * 1000

const FILE_LINK = /\[([^\]]+)\]\((\/v1\/report\/files\/[^\s)]+)\)/g

type FileLink = { label: string; path: string }

/** 从任务结果文本里拎出「[底稿 PDF](/v1/report/files/xxx)」这类下载链接 */
function extractReportLinks(text: string | null | undefined): FileLink[] {
  if (!text) return []
  const seen = new Set<string>()
  const links: FileLink[] = []
  for (const match of text.matchAll(FILE_LINK)) {
    const path = resolveReportFilePath(match[2] ?? '')
    if (!path || seen.has(path)) continue
    seen.add(path)
    links.push({ label: (match[1] || path).trim(), path })
  }
  return links
}

/** 从任务结果里挑「标题：/校验：」两行，成功卡片上当作结论摘要 */
function extractSummary(text: string | null | undefined): {
  title: string
  validation: string
} {
  if (!text) return { title: '', validation: '' }
  const pick = (label: string) => {
    const line = text.split('\n').find((item) => item.startsWith(label))
    return line ? line.slice(label.length).trim() : ''
  }
  return { title: pick('标题：'), validation: pick('校验：') }
}

function formatElapsed(seconds: number | undefined): string {
  const total = Math.max(0, Math.round(seconds ?? 0))
  if (total < 60) return `${total} 秒`
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`
}

const TITLES: Record<ReportJob['status'], string> = {
  queued: '任务排队中',
  running: '研报生成中',
  succeeded: '研报已生成',
  failed: '研报生成失败',
}

type Props = {
  jobId: string
  /** 任务完成时随消息落库的交付文本：有它就直接渲染结果，不再轮询 */
  delivery?: string
}

export function ReportJobCard({ jobId, delivery }: Props) {
  const preview = useReportPreview()
  const [job, setJob] = useState<ReportJob | null>(null)
  const [error, setError] = useState('')
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    // 交付文本已经在消息里：不碰接口，服务重启也不影响
    if (delivery) return
    let cancelled = false
    let timer: number | undefined
    const startedAt = Date.now()

    const tick = async () => {
      try {
        const next = await fetchReportJob(jobId)
        if (cancelled) return
        setJob(next)
        setError('')
        if (next.status === 'succeeded' || next.status === 'failed') return
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : '查询任务状态失败'
        // 404 = 进程重启丢了内存任务表；说得具体点，别让用户以为报告坏了
        setError(
          /没有找到|没有 job_id|not found/i.test(message)
            ? '任务记录已失效（服务重启会清空内存任务表），这次生成的结果无法再查询；需要的话重新发起一次生成。'
            : message,
        )
        return
      }
      if (cancelled || Date.now() - startedAt > POLL_TIMEOUT_MS) return
      timer = window.setTimeout(() => void tick(), POLL_INTERVAL_MS)
    }

    void tick()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [jobId, nonce, delivery])

  // 交付文本（随消息落库）优先：有它就不看任务，也不轮询
  const resultText = delivery || job?.result?.text
  const links = useMemo(() => extractReportLinks(resultText), [resultText])
  // 溯源/审核这类附属文件不进下载按钮组，降级成一行小字链接，主按钮只留报告本体
  const isAuxLink = (label: string) => /溯源|审核/.test(label)
  const primaryLinks = links.filter((link) => !isAuxLink(link.label))
  const auxLinks = links.filter((link) => isAuxLink(link.label))
  // 结果文本里有「深度 PDF 审核队列：/v1/report/reviews/<id>」，据此直连审核面板
  const reviewId = useMemo(() => {
    const match = /\/v1\/report\/reviews\/([0-9a-zA-Z_-]+)/.exec(resultText ?? '')
    return match?.[1] ?? ''
  }, [resultText])
  const summary = useMemo(() => extractSummary(resultText), [resultText])

  const status = delivery ? 'succeeded' : (job?.status ?? 'running')
  const progress = Math.max(0, Math.min(100, Math.round(job?.progress ?? 0)))
  const title = delivery ? TITLES.succeeded : job ? TITLES[job.status] : '研报任务已提交'

  return (
    <section className={`report-job report-job-${status}`}>
      <div className="report-job-head">
        <span className="report-job-dot" aria-hidden="true" />
        <span className="report-job-title">{title}</span>
        <span className="report-job-id" title={`job_id=${jobId}`}>
          #{jobId.slice(0, 8)}
        </span>
      </div>

      {error ? (
        <p className="report-job-error">
          任务状态查询失败：{error}
          <button
            type="button"
            className="report-job-retry"
            onClick={() => {
              setError('')
              setNonce((value) => value + 1)
            }}
          >
            重试
          </button>
        </p>
      ) : null}

      {!error && (status === 'running' || status === 'queued') ? (
        <>
          <p className="report-job-stage">{job?.stage || '任务已排入队列…'}</p>
          <div
            className="report-job-bar"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <p className="report-job-meta">
            {progress}% · 已用 {formatElapsed(job?.elapsed_seconds)}
          </p>
        </>
      ) : null}

      {!error && status === 'failed' ? (
        <p className="report-job-error">{job?.error || '任务失败，原因未知'}</p>
      ) : null}

      {!error && status === 'succeeded' ? (
        <>
          {summary.title ? (
            <p className="report-job-summary">{summary.title}</p>
          ) : null}
          {primaryLinks.length ? (
            <div className="report-job-files">
              {primaryLinks.map((link) => (
                <button
                  key={link.path}
                  type="button"
                  className="report-job-file"
                  title={link.label}
                  onClick={() => preview.open(link.path, link.label)}
                >
                  <DownloadIcon />
                  <span>{link.label}</span>
                </button>
              ))}
            </div>
          ) : null}
          {auxLinks.length ? (
            <p className="report-job-aux">
              {auxLinks.map((link, index) => (
                <span className="report-job-aux-item" key={link.path}>
                  {index ? <span className="report-job-aux-sep">·</span> : null}
                  <button
                    type="button"
                    className="report-job-aux-link"
                    onClick={() => {
                      // 「人工审核队列」打开审核面板（普通用户只能看到自己那份）
                      if (/审核/.test(link.label) && reviewId) {
                        preview.openReview(reviewId)
                        return
                      }
                      preview.open(link.path, link.label)
                    }}
                  >
                    {link.label}
                  </button>
                </span>
              ))}
            </p>
          ) : null}
          {!links.length ? (
            <p className="report-job-note">
              报告已生成，但结果里没有可解析的下载链接；可到右侧审核队列或
              /v1/report/reviews 查看产物。
            </p>
          ) : null}
          {summary.validation ? (
            <p className="report-job-note">校验：{summary.validation}</p>
          ) : null}
          <p className="report-job-note">
            深度层 PDF 可在线预览（红框为需人工审核的推断结论），需管理员批准定稿后才能下载。
          </p>
        </>
      ) : null}
    </section>
  )
}
