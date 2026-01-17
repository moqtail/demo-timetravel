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

export class TelemetryManager {
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

    telemetryDB.addEntry({
      sessionId,
      userId,
      userName,
      streamType: TelemetryStreamType.StartupLatency,
      timestamp: Date.now(),
      value: duration,
    })

    console.log('StartupLatency: ', duration, 'ms')
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

    if (tracking.direction === 'HD->SD') {
      console.log('HD->SD Toggle: ', duration, 'ms')
    }
    if (tracking.direction === 'SD->HD') {
      console.log('SD->HD Toggle: ', duration, 'ms')
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

  // ===== Test 3: Rewind Timing =====
  trackRewindButtonPressed(_sessionId: string, userId: string) {
    const time = Date.now()
    this.rewindTrackingMap.set(userId, { rewindButtonPressed: time })
  }

  trackRewindPlaybackStarted(sessionId: string, userId: string, userName: string) {
    const time = Date.now()
    const tracking = this.rewindTrackingMap.get(userId)

    // Log Rewind Latency
    console.log('Rewind Latency: ', time - tracking?.rewindButtonPressed!, 'ms')

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
      const { videoResub, ...rest } = tracking
      this.subscriptionTrackingMap.set(userId, rest)

      const duration = endTime - startTime

      // add to telemetryDB
      telemetryDB
        .addEntry({
          sessionId,
          userId,
          userName,
          streamType: TelemetryStreamType.VideoResubLatency,
          timestamp: Date.now(),
          value: duration,
        })
        .then(() => {
          console.log('Video Resub Latency metric saved to telemetryDB')
        })
        .catch((error: any) => {
          console.error('Error saving Video Resub Latency metric to telemetryDB:', error)
        })

      console.log(`Video Resubcription Latency for ${userName}: ${duration}ms`)
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
      const duration = endTime - startTime

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
          value: duration!,
        })
        .then(() => {
          console.log('Audio Resub Latency metric saved to telemetryDB')
        })
        .catch((error: any) => {
          console.error('Error saving Audio Resub Latency metric to telemetryDB:', error)
        })

      console.log(`Audio Resubcription Latency for ${userName}: ${duration}ms`)
    }
  }

  // ===== Latency and Bitrate Telemetry =====
  trackLatencyAndBitrate(
    sessionId: string,
    userId: string,
    userName: string,
    videoLatency: number,
    audioLatency: number,
    screenshareLatency: number,
    videoBitrate: number,
    audioBitrate: number,
    screenshareBitrate: number,
    isSelf: boolean,
  ) {
    // Only track latency for remote users (not self)
    if (!isSelf) {
      // Store video latency to DB
      telemetryDB
        .addEntry({
          sessionId,
          userId,
          userName,
          streamType: TelemetryStreamType.VideoLatency,
          timestamp: Date.now(),
          value: videoLatency,
        })
        .catch((err) => console.error('Failed to store video latency:', err))

      // Store audio latency to DB
      telemetryDB
        .addEntry({
          sessionId,
          userId,
          userName,
          streamType: TelemetryStreamType.AudioLatency,
          timestamp: Date.now(),
          value: audioLatency,
        })
        .catch((err) => console.error('Failed to store audio latency:', err))
    }

    // Store screenshare latency to DB (for all users)
    telemetryDB
      .addEntry({
        sessionId,
        userId,
        userName,
        streamType: TelemetryStreamType.ScreenshareLatency,
        timestamp: Date.now(),
        value: screenshareLatency,
      })
      .catch((err) => console.error('Failed to store screenshare latency:', err))

    // Store video bitrate to DB
    telemetryDB
      .addEntry({
        sessionId,
        userId,
        userName,
        streamType: TelemetryStreamType.VideoBitrate,
        timestamp: Date.now(),
        value: videoBitrate,
      })
      .catch((err) => console.error('Failed to store video bitrate:', err))

    // Store audio bitrate to DB
    telemetryDB
      .addEntry({
        sessionId,
        userId,
        userName,
        streamType: TelemetryStreamType.AudioBitrate,
        timestamp: Date.now(),
        value: audioBitrate,
      })
      .catch((err) => console.error('Failed to store audio bitrate:', err))

    // Store screenshare bitrate to DB
    telemetryDB
      .addEntry({
        sessionId,
        userId,
        userName,
        streamType: TelemetryStreamType.ScreenshareBitrate,
        timestamp: Date.now(),
        value: screenshareBitrate,
      })
      .catch((err) => console.error('Failed to store screenshare bitrate:', err))
  }
}
