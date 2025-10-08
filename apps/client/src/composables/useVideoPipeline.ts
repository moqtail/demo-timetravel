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

import {
  ExtensionHeaders,
  ObjectForwardingPreference,
  FilterType,
  GroupOrder,
  SubscribeError,
  Tuple,
  FullTrackName,
  MoqtObject,
  Location,
} from 'moqtail-ts/model'
import { MOQtailClient, LiveTrackSource, SubscribeOptions } from 'moqtail-ts/client'
import { PlayoutBuffer, NetworkTelemetry } from 'moqtail-ts/util'
import { RefObject } from 'react'
import { SocketClock } from '@/util/socketClock'

import DecodeWorker from '@/workers/decoderWorker?worker'
import PCMPlayerProcessorURL from '@/workers/pcmPlayerProcessor?url'

let clock: SocketClock
export function setClock(c: SocketClock) {
  clock = c
}

export async function connectToRelay(url: string) {
  return await MOQtailClient.new({ url, supportedVersions: [0xff00000b] })
}

export async function announceNamespaces(moqClient: MOQtailClient, namespace: Tuple) {
  await moqClient.announce(namespace)
}

export function setupTracks(
  moqClient: MOQtailClient,
  audioFullTrackName: FullTrackName,
  videoFullTrackName: FullTrackName,
  videoHDFullTrackName: FullTrackName,
  chatFullTrackName: FullTrackName,
  screenshareFullTrackName: FullTrackName,
  audioTrackAlias: bigint,
  videoTrackAlias: bigint,
  videoHDTrackAlias: bigint,
  chatTrackAlias: bigint,
  screenshareTrackAlias: bigint,
) {
  let audioStreamController: ReadableStreamDefaultController<MoqtObject> | null = null
  const audioStream = new ReadableStream<MoqtObject>({
    start(controller) {
      audioStreamController = controller
    },
    cancel() {
      audioStreamController = null
    },
  })
  let videoStreamController: ReadableStreamDefaultController<MoqtObject> | null = null
  const videoStream = new ReadableStream<MoqtObject>({
    start(controller) {
      videoStreamController = controller
    },
    cancel() {
      videoStreamController = null
    },
  })
  let videoHDStreamController: ReadableStreamDefaultController<MoqtObject> | null = null
  const videoHDStream = new ReadableStream<MoqtObject>({
    start(controller) {
      videoHDStreamController = controller
    },
    cancel() {
      videoHDStreamController = null
    },
  })
  let chatStreamController: ReadableStreamDefaultController<MoqtObject> | null = null
  const chatStream = new ReadableStream<MoqtObject>({
    start(controller) {
      chatStreamController = controller
    },
    cancel() {
      chatStreamController = null
    },
  })
  let screenshareStreamController: ReadableStreamDefaultController<MoqtObject> | null = null
  const screenshareStream = new ReadableStream<MoqtObject>({
    start(controller) {
      screenshareStreamController = controller
    },
    cancel() {
      screenshareStreamController = null
    },
  })
  const audioContentSource = new LiveTrackSource(audioStream)
  moqClient.addOrUpdateTrack({
    fullTrackName: audioFullTrackName,
    forwardingPreference: ObjectForwardingPreference.Subgroup,
    trackSource: { live: audioContentSource },
    publisherPriority: 128, // Magic number
    trackAlias: audioTrackAlias,
  })
  const videoContentSource = new LiveTrackSource(videoStream)
  moqClient.addOrUpdateTrack({
    fullTrackName: videoFullTrackName,
    forwardingPreference: ObjectForwardingPreference.Subgroup,
    trackSource: { live: videoContentSource },
    publisherPriority: 128, // Magic number
    trackAlias: videoTrackAlias,
  })
  const videoHDContentSource = new LiveTrackSource(videoHDStream)
  moqClient.addOrUpdateTrack({
    fullTrackName: videoHDFullTrackName,
    forwardingPreference: ObjectForwardingPreference.Subgroup,
    trackSource: { live: videoHDContentSource },
    publisherPriority: 128, // Magic number
    trackAlias: videoHDTrackAlias,
  })
  const chatContentSource = new LiveTrackSource(chatStream)
  moqClient.addOrUpdateTrack({
    fullTrackName: chatFullTrackName,
    forwardingPreference: ObjectForwardingPreference.Subgroup,
    trackSource: { live: chatContentSource },
    publisherPriority: 128, // Magic number
    trackAlias: chatTrackAlias,
  })
  const screenshareContentSource = new LiveTrackSource(screenshareStream)
  moqClient.addOrUpdateTrack({
    fullTrackName: screenshareFullTrackName,
    forwardingPreference: ObjectForwardingPreference.Subgroup,
    trackSource: { live: screenshareContentSource },
    publisherPriority: 128, // Magic number
    trackAlias: screenshareTrackAlias,
  })
  return {
    audioStream,
    videoStream,
    videoHDStream,
    chatStream,
    screenshareStream,
    getAudioStreamController: () => audioStreamController,
    getVideoStreamController: () => videoStreamController,
    getVideoHDStreamController: () => videoHDStreamController,
    getChatStreamController: () => chatStreamController,
    getScreenshareStreamController: () => screenshareStreamController,
  }
}

export function initializeChatMessageSender({
  chatFullTrackName,
  chatStreamController,
  publisherPriority = 1,
  objectForwardingPreference,
  initialChatGroupId = 10001,
  initialChatObjectId = 0,
}: {
  chatFullTrackName: any
  chatStreamController: ReadableStreamDefaultController<any> | null
  publisherPriority?: number
  objectForwardingPreference: any
  initialChatGroupId?: number
  initialChatObjectId?: number
}) {
  function send(message: string) {
    if (!chatStreamController) return
    const payload = new TextEncoder().encode(message)
    const moqt = MoqtObject.newWithPayload(
      chatFullTrackName,
      new Location(BigInt(initialChatGroupId++), BigInt(initialChatObjectId)),
      publisherPriority,
      objectForwardingPreference,
      BigInt(Math.round(clock.now())),
      null,
      payload,
    )
    chatStreamController.enqueue(moqt)
    console.log('Chat message sent with location:', initialChatGroupId, initialChatObjectId)
  }

  return { send }
}

export async function startAudioEncoder({
  stream,
  audioFullTrackName,
  audioStreamController,
  publisherPriority,
  audioGroupId,
  objectForwardingPreference,
}: {
  stream: MediaStream
  audioFullTrackName: FullTrackName
  audioStreamController: ReadableStreamDefaultController<MoqtObject> | null
  publisherPriority: number
  audioGroupId: number
  objectForwardingPreference: ObjectForwardingPreference
}) {
  console.log('Starting audio encoder with group ID:', audioGroupId)
  let audioObjectId = 0n
  let currentAudioGroupId = audioGroupId
  let shouldEncode = true

  setInterval(() => {
    currentAudioGroupId += 1
    audioObjectId = 0n
  }, 2000)

  const audioContext = new AudioContext({ sampleRate: 48000 })
  await audioContext.audioWorklet.addModule(PCMPlayerProcessorURL)

  const source = audioContext.createMediaStreamSource(stream) // same stream as video
  const audioNode = new AudioWorkletNode(audioContext, 'audio-encoder-processor')
  source.connect(audioNode)
  audioNode.connect(audioContext.destination)

  console.log('adding audio encoder')
  let audioEncoder: AudioEncoder | null = null
  if (typeof AudioEncoder !== 'undefined') {
    audioEncoder = new AudioEncoder({
      output: (chunk) => {
        if (!shouldEncode) return

        const payload = new Uint8Array(chunk.byteLength)
        chunk.copyTo(payload)

        const captureTime = Math.round(clock!.now())
        const locHeaders = new ExtensionHeaders().addCaptureTimestamp(captureTime)

        console.warn('Audio Group ID is:', currentAudioGroupId)
        // console.log('AudioEncoder output chunk:', chunk);
        const moqt = MoqtObject.newWithPayload(
          audioFullTrackName,
          new Location(BigInt(currentAudioGroupId), BigInt(audioObjectId++)),
          publisherPriority,
          objectForwardingPreference,
          BigInt(Math.round(clock!.now())),
          locHeaders.build(),
          payload,
        )
        // console.log('AudioEncoder output:', moqt);
        audioStreamController?.enqueue(moqt)
      },
      error: console.error,
    })
    audioEncoder.configure(window.appSettings.audioEncoderConfig)
  }

  let pcmBuffer: Float32Array[] = []
  const AUDIO_PACKET_SAMPLES = 960

  audioNode.port.onmessage = (event) => {
    // console.log('Received audio data from AudioWorkletNode:', event.data);
    if (!audioEncoder) return
    if (!shouldEncode) return

    // console.log('Audio data received, processing...');
    const samples = event.data as Float32Array
    pcmBuffer.push(samples)

    let totalSamples = pcmBuffer.reduce((sum, arr) => sum + arr.length, 0)
    while (totalSamples >= AUDIO_PACKET_SAMPLES) {
      let out = new Float32Array(AUDIO_PACKET_SAMPLES)
      let offset = 0
      while (offset < AUDIO_PACKET_SAMPLES && pcmBuffer.length > 0) {
        let needed = AUDIO_PACKET_SAMPLES - offset
        let chunk = pcmBuffer[0]
        if (chunk.length <= needed) {
          out.set(chunk, offset)
          offset += chunk.length
          pcmBuffer.shift()
        } else {
          out.set(chunk.subarray(0, needed), offset)
          pcmBuffer[0] = chunk.subarray(needed)
          offset += needed
        }
      }
      const audioData = new AudioData({
        format: 'f32',
        sampleRate: 48000,
        numberOfFrames: AUDIO_PACKET_SAMPLES,
        numberOfChannels: 1,
        timestamp: performance.now() * 1000,
        data: out.buffer,
      })
      audioEncoder.encode(audioData)
      audioData.close()
      totalSamples -= AUDIO_PACKET_SAMPLES
    }
  }

  return {
    audioNode,
    audioEncoder,
    setEncoding: (enabled: boolean) => {
      shouldEncode = enabled
      if (!enabled) {
        pcmBuffer = []
      }
    },
  }
}

export function initializeVideoEncoder({
  videoFullTrackName,
  videoStreamController,
  publisherPriority,
  objectForwardingPreference,
}: {
  videoFullTrackName: FullTrackName
  videoStreamController: ReadableStreamDefaultController<MoqtObject> | null
  publisherPriority: number
  objectForwardingPreference: ObjectForwardingPreference
}) {
  let videoEncoder: VideoEncoder | null = null
  let encoderActive = true
  let videoGroupId = 0
  let videoObjectId = 0n
  let isFirstKeyframeSent = false
  let videoConfig: ArrayBuffer | null = null
  let frameCounter = 0
  const pendingVideoTimestamps: number[] = []
  let videoReader: ReadableStreamDefaultReader<any> | null = null

  const createVideoEncoder = () => {
    isFirstKeyframeSent = false
    //videoGroupId = 0 //if problematic, open this
    videoObjectId = 0n
    frameCounter = 0
    pendingVideoTimestamps.length = 0
    //videoConfig = null

    videoEncoder = new VideoEncoder({
      output: async (chunk, meta) => {
        if (chunk.type === 'key') {
          videoGroupId++
          videoObjectId = 0n
        }

        let captureTime = pendingVideoTimestamps.shift()
        if (captureTime === undefined) {
          console.warn('No capture time available for video frame, skipping')
          captureTime = Math.round(clock!.now())
        }

        const locHeaders = new ExtensionHeaders()
          .addCaptureTimestamp(captureTime)
          .addVideoFrameMarking(chunk.type === 'key' ? 1 : 0)

        const desc = meta?.decoderConfig?.description
        if (!isFirstKeyframeSent && desc instanceof ArrayBuffer) {
          videoConfig = desc
          locHeaders.addVideoConfig(new Uint8Array(desc))
          isFirstKeyframeSent = true
        }
        if (isFirstKeyframeSent && videoConfig instanceof ArrayBuffer) {
          locHeaders.addVideoConfig(new Uint8Array(videoConfig))
        }
        const frameData = new Uint8Array(chunk.byteLength)
        chunk.copyTo(frameData)

        const moqt = MoqtObject.newWithPayload(
          videoFullTrackName,
          new Location(BigInt(videoGroupId), BigInt(videoObjectId++)),
          publisherPriority,
          objectForwardingPreference,
          0n,
          locHeaders.build(),
          frameData,
        )
        if (videoStreamController) {
          videoStreamController.enqueue(moqt)
        } else {
          console.error('videoStreamController is not available')
        }
      },
      error: console.error,
    })
    console.log('Configuring video encoder with settings:', window.appSettings.videoEncoderConfig)
    videoEncoder.configure(window.appSettings.videoEncoderConfig)
  }

  createVideoEncoder()

  const stop = async () => {
    encoderActive = false
    if (videoReader) {
      try {
        await videoReader.cancel()
      } catch (e) {
        // ignore cancel errors
      }
      videoReader = null
    }
    if (videoEncoder) {
      try {
        await videoEncoder.flush()
        videoEncoder.close()
      } catch (e) {
        // ignore close errors
      }
      videoEncoder = null
    }
  }

  return {
    videoEncoder,
    encoderActive,
    pendingVideoTimestamps,
    frameCounter,
    start: async (stream: MediaStream) => {
      // Stop previous encoder and reset state
      if (videoEncoder && encoderActive) {
        encoderActive = false
        await stop()
      }

      if (!stream) {
        return { videoEncoder: null, videoReader: null }
      }

      encoderActive = true
      createVideoEncoder()

      const videoTrack = stream.getVideoTracks()[0]
      if (!videoTrack) {
        return { videoEncoder: null, videoReader: null }
      }

      videoReader = new (window as any).MediaStreamTrackProcessor({
        track: videoTrack,
      }).readable.getReader()

      const readAndEncode = async (reader: ReadableStreamDefaultReader<any>) => {
        while (encoderActive) {
          try {
            const result = await reader.read()
            if (result.done) break

            const captureTime = Math.round(clock!.now())
            pendingVideoTimestamps.push(captureTime)

            try {
              let insert_keyframe = false
              if (window.appSettings.keyFrameInterval !== 'auto') {
                insert_keyframe = frameCounter % (window.appSettings.keyFrameInterval || 0) === 0
              }

              if (insert_keyframe) {
                videoEncoder?.encode(result.value, { keyFrame: insert_keyframe })
              } else {
                videoEncoder?.encode(result.value)
              }
              frameCounter++
            } catch (encodeError) {
              console.error('Error encoding video frame:', encodeError)
            } finally {
              if (result.value && typeof result.value.close === 'function') {
                result.value.close()
              }
            }
          } catch (readError) {
            console.error('Error reading video frame:', readError)
            if (!encoderActive) break
          }
        }
      }

      if (!videoReader) {
        console.error('Failed to create video reader')
        return
      }
      if (videoReader) {
        readAndEncode(videoReader)
      }
      return { videoEncoder, videoReader }
    },
    stop,
  }
}

export async function startVideoEncoder({
  stream,
  videoFullTrackName,
  videoStreamController,
  publisherPriority,
  objectForwardingPreference,
}: {
  stream: MediaStream
  videoFullTrackName: FullTrackName
  videoStreamController: ReadableStreamDefaultController<MoqtObject> | null
  publisherPriority: number
  objectForwardingPreference: ObjectForwardingPreference
}) {
  if (!stream) {
    console.error('No stream provided to video encoder')
    return { stop: async () => {} }
  }

  let videoEncoder: VideoEncoder | null = null
  let videoReader: ReadableStreamDefaultReader<any> | null = null
  let encoderActive = true
  let videoGroupId = 0
  let videoObjectId = 0n
  let isFirstKeyframeSent = false
  let videoConfig: ArrayBuffer | null = null
  let frameCounter = 0
  const pendingVideoTimestamps: number[] = []

  const createVideoEncoder = () => {
    isFirstKeyframeSent = false
    videoGroupId = 0
    videoObjectId = 0n
    frameCounter = 0
    pendingVideoTimestamps.length = 0
    videoConfig = null

    videoEncoder = new VideoEncoder({
      output: async (chunk, meta) => {
        if (chunk.type === 'key') {
          videoGroupId++
          videoObjectId = 0n
        }

        let captureTime = pendingVideoTimestamps.shift()
        if (captureTime === undefined) {
          console.warn('No capture time available for video frame, skipping')
          captureTime = Math.round(clock!.now())
        }

        const locHeaders = new ExtensionHeaders()
          .addCaptureTimestamp(captureTime)
          .addVideoFrameMarking(chunk.type === 'key' ? 1 : 0)

        const desc = meta?.decoderConfig?.description
        if (!isFirstKeyframeSent && desc instanceof ArrayBuffer) {
          videoConfig = desc
          locHeaders.addVideoConfig(new Uint8Array(desc))
          isFirstKeyframeSent = true
        }
        if (isFirstKeyframeSent && videoConfig instanceof ArrayBuffer) {
          locHeaders.addVideoConfig(new Uint8Array(videoConfig))
        }
        const frameData = new Uint8Array(chunk.byteLength)
        chunk.copyTo(frameData)

        const moqt = MoqtObject.newWithPayload(
          videoFullTrackName,
          new Location(BigInt(videoGroupId), BigInt(videoObjectId++)),
          publisherPriority,
          objectForwardingPreference,
          0n,
          locHeaders.build(),
          frameData,
        )
        if (videoStreamController) {
          videoStreamController.enqueue(moqt)
        } else {
          console.error('videoStreamController is not available')
        }
      },
      error: console.error,
    })
    videoEncoder.configure(window.appSettings.videoEncoderConfig)
  }

  createVideoEncoder()

  const videoTrack = stream.getVideoTracks()[0]
  if (!videoTrack) {
    console.error('No video track available in stream')
    return { stop: async () => {} }
  }

  videoReader = new (window as any).MediaStreamTrackProcessor({
    track: videoTrack,
  }).readable.getReader()

  const readAndEncode = async (reader: ReadableStreamDefaultReader<any>) => {
    while (encoderActive) {
      try {
        const result = await reader.read()
        if (result.done) break

        const captureTime = Math.round(clock!.now())
        pendingVideoTimestamps.push(captureTime)

        // Our video is 25 fps. Each 2s, we can send a new keyframe.
        const insert_keyframe = frameCounter % 50 === 0

        try {
          videoEncoder?.encode(result.value, { keyFrame: insert_keyframe })
          frameCounter++
        } catch (encodeError) {
          console.error('Error encoding video frame:', encodeError)
        } finally {
          if (result.value && typeof result.value.close === 'function') {
            result.value.close()
          }
        }
      } catch (readError) {
        console.error('Error reading video frame:', readError)
        if (!encoderActive) break
      }
    }
  }

  if (!videoReader) {
    console.error('Failed to create video reader')
    return { stop: async () => {} }
  }
  readAndEncode(videoReader)

  const stop = async () => {
    encoderActive = false
    if (videoReader) {
      try {
        await videoReader.cancel()
      } catch (e) {
        // ignore cancel errors
      }
      videoReader = null
    }
    if (videoEncoder) {
      try {
        await videoEncoder.flush()
        videoEncoder.close()
      } catch (e) {
        // ignore close errors
      }
      videoEncoder = null
    }
  }

  return { videoEncoder, videoReader, stop }
}

export function initializeVideoHDEncoder({
  videoHDFullTrackName,
  videoHDStreamController,
  publisherPriority,
  objectForwardingPreference,
}: {
  videoHDFullTrackName: FullTrackName
  videoHDStreamController: ReadableStreamDefaultController<MoqtObject> | null
  publisherPriority: number
  objectForwardingPreference: ObjectForwardingPreference
}) {
  let videoEncoder: VideoEncoder | null = null
  let encoderActive = true
  let videoGroupId = 0
  let videoObjectId = 1n
  let isFirstKeyframeSent = false
  let videoConfig: ArrayBuffer | null = null
  let frameCounter = 0
  const pendingVideoTimestamps: number[] = []
  let videoReader: ReadableStreamDefaultReader<any> | null = null

  const createVideoEncoder = () => {
    isFirstKeyframeSent = false
    videoObjectId = 1n
    frameCounter = 0
    pendingVideoTimestamps.length = 0

    videoEncoder = new VideoEncoder({
      output: async (chunk, meta) => {
        if (chunk.type === 'key') {
          videoGroupId++
          videoObjectId = 0n
        }

        let captureTime = pendingVideoTimestamps.shift()
        if (captureTime === undefined) {
          console.warn('No capture time available for HD video frame, skipping')
          captureTime = Math.round(clock!.now())
        }

        const locHeaders = new ExtensionHeaders()
          .addCaptureTimestamp(captureTime)
          .addVideoFrameMarking(chunk.type === 'key' ? 1 : 0)

        const desc = meta?.decoderConfig?.description
        if (!isFirstKeyframeSent && desc instanceof ArrayBuffer) {
          videoConfig = desc
          locHeaders.addVideoConfig(new Uint8Array(desc))
          isFirstKeyframeSent = true
        }
        if (isFirstKeyframeSent && videoConfig instanceof ArrayBuffer) {
          locHeaders.addVideoConfig(new Uint8Array(videoConfig))
        }
        const frameData = new Uint8Array(chunk.byteLength)
        chunk.copyTo(frameData)

        const moqt = MoqtObject.newWithPayload(
          videoHDFullTrackName,
          new Location(BigInt(videoGroupId), BigInt(videoObjectId++)),
          publisherPriority,
          objectForwardingPreference,
          0n,
          locHeaders.build(),
          frameData,
        )
        videoHDStreamController?.enqueue(moqt)

        if (!isFirstKeyframeSent) {
          console.log('First HD video keyframe sent')
          isFirstKeyframeSent = true
        }
      },
      error: (error) => {
        console.error('HD Video encoding error:', error)
      },
    })

    videoEncoder.configure(window.appSettings.videoEncoderConfigHD)

    return videoEncoder
  }

  const stop = async () => {
    encoderActive = false
    if (videoReader) {
      try {
        await videoReader.cancel()
      } catch (e) {
        // ignore cancel errors
      }
      videoReader = null
    }
    if (videoEncoder) {
      try {
        await videoEncoder.flush()
        videoEncoder.close()
      } catch (e) {
        // ignore close errors
      }
      videoEncoder = null
    }
  }

  return {
    videoEncoder,
    encoderActive,
    pendingVideoTimestamps,
    frameCounter,
    start: async (stream: MediaStream) => {
      // Stop previous encoder and reset state
      if (videoEncoder && encoderActive) {
        encoderActive = false
        await stop()
      }

      if (!stream) {
        return { videoEncoder: null, videoReader: null }
      }

      encoderActive = true
      createVideoEncoder()

      const videoTrack = stream.getVideoTracks()[0]
      if (!videoTrack) {
        return { videoEncoder: null, videoReader: null }
      }

      videoReader = new (window as any).MediaStreamTrackProcessor({
        track: videoTrack,
      }).readable.getReader()

      const readAndEncode = async (reader: ReadableStreamDefaultReader<any>) => {
        while (encoderActive) {
          try {
            const result = await reader.read()
            if (result.done) break

            const captureTime = Math.round(clock!.now())
            pendingVideoTimestamps.push(captureTime)

            // Use HD settings for keyframe interval - higher framerate
            const keyFrameInterval =
              typeof window.appSettings.keyFrameInterval === 'number' ? window.appSettings.keyFrameInterval : 50
            const insert_keyframe = frameCounter % keyFrameInterval === 0

            try {
              videoEncoder?.encode(result.value, { keyFrame: insert_keyframe })
              frameCounter++
            } catch (encodeError) {
              console.error('Error encoding HD video frame:', encodeError)
            } finally {
              if (result.value && typeof result.value.close === 'function') {
                result.value.close()
              }
            }
          } catch (readError) {
            console.error('Error reading HD video frame:', readError)
            if (!encoderActive) break
          }
        }
      }

      if (!videoReader) {
        console.error('Failed to create HD video reader')
        return { videoEncoder: null, videoReader: null }
      }
      readAndEncode(videoReader)

      return { videoEncoder, videoReader }
    },
    stop,
    createVideoEncoder,
  }
}

export function initializeScreenshareEncoder({
  screenshareFullTrackName,
  screenshareStreamController,
  publisherPriority,
  objectForwardingPreference,
}: {
  screenshareFullTrackName: FullTrackName
  screenshareStreamController: ReadableStreamDefaultController<MoqtObject> | null
  publisherPriority: number
  objectForwardingPreference: ObjectForwardingPreference
}) {
  let videoEncoder: VideoEncoder | null = null
  let encoderActive = true
  let videoGroupId = 0
  let videoObjectId = 1n
  let isFirstKeyframeSent = false
  let videoConfig: ArrayBuffer | null = null
  let frameCounter = 0
  const pendingVideoTimestamps: number[] = []
  let videoReader: ReadableStreamDefaultReader<any> | null = null

  const createVideoEncoder = () => {
    isFirstKeyframeSent = false
    videoObjectId = 0n
    frameCounter = 0
    pendingVideoTimestamps.length = 0

    videoEncoder = new VideoEncoder({
      output: async (chunk, meta) => {
        if (chunk.type === 'key') {
          videoGroupId++
          videoObjectId = 0n
        }

        let captureTime = pendingVideoTimestamps.shift()
        if (captureTime === undefined) {
          console.warn('No capture time available for screenshare frame, skipping')
          captureTime = Math.round(clock!.now())
        }

        const locHeaders = new ExtensionHeaders()
          .addCaptureTimestamp(captureTime)
          .addVideoFrameMarking(chunk.type === 'key' ? 1 : 0)

        const desc = meta?.decoderConfig?.description
        if (!isFirstKeyframeSent && desc instanceof ArrayBuffer) {
          videoConfig = desc
          locHeaders.addVideoConfig(new Uint8Array(desc))
          isFirstKeyframeSent = true
        }
        if (isFirstKeyframeSent && videoConfig instanceof ArrayBuffer) {
          locHeaders.addVideoConfig(new Uint8Array(videoConfig))
        }

        const frameData = new Uint8Array(chunk.byteLength)
        chunk.copyTo(frameData)

        const moqt = MoqtObject.newWithPayload(
          screenshareFullTrackName,
          new Location(BigInt(videoGroupId), BigInt(videoObjectId++)),
          publisherPriority,
          objectForwardingPreference,
          0n,
          locHeaders.build(),
          frameData,
        )
        if (screenshareStreamController) {
          screenshareStreamController.enqueue(moqt)
        } else {
          console.error('screenshareStreamController is not available')
        }
      },
      error: console.error,
    })
    console.log('Configuring screenshare encoder with settings:', window.appSettings.screenshareEncoderConfig)
    videoEncoder.configure(window.appSettings.screenshareEncoderConfig)
  }

  createVideoEncoder()

  const stop = async () => {
    encoderActive = false
    if (videoReader) {
      try {
        await videoReader.cancel()
      } catch (e) {
        // ignore cancel errors
      }
      videoReader = null
    }
    if (videoEncoder) {
      try {
        await videoEncoder.flush()
        videoEncoder.close()
      } catch (e) {
        // ignore close errors
      }
      videoEncoder = null
    }
  }

  return {
    videoEncoder,
    encoderActive,
    pendingVideoTimestamps,
    frameCounter,
    start: async (stream: MediaStream) => {
      // Stop previous encoder and reset state
      if (videoEncoder && encoderActive) {
        encoderActive = false
        await stop()
      }

      if (!stream) {
        return { videoEncoder: null, videoReader: null }
      }

      encoderActive = true
      createVideoEncoder()

      const videoTrack = stream.getVideoTracks()[0]
      if (!videoTrack) {
        return { videoEncoder: null, videoReader: null }
      }

      videoReader = new (window as any).MediaStreamTrackProcessor({
        track: videoTrack,
      }).readable.getReader()

      const readAndEncode = async (reader: ReadableStreamDefaultReader<any>) => {
        while (encoderActive) {
          try {
            const result = await reader.read()
            if (result.done) break

            const captureTime = Math.round(clock!.now())
            pendingVideoTimestamps.push(captureTime)

            try {
              if (videoEncoder && videoEncoder.state === 'configured') {
                const keyFrameInterval =
                  typeof window.appSettings.keyFrameInterval === 'number' ? window.appSettings.keyFrameInterval : 50
                videoEncoder.encode(result.value, { keyFrame: frameCounter % keyFrameInterval === 0 })
                frameCounter++
              }
            } catch (error) {
              console.error('Error encoding screenshare frame:', error)
            }

            result.value.close()
          } catch (error) {
            if (encoderActive) {
              console.error('Error reading screenshare frame:', error)
            }
            break
          }
        }
      }

      if (videoReader) {
        readAndEncode(videoReader)
      }
      return { videoEncoder, videoReader }
    },
    stop,
  }
}

export async function startScreenshareEncoder({
  stream,
  screenshareFullTrackName,
  screenshareStreamController,
  publisherPriority,
  objectForwardingPreference,
}: {
  stream: MediaStream
  screenshareFullTrackName: FullTrackName
  screenshareStreamController: ReadableStreamDefaultController<MoqtObject> | null
  publisherPriority: number
  objectForwardingPreference: ObjectForwardingPreference
}) {
  if (!stream) {
    console.error('No stream provided to screenshare encoder')
    return { stop: async () => {} }
  }

  let videoEncoder: VideoEncoder | null = null
  let videoReader: ReadableStreamDefaultReader<any> | null = null
  let encoderActive = true
  let videoGroupId = 0
  let videoObjectId = 0n
  let isFirstKeyframeSent = false
  let videoConfig: ArrayBuffer | null = null
  let frameCounter = 0
  const pendingVideoTimestamps: number[] = []

  const createVideoEncoder = () => {
    isFirstKeyframeSent = false
    videoGroupId = 0
    videoObjectId = 0n
    frameCounter = 0
    pendingVideoTimestamps.length = 0
    videoConfig = null

    videoEncoder = new VideoEncoder({
      output: async (chunk, meta) => {
        if (chunk.type === 'key') {
          videoGroupId++
          videoObjectId = 0n
        }

        let captureTime = pendingVideoTimestamps.shift()
        if (captureTime === undefined) {
          console.warn('No capture time available for screenshare frame, skipping')
          captureTime = Math.round(clock!.now())
        }

        const locHeaders = new ExtensionHeaders()
          .addCaptureTimestamp(captureTime)
          .addVideoFrameMarking(chunk.type === 'key' ? 1 : 0)

        const desc = meta?.decoderConfig?.description
        if (!isFirstKeyframeSent && desc instanceof ArrayBuffer) {
          videoConfig = desc
          locHeaders.addVideoConfig(new Uint8Array(desc))
          isFirstKeyframeSent = true
        }
        if (isFirstKeyframeSent && videoConfig instanceof ArrayBuffer) {
          locHeaders.addVideoConfig(new Uint8Array(videoConfig))
        }

        const frameData = new Uint8Array(chunk.byteLength)
        chunk.copyTo(frameData)

        const moqt = MoqtObject.newWithPayload(
          screenshareFullTrackName,
          new Location(BigInt(videoGroupId), BigInt(videoObjectId++)),
          publisherPriority,
          objectForwardingPreference,
          0n,
          locHeaders.build(),
          frameData,
        )
        if (screenshareStreamController) {
          screenshareStreamController.enqueue(moqt)
        } else {
          console.error('screenshareStreamController is not available')
        }
      },
      error: console.error,
    })
    videoEncoder.configure(window.appSettings.screenshareEncoderConfig)
  }

  createVideoEncoder()

  const videoTrack = stream.getVideoTracks()[0]
  if (!videoTrack) {
    console.error('No video track available in screenshare stream')
    return { stop: async () => {} }
  }

  videoReader = new (window as any).MediaStreamTrackProcessor({
    track: videoTrack,
  }).readable.getReader()

  const readAndEncode = async (reader: ReadableStreamDefaultReader<any>) => {
    while (encoderActive) {
      try {
        const result = await reader.read()
        if (result.done) break

        const captureTime = Math.round(clock!.now())
        pendingVideoTimestamps.push(captureTime)

        try {
          if (videoEncoder && videoEncoder.state === 'configured') {
            const keyFrameInterval =
              typeof window.appSettings.keyFrameInterval === 'number' ? window.appSettings.keyFrameInterval : 50
            videoEncoder.encode(result.value, { keyFrame: frameCounter % keyFrameInterval === 0 })
            frameCounter++
          }
        } catch (error) {
          console.error('Error encoding screenshare frame:', error)
        }

        result.value.close()
      } catch (error) {
        if (encoderActive) {
          console.error('Error reading screenshare frame:', error)
        }
        break
      }
    }
  }

  if (videoReader) {
    readAndEncode(videoReader)
  }

  const stop = async () => {
    encoderActive = false
    if (videoReader) {
      try {
        await videoReader.cancel()
      } catch (e) {
        // ignore cancel errors
      }
      videoReader = null
    }
    if (videoEncoder) {
      try {
        await videoEncoder.flush()
        videoEncoder.close()
      } catch (e) {
        // ignore close errors
      }
      videoEncoder = null
    }
  }

  return { videoEncoder, videoReader, stop }
}

const canvasWorkerMap = new WeakMap<HTMLCanvasElement, Worker>()

function getOrCreateWorkerAndCanvas(canvas: HTMLCanvasElement) {
  const existingWorker = canvasWorkerMap.get(canvas)
  if (existingWorker) {
    existingWorker.postMessage({
      type: 'updateDecoderConfig',
      decoderConfig: window.appSettings.videoDecoderConfig,
    })

    resizeCanvasWorker(
      canvas,
      window.appSettings.videoDecoderConfig.codedHeight || 640,
      window.appSettings.videoDecoderConfig.codedWidth || 360,
    )
    return existingWorker
  }

  try {
    const worker = new DecodeWorker()
    const offscreen = canvas.transferControlToOffscreen()
    worker.postMessage({ type: 'init', canvas: offscreen, decoderConfig: window.appSettings.videoDecoderConfig }, [
      offscreen,
    ])

    canvasWorkerMap.set(canvas, worker)

    const originalTerminate = worker.terminate
    worker.terminate = function () {
      canvasWorkerMap.delete(canvas)
      return originalTerminate.call(this)
    }

    return worker
  } catch (error) {
    if (error instanceof DOMException && error.name === 'InvalidStateError') {
      console.error('Canvas control already transferred. This should not happen with proper cleanup.')
    }
    throw error
  }
}

function getOrCreateHDWorkerAndCanvas(canvas: HTMLCanvasElement) {
  const existingWorker = canvasWorkerMap.get(canvas)
  if (existingWorker) {
    existingWorker.postMessage({
      type: 'updateDecoderConfig',
      decoderConfig: window.appSettings.videoDecoderConfigHD,
    })

    resizeCanvasWorker(
      canvas,
      window.appSettings.videoDecoderConfigHD.codedWidth || 1280,
      window.appSettings.videoDecoderConfigHD.codedHeight || 720,
    )
    return existingWorker
  }

  try {
    const worker = new DecodeWorker()
    const offscreen = canvas.transferControlToOffscreen()
    worker.postMessage(
      {
        type: 'init',
        canvas: offscreen,
        decoderConfig: window.appSettings.videoDecoderConfigHD,
      },
      [offscreen],
    )

    canvasWorkerMap.set(canvas, worker)

    const originalTerminate = worker.terminate
    worker.terminate = function () {
      canvasWorkerMap.delete(canvas)
      return originalTerminate.call(this)
    }

    return worker
  } catch (error) {
    if (error instanceof DOMException && error.name === 'InvalidStateError') {
      console.error('Canvas control already transferred. This should not happen with proper cleanup.')
    }
    throw error
  }
}

export function updateWorkerForQuality(canvas: HTMLCanvasElement, isHD: boolean) {
  const worker = canvasWorkerMap.get(canvas)
  if (worker) {
    const decoderConfig = isHD ? window.appSettings.videoDecoderConfigHD : window.appSettings.videoDecoderConfig
    worker.postMessage({
      type: 'updateDecoderConfig',
      decoderConfig,
    })

    // Resize canvas to match the quality
    if (isHD) {
      resizeCanvasWorker(
        canvas,
        window.appSettings.videoDecoderConfigHD.codedWidth || 1280,
        window.appSettings.videoDecoderConfigHD.codedHeight || 720,
      )
    } else {
      resizeCanvasWorker(
        canvas,
        window.appSettings.videoDecoderConfig.codedWidth || 640,
        window.appSettings.videoDecoderConfig.codedHeight || 360,
      )
    }

    console.log(`Updated worker decoder config and canvas size for ${isHD ? 'HD (1280x720)' : 'SD (640x360)'} quality`)
  }
}

function getOrCreateScreenshareWorker(canvas: HTMLCanvasElement): Worker {
  // Check if there's already a worker for this canvas
  const existingWorker = canvasWorkerMap.get(canvas)
  if (existingWorker) {
    return existingWorker
  }

  try {
    const worker = new DecodeWorker()
    const offscreen = canvas.transferControlToOffscreen()
    worker.postMessage(
      {
        type: 'init',
        canvas: offscreen,
        decoderConfig: window.appSettings.screenshareDecoderConfig,
        contentType: 'screenshare',
      },
      [offscreen],
    )

    canvasWorkerMap.set(canvas, worker)

    const originalTerminate = worker.terminate
    worker.terminate = function () {
      canvasWorkerMap.delete(canvas)
      return originalTerminate.call(this)
    }

    return worker
  } catch (error) {
    if (error instanceof DOMException && error.name === 'InvalidStateError') {
      console.error('Canvas control already transferred. This should not happen with proper cleanup.')
    }
    throw error
  }
}

export function clearScreenshareCanvas(canvas: HTMLCanvasElement): boolean {
  const worker = canvasWorkerMap.get(canvas)
  if (worker) {
    worker.postMessage({ type: 'clear' })
    return true
  }
  console.warn('No worker found for canvas, cannot send clear message')
  return false
}

export function resizeCanvasWorker(canvas: HTMLCanvasElement, newWidth: number, newHeight: number): void {
  const worker = canvasWorkerMap.get(canvas)
  if (worker) {
    console.log(`Resizing canvas worker to ${newWidth}x${newHeight}`)
    worker.postMessage({
      type: 'resize',
      newWidth,
      newHeight,
    })
  }
}

export function resizeCanvasForMaximization(
  canvas: HTMLCanvasElement,
  isMaximized: boolean,
  isHD: boolean = false,
): void {
  if (isMaximized) {
    // When maximized, use a higher resolution for better quality
    // Scale up from the source resolution to reduce pixelation
    const targetWidth = isHD ? 1920 : 1280 // Higher resolution for maximized view
    const targetHeight = isHD ? 1080 : 720
    resizeCanvasWorker(canvas, targetWidth, targetHeight)
    console.log(`Resized canvas for maximized view: ${targetWidth}x${targetHeight} (${isHD ? 'HD' : 'SD'} source)`)
  } else {
    // When not maximized, use the original video resolution
    const originalWidth = isHD ? 1280 : 640
    const originalHeight = isHD ? 720 : 360
    resizeCanvasWorker(canvas, originalWidth, originalHeight)
    console.log(`Resized canvas for normal view: ${originalWidth}x${originalHeight} (${isHD ? 'HD' : 'SD'} source)`)
  }
}

export function cleanupCanvasWorker(canvas: HTMLCanvasElement): boolean {
  const worker = canvasWorkerMap.get(canvas)
  if (worker) {
    console.log('Terminating canvas worker for cleanup')
    worker.terminate()
    canvasWorkerMap.delete(canvas)
    return true
  }
  return false
}

async function setupAudioPlayback(audioContext: AudioContext) {
  await audioContext.audioWorklet.addModule(PCMPlayerProcessorURL)
  const audioNode = new AudioWorkletNode(audioContext, 'pcm-player-processor')
  audioNode.connect(audioContext.destination)
  return audioNode
}

function subscribeAndPipeToWorker(
  moqClient: MOQtailClient,
  subscribeArgs: SubscribeOptions,
  worker: Worker,
  type: 'moq' | 'moq-audio',
): Promise<bigint | undefined> {
  return moqClient.subscribe(subscribeArgs).then((response) => {
    window.appSettings.playoutBufferConfig.maxLatencyMs
    if (!(response instanceof SubscribeError)) {
      const { requestId, stream } = response
      const buffer = new PlayoutBuffer(stream, {
        targetLatencyMs: window.appSettings.playoutBufferConfig.targetLatencyMs,
        maxLatencyMs: window.appSettings.playoutBufferConfig.maxLatencyMs,
        clock,
      })
      buffer.onObject = (obj) => {
        if (!obj) {
          // Stream ended or error
          console.warn(`Buffer terminated ${type}`)
          return
        }

        if (!obj.payload) {
          console.warn('Received MoqtObject without payload, skipping:', obj)
          // Request next object immediately
          return
        }
        // Send to worker
        worker.postMessage(
          {
            type,
            extensions: obj.extensionHeaders,
            payload: obj,
            serverTimestamp: clock!.now(),
          },
          [obj.payload.buffer],
        )
      }

      return requestId
    } else {
      console.error('Subscribe Error:', response)
      return undefined
    }
  })
}

function handleWorkerMessages(
  worker: Worker,
  audioNode: AudioWorkletNode,
  videoTelemetry?: NetworkTelemetry,
  audioTelemetry?: NetworkTelemetry,
) {
  worker.onmessage = (event) => {
    if (event.data.type === 'audio') {
      // console.log('Received audio data from worker:', event.data);
      audioNode.port.postMessage(new Float32Array(event.data.samples))
    }
    if (event.data.type === 'video-telemetry') {
      if (videoTelemetry) {
        videoTelemetry.push({
          latency: Math.abs(event.data.latency),
          size: event.data.throughput,
        })
      }
    }
    if (event.data.type === 'audio-telemetry') {
      if (audioTelemetry) {
        audioTelemetry.push({
          latency: Math.abs(event.data.latency),
          size: event.data.throughput,
        })
      }
    }
  }
}

export function useVideoPublisher(
  moqClient: MOQtailClient,
  videoRef: RefObject<HTMLVideoElement>,
  mediaStream: RefObject<MediaStream | null>,
  _roomId: string,
  _userId: string,
  videoTrackAlias: number,
  audioTrackAlias: number,
  videoFullTrackName: FullTrackName,
  audioFullTrackName: FullTrackName,
  chatFullTrackName: FullTrackName,
) {
  const setup = async () => {
    const video = videoRef.current
    if (!video) {
      console.error('Video element is not available')
      return
    }

    const stream = mediaStream.current
    if (stream instanceof MediaStream) {
      video.srcObject = stream
    } else {
      console.error('Expected MediaStream, got:', stream)
    }
    if (!stream) {
      console.error('MediaStream is not available')
      return
    }
    video.muted = true
    announceNamespaces(moqClient, videoFullTrackName.namespace)
    const screenshareFullTrackName = FullTrackName.tryNew(
      videoFullTrackName.namespace,
      new TextEncoder().encode('screenshare'),
    )
    const videoHDFullTrackName = FullTrackName.tryNew(
      videoFullTrackName.namespace,
      new TextEncoder().encode('video-hd'),
    )
    let tracks = setupTracks(
      moqClient,
      audioFullTrackName,
      videoFullTrackName,
      videoHDFullTrackName,
      chatFullTrackName,
      screenshareFullTrackName,
      BigInt(audioTrackAlias),
      BigInt(videoTrackAlias),
      BigInt(99998), // videoHDTrackAlias placeholder
      BigInt(0), // chatTrackAlias
      BigInt(99999), // screenshareTrackAlias placeholder
    )

    const videoPromise = startVideoEncoder({
      stream,
      videoFullTrackName,
      videoStreamController: tracks.getVideoStreamController(),
      publisherPriority: 1,
      objectForwardingPreference: ObjectForwardingPreference.Subgroup,
    })

    const audioPromise = startAudioEncoder({
      stream,
      audioFullTrackName,
      audioStreamController: tracks.getAudioStreamController(),
      publisherPriority: 1,
      audioGroupId: 0,
      objectForwardingPreference: ObjectForwardingPreference.Subgroup,
    })

    await Promise.all([videoPromise, audioPromise])

    return () => {}
  }
  return setup
}

export function useVideoAndAudioSubscriber(
  moqClient: MOQtailClient,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  videoTrackAlias: number,
  audioTrackAlias: number,
  videoFullTrackName: FullTrackName,
  audioFullTrackName: FullTrackName,
  videoTelemetry?: NetworkTelemetry,
  audioTelemetry?: NetworkTelemetry,
) {
  const setup = async (): Promise<{ videoRequestId?: bigint; audioRequestId?: bigint; cleanup: () => void }> => {
    const canvas = canvasRef.current
    console.log('Now will check for canvas ref')
    if (!canvas) return { cleanup: () => {} }
    console.log('Worker and audio node is going to be initialized')
    const worker = getOrCreateWorkerAndCanvas(canvas)
    const audioNode = await setupAudioPlayback(new AudioContext({ sampleRate: 48000 }))
    console.log('Worker and audio node initialized')

    handleWorkerMessages(worker, audioNode, videoTelemetry, audioTelemetry)

    const audioRequestId = await subscribeAndPipeToWorker(
      moqClient,
      {
        fullTrackName: audioFullTrackName,
        groupOrder: GroupOrder.Original,
        filterType: FilterType.LatestObject,
        forward: true,
        priority: 0,
        trackAlias: audioTrackAlias,
      },
      worker,
      'moq-audio',
    )
    console.info('Subscribed to audio', audioFullTrackName, 'with requestId:', audioRequestId)

    const videoRequestId = await subscribeAndPipeToWorker(
      moqClient,
      {
        fullTrackName: videoFullTrackName,
        groupOrder: GroupOrder.Original,
        filterType: FilterType.LatestObject,
        forward: true,
        priority: 0,
        trackAlias: videoTrackAlias,
      },
      worker,
      'moq',
    )
    console.info('Subscribed to video', videoFullTrackName, 'with requestId:', videoRequestId)

    return {
      videoRequestId,
      audioRequestId,
      cleanup: () => {
        worker.terminate()
      },
    }
  }
  return setup
}

export function onlyUseVideoSubscriber(
  moqClient: MOQtailClient,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  videoTrackAlias: number,
  videoFullTrackName: FullTrackName,
  videoTelemetry?: NetworkTelemetry,
) {
  const setup = async (): Promise<{ videoRequestId?: bigint; cleanup: () => void }> => {
    const canvas = canvasRef.current
    console.log('Setting up video-only subscription')
    if (!canvas) return { cleanup: () => {} }

    const worker = getOrCreateWorkerAndCanvas(canvas)

    worker.onmessage = (event) => {
      if (event.data.type === 'video-telemetry') {
        if (videoTelemetry) {
          videoTelemetry.push({
            latency: Math.abs(event.data.latency),
            size: event.data.throughput,
          })
        }
      }
    }

    const videoRequestId = await subscribeAndPipeToWorker(
      moqClient,
      {
        fullTrackName: videoFullTrackName,
        groupOrder: GroupOrder.Original,
        filterType: FilterType.LatestObject,
        forward: true,
        priority: 0,
        trackAlias: videoTrackAlias,
      },
      worker,
      'moq',
    )
    console.log('Subscribed to video only', videoFullTrackName, 'with requestId:', videoRequestId)

    return {
      videoRequestId,
      cleanup: () => {
        // ! Do not terminate the worker
        console.log('Video-only subscription cleanup called')
      },
    }
  }
  return setup
}

export function onlyUseVideoHDSubscriber(
  moqClient: MOQtailClient,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  videoHDTrackAlias: number,
  videoHDFullTrackName: FullTrackName,
  videoTelemetry?: NetworkTelemetry,
) {
  const setup = async (): Promise<{ videoRequestId?: bigint; cleanup: () => void }> => {
    const canvas = canvasRef.current
    if (!canvas) return { cleanup: () => {} }

    const worker = getOrCreateHDWorkerAndCanvas(canvas)

    worker.onmessage = (event) => {
      if (event.data.type === 'video-telemetry') {
        if (videoTelemetry) {
          videoTelemetry.push({
            latency: Math.abs(event.data.latency),
            size: event.data.throughput,
          })
        }
      }
    }

    const videoRequestId = await subscribeAndPipeToWorker(
      moqClient,
      {
        fullTrackName: videoHDFullTrackName,
        groupOrder: GroupOrder.Original,
        filterType: FilterType.LatestObject,
        forward: true,
        priority: 0,
        trackAlias: videoHDTrackAlias,
      },
      worker,
      'moq',
    )
    console.log('Subscribed to HD video only', videoHDFullTrackName, 'with requestId:', videoRequestId)

    return {
      videoRequestId,
      cleanup: () => {
        console.log('HD Video-only subscription cleanup called')
      },
    }
  }
  return setup
}

export function onlyUseScreenshareSubscriber(
  moqClient: MOQtailClient,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  screenshareTrackAlias: number,
  screenshareFullTrackName: FullTrackName,
  screenshareTelemetry?: NetworkTelemetry,
) {
  const setup = async (): Promise<{ videoRequestId?: bigint; cleanup: () => void }> => {
    const canvas = canvasRef.current
    console.log('Setting up screenshare-only subscription')
    if (!canvas) return { cleanup: () => {} }

    const worker = getOrCreateScreenshareWorker(canvas)

    worker.onmessage = (event) => {
      if (event.data.type === 'video-telemetry') {
        if (screenshareTelemetry) {
          screenshareTelemetry.push({
            latency: Math.abs(event.data.latency),
            size: event.data.throughput,
          })
        }
      }
    }

    const videoRequestId = await subscribeAndPipeToWorker(
      moqClient,
      {
        fullTrackName: screenshareFullTrackName,
        groupOrder: GroupOrder.Original,
        filterType: FilterType.LatestObject,
        forward: true,
        priority: 0,
        trackAlias: screenshareTrackAlias,
      },
      worker,
      'moq',
    )
    console.log('Subscribed to screenshare only', screenshareFullTrackName, 'with requestId:', videoRequestId)

    return {
      videoRequestId,
      cleanup: () => {
        // ! Do not terminate the worker
        console.log('Screenshare-only subscription cleanup called')
      },
    }
  }
  return setup
}

export function onlyUseAudioSubscriber(
  moqClient: MOQtailClient,
  audioTrackAlias: number,
  audioFullTrackName: FullTrackName,
  audioTelemetry?: NetworkTelemetry,
) {
  const setup = async (): Promise<{ audioRequestId?: bigint; cleanup: () => void }> => {
    console.log('Setting up audio-only subscription')

    const worker = new DecodeWorker()
    worker.postMessage({ type: 'init-audio-only', decoderConfig: window.appSettings.audioDecoderConfig })

    const audioNode = await setupAudioPlayback(new AudioContext({ sampleRate: 48000 }))
    console.log('Audio node initialized')

    worker.onmessage = (event) => {
      if (event.data.type === 'audio') {
        audioNode.port.postMessage(new Float32Array(event.data.samples))
      }
      if (event.data.type === 'audio-telemetry') {
        if (audioTelemetry) {
          audioTelemetry.push({
            latency: Math.abs(event.data.latency),
            size: event.data.throughput,
          })
        }
      }
    }

    const audioRequestId = await subscribeAndPipeToWorker(
      moqClient,
      {
        fullTrackName: audioFullTrackName,
        groupOrder: GroupOrder.Original,
        filterType: FilterType.LatestObject,
        forward: true,
        priority: 0,
        trackAlias: audioTrackAlias,
      },
      worker,
      'moq-audio',
    )
    console.log('Subscribed to audio only', audioFullTrackName, 'with requestId:', audioRequestId)

    return {
      audioRequestId,
      cleanup: () => {
        // ! Do not terminate the worker
        console.log('Audio-only subscription cleanup called')
      },
    }
  }
  return setup
}

export async function subscribeToChatTrack({
  moqClient,
  chatTrackAlias,
  chatFullTrackName,
  onMessage,
}: {
  moqClient: MOQtailClient
  chatTrackAlias: number
  chatFullTrackName: FullTrackName
  onMessage: (msg: any) => void
}) {
  moqClient
    .subscribe({
      fullTrackName: chatFullTrackName,
      groupOrder: GroupOrder.Original,
      filterType: FilterType.LatestObject,
      forward: true,
      priority: 0,
      trackAlias: chatTrackAlias,
    })
    .then((response) => {
      if (!(response instanceof SubscribeError)) {
        const { stream } = response
        const reader = stream.getReader()
        ;(async () => {
          while (true) {
            const { done, value: obj } = await reader.read()
            console.log('Received chat object:', obj?.location?.group?.toString(), obj?.location?.object?.toString())
            if (done) break
            if (!obj.payload) {
              console.warn('Received MoqtObject without payload, skipping:', obj)
              continue
            }
            try {
              const decoded = new TextDecoder().decode(obj.payload)
              const msgObj = JSON.parse(decoded)
              console.log('Decoded chat message:', msgObj)
              onMessage(msgObj)
            } catch (e) {
              console.error('Failed to decode chat message', e)
            }
          }
        })()
      } else {
        console.error('Subscribe Error:', response)
      }
    })
}
