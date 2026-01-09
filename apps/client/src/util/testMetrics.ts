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

export interface StartupLatencyMetric {
  type: 'startup-latency'
  participantId: string
  participantName: string
  startTime: number
  endTime: number
  duration: number
  timestamp: string
  notes: string
}

export interface QualityToggleMetric {
  type: 'quality-toggle'
  participantId: string
  participantName: string
  direction: 'HD->SD' | 'SD->HD'
  startTime: number
  endTime: number
  duration: number
  timestamp: string
}

export interface PeriodicMonitoringMetric {
  type: 'periodic-monitoring'
  participantId: string
  participantName: string
  wallClock: number
  latency: number
  quality: 'SD' | 'HD'
  videoBitrate: number
  audioBitrate: number
  timestamp: string
}

export interface RewindMetric {
  type: 'rewind'
  participantId: string
  participantName: string
  action: 'rewind-button-pressed' | 'rewind-playback-started' | 'rewind-closed' | 'first-frame-after-rewind'
  time: number
  timestamp: string
  notes: string
}

export interface SubscriptionMetric {
  type: 'subscription'
  participantId: string
  participantName: string
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

  trackStartupJoinButtonClick(participantId: string) {
    this.startupTrackingMap.set(participantId, Date.now())
  }

  trackStartupFirstFrame(participantId: string, participantName: string, hasCam: boolean) {
    const startTime = this.startupTrackingMap.get(participantId)
    if (!startTime) {
      console.log(`[Startup] No start time found for participant: ${participantId}`)
      return
    }

    const endTime = Date.now()
    const duration = endTime - startTime

    const metric: StartupLatencyMetric = {
      type: 'startup-latency',
      participantId,
      participantName,
      startTime,
      endTime,
      duration,
      timestamp: new Date().toISOString(),
      notes: hasCam ? `First frame rendered` : 'N/A - Camera off',
    }

    console.log('StartupLatency: ', metric.duration, 'ms')
    this.startupTrackingMap.delete(participantId)
  }

  // ===== Test 2: Quality Toggle =====
  trackQualityToggleStart(participantId: string, direction: 'HD->SD' | 'SD->HD') {
    const startTime = Date.now()
    this.qualityToggleTrackingMap.set(participantId, { startTime, direction })
  }

  trackQualityToggleComplete(participantId: string, participantName: string) {
    const tracking = this.qualityToggleTrackingMap.get(participantId)
    if (!tracking) {
      return
    }

    const endTime = Date.now()
    const duration = endTime - tracking.startTime

    const metric: QualityToggleMetric = {
      type: 'quality-toggle',
      participantId,
      participantName,
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
    this.qualityToggleTrackingMap.delete(participantId)
  }

  // ===== Periodic Monitoring removed (not needed for the 3 requested metrics) =====

  // ===== Test 3: Rewind Timing =====
  trackRewindButtonPressed(participantId: string) {
    const time = Date.now()
    this.rewindTrackingMap.set(participantId, { rewindButtonPressed: time })
  }

  trackRewindPlaybackStarted(participantId: string, participantName: string) {
    const time = Date.now()
    const tracking = this.rewindTrackingMap.get(participantId)

    const metric: RewindMetric = {
      type: 'rewind',
      participantId,
      participantName,
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
      this.rewindTrackingMap.set(participantId, { ...tracking, rewindPlaybackStarted: time })
    }
  }

  trackVideoResubStart(participantId: string) {
    const time = Date.now()
    const tracking = this.subscriptionTrackingMap.get(participantId) || {}
    this.subscriptionTrackingMap.set(participantId, { ...tracking, videoResub: time })
  }

  trackVideoResubComplete(participantId: string, participantName: string) {
    const tracking = this.subscriptionTrackingMap.get(participantId)
    const startTime = tracking?.videoResub
    const endTime = Date.now()

    if (startTime) {
      const metric: SubscriptionMetric = {
        type: 'subscription',
        participantId,
        participantName,
        action: 'resub-video',
        startTime,
        endTime,
        duration: endTime - startTime,
        timestamp: new Date().toISOString(),
      }

      this.metrics.push(metric)

      const { videoResub, ...rest } = tracking
      this.subscriptionTrackingMap.set(participantId, rest)

      console.log(`Video Resubcription Latency for ${participantName}: ${metric.duration}ms`)
    }
  }

  trackAudioResubStart(participantId: string) {
    const time = Date.now()
    const tracking = this.subscriptionTrackingMap.get(participantId) || {}
    this.subscriptionTrackingMap.set(participantId, { ...tracking, audioResub: time })
  }

  trackAudioResubComplete(participantId: string, participantName: string) {
    const tracking = this.subscriptionTrackingMap.get(participantId)
    const startTime = tracking?.audioResub
    const endTime = Date.now()

    if (startTime) {
      const metric: SubscriptionMetric = {
        type: 'subscription',
        participantId,
        participantName,
        action: 'resub-audio',
        startTime,
        endTime,
        duration: endTime - startTime,
        timestamp: new Date().toISOString(),
      }

      this.metrics.push(metric)

      // Clear audio resub tracking
      const { audioResub, ...rest } = tracking
      this.subscriptionTrackingMap.set(participantId, rest)

      console.log(`Audio Resubcription Latency for ${participantName}: ${metric.duration}ms`)
    }
  }
}
