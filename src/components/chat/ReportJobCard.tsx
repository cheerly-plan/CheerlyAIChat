import { useEffect, useMemo, useState } from 'react'
import { fetchReportJob } from '../../api'
import type { ReportJob } from '../../types'
import { resolveReportFilePath, useReportPreview } from './ReportPreviewContext'

// 深度层约 5–8 分钟：3s 一轮够快，也不会把后端打满
const POLL_INTERVAL_MS = 3000
// 兜底上限：任务表在内存里，异常任务不该被无限轮询
const POLL_TIMEOUT_MS = 40 * 60 * 1000

const FILE_LINK = /\[([^\]]+)\]\(\/v1\/report\/files\/[^\s)]+\)/g

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
}

export function ReportJobCard({ jobId }: Props) {
  const preview = useReportPreview()
  const [job, setJob] = useState<ReportJob | null>(null)
  const [error, setError] = useState('')
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
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
        // 404（进程重启丢了任务表）或网络错误：停止轮询，留一个手动重试
        setError(err instanceof Error ? err.message : '查询任务状态失败')
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
  }, [jobId, nonce])

  const links = useMemo(
    () => extractReportLinks(job?.result?.text),
    [job?.result?.text],
  )

  const status = job?.status ?? 'running'
  const progress = Math.max(0, Math.min(100, Math.round(job?.progress ?? 0)))
  const title = job ? TITLES[job.status] : '研报任务已提交'

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
          {links.length ? (
            <div className="report-job-links">
              {links.map((link) => (
                <button
                  key={link.path}
                  type="button"
                  className="report-job-link"
                  onClick={() => preview.open(link.path, link.label)}
                >
                  {link.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="report-job-note">
              报告已生成，但结果里没有可解析的下载链接；可到右侧审核队列或
              /v1/report/reviews 查看产物。
            </p>
          )}
          <p className="report-job-note">
            深度 PDF 与底稿分开审核：PDF 需管理员批准后才能下载，Markdown 可先看。
          </p>
        </>
      ) : null}
    </section>
  )
}
