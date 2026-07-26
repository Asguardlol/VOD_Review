import { useEffect, useRef, useState } from 'react'
import { TimelineEngine, type TimelineState } from '../core/timeline'

const EMPTY_STATE: TimelineState = {
  positionMs: 0,
  playing: false,
  stalled: false,
  stalledPovIds: [],
}

/**
 * Owns one TimelineEngine for the lifetime of a review view.
 *
 * The engine pushes a new state object on every tick (~400ms) and on every
 * command, which is what keeps the scrubber moving.
 */
export function useTimeline(): {
  engine: TimelineEngine
  state: TimelineState
} {
  const [state, setState] = useState<TimelineState>(EMPTY_STATE)
  const engineRef = useRef<TimelineEngine | null>(null)

  if (engineRef.current === null) {
    engineRef.current = new TimelineEngine(() => {
      // Read through the ref: the engine calls this from a timer, long after
      // this closure was created.
      const engine = engineRef.current
      if (engine) setState(engine.state)
    })
  }

  useEffect(() => {
    const engine = engineRef.current
    return () => engine?.destroy()
  }, [])

  return { engine: engineRef.current, state }
}
