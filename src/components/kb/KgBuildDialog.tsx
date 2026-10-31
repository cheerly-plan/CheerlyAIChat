import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { CheckIcon, ChevronDownIcon, CloseIcon } from '../chat/icons'
import type { KgDocType } from '../../api'

type Props = {
  filename: string
  /** 可选文档类型：已经过滤掉 general（它等于「不选」） */
  docTypes: KgDocType[]
  /** 表单初值：重建时预填当前图用的配置，首次构建为空（= 通用） */
  initialDocType: string
  initialLevel: 'full' | 'light'
  /** 是否已有图谱：决定标题、提交按钮文案与覆盖提示 */
  hasGraph: boolean
  submitting?: boolean
  /** 提交失败的服务端文案：留在弹窗里显示，不关弹窗（选择还在） */
  error?: string
  onCancel: () => void
  onSubmit: (config: { docType: string; level: 'full' | 'light' }) => void
}

/**
 * 建图配置弹窗：文档类型 + 抽取粒度。
 *
 * 为什么从行内搬到弹窗：这两个参数决定「这次要从切片里抽出什么」，是
 * 一次十几分钟算力的事，值得让人确认一遍；行内下拉太轻，误点一下就换
 * 配置重抽了，而且行内也没空间把「这类文档重点抽什么」说清楚。
 *
 * 表单只在提交时生效，取消即丢弃——不再有「先存库、等重建才生效」那种
 * 中间态（库里的配置和眼前的图对不上）。
 */
export function KgBuildDialog({
  filename,
  docTypes,
  initialDocType,
  initialLevel,
  hasGraph,
  submitting = false,
  error: surfaceError,
  onCancel,
  onSubmit,
}: Props) {
  const titleId = useId()
  const [docType, setDocType] = useState(initialDocType)
  const [level, setLevel] = useState<'full' | 'light'>(initialLevel)

  // 自绘下拉：原生 <select> 的展开列表是操作系统画的（灰底、对勾、比弹窗
  // 还宽），和弹窗的圆角/阴影/字号完全两套语言，只能整体换掉
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const wrapRef = useRef<HTMLDivElement>(null)
  // 菜单最大高度按弹窗内的剩余空间算：写死一个值，等文档类型多了就会顶到
  // 弹窗外（浮层没有被裁剪，超出部分会飘在弹窗下方的遮罩上）
  const [menuMax, setMenuMax] = useState(0)

  const options = useMemo(
    () => [{ key: '', label: '通用文档' }, ...docTypes.map((item) => ({ key: item.key, label: item.label }))],
    [docTypes],
  )

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // 输入法组合中按 Esc 是取消候选，不该顺手关掉弹窗
      if (event.key !== 'Escape' || event.isComposing) return
      // 下拉开着时 Esc 只收下拉，不连带关弹窗
      if (menuOpen) {
        setMenuOpen(false)
        return
      }
      onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, menuOpen])

  // 量一次可用高度：触发框下沿到弹窗下沿，减掉 6px 间距 + 8px 留白
  useEffect(() => {
    if (!menuOpen) return
    const measure = () => {
      const wrap = wrapRef.current
      const dialog = wrap?.closest('.session-dialog')
      if (!wrap || !dialog) return
      const space =
        dialog.getBoundingClientRect().bottom - wrap.getBoundingClientRect().bottom - 14
      setMenuMax(Math.max(96, space))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [menuOpen])

  // 点菜单外任意处收起
  useEffect(() => {
    if (!menuOpen) return
    function onDown(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  // 键盘上下移动时让高亮项保持在可视区
  useEffect(() => {
    if (!menuOpen || activeIdx < 0) return
    wrapRef.current
      ?.querySelector(`[data-idx="${activeIdx}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [menuOpen, activeIdx])

  const openMenu = () => {
    setActiveIdx(Math.max(0, options.findIndex((item) => item.key === docType)))
    setMenuOpen(true)
  }

  const pick = (key: string) => {
    setDocType(key)
    setMenuOpen(false)
  }

  const onMenuKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!menuOpen) openMenu()
      else setActiveIdx((idx) => Math.min(idx + 1, options.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (menuOpen) setActiveIdx((idx) => Math.max(idx - 1, 0))
    } else if ((event.key === 'Enter' || event.key === ' ') && menuOpen) {
      event.preventDefault()
      if (options[activeIdx]) pick(options[activeIdx].key)
    }
  }

  const picked = docTypes.find((item) => item.key === docType)
  const changed =
    docType !== initialDocType || level !== initialLevel

  const submit = () => {
    if (submitting) return
    onSubmit({ docType, level })
  }

  return (
    <div className="session-dialog-mask" onClick={onCancel}>
      <div
        className="session-dialog kb-build-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="session-dialog-head">
          <h3 id={titleId}>{hasGraph ? '重建图谱' : '构建图谱'}</h3>
          <button
            type="button"
            className="session-dialog-close"
            aria-label="关闭"
            onClick={onCancel}
          >
            <CloseIcon />
          </button>
        </div>

        <p className="kb-build-file" title={filename}>
          {filename}
        </p>

        <div className="kb-build-field">
          <span className="kb-build-label" id={`${titleId}-doc`}>
            文档类型
          </span>
          <div
            ref={wrapRef}
            className={`kb-build-select-wrap${menuOpen ? ' is-open' : ''}`}
            onKeyDown={onMenuKeyDown}
          >
            <button
              type="button"
              className="kb-build-select"
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
              aria-labelledby={`${titleId}-doc`}
              autoFocus
              onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())}
            >
              <span className="kb-build-select-label">
                {options.find((item) => item.key === docType)?.label ?? '通用文档'}
              </span>
              <ChevronDownIcon />
            </button>
            {menuOpen ? (
              <ul
                className="kb-build-menu"
                role="listbox"
                aria-labelledby={`${titleId}-doc`}
                style={menuMax ? { maxHeight: menuMax } : undefined}
              >
                {options.map((item, idx) => (
                  <li key={item.key || '__general'}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={item.key === docType}
                      data-idx={idx}
                      className={`kb-build-option${item.key === docType ? ' is-on' : ''}${
                        idx === activeIdx ? ' is-active' : ''
                      }`}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => pick(item.key)}
                    >
                      <span className="kb-build-option-text">{item.label}</span>
                      {item.key === docType ? <CheckIcon /> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <p className="kb-build-note">
            {picked
              ? `重点抽：${picked.entity_scope.slice(0, 6).join('、') || '按该类文档的默认范围'}${
                  picked.entity_scope.length > 6 ? ' 等' : ''
                }`
              : '不限定实体范围，按基础规则抽原文里的专有名词与它们之间的关系。'}
          </p>
        </div>

        <div className="kb-build-field">
          <span className="kb-build-label">抽取粒度</span>
          <div className="kb-build-levels" role="group" aria-label="抽取粒度">
            {(
              [
                {
                  key: 'full',
                  label: '完整',
                  note: '尽量抽全实体与关系，图谱更密，耗时更长',
                },
                {
                  key: 'light',
                  label: '轻量',
                  note: '只留主干：主体、主产品、核心指标，跳过零散名词',
                },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                type="button"
                className={level === item.key ? 'is-on' : ''}
                aria-pressed={level === item.key}
                onClick={() => setLevel(item.key)}
              >
                <b>{item.label}</b>
                <i>{item.note}</i>
              </button>
            ))}
          </div>
        </div>

        <p className="kb-build-hint">
          {hasGraph
            ? '重建会按这套配置从当前切片重抽一遍，覆盖现有图谱；切片与对话检索不受影响。'
            : '从当前切片文本抽取实体与关系，可以在构建过程中继续使用切片检索。'}
        </p>

        {surfaceError ? <p className="kb-build-error">{surfaceError}</p> : null}

        <div className="session-dialog-actions">
          <button
            type="button"
            className="ghost"
            onClick={onCancel}
            disabled={submitting}
          >
            取消
          </button>
          <button
            type="button"
            className="primary"
            onClick={submit}
            disabled={submitting}
            title={changed ? '按这套配置重抽' : '沿用现有配置再抽一遍'}
          >
            {submitting
              ? '提交中…'
              : hasGraph
                ? changed
                  ? '按此配置重抽'
                  : '重新生成'
                : '开始构建'}
          </button>
        </div>
      </div>
    </div>
  )
}
