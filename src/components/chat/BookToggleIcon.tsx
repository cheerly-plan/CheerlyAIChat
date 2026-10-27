import { memo, useEffect, useRef } from 'react'
import lottie from 'lottie-web/build/player/lottie_light'
import type { AnimationItem } from 'lottie-web'
import bookData from '../../assets/book-open.json'

type Props = {
  enabled: boolean
  /** 关闭时是否倒放回合上的书（与智能搜索地球开关一致，默认 true） */
  animateOff?: boolean
  size?: number
}

/**
 * 「知识库」书本开关图标 —— 交互对齐 GlobeToggleIcon：
 * 30 帧 / 60fps；未开启是合上的书，开启正向翻开，关闭倒放合上。
 */
export const BookToggleIcon = memo(function BookToggleIcon({
  enabled,
  animateOff = true,
  size = 16,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<AnimationItem | null>(null)

  useEffect(() => {
    const anim = lottie.loadAnimation({
      container: boxRef.current!,
      renderer: 'svg',
      loop: false,
      autoplay: false,
      animationData: bookData,
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
    })
    animRef.current = anim
    return () => {
      anim.destroy()
      animRef.current = null
    }
  }, [])

  const offFrame = bookData.ip ?? 0
  const onFrame = (bookData.op ?? 30) - offFrame - 1

  useEffect(() => {
    const anim = animRef.current
    if (!anim) return
    const target = enabled ? onFrame : offFrame
    const current = anim.firstFrame + anim.currentRawFrame
    if (current === target) return
    if (!enabled && !animateOff) {
      anim.segments.length = 0
      anim.firstFrame = offFrame
      anim.totalFrames = onFrame + 1
      anim.timeCompleted = anim.totalFrames
      anim.goToAndStop(target, true)
      return
    }
    anim.playSegments([current, target], true)
  }, [enabled, animateOff, offFrame, onFrame])

  return (
    <div
      ref={boxRef}
      className="book-toggle-icon"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  )
})
