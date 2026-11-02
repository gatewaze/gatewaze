'use client'

import { useMemo, useSyncExternalStore } from 'react'

interface TimeLeft {
  days: number
  hours: number
  minutes: number
  seconds: number
  isExpired: boolean
}

const EXPIRED: TimeLeft = {
  days: 0,
  hours: 0,
  minutes: 0,
  seconds: 0,
  isExpired: true,
}

// The clock as an external store: ticks once a second while subscribed. The
// snapshot is the current whole second (stable between ticks); the server
// snapshot is null, so SSR and hydration render the expired default as before.
function subscribeEverySecond(onTick: () => void) {
  const interval = setInterval(onTick, 1000)
  return () => clearInterval(interval)
}
const subscribeNever = () => () => {}
const getNowSecond = () => Math.floor(Date.now() / 1000)
const getNoTime = () => null

function calculateTimeLeft(targetDate: string, now: number): TimeLeft {
  const target = new Date(targetDate).getTime()
  const difference = target - now

  if (difference <= 0) {
    return EXPIRED
  }

  const days = Math.floor(difference / (1000 * 60 * 60 * 24))
  const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60))
  const seconds = Math.floor((difference % (1000 * 60)) / 1000)

  return {
    days,
    hours,
    minutes,
    seconds,
    isExpired: false,
  }
}

/**
 * Real-time countdown hook
 * Updates every second with time remaining until target date
 */
export function useCountdown(targetDate: string | null): TimeLeft {
  const nowSecond = useSyncExternalStore(
    targetDate ? subscribeEverySecond : subscribeNever,
    targetDate ? getNowSecond : getNoTime,
    getNoTime,
  )

  return useMemo(
    () => (targetDate && nowSecond !== null ? calculateTimeLeft(targetDate, nowSecond * 1000) : EXPIRED),
    [targetDate, nowSecond],
  )
}
