/**
 * Copyright 2025 The MOQtail Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { telemetryDB, TelemetryStreamType } from '@/util/telemetryDB'

export interface StartupLatencyMetric {
  type: 'startup-latency'
  userId: string
  userName: string
  startTime: number
  endTime: number
  duration: number
  timestamp: string
  notes: string
}

export interface QualityToggleMetric {
  type: 'quality-toggle'
  userId: string
  userName: string
  direction: 'HD->SD' | 'SD->HD'
  startTime: number
  endTime: number
  duration: number
  timestamp: string
}

export interface PeriodicMonitoringMetric {
  type: 'periodic-monitoring'
  userId: string
  userName: string
  wallClock: number
  latency: number
  quality: 'SD' | 'HD'
  videoBitrate: number
  audioBitrate: number
  timestamp: string
}

export interface RewindMetric {
  type: 'rewind'
  userId: string
  userName: string
  action: 'rewind-button-pressed' | 'rewind-playback-started' | 'rewind-closed' | 'first-frame-after-rewind'
  time: number
  timestamp: string
  notes: string
}

export interface SubscriptionMetric {
  type: 'subscription'
  userId: string
  userName: string
  action: 'unsub-video' | 'resub-video' | 'unsub-audio' | 'resub-audio'
  startTime: number
  endTime?: number
  duration?: number
  timestamp: string
}

export type TestMetric =
  | StartupLatencyMetric
  | QualityToggleMetric
  | PeriodicMonitoringMetric
  | RewindMetric
  | SubscriptionMetric

export class TestMetricsManager {
  private metrics: TestMetric[] = []
  private startupTrackingMap: Map<string, number> = new Map()
  private qualityToggleTrackingMap: Map<string, { startTime: number; direction: 'HD->SD' | 'SD->HD' }> = new Map()
  private rewindTrackingMap: Map<string, { rewindButtonPressed?: number; rewindPlaybackStarted?: number }> = new Map()
  private subscriptionTrackingMap: Map<string, { videoResub?: number; audioResub?: number }> = new Map()

  constructor() {}

  trackStartupJoinButtonClick(userId: string) {
    this.startupTrackingMap.set(userId, Date.now())
  }

  trackStartupFirstFrame(sessionId: string, userId: string, userName: string, hasCam: boolean) {
    const startTime = this.startupTrackingMap.get(userId)
    if (!startTime) {
      console.log(`[Startup] No start time found for participant: ${userId}`)
      return
    }

    const endTime = Date.now()
    const duration = endTime - startTime

    const metric: StartupLatencyMetric = {
      type: 'startup-latency',
      userId,
      userName,
      startTime,
      endTime,
      duration,
      timestamp: new Date().toISOString(),
      notes: hasCam ? `First frame rendered` : 'N/A - Camera off',
    }

    telemetryDB.addEntry({
      sessionId,
      userId,
      userName,
      streamType: TelemetryStreamType.StartupLatency,
      timestamp: Date.now(),
      value: duration,
    })

    console.log('StartupLatency: ', metric.duration, 'ms')
    this.startupTrackingMap.delete(userId)
  }

  // ===== Test 2: Quality Toggle =====
  trackQualityToggleStart(_sessionId: string, userId: string, direction: 'HD->SD' | 'SD->HD') {
    const startTime = Date.now()
    this.qualityToggleTrackingMap.set(userId, { startTime, direction })
  }

  trackQualityToggleComplete(sessionId: string, userId: string, userName: string) {
    const tracking = this.qualityToggleTrackingMap.get(userId)
    if (!tracking) {
      return
    }

    const endTime = Date.now()
    const duration = endTime - tracking.startTime

    const metric: QualityToggleMetric = {
      type: 'quality-toggle',
      userId,
      userName,
      direction: tracking.direction,
      startTime: tracking.startTime,
      endTime,
      duration,
      timestamp: new Date().toISOString(),
    }

    if (tracking.direction === 'HD->SD') {
      console.log('HD->SD Toggle: ', metric.duration, 'ms')
    }
    if (tracking.direction === 'SD->HD') {
      console.log('SD->HD Toggle: ', metric.duration, 'ms')
    }
    this.qualityToggleTrackingMap.delete(userId)

    telemetryDB.addEntry({
      sessionId,
      userId,
      userName,
      streamType:
        tracking.direction === 'HD->SD'
          ? TelemetryStreamType.HdToSdToggleLatency
          : TelemetryStreamType.SdToHdToggleLatency,
      timestamp: Date.now(),
      value: duration,
    })
  }

  // ===== Periodic Monitoring removed (not needed for the 3 requested metrics) =====

  // ===== Test 3: Rewind Timing =====
  trackRewindButtonPressed(_sessionId: string, userId: string) {
    const time = Date.now()
    this.rewindTrackingMap.set(userId, { rewindButtonPressed: time })
  }

  trackRewindPlaybackStarted(sessionId: string, userId: string, userName: string) {
    const time = Date.now()
    const tracking = this.rewindTrackingMap.get(userId)

    const metric: RewindMetric = {
      type: 'rewind',
      userId,
      userName,
      action: 'rewind-playback-started',
      time,
      timestamp: new Date().toISOString(),
      notes: tracking?.rewindButtonPressed
        ? `Duration from button press: ${time - tracking.rewindButtonPressed}ms`
        : 'No button press tracked',
    }

    // Log Rewind Latency
    console.log('Rewind Latency: ', metric.time - tracking?.rewindButtonPressed!, 'ms')

    if (tracking) {
      this.rewindTrackingMap.set(userId, { ...tracking, rewindPlaybackStarted: time })

      // add to telemetryDB
      telemetryDB
        .addEntry({
          sessionId,
          userId,
          userName,
          streamType: TelemetryStreamType.RewindLatency,
          timestamp: Date.now(),
          value: time - tracking.rewindButtonPressed!,
        })
        .then(() => {
          console.log('Rewind Latency metric saved to telemetryDB')
        })
        .catch((error: any) => {
          console.error('Error saving Rewind Latency metric to telemetryDB:', error)
        })
    }
  }

  trackVideoResubStart(_sessionId: string, userId: string) {
    const time = Date.now()
    const tracking = this.subscriptionTrackingMap.get(userId) || {}
    this.subscriptionTrackingMap.set(userId, { ...tracking, videoResub: time })
  }

  trackVideoResubComplete(sessionId: string, userId: string, userName: string) {
    const tracking = this.subscriptionTrackingMap.get(userId)
    const startTime = tracking?.videoResub
    const endTime = Date.now()

    if (startTime) {
      const metric: SubscriptionMetric = {
        type: 'subscription',
        userId,
        userName,
        action: 'resub-video',
        startTime,
        endTime,
        duration: endTime - startTime,
        timestamp: new Date().toISOString(),
      }

      this.metrics.push(metric)

      const { videoResub, ...rest } = tracking
      this.subscriptionTrackingMap.set(userId, rest)

      // add to telemetryDB
      telemetryDB
        .addEntry({
          sessionId,
          userId,
          userName,
          streamType: TelemetryStreamType.VideoResubLatency,
          timestamp: Date.now(),
          value: metric.duration!,
        })
        .then(() => {
          console.log('Video Resub Latency metric saved to telemetryDB')
        })
        .catch((error: any) => {
          console.error('Error saving Video Resub Latency metric to telemetryDB:', error)
        })

      console.log(`Video Resubcription Latency for ${userName}: ${metric.duration}ms`)
    }
  }

  trackAudioResubStart(_sessionId: string, userId: string) {
    const time = Date.now()
    const tracking = this.subscriptionTrackingMap.get(userId) || {}
    this.subscriptionTrackingMap.set(userId, { ...tracking, audioResub: time })
  }

  trackAudioResubComplete(sessionId: string, userId: string, userName: string) {
    const tracking = this.subscriptionTrackingMap.get(userId)
    const startTime = tracking?.audioResub
    const endTime = Date.now()

    if (startTime) {
      const metric: SubscriptionMetric = {
        type: 'subscription',
        userId,
        userName,
        action: 'resub-audio',
        startTime,
        endTime,
        duration: endTime - startTime,
        timestamp: new Date().toISOString(),
      }

      this.metrics.push(metric)

      // Clear audio resub tracking
      const { audioResub, ...rest } = tracking
      this.subscriptionTrackingMap.set(userId, rest)

      // add to telemetryDB
      telemetryDB
        .addEntry({
          sessionId,
          userId,
          userName,
          streamType: TelemetryStreamType.AudioResubLatency,
          timestamp: Date.now(),
          value: metric.duration!,
        })
        .then(() => {
          console.log('Audio Resub Latency metric saved to telemetryDB')
        })
        .catch((error: any) => {
          console.error('Error saving Audio Resub Latency metric to telemetryDB:', error)
        })

      console.log(`Audio Resubcription Latency for ${userName}: ${metric.duration}ms`)
    }
  }
}
