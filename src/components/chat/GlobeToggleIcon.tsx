import { memo, useEffect, useRef } from 'react'
import lottie from 'lottie-web/build/player/lottie_light'
import type { AnimationItem } from 'lottie-web'
import globeData from '../../assets/globe-search.json'

type Props = {
  enabled: boolean
  /** 关闭时是否倒放回初始帧（DeepSeek 同款为 true） */
  animateOff?: boolean
  size?: number
}

/**
 * 「智能搜索」地球开关图标 —— 复刻 DeepSeek 的 Lottie toggle 实现（其源码内 vi 组件）：
 * 图标是一段 30 帧、60fps 的经线滑动动画；
 * 开启时从当前帧正向播放到末帧，关闭时倒放回首帧，像拖动进度条一样顺滑往返。
 */
export const GlobeToggleIcon = memo(function GlobeToggleIcon({
  enabled,
  animateOff = true,
  size = 14,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<AnimationItem | null>(null)

  useEffect(() => {
    const anim = lottie.loadAnimation({
      container: boxRef.current!,
      renderer: 'svg',
      loop: false,
      autoplay: false,
      animationData: globeData,
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
    })
    animRef.current = anim
    return () => {
      anim.destroy()
      animRef.current = null
    }
  }, [])

  // 帧区间与 DeepSeek 一致：off = 首帧，on = 末帧前一帧
  const offFrame = globeData.ip ?? 0
  const onFrame = (globeData.op ?? 30) - offFrame - 1

  useEffect(() => {
    const anim = animRef.current
    if (!anim) return
    const target = enabled ? onFrame : offFrame
    const current = anim.firstFrame + anim.currentRawFrame
    if (current === target) return
    if (!enabled && !animateOff) {
      // 关闭且不播动画：直接跳回首帧
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
      className="globe-toggle-icon"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  )
})
