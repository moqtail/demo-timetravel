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

export interface AppSettings {
  relayUrl: string
  wsUrl: string
  wsPath: string
  posthog_host: string
  posthog_code: string
  audioEncoderConfig: AudioEncoderConfig
  audioDecoderConfig: AudioDecoderConfig
  videoEncoderConfigHD: VideoEncoderConfig
  videoDecoderConfigHD: VideoDecoderConfig
  videoEncoderConfig: VideoEncoderConfig
  videoDecoderConfig: VideoDecoderConfig
  screenshareEncoderConfig: VideoEncoderConfig
  screenshareDecoderConfig: VideoDecoderConfig
  keyFrameInterval: 'auto' | number
  clockNormalizationConfig: {
    timeServerUrl: string
    numberOfSamples: number
  }
  playoutBufferConfig: {
    targetLatencyMs: number
    maxLatencyMs: number
  }
  canvasResolutionConfig: {
    screenshare: {
      defaultWidth: number
      defaultHeight: number
      maxWidth: number
      maxHeight: number
    }
  }
}
