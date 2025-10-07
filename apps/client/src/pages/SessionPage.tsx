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

import React, { useState, useEffect, useRef } from 'react'
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  PhoneOff,
  Send,
  Users,
  MessageSquare,
  Info,
  X,
  Smile,
  Activity,
  Expand,
  Minimize,
  RotateCcw,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
} from 'lucide-react'

import { useSession } from '@/contexts/SessionContext'
import {
  RoomUser,
  ChatMessage,
  TrackUpdateResponse,
  ToggleResponse,
  UserDisconnectedMessage,
  UpdateTrackRequest,
  RoomTimeoutMessage,
} from '@/types/types'
import { useSocket } from '@/sockets/SocketContext'
import {
  FullTrackName,
  ObjectForwardingPreference,
  Tuple,
  GroupOrder,
  FetchType,
  Location,
  FetchError,
} from 'moqtail-ts/model'
import {
  announceNamespaces,
  initializeChatMessageSender,
  initializeVideoEncoder,
  initializeVideoHDEncoder,
  initializeScreenshareEncoder,
  connectToRelay,
  setupTracks,
  startAudioEncoder,
  subscribeToChatTrack,
  onlyUseVideoSubscriber,
  onlyUseVideoHDSubscriber,
  onlyUseScreenshareSubscriber,
  startScreenshareEncoder,
  onlyUseAudioSubscriber,
  resizeCanvasWorker,
  resizeCanvasForMaximization,
  clearScreenshareCanvas,
} from '@/composables/useVideoPipeline'
import { MOQtailClient } from 'moqtail-ts/client'
import { NetworkTelemetry, ClockNormalizer } from 'moqtail-ts/util'
import { RewindPlayer } from './RewindPlayer'
import { BufferedMoqtObject } from '@/composables/rewindBuffer'

function SessionPage() {
  // initialize the MOQTail client
  const relayUrl = window.appSettings.relayUrl
  const [moqClient, setMoqClient] = useState<MOQtailClient | undefined>(undefined)

  // initialize the variables
  const [maximizedUserId, setMaximizedUserId] = useState<string | null>(null)
  const { userId, username, roomState, sessionDurationMinutes, rewindFetchGroupSize, clearSession } = useSession()
  const [isMicOn, setIsMicOn] = useState(false)
  const [isCamOn, setisCamOn] = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(true) // TODO: implement MoQ chat
  const [chatMessage, setChatMessage] = useState('')
  const { socket: contextSocket } = useSocket()
  const [users, setUsers] = useState<{ [K: string]: RoomUser }>({})
  const [remoteCanvasRefs, setRemoteCanvasRefs] = useState<{ [id: string]: React.RefObject<HTMLCanvasElement> }>({})
  const [remoteScreenshareCanvasRefs, setRemoteScreenshareCanvasRefs] = useState<{
    [id: string]: React.RefObject<HTMLCanvasElement>
  }>({})
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [telemetryData, setTelemetryData] = useState<{
    [userId: string]: { latency: number; videoBitrate: number; audioBitrate: number }
  }>({})
  const telemetryInstances = useRef<{ [userId: string]: { video: NetworkTelemetry; audio: NetworkTelemetry } }>({})
  const [latencyHistory, setLatencyHistory] = useState<{ [userId: string]: number[] }>({})
  const [videoBitrateHistory, setVideoBitrateHistory] = useState<{ [userId: string]: number[] }>({})
  const [audioBitrateHistory, setAudioBitrateHistory] = useState<{ [userId: string]: number[] }>({})
  const [timeRemaining, setTimeRemaining] = useState<string>('--:--')
  const [timeRemainingColor, setTimeRemainingColor] = useState<string>('text-green-400')
  const selfVideoRef = useRef<HTMLVideoElement>(null)
  const selfScreenshareRef = useRef<HTMLVideoElement>(null)
  const selfMediaStream = useRef<MediaStream | null>(null)
  const selfScreenshareStream = useRef<MediaStream | null>(null)
  const publisherInitialized = useRef<boolean>(false)
  const moqtailClientInitStarted = useRef<boolean>(false)
  const [pendingRoomClosedMessage, setPendingRoomClosedMessage] = useState<string | null>(null)
  const originalTitle = useRef<string>(document.title)
  const videoEncoderObjRef = useRef<any>(null)
  const videoHDEncoderObjRef = useRef<any>(null)
  const screenshareEncoderObjRef = useRef<any>(null)
  const audioEncoderObjRef = useRef<any>(null)
  const chatSenderRef = useRef<{ send: (msg: string) => void } | null>(null)
  const tracksRef = useRef<any>(null)
  const offsetRef = useRef<number>(0)
  const screenshareSubscriptionsRef = useRef<{ [userId: string]: { requestId: bigint; subscribed: boolean } }>({})
  const moqClientRef = useRef<MOQtailClient | undefined>(undefined)
  const usersRef = useRef<{ [K: string]: RoomUser }>({})
  const remoteCanvasRefsRef = useRef<{ [id: string]: React.RefObject<HTMLCanvasElement> }>({})
  const [mediaReady, setMediaReady] = useState(false)
  const [showInfoCards, setShowInfoCards] = useState<{ [userId: string]: boolean }>({})
  const [infoPanelType, setInfoPanelType] = useState<{ [userId: string]: 'network' | 'codec' }>({})
  const [codecData, setCodecData] = useState<{
    [userId: string]: {
      videoCodec: string
      audioCodec: string
      frameRate: number
      sampleRate: number
      resolution: string
      syncDrift: number
      videoBitrate?: number
      audioBitrate?: number
      numberOfChannels?: number
    }
  }>({})

  const [userSubscriptions, setUserSubscriptions] = useState<{
    [userId: string]: {
      videoSubscribed: boolean
      videoHDSubscribed?: boolean
      audioSubscribed: boolean
      screenshareSubscribed?: boolean
      videoRequestId?: bigint
      videoHDRequestId?: bigint
      audioRequestId?: bigint
      screenshareRequestId?: bigint
      intentionallyUnsubscribed?: boolean
      screenshareIntentionallyUnsubscribed?: boolean
    }
  }>({})

  const chatMessagesRef = useRef<HTMLDivElement>(null)
  const emojiPickerRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<HTMLInputElement>(null)
  const [isUserScrolling, setIsUserScrolling] = useState(false)
  const [userColors, setUserColors] = useState<{ [userId: string]: { bgClass: string; hexColor: string } }>({})
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)

  // Rewind player state
  const [isRewindPlayerOpen, setIsRewindPlayerOpen] = useState(false)
  const [selectedRewindUserId, setSelectedRewindUserId] = useState<string>('')
  const [fetchedRewindData, setFetchedRewindData] = useState<{
    [userId: string]: { video: BufferedMoqtObject[]; audio: BufferedMoqtObject[] }
  }>({})
  const [isFetching, setIsFetching] = useState(false)
  const isRewindCleaningUp = useRef<boolean>(false)

  type VideoQuality = 'SD' | 'HD'
  const [userVideoQualities, setUserVideoQualities] = useState<{ [userId: string]: VideoQuality }>({})
  const userVideoQualitiesRef = useRef<{ [userId: string]: VideoQuality }>({})
  const userSubscriptionsRef = useRef<{
    [userId: string]: {
      videoSubscribed: boolean
      videoHDSubscribed?: boolean
      audioSubscribed: boolean
      screenshareSubscribed?: boolean
      videoRequestId?: bigint
      videoHDRequestId?: bigint
      audioRequestId?: bigint
      screenshareRequestId?: bigint
      intentionallyUnsubscribed?: boolean
    }
  }>({})
  const hdSubscriptionAttemptsRef = useRef<Set<string>>(new Set())
  const manualQualityTransitionsRef = useRef<Set<string>>(new Set())

  // HD Permission Dialog State
  const [hdPermissionRequest, setHdPermissionRequest] = useState<{ requesterId: string; requesterName: string } | null>(
    null,
  )
  const [pendingHDRequests, setPendingHDRequests] = useState<Set<string>>(new Set())
  useEffect(() => {
    userVideoQualitiesRef.current = userVideoQualities
  }, [userVideoQualities])
  useEffect(() => {
    usersRef.current = users
  }, [users])

  useEffect(() => {
    remoteCanvasRefsRef.current = remoteCanvasRefs
  }, [remoteCanvasRefs])

  useEffect(() => {
    userSubscriptionsRef.current = userSubscriptions
  }, [userSubscriptions])

  const emojiCategories = {
    Faces: ['😀', '😂', '😍', '😊', '😉', '😎', '🤔', '😮', '😢', '😭', '😡', '🤯', '🙄', '😴'],
    Gestures: ['👍', '👎', '👏', '🙌', '👋', '✌️', '🤞', '🤝', '🙏', '💪', '👌', '🤟', '✊', '👊'],
    Hearts: ['⚡️', '💯', '⭐', '✅', '⏳'],
    Objects: ['🎉', '🎊', '🎈', '🎁', '🎂', '🎵', '🏆', '🎯'],
  }

  const allEmojis = Object.values(emojiCategories).flat()

  const quickEmojis = ['👍', '⚡️', '😀', '😂', '✅', '🎉']

  const addEmoji = (emoji: string) => {
    const input = chatInputRef.current
    if (input) {
      const start = input.selectionStart || 0
      const end = input.selectionEnd || 0
      const newValue = chatMessage.slice(0, start) + emoji + chatMessage.slice(end)
      setChatMessage(newValue)

      setTimeout(() => {
        const newCursorPos = start + emoji.length
        input.setSelectionRange(newCursorPos, newCursorPos)
        input.focus()
      }, 0)
    } else {
      setChatMessage((prev) => prev + emoji)
    }
    setShowEmojiPicker(false)
  }

  const renderMessageWithEmojis = (text: string) => {
    const emojiOnlyRegex = /^[\p{Emoji_Presentation}\p{Emoji}\uFE0F\s]+$/u
    const isEmojiOnly = emojiOnlyRegex.test(text) && text.trim().length <= 10 // Max 10 chars for emoji-only

    if (isEmojiOnly) {
      return <span style={{ fontSize: '2em', lineHeight: '1' }}>{text}</span>
    }

    const emojiRegex = /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/gu
    const parts = text.split(emojiRegex)

    return parts.map((part, index) => {
      if (emojiRegex.test(part)) {
        return (
          <span
            key={index}
            style={{
              fontSize: '1.2em',
              lineHeight: '1.2',
              display: 'inline-block',
              margin: '0 1px',
            }}
          >
            {part}
          </span>
        )
      }
      return part
    })
  }

  const handleSendMessage = async () => {
    if (chatMessage.trim()) {
      // Format timestamp as h.mmAM/PM
      const now = new Date()
      let hours = now.getHours()
      const minutes = now.getMinutes()
      const ampm = hours >= 12 ? 'PM' : 'AM'
      hours = hours % 12
      hours = hours ? hours : 12
      const formattedMinutes = minutes < 10 ? '0' + minutes : minutes
      const formattedTime = `${hours}:${formattedMinutes}${ampm}`
      if (chatSenderRef.current) {
        chatSenderRef.current.send(
          JSON.stringify({
            sender: username,
            message: chatMessage,
            timestamp: formattedTime,
          }),
        )
      }
      setChatMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(10).slice(2),
          sender: username,
          message: chatMessage,
          timestamp: formattedTime,
        },
      ])
      setChatMessage('')
    }
  }

  const addUser = (user: RoomUser): void => {
    setUsers((prev) => {
      const users = { ...prev }
      users[user.id] = user
      return users
    })
  }

  // Rewind functionality
  const handleOpenRewindPlayer = async (userId: string) => {
    if (isFetching) {
      console.log('Already fetching rewind data, please wait...')
      return
    }

    console.log('Fetching rewind data for user:', userId)
    setIsFetching(true)

    try {
      if (!moqClient || !roomState) {
        console.error('MOQ client or room state not available')
        return
      }

      const videoObjects: BufferedMoqtObject[] = []
      const audioObjects: BufferedMoqtObject[] = []

      // Fetch video track
      const videoTrackName = getTrackname(roomState.name, userId, 'video')
      console.log('Fetching video track:', videoTrackName.toString())

      /*
      const videoResult = await moqClient.fetch({
        priority: 0,
        groupOrder: GroupOrder.Original,
        typeAndProps: {
          type: FetchType.StandAlone,
          props: {
            fullTrackName: videoTrackName,
            startLocation: new Location(0n, 0n),
            endLocation: new Location(60n, 0n)
          },
        },
      })
      */
      // get request id from the video track subscription
      console.log('userSubscriptions', userSubscriptions)
      const videoRequestId = userSubscriptions[userId]?.videoRequestId
      if (videoRequestId === undefined) {
        console.error('No video request id found for user:', userId)
        return
      }

      console.log('SessionPage: About to fetch video with joiningRequestId:', videoRequestId)
      console.log('SessionPage: Using rewind fetch group size:', rewindFetchGroupSize)
      console.log(
        'SessionPage: All moqClient requestIds before video fetch:',
        moqClient ? Array.from(moqClient.requests.keys()) : 'no client',
      )
      const videoResult = await moqClient.fetch({
        priority: 0,
        groupOrder: GroupOrder.Original,
        typeAndProps: {
          type: FetchType.Relative,
          props: {
            joiningRequestId: videoRequestId,
            joiningStart: BigInt(rewindFetchGroupSize),
          },
        },
      })

      if (!(videoResult instanceof FetchError)) {
        const reader = videoResult.stream.getReader()
        console.log('Reading video objects from fetch stream...')

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            if (value && value.payload) {
              videoObjects.push({
                object: value,
                timestamp: Date.now(),
                type: 'video',
              })
              console.log('Fetched video object:', {
                group: value.location.group.toString(),
                object: value.location.object.toString(),
                payloadSize: value.payload.length,
              })
            }
          }
        } finally {
          reader.releaseLock()
        }
      } else {
        console.warn('Video fetch failed or returned error:', videoResult)
      }

      console.log('Skipping audio fetch to avoid AV sync issues during demo')

      console.log(`Fetch complete for user ${userId}: ${videoObjects.length} video objects (audio skipped for demo)`)

      setFetchedRewindData((prev) => ({
        ...prev,
        [userId]: { video: videoObjects, audio: audioObjects },
      }))

      if (videoObjects.length > 0) {
        setSelectedRewindUserId(userId)
        setIsRewindPlayerOpen(true)
      } else {
        console.warn('No video data available for user:', userId)
      }
    } catch (error) {
      console.error('Error fetching rewind data:', error)
    } finally {
      setIsFetching(false)
    }
  }

  const handleCloseRewindPlayer = () => {
    console.log('SessionPage: Closing rewind player')
    isRewindCleaningUp.current = true

    // Clear the fetched rewind data for the selected user
    if (selectedRewindUserId) {
      setFetchedRewindData((prev) => {
        const updated = { ...prev }
        delete updated[selectedRewindUserId]
        console.log(`Cleared fetched rewind data for user: ${selectedRewindUserId}`)
        return updated
      })
    }

    setIsRewindPlayerOpen(false)
    setSelectedRewindUserId('')

    // Add a delay to ensure rewind player cleanup is complete
    setTimeout(() => {
      console.log('SessionPage: Rewind player cleanup complete')
      isRewindCleaningUp.current = false
    }, 500)
  }

  const isSelf = (id: string): boolean => {
    return id === userId
  }

  const getUserInitials = (name: string): string => {
    const words = name.trim().split(/\s+/)

    if (words.length === 1) {
      return words[0].substring(0, 2).toUpperCase()
    } else {
      return words

        .slice(0, 2)

        .map((word) => word.charAt(0))

        .join('')

        .toUpperCase()
    }
  }

  const availableColors = [
    { bgClass: 'bg-blue-500', hexColor: '#3b82f6' },

    { bgClass: 'bg-green-500', hexColor: '#22c55e' },

    { bgClass: 'bg-purple-500', hexColor: '#a855f7' },

    { bgClass: 'bg-red-500', hexColor: '#ff0000' },

    { bgClass: 'bg-orange-500', hexColor: '#f97316' },

    { bgClass: 'bg-teal-500', hexColor: '#14b8a6' },
  ]

  const getUserColor = (userId: string): string => {
    return userColors[userId]?.bgClass || 'bg-gray-500'
  }

  const toggleInfoCard = (userId: string, panelType: 'network' | 'codec' = 'network') => {
    setShowInfoCards((prev) => ({
      ...prev,
      [userId]: !prev[userId] || infoPanelType[userId] !== panelType ? true : false,
    }))

    setInfoPanelType((prev) => ({
      ...prev,
      [userId]: panelType,
    }))
  }

  const getUserColorHex = (userId: string): string => {
    return userColors[userId]?.hexColor || '#6b7280'
  }

  const getSenderUserId = (senderName: string): string => {
    const user = Object.values(users).find((u) => u.name === senderName)

    return user?.id || ''
  }

  // Request notification permission on component mount
  const requestNotificationPermission = async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      try {
        await Notification.requestPermission()
      } catch (error) {
        console.warn('Failed to request notification permission:', error)
      }
    }
  }

  // Show notification when tab is not visible
  const showRoomClosedNotification = (message: string) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification('MOQtail Room Closed', {
        body: message,
        icon: '/moqtail.ico',
        requireInteraction: true, // Keep notification visible until user interacts
      })

      notification.onclick = () => {
        window.focus()
        notification.close()
      }
    }
  }

  // Check if document is visible
  const isDocumentVisible = () => {
    return !document.hidden
  }

  const handleToggle = (kind: 'mic' | 'cam') => {
    // Don't allow toggles while rewind player is cleaning up
    if (isRewindCleaningUp.current) {
      console.log('Rewind player is cleaning up, ignoring toggle request')
      return
    }

    const setter = kind === 'mic' ? setIsMicOn : setisCamOn
    setter((prev) => {
      const newValue = !prev
      setUsers((users) => {
        const u = users[userId]
        if (kind === 'mic') {
          users[userId] = { ...u, hasAudio: newValue }
          toggleMediaStreamAudio(newValue)
          if (audioEncoderObjRef.current) {
            audioEncoderObjRef.current.setEncoding(newValue)
          }
        } else if (kind === 'cam') {
          users[userId] = { ...u, hasVideo: newValue }
          // --- Video track switching logic ---
          const audioTrack = selfMediaStream.current?.getAudioTracks()[0]
          let newStream
          if (newValue) {
            navigator.mediaDevices.getUserMedia({ video: { aspectRatio: 16 / 9 } }).then((videoStream) => {
              const realVideoTrack = videoStream.getVideoTracks()[0]
              const oldVideoTrack = selfMediaStream.current?.getVideoTracks()[0]
              if (oldVideoTrack) {
                oldVideoTrack.stop()
                selfMediaStream.current?.removeTrack(oldVideoTrack)
              }
              newStream = new MediaStream()
              if (audioTrack) newStream.addTrack(audioTrack)
              newStream.addTrack(realVideoTrack)
              selfMediaStream.current = newStream
              if (videoEncoderObjRef.current) {
                videoEncoderObjRef.current.offset = offsetRef.current
                videoEncoderObjRef.current.start(selfMediaStream.current)
              }
              //TODO: HOW TO CONTINUE HD VIDEO ENCODER
              if (videoHDEncoderObjRef.current) {
                videoHDEncoderObjRef.current.offset = offsetRef.current
                videoHDEncoderObjRef.current.start(selfMediaStream.current)
              }
              if (selfVideoRef.current) {
                selfVideoRef.current.srcObject = newStream
                selfVideoRef.current.muted = true
              }
            })
          } else {
            const oldVideoTrack = selfMediaStream.current?.getVideoTracks()[0]
            if (oldVideoTrack) {
              oldVideoTrack.stop()
              selfMediaStream.current?.removeTrack(oldVideoTrack)
            }
            newStream = new MediaStream()
            if (audioTrack) newStream.addTrack(audioTrack)
            selfMediaStream.current = newStream
            if (selfVideoRef.current) selfVideoRef.current.srcObject = newStream
            selfVideoRef.current!.muted = true
            if (videoEncoderObjRef.current) {
              videoEncoderObjRef.current.stop()
            }
            //TODO: HOW TO STOP HD VIDEO ENCODER
            if (videoHDEncoderObjRef.current) {
              videoHDEncoderObjRef.current.stop()
            }
          }
        }
        return users
      })
      contextSocket?.emit('toggle-button', { kind, value: newValue })
      return newValue
    })
  }

  function toggleMediaStreamAudio(val: boolean) {
    const mediaStream = selfMediaStream.current!
    if (mediaStream) {
      const tracks = mediaStream.getAudioTracks()
      tracks.forEach((track) => (track.enabled = val))
    }
  }

  const handleToggleCam = () => {
    handleToggle('cam')
  }
  const handleToggleMic = () => {
    handleToggle('mic')
  }

  const handleQualityTransition = async (
    targetUserId: string,
    currentQuality: VideoQuality,
    newQuality: VideoQuality,
  ) => {
    if (isRewindCleaningUp.current) {
      return
    }

    console.log(`Transitioning ${targetUserId} from ${currentQuality} to ${newQuality}`)
    manualQualityTransitionsRef.current.add(targetUserId)

    try {
      if (currentQuality === 'HD' && newQuality === 'SD') {
        console.log('Unsubscribing from HD video')
        hdSubscriptionAttemptsRef.current.delete(targetUserId)
        await unsubscribeFromHDVideo(targetUserId)
        await new Promise((resolve) => setTimeout(resolve, 500))
      } else if (currentQuality === 'SD' && newQuality === 'HD') {
        console.log('Unsubscribing from SD video')
        hdSubscriptionAttemptsRef.current.delete(targetUserId)
        await unsubscribeFromUser(targetUserId, 'video')
        await new Promise((resolve) => setTimeout(resolve, 500))
      }

      if (newQuality === 'HD') {
        contextSocket?.emit('request-hd-video', {
          targetUserId,
          requesterId: userId,
        })
        console.log(`Sent HD video request to user ${targetUserId}`)
      } else {
        contextSocket?.emit('request-sd-video', {
          targetUserId,
          requesterId: userId,
        })
        console.log(`Sent SD video request to user ${targetUserId}`)

        const success = await subscribeToSDVideo(targetUserId)
        if (success) {
          console.log(`Successfully switched to SD video for ${targetUserId}`)
        } else {
          console.error(`Failed to switch to SD video for ${targetUserId}`)
        }
      }
    } catch (error) {
      console.error(`Error during quality transition for ${targetUserId}:`, error)
    } finally {
      manualQualityTransitionsRef.current.delete(targetUserId)
    }

    setUserVideoQualities((prev) => {
      const newQualities = {
        ...prev,
        [targetUserId]: newQuality,
      }
      userVideoQualitiesRef.current = newQualities

      return newQualities
    })
  }

  const handleToggleRemoteUserQuality = async (targetUserId: string) => {
    if (isRewindCleaningUp.current) {
      return
    }

    const currentQuality = userVideoQualities[targetUserId] || 'SD'

    if (currentQuality === 'HD') {
      // HD to SD: Direct transition, no permission needed
      console.log(`Switching from HD to SD for ${targetUserId}`)
      await handleQualityTransition(targetUserId, 'HD', 'SD')
    } else {
      // SD to HD: Request permission first
      console.log(`Requesting HD permission from ${targetUserId}`)

      // Add to pending requests
      setPendingHDRequests((prev) => new Set(prev).add(targetUserId))

      contextSocket?.emit('request-hd-video', {
        targetUserId,
        requesterId: userId,
      })
      console.log(`Sent HD permission request to user ${targetUserId}`)
      // Wait for permission response - handleQualityTransition will be called based on response
    }
  }

  // HD Permission Response Functions
  const handleHDPermissionAccept = () => {
    if (hdPermissionRequest && contextSocket) {
      console.log(`Accepting HD permission request from ${hdPermissionRequest.requesterId}`)
      contextSocket.emit('hd-permission-response', {
        requesterId: hdPermissionRequest.requesterId,
        allowed: true,
      })
      setHdPermissionRequest(null)
    }
  }

  const handleHDPermissionReject = () => {
    if (hdPermissionRequest && contextSocket) {
      console.log(`Rejecting HD permission request from ${hdPermissionRequest.requesterId}`)
      contextSocket.emit('hd-permission-response', {
        requesterId: hdPermissionRequest.requesterId,
        allowed: false,
      })
      setHdPermissionRequest(null)
    }
  }

  const handleStartHDEncoding = () => {
    if (isRewindCleaningUp.current) {
      return
    }

    console.log('Starting HD encoding process...')

    setUsers((users) => {
      const u = users[userId]
      users[userId] = { ...u, hasVideoHD: true }
      return { ...users }
    })

    if (roomState) {
      const roomName = roomState.name
      const videoHDTrack = roomState.users[userId]?.publishedTracks['video-hd']

      if (videoHDTrack && moqClientRef.current) {
        // TODO: HD Track should be announced only when the user accepts
        // TODO: Otherwise, SD should continue (the unsub should not happen)
        console.log('Announcing HD track to server')
        contextSocket?.emit('update-track', { trackType: 'video-hd', event: 'announce' })

        if (selfMediaStream.current && tracksRef.current) {
          if (!videoHDEncoderObjRef.current) {
            const videoHDFullTrackName = getTrackname(roomName, userId, 'video-hd')
            videoHDEncoderObjRef.current = initializeVideoHDEncoder({
              videoHDFullTrackName,
              videoHDStreamController: tracksRef.current.getVideoHDStreamController(),
              publisherPriority: 1,
              objectForwardingPreference: ObjectForwardingPreference.Subgroup,
            })
          }

          if (videoHDEncoderObjRef.current) {
            videoHDEncoderObjRef.current.offset = offsetRef.current
            videoHDEncoderObjRef.current.start(selfMediaStream.current)
            console.log('HD encoder started successfully')
          }

          contextSocket?.emit('update-track', { trackType: 'video-hd', event: 'publish' })
        } else {
          console.warn('Cannot start HD encoder - missing media stream or tracks')
        }
      } else {
        console.warn('Cannot start HD encoding - missing video HD track or moqClient', {
          hasVideoHDTrack: !!videoHDTrack,
          hasMoqClient: !!moqClientRef.current,
        })
      }
    } else {
      console.warn('Cannot start HD encoding - no room state')
    }

    contextSocket?.emit('toggle-button', { kind: 'cam-hd', value: true })

    console.log('Started HD encoding due to remote request')
  }

  const handleStopHDEncoding = () => {
    if (isRewindCleaningUp.current) {
      return
    }

    setUsers((users) => {
      const u = users[userId]
      users[userId] = { ...u, hasVideoHD: false }
      return { ...users }
    })

    if (videoHDEncoderObjRef.current) {
      videoHDEncoderObjRef.current.stop()
      videoHDEncoderObjRef.current = null
    }

    contextSocket?.emit('toggle-button', { kind: 'cam-hd', value: false })

    console.log('Stopped HD encoding due to remote request')
  }

  const handleToggleScreenShare = async () => {
    if (!isScreenSharing) {
      const someoneSharing = Object.values(users).some((u) => u.hasScreenshare && u.id !== userId)
      if (!isScreenSharing && someoneSharing) {
        alert('Only one person can share their screen at a time.')
        return
      }

      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true })
        const screenTrack = screenStream.getVideoTracks()[0]

        selfScreenshareStream.current = screenStream

        console.log('Screenshare stream tracks:', screenStream.getTracks())

        try {
          if (!tracksRef.current) {
            console.error('tracksRef.current is null - cannot start screenshare encoder')
            return
          }

          if (screenshareEncoderObjRef.current) {
            console.log('Cleaning up previous screenshare encoder')
            try {
              screenshareEncoderObjRef.current.stop()
            } catch (error) {
              console.error('Error stopping previous screenshare encoder:', error)
            }
            screenshareEncoderObjRef.current = null
          }

          const screenshareFullTrackName = getTrackname(roomState!.name, userId, 'screenshare')
          console.log('screenshareFullTrackName:', screenshareFullTrackName)

          const screenshareStreamController = tracksRef.current.getScreenshareStreamController()

          const screenshareResult = await startScreenshareEncoder({
            stream: screenStream,
            screenshareFullTrackName,
            screenshareStreamController,
            publisherPriority: 1,
            objectForwardingPreference: ObjectForwardingPreference.Subgroup,
          })
          console.log('screenshareResult:', screenshareResult)
          screenshareEncoderObjRef.current = screenshareResult

          const updateTrackRequest: UpdateTrackRequest = {
            trackType: 'screenshare',
            event: 'announce',
          }
          contextSocket?.emit('update-track', updateTrackRequest)
          console.log('Screenshare track announced to other clients')
        } catch (error) {
          console.error('Failed to start screenshare encoder:', error)
          if (selfScreenshareStream.current) {
            selfScreenshareStream.current.getTracks().forEach((track) => track.stop())
            selfScreenshareStream.current = null
          }
          return
        }

        setIsScreenSharing(true)
        contextSocket?.emit('screen-share-toggled', { userId, hasScreenshare: true })
        setUsers((users) => ({
          ...users,
          [userId]: { ...users[userId], hasScreenshare: true },
        }))

        screenTrack.onended = () => {
          console.log('Screen track ended - cleaning up screenshare')

          setIsScreenSharing(false)
          contextSocket?.emit('screen-share-toggled', { userId, hasScreenshare: false })
          setUsers((users) => ({
            ...users,
            [userId]: { ...users[userId], hasScreenshare: false },
          }))

          if (screenshareEncoderObjRef.current) {
            try {
              screenshareEncoderObjRef.current.stop()
            } catch (error) {
              console.error('Error stopping screenshare encoder:', error)
            }
            screenshareEncoderObjRef.current = null
          }

          if (selfScreenshareStream.current) {
            selfScreenshareStream.current.getTracks().forEach((track) => {
              try {
                track.stop()
              } catch (error) {
                console.error('Error stopping screenshare track:', error)
              }
            })
            selfScreenshareStream.current = null
          }

          if (selfScreenshareRef.current) {
            selfScreenshareRef.current.srcObject = null
          }
        }
      } catch (err) {
        console.error('Failed to start screen sharing', err)
      }
    } else {
      setIsScreenSharing(false)
      contextSocket?.emit('screen-share-toggled', { userId, hasScreenshare: false })
      setUsers((users) => ({
        ...users,
        [userId]: { ...users[userId], hasScreenshare: false },
      }))

      if (screenshareEncoderObjRef.current) {
        try {
          screenshareEncoderObjRef.current.stop()
        } catch (error) {
          console.error('Error stopping screenshare encoder:', error)
        }
        screenshareEncoderObjRef.current = null
      }

      if (selfScreenshareStream.current) {
        selfScreenshareStream.current.getTracks().forEach((track) => {
          try {
            track.stop()
          } catch (error) {
            console.error('Error stopping screenshare track:', error)
          }
        })
        selfScreenshareStream.current = null
      }

      if (selfScreenshareRef.current) {
        selfScreenshareRef.current.srcObject = null
      }
    }
  }

  useEffect(() => {
    async function startPublisher() {
      try {
        //console.log('Starting publisher for user:', userId);
        if (!userId) {
          console.error('User ID is not defined')
          return
        }
        if (!roomState) {
          console.error('Room state is not defined')
          return
        }

        selfMediaStream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
        const audioTracks = selfMediaStream.current.getAudioTracks()
        audioTracks.forEach((track) => (track.enabled = false))

        //console.log('Got user media:', selfMediaStream.current);
        setMediaReady(true)

        if (selfVideoRef.current) {
          selfVideoRef.current.srcObject = selfMediaStream.current
          selfVideoRef.current.muted = true // Ensure muted
          //console.log('Set video srcObject');
        } else {
          console.error('selfVideoRef.current is null')
          return
        }
        const roomName = roomState?.name
        if (!roomName) {
          console.error('Room name is not defined')
          return
        }

        const videoFullTrackName = getTrackname(roomName, userId, 'video')
        const videoHDFullTrackName = getTrackname(roomName, userId, 'video-hd')
        const audioFullTrackName = getTrackname(roomName, userId, 'audio')
        const chatFullTrackName = getTrackname(roomName, userId, 'chat')
        const screenshareFullTrackName = getTrackname(roomName, userId, 'screenshare')

        const selfUser = roomState.users[userId]
        if (!selfUser) {
          console.error('Self user not found in room state: %s', userId)
          return
        }
        //console.log('Self user found:', selfUser);
        const videoTrack = selfUser?.publishedTracks['video']
        const videoTrackAlias = videoTrack?.alias

        const videoHDTrack = selfUser?.publishedTracks['video-hd']
        const videoHDTrackAlias = videoHDTrack?.alias

        const audioTrack = selfUser?.publishedTracks['audio']
        const audioTrackAlias = audioTrack?.alias

        const chatTrack = selfUser?.publishedTracks['chat']
        const chatTrackAlias = chatTrack?.alias

        const screenshareTrack = selfUser?.publishedTracks['screenshare']
        const screenshareTrackAlias = screenshareTrack?.alias

        if (isNaN(videoTrackAlias ?? undefined)) {
          console.error('Video track alias not found for user:', userId)
          return
        }
        if (isNaN(audioTrackAlias ?? undefined)) {
          console.error('Audio track alias not found for user:', userId)
          return
        }
        if (isNaN(screenshareTrackAlias ?? undefined)) {
          console.error('Screenshare track alias not found for user:', userId)
          return
        }

        const normalizer = await ClockNormalizer.create(
          window.appSettings.clockNormalizationConfig.timeServerUrl,
          window.appSettings.clockNormalizationConfig.numberOfSamples,
        )
        const offset = normalizer.getSkew()
        offsetRef.current = offset
        announceNamespaces(moqClient!, videoFullTrackName.namespace)
        let tracks = setupTracks(
          moqClient!,
          audioFullTrackName,
          videoFullTrackName,
          videoHDFullTrackName,
          chatFullTrackName,
          screenshareFullTrackName,
          BigInt(audioTrackAlias),
          BigInt(videoTrackAlias),
          BigInt(videoHDTrackAlias),
          BigInt(chatTrackAlias),
          BigInt(screenshareTrackAlias),
        )
        tracksRef.current = tracks

        videoEncoderObjRef.current = initializeVideoEncoder({
          videoFullTrackName,
          videoStreamController: tracks.getVideoStreamController(),
          publisherPriority: 1,
          objectForwardingPreference: ObjectForwardingPreference.Subgroup,
        })

        videoHDEncoderObjRef.current = initializeVideoHDEncoder({
          videoHDFullTrackName,
          videoHDStreamController: tracks.getVideoHDStreamController(),
          publisherPriority: 1,
          objectForwardingPreference: ObjectForwardingPreference.Subgroup,
        })

        screenshareEncoderObjRef.current = initializeScreenshareEncoder({
          screenshareFullTrackName,
          screenshareStreamController: tracks.getScreenshareStreamController(),
          publisherPriority: 1,
          objectForwardingPreference: ObjectForwardingPreference.Subgroup,
        })

        // Only start video encoder if we have video tracks

        const hasVideoTrack = selfMediaStream.current.getVideoTracks().length > 0

        let videoPromise: Promise<any> = Promise.resolve()

        if (hasVideoTrack) {
          videoPromise = videoEncoderObjRef.current.start(selfMediaStream.current)
        }
        const audioPromise = startAudioEncoder({
          stream: selfMediaStream.current,
          audioFullTrackName,
          audioStreamController: tracks.getAudioStreamController(),
          publisherPriority: 1,
          audioGroupId: 0,
          objectForwardingPreference: ObjectForwardingPreference.Subgroup,
        }).then((audioEncoderResult) => {
          audioEncoderObjRef.current = audioEncoderResult
          audioEncoderObjRef.current.setEncoding(isMicOn)
          return audioEncoderResult
        })
        chatSenderRef.current = initializeChatMessageSender({
          chatFullTrackName,
          chatStreamController: tracks.getChatStreamController(),
          publisherPriority: 1,
          objectForwardingPreference: ObjectForwardingPreference.Subgroup,
        })

        await Promise.all([videoPromise, audioPromise])

        // send announce update to the socket server
        // so that the other clients are notified
        // and they can subscribe
        const updateTrackRequest: UpdateTrackRequest = {
          trackType: 'video',
          event: 'announce',
        }
        contextSocket?.emit('update-track', updateTrackRequest)

        updateTrackRequest.trackType = 'audio'
        contextSocket?.emit('update-track', updateTrackRequest)

        updateTrackRequest.trackType = 'chat'
        contextSocket?.emit('update-track', updateTrackRequest)
      } catch (err) {
        console.error('Error in publisher setup:', err)
      }
    }
    //console.log('before startPublisher', moqClient, userId, selfVideoRef.current, publisherInitialized)
    if (moqClient && userId && selfVideoRef.current && !publisherInitialized.current) {
      publisherInitialized.current = true
      setTimeout(async () => {
        try {
          await startPublisher()
          //console.log('startPublisher done')
        } catch (err) {
          console.error('error in startPublishing', err)
        }
      }, 1000)
    }
  }, [userId, roomState, moqClient])

  useEffect(() => {
    if (!username || !roomState) {
      leaveRoom()
      return
    }

    if (!moqtailClientInitStarted.current) {
      moqtailClientInitStarted.current = true

      const initClient = async () => {
        const client = await connectToRelay(relayUrl + '/' + username)
        setMoqClient(client)
        moqClientRef.current = client // Store in ref for stable access
        client.onDataReceived = (_data) => {
          // console.warn('Data received:', data)
        }
        //console.log('initClient', client)
        if (roomState && Object.values(users).length === 0) {
          const otherUsers = Object.keys(roomState.users).filter((uId) => uId != userId)
          setUsers(roomState.users)

          Object.keys(roomState.users).forEach((uId) => initializeTelemetryForUser(uId))
          const canvasRefs = Object.fromEntries(otherUsers.map((uId) => [uId, React.createRef<HTMLCanvasElement>()]))
          const screenshareCanvasRefs = Object.fromEntries(
            otherUsers.map((uId) => [uId, React.createRef<HTMLCanvasElement>()]),
          )
          setRemoteCanvasRefs(canvasRefs)
          setRemoteScreenshareCanvasRefs(screenshareCanvasRefs)
        }
      }

      initClient()
    }

    if (!contextSocket) return
    const socket = contextSocket
    socket.on('user-joined', (user: RoomUser) => {
      console.info(`User joined: ${user.name} (${user.id})`)
      addUser(user)
      initializeTelemetryForUser(user.id)
      setRemoteCanvasRefs((prev) => ({
        ...prev,
        [user.id]: React.createRef<HTMLCanvasElement>(),
      }))
      setRemoteScreenshareCanvasRefs((prev) => ({
        ...prev,
        [user.id]: React.createRef<HTMLCanvasElement>(),
      }))
      setUserSubscriptions((prev) => ({
        ...prev,
        [user.id]: {
          videoSubscribed: false,
          videoHDSubscribed: false,
          audioSubscribed: false,
          screenshareSubscribed: false,
          screenshareIntentionallyUnsubscribed: false,
        },
      }))
    })

    socket.on('track-updated', (response: TrackUpdateResponse) => {
      setUsers((prevUsers) => {
        //console.log('track-updated', prevUsers, response)
        const updatedUser = prevUsers[response.userId]
        if (updatedUser) {
          const track = response.track
          if (
            track.kind === 'video' ||
            track.kind === 'audio' ||
            track.kind === 'chat' ||
            track.kind === 'screenshare' ||
            track.kind === 'video-hd'
          ) {
            updatedUser.publishedTracks[track.kind] = track
            console.log(
              `Track updated for ${response.userId}: ${track.kind} - alias: ${track.alias}, announced: ${track.announced}`,
            )
          }
        }
        return { ...prevUsers }
      })

      // Handle HD video subscription outside of setState
      if (response.track.kind === 'video-hd' && response.track.announced > 0) {
        console.log('HD track announced, checking if we should subscribe...')

        const currentQuality = userVideoQualitiesRef.current[response.userId]
        console.log(`HD track announced by ${response.userId}, current requested quality: ${currentQuality}`)

        if (currentQuality === 'HD') {
          if (hdSubscriptionAttemptsRef.current.has(response.userId)) {
            // Subscribe request already sent
            return
          }

          console.log(`Auto-subscribing to HD video from ${response.userId}`)
          hdSubscriptionAttemptsRef.current.add(response.userId)

          setTimeout(() => {
            const currentUsers = usersRef.current
            const currentCanvasRefs = remoteCanvasRefsRef.current

            subscribeToHDVideoWithState(response.userId, currentUsers, currentCanvasRefs)
              .then((success) => {
                if (success) {
                  console.log(`HD subscription successful for ${response.userId}`)
                } else {
                  console.log(`HD subscription failed for ${response.userId}`)
                }
              })
              .catch((error) => {
                console.error(`HD subscription error for ${response.userId}:`, error)
              })
              .finally(() => {
                // Always remove from attempts set when done
                hdSubscriptionAttemptsRef.current.delete(response.userId)
              })
          }, 1000) // Increased delay to 1 second
        } else {
          console.log(`Not subscribing - current quality is ${currentQuality}, not HD`)
        }
      }
    })

    socket.on('button-toggled', (response: ToggleResponse) => {
      setUsers((prevUsers) => {
        const updatedUsers = { ...prevUsers }
        const user = updatedUsers[response.userId]
        if (user) {
          if (response.kind === 'mic') {
            user.hasAudio = response.value
          }
          if (response.kind === 'cam') {
            user.hasVideo = response.value
          }
        }
        return updatedUsers
      })
    })
    socket.on('screen-share-toggled', ({ userId: toggledUserId, hasScreenshare }) => {
      console.log(`Screen share toggled for ${toggledUserId}: ${hasScreenshare}`)

      setUsers((prevUsers) => {
        if (!prevUsers[toggledUserId]) return prevUsers

        if (!hasScreenshare && prevUsers[toggledUserId].hasScreenshare) {
          console.log(`User ${toggledUserId} stopped screensharing, triggering unsubscription`)
          unsubscribeFromScreenshare(toggledUserId, false)

          const screenshareVirtualId = `${toggledUserId}-screenshare`
          if (maximizedUserId === screenshareVirtualId) {
            console.log(`Clearing maximized screenshare user ${screenshareVirtualId}`)
            setMaximizedUserId(null)
          }

          setCodecData((prev) => {
            const newData = { ...prev }
            delete newData[screenshareVirtualId]
            return newData
          })
        }

        return {
          ...prevUsers,
          [toggledUserId]: {
            ...prevUsers[toggledUserId],
            hasScreenshare,
          },
        }
      })
    })

    // Handle HD permission request from another user
    socket.on('hd-permission-request', ({ requesterId }) => {
      console.log(`User ${requesterId} is requesting HD video permission from me`)
      const requester = usersRef.current[requesterId]
      const requesterName = requester ? requester.name : 'Unknown User'
      setHdPermissionRequest({ requesterId, requesterName })
    })

    // Handle permission denied response
    socket.on('hd-permission-denied', ({ targetUserId }) => {
      console.log(`HD permission denied by ${targetUserId}`)
      // User stays in SD mode - no action needed since we didn't change quality yet

      // Remove from pending requests
      setPendingHDRequests((prev) => {
        const newSet = new Set(prev)
        newSet.delete(targetUserId)
        return newSet
      })
    })

    // Handle permission granted response
    socket.on('hd-permission-granted', ({ targetUserId }) => {
      console.log(`HD permission granted by ${targetUserId}`)

      // Remove from pending requests
      setPendingHDRequests((prev) => {
        const newSet = new Set(prev)
        newSet.delete(targetUserId)
        return newSet
      })

      // First, set the quality to HD so the track-updated handler will auto-subscribe
      setUserVideoQualities((prev) => {
        const newQualities = {
          ...prev,
          [targetUserId]: 'HD' as VideoQuality,
        }
        userVideoQualitiesRef.current = newQualities
        console.log(`Set quality to HD for ${targetUserId} - track-updated will handle the rest`)
        return newQualities
      })

      // Unsubscribe from SD video after a short delay to ensure HD subscription starts
      setTimeout(async () => {
        try {
          console.log(`Unsubscribing from SD video for ${targetUserId}`)
          await unsubscribeFromUser(targetUserId, 'video')
        } catch (error) {
          console.error(`Error unsubscribing from SD for ${targetUserId}:`, error)
        }
      }, 200)
    })

    // Handle direct HD video request (when permission is granted)
    socket.on('request-hd-video', ({ requesterId }) => {
      console.log(`Starting HD encoding - permission was granted for ${requesterId}`)
      handleStartHDEncoding()
    })

    socket.on('request-sd-video', ({ requesterId }) => {
      console.log(`User ${requesterId} requested SD video from me`)
      handleStopHDEncoding()
    })

    socket.on('hd-already-active', ({ targetUserId }) => {
      console.log(`HD encoding already active for ${targetUserId} - subscribing to existing HD stream`)

      // Remove from pending requests since we're getting direct access to HD
      setPendingHDRequests((prev) => {
        const newSet = new Set(prev)
        newSet.delete(targetUserId)
        return newSet
      })

      manualQualityTransitionsRef.current.add(targetUserId)

      setUserVideoQualities((prev) => {
        const newQualities = {
          ...prev,
          [targetUserId]: 'HD' as VideoQuality,
        }
        userVideoQualitiesRef.current = newQualities
        console.log(`Updated quality state to HD for ${targetUserId}:`, newQualities)
        return newQualities
      })

      setTimeout(async () => {
        try {
          console.log(`Unsubscribing from SD video for ${targetUserId} before subscribing to existing HD`)
          await unsubscribeFromUser(targetUserId, 'video')

          await new Promise((resolve) => setTimeout(resolve, 500))

          const currentUsers = usersRef.current
          const currentCanvasRefs = remoteCanvasRefsRef.current

          console.log(`Subscribing to existing HD video for ${targetUserId}`)
          const success = await subscribeToHDVideoWithState(targetUserId, currentUsers, currentCanvasRefs)

          if (success) {
            console.log(`Successfully subscribed to existing HD video for ${targetUserId}`)
          } else {
            console.error(`Failed to subscribe to existing HD video for ${targetUserId}`)
          }
        } catch (error) {
          console.error(`Error subscribing to existing HD for ${targetUserId}:`, error)
        } finally {
          manualQualityTransitionsRef.current.delete(targetUserId)
        }
      }, 100)
    })

    socket.on('user-disconnect', (msg: UserDisconnectedMessage) => {
      console.info(`User disconnected: ${msg.userId}`)
      setUsers((prev) => {
        const users = { ...prev }
        delete users[msg.userId]
        return users
      })

      const canvasRef = remoteCanvasRefs[msg.userId]

      if (canvasRef && canvasRef.current) {
        canvasRef.current.remove()
      }

      setRemoteCanvasRefs((prev) => {
        const newRefs = { ...prev }
        delete newRefs[msg.userId]
        return newRefs
      })

      delete telemetryInstances.current[msg.userId]
      delete previousValues.current[msg.userId]
      setTelemetryData((prev) => {
        const newData = { ...prev }
        delete newData[msg.userId]
        return newData
      })
      setCodecData((prev) => {
        const newData = { ...prev }
        delete newData[msg.userId]
        return newData
      })

      setUserSubscriptions((prev) => {
        const updated = { ...prev }
        delete updated[msg.userId]
        return updated
      })

      setLatencyHistory((prev) => {
        const newHistory = { ...prev }
        delete newHistory[msg.userId]
        return newHistory
      })
      setVideoBitrateHistory((prev) => {
        const newHistory = { ...prev }
        delete newHistory[msg.userId]
        return newHistory
      })
      setAudioBitrateHistory((prev) => {
        const newHistory = { ...prev }
        delete newHistory[msg.userId]
        return newHistory
      })
      // Clean up user color

      setUserColors((prev) => {
        const newColors = { ...prev }

        delete newColors[msg.userId]

        return newColors
      })
      // TODO: unsubscribe
    })

    socket.on('room-closed', (msg: RoomTimeoutMessage) => {
      console.info('Room closed:', msg.message)
      const fullMessage = msg.message

      if (isDocumentVisible()) {
        // Tab is visible, show alert immediately
        alert(`${fullMessage}\n\nYou will be redirected to the home page.`)
        leaveRoom()
      } else {
        // Tab is not visible, show notification and save message for later
        showRoomClosedNotification(fullMessage)
        setPendingRoomClosedMessage(fullMessage)
        document.title = '🔴 Room Closed - MOQtail Demo'
      }
    })

    return () => {
      socket.off('user-joined')
      socket.off('track-updated')
      socket.off('button-toggled')
      socket.off('user-disconnect')
      socket.off('room-timeout')
      socket.off('screen-share-toggled')
      socket.off('request-hd-video')
      socket.off('request-sd-video')
      socket.off('hd-already-active')
      socket.off('hd-permission-request')
      socket.off('hd-permission-denied')
      socket.off('hd-permission-granted')
    }
  }, [contextSocket])

  useEffect(() => {
    const assignColors = () => {
      const assigned = { ...userColors }
      const used = new Set(Object.values(assigned).map((c) => c.bgClass))

      Object.keys(users).forEach((uid) => {
        if (!assigned[uid]) {
          const available = availableColors.find((c) => !used.has(c.bgClass))
          if (available) {
            assigned[uid] = available
            used.add(available.bgClass)
          } else {
            // fallback: assign gray if colors are exhausted
            assigned[uid] = { bgClass: 'bg-gray-500', hexColor: '#6b7280' }
          }
        }
      })
      setUserColors(assigned)
    }

    assignColors()
  }, [users])

  const initializeTelemetryForUser = (userId: string) => {
    if (!telemetryInstances.current[userId]) {
      telemetryInstances.current[userId] = {
        video: new NetworkTelemetry(1000), // 1 second window
        audio: new NetworkTelemetry(1000), // 1 second window
      }

      setCodecData((prev) => ({
        ...prev,
        [userId]: isSelf(userId) ? getSelfCodecData() : getOtherParticipantCodecData(userId),
      }))
    }
  }

  const getSelfCodecData = () => {
    const videoConfig = window.appSettings.videoEncoderConfig
    const audioConfig = window.appSettings.audioEncoderConfig

    return {
      videoCodec: videoConfig.codec,
      audioCodec: audioConfig.codec,
      frameRate: videoConfig.framerate || 30,
      sampleRate: audioConfig.sampleRate || 48000,
      resolution: `${videoConfig.width || 1280}x${videoConfig.height || 720}`,
      syncDrift: 0, // TODO
      videoBitrate: videoConfig.bitrate,
      audioBitrate: audioConfig.bitrate,
      numberOfChannels: audioConfig.numberOfChannels,
    }
  }

  const getScreenshareCodecData = () => {
    const screenshareConfig = window.appSettings.screenshareEncoderConfig

    return {
      videoCodec: screenshareConfig.codec,
      audioCodec: '0',
      frameRate: screenshareConfig.framerate || 30,
      sampleRate: 0,
      resolution: `${screenshareConfig.width || 1920}x${screenshareConfig.height || 1080}`,
      syncDrift: 0,
      videoBitrate: screenshareConfig.bitrate,
      audioBitrate: 0,
      numberOfChannels: 0,
    }
  }

  const getOtherParticipantCodecData = (userId?: string) => {
    const currentQuality = userId ? userVideoQualities[userId] || 'SD' : 'SD'
    const isHD = currentQuality === 'HD'

    const videoConfig = isHD ? window.appSettings.videoEncoderConfigHD : window.appSettings.videoEncoderConfig
    const audioConfig = window.appSettings.audioEncoderConfig

    return {
      videoCodec: videoConfig.codec,
      audioCodec: audioConfig.codec,
      frameRate: videoConfig.framerate || 25,
      sampleRate: audioConfig.sampleRate || 48000,
      resolution: `${videoConfig.width || (isHD ? 1280 : 640)}x${videoConfig.height || (isHD ? 720 : 360)}`,
      syncDrift: 0, // TODO
      videoBitrate: videoConfig.bitrate,
      audioBitrate: audioConfig.bitrate,
      numberOfChannels: audioConfig.numberOfChannels,
    }
  }

  const previousValues = useRef<{ [userId: string]: { latency: number; videoBitrate: number; audioBitrate: number } }>(
    {},
  )

  // Update every 100ms
  useEffect(() => {
    const interval = setInterval(() => {
      const newTelemetryData: { [userId: string]: { latency: number; videoBitrate: number; audioBitrate: number } } = {}

      Object.keys(telemetryInstances.current).forEach((userId) => {
        const telemetry = telemetryInstances.current[userId]
        if (telemetry) {
          const videoLatency = isSelf(userId) ? 0 : Math.round(telemetry.video.latency)
          const audioLatency = isSelf(userId) ? 0 : Math.round(telemetry.audio.latency)
          const videoBitrate = (telemetry.video.throughput * 8) / 1000 // bytes/s to Kbps
          const audioBitrate = (telemetry.audio.throughput * 8) / 1000 // bytes/s to Kbps

          const user = users[userId]
          const shouldUseAudioLatency = user?.hasAudio && (!user?.hasVideo || audioLatency > 0)
          const displayLatency = shouldUseAudioLatency ? audioLatency : videoLatency
          //console.log(`Telemetry for user ${userId}: videoLatency=${videoLatency}, audioLatency=${audioLatency}, displayLatency=${displayLatency}, hasVideo=${user?.hasVideo}, hasAudio=${user?.hasAudio}, shouldUseAudioLatency=${shouldUseAudioLatency}`)

          newTelemetryData[userId] = {
            latency: displayLatency,
            videoBitrate: Math.max(0, videoBitrate),
            audioBitrate: Math.max(0, audioBitrate),
          }

          // Latency history (last 30 points)
          if (!isSelf(userId)) {
            setLatencyHistory((prevLatency) => {
              const userHistory = prevLatency[userId] || []
              const newHistory = [...userHistory, displayLatency].slice(-30)
              return {
                ...prevLatency,
                [userId]: newHistory,
              }
            })
          }

          // Video bitrate history (last 30 points)
          setVideoBitrateHistory((prevVideoBitrate) => {
            const userHistory = prevVideoBitrate[userId] || []
            const newHistory = [...userHistory, videoBitrate].slice(-30)
            return {
              ...prevVideoBitrate,
              [userId]: newHistory,
            }
          })

          // Audio bitrate history (last 30 points)
          setAudioBitrateHistory((prevAudioBitrate) => {
            const userHistory = prevAudioBitrate[userId] || []
            const newHistory = [...userHistory, audioBitrate].slice(-30)
            return {
              ...prevAudioBitrate,
              [userId]: newHistory,
            }
          })
        }
      })

      setTelemetryData(newTelemetryData)
    }, 100)

    return () => clearInterval(interval)
  }, [users])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
        setShowEmojiPicker(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowEmojiPicker(false)
      }
    }

    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showEmojiPicker])

  useEffect(() => {
    Object.values(remoteCanvasRefs).forEach((ref) => {
      handleRemoteVideo(ref)
    })
  }, [remoteCanvasRefs, users])

  useEffect(() => {
    Object.values(remoteScreenshareCanvasRefs).forEach((ref) => {
      handleRemoteScreenshare(ref)
    })
  }, [users, remoteScreenshareCanvasRefs, userSubscriptions])

  useEffect(() => {
    Object.keys(userVideoQualities).forEach((userId) => {
      if (!isSelf(userId)) {
        setCodecData((prev) => ({
          ...prev,
          [userId]: getOtherParticipantCodecData(userId),
        }))
      }
    })
  }, [userVideoQualities])

  useEffect(() => {
    const handlePopState = (_event: PopStateEvent) => {
      leaveRoom()
    }

    window.addEventListener('popstate', handlePopState)

    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  // Request notification permission and handle page visibility changes
  useEffect(() => {
    // Request notification permission on mount
    requestNotificationPermission()

    // Handle page visibility changes to show pending room closed messages
    const handleVisibilityChange = () => {
      if (!document.hidden && pendingRoomClosedMessage) {
        // Tab became visible and we have a pending message
        alert(`${pendingRoomClosedMessage}\n\nYou will be redirected to the home page.`)
        setPendingRoomClosedMessage(null)
        document.title = originalTitle.current
        leaveRoom()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [pendingRoomClosedMessage])

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      // Restore original title on unmount
      document.title = originalTitle.current
    }
  }, [])

  // Timer
  useEffect(() => {
    if (!roomState?.created) return
    const interval = setInterval(() => {
      const now = Date.now()
      const elapsed = now - roomState.created
      const totalTimeoutMs = sessionDurationMinutes * 60 * 1000
      const remaining = Math.max(0, totalTimeoutMs - elapsed)
      if (remaining <= 0) {
        setTimeRemaining('0:00')
        setTimeRemainingColor('text-red-500')
        clearInterval(interval)
        return
      }

      const minutes = Math.floor(remaining / 60000)
      const seconds = Math.floor((remaining % 60000) / 1000)
      setTimeRemaining(`${minutes}:${seconds.toString().padStart(2, '0')}`)

      if (remaining <= 60000) {
        // 1 minute
        setTimeRemainingColor('text-red-500')
      } else if (remaining <= 120000) {
        // 2 minutes
        setTimeRemainingColor('text-yellow-400')
      } else {
        setTimeRemainingColor('text-green-400')
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [roomState?.created, sessionDurationMinutes])

  useEffect(() => {
    console.log('Screenshare useEffect triggered:', {
      hasStream: !!selfScreenshareStream.current,
      hasRef: !!selfScreenshareRef.current,
      isScreenSharing,
      streamTracks: selfScreenshareStream.current?.getTracks()?.length || 0,
    })

    if (selfScreenshareStream.current && selfScreenshareRef.current && isScreenSharing) {
      console.log('Assigning screenshare stream to ref in useEffect')
      selfScreenshareRef.current.srcObject = selfScreenshareStream.current
      selfScreenshareRef.current.muted = true
      console.log('Screenshare video element configured successfully:', selfScreenshareRef.current)
    }
  }, [isScreenSharing, selfScreenshareStream.current])

  function getUserCount() {
    return Object.entries(users).length
  }

  function getTrackname(
    roomName: string,
    userId: string,
    kind: 'video' | 'video-hd' | 'audio' | 'chat' | 'screenshare',
  ): FullTrackName {
    // Returns a FullTrackName for the given room, user, and track kind
    return FullTrackName.tryNew(Tuple.fromUtf8Path(`/moqtail/${roomName}/${userId}`), new TextEncoder().encode(kind))
  }

  function handleRemoteVideo(canvasRef: React.RefObject<HTMLCanvasElement>) {
    //console.log('handleRemoteVideo init', canvasRef)
    if (!canvasRef?.current) return
    if (!moqClient) return
    if (canvasRef.current.dataset.status) return

    const userId = canvasRef.current.id
    const roomName = roomState?.name!
    const videoTrackAlias = parseInt(canvasRef.current.dataset.videotrackalias || '-1')
    const audioTrackAlias = parseInt(canvasRef.current.dataset.audiotrackalias || '-1')
    const chatTrackAlias = parseInt(canvasRef.current.dataset.chattrackalias || '-1')
    const announced = parseInt(canvasRef.current.dataset.announced || '0')
    const currentSubscription = userSubscriptions[userId]
    const isVideoSubscribed = currentSubscription?.videoSubscribed || false
    const isVideoHDSubscribed = currentSubscription?.videoHDSubscribed || false
    const isAudioSubscribed = currentSubscription?.audioSubscribed || false
    const isCompletelyUnsubscribed = !isVideoSubscribed && !isVideoHDSubscribed && !isAudioSubscribed
    const tracksReady = announced > 0 && videoTrackAlias > 0 && audioTrackAlias > 0
    const wasIntentionallyUnsubscribed = currentSubscription?.intentionallyUnsubscribed === true

    const isInManualTransition = manualQualityTransitionsRef.current.has(userId)
    const shouldSubscribe =
      tracksReady && isCompletelyUnsubscribed && !wasIntentionallyUnsubscribed && !isInManualTransition

    if (shouldSubscribe) {
      console.log(`Starting subscription to ${userId} - video: ${videoTrackAlias}, audio: ${audioTrackAlias}`)
      setTimeout(async () => {
        await subscribeToTrack(roomName, userId, videoTrackAlias, audioTrackAlias, chatTrackAlias, canvasRef)
      }, 500)
    } else {
      if (tracksReady && isInManualTransition) {
        console.log(`Skipping auto-subscription to ${userId} - user is undergoing manual quality transition`)
      } else if (tracksReady && wasIntentionallyUnsubscribed) {
        console.log(`Skipping auto-subscription to ${userId} - user was intentionally unsubscribed from both tracks`)
      } else if (tracksReady && !isCompletelyUnsubscribed) {
        console.log(
          `Skipping subscription to ${userId} - already subscribed (video: ${isVideoSubscribed}, videoHD: ${isVideoHDSubscribed}, audio: ${isAudioSubscribed})`,
        )
      } else if (!tracksReady) {
        console.log(
          `Not ready to subscribe to ${userId} yet - announced: ${announced}, video: ${videoTrackAlias}, audio: ${audioTrackAlias}`,
        )
      }
    }
  }

  async function handleRemoteScreenshare(canvasRef: React.RefObject<HTMLCanvasElement>) {
    if (!canvasRef?.current) return
    if (!moqClient) return
    if (canvasRef.current.dataset.status) return

    const userId = canvasRef.current.id
    const roomName = roomState?.name!
    const user = users[userId]
    const screenshareTrack = user?.publishedTracks?.screenshare
    const screenshareTrackAlias = screenshareTrack?.alias
    const currentSubscription = userSubscriptions[userId]
    const isScreenshareSubscribed = currentSubscription?.screenshareSubscribed || false
    const userHasScreenshare = user?.hasScreenshare || false
    const wasScreenshareIntentionallyUnsubscribed = currentSubscription?.screenshareIntentionallyUnsubscribed === true

    const tracksReady = screenshareTrackAlias && screenshareTrackAlias > 0
    const shouldSubscribe =
      tracksReady && userHasScreenshare && !isScreenshareSubscribed && !wasScreenshareIntentionallyUnsubscribed

    if (shouldSubscribe) {
      console.log(`Starting screenshare subscription to ${userId} - screenshare: ${screenshareTrackAlias}`)
      setTimeout(async () => {
        await subscribeToScreenshareTrack(roomName, userId, screenshareTrackAlias, canvasRef)
      }, 500)
    } else {
      if (!userHasScreenshare && isScreenshareSubscribed) {
        console.log(`User ${userId} stopped screensharing, cleaning up subscription`)
        unsubscribeFromScreenshare(userId, false)
      } else if (!tracksReady) {
        console.log(
          `Not ready to subscribe to screenshare for ${userId} yet - screenshareTrackAlias: ${screenshareTrackAlias}`,
        )
      }
    }
  }

  async function subscribeToTrack(
    roomName: string,
    userId: string,
    videoTrackAlias: number,
    audioTrackAlias: number,
    chatTrackAlias: number,
    canvasRef: React.RefObject<HTMLCanvasElement>,
    client: MOQtailClient | undefined = undefined,
  ) {
    try {
      const the_client = client ? client : moqClient!
      //console.log('subscribeToTrack', roomName, userId, videoTrackAlias, audioTrackAlias, canvasRef)
      // TODO: sub to audio and video separately
      // for now, we just check the video announced date
      if (canvasRef.current && !canvasRef.current.dataset.status) {
        //console.log("subscribeToTrack - Now will try to subscribe")
        const videoFullTrackName = getTrackname(roomName, userId, 'video')
        const audioFullTrackName = getTrackname(roomName, userId, 'audio')
        const chatFullTrackName = getTrackname(roomName, userId, 'chat')
        canvasRef.current!.dataset.status = 'pending'
        // Initialize telemetry for this user if not already done
        initializeTelemetryForUser(userId)
        const userTelemetry = telemetryInstances.current[userId]

        //console.log("subscribeToTrack - Use video subscriber called", videoTrackAlias, audioTrackAlias, videoFullTrackName, audioFullTrackName)
        // Subscribe to video and audio separately for independent control
        const videoResult = await onlyUseVideoSubscriber(
          the_client,
          canvasRef,
          videoTrackAlias,
          videoFullTrackName,
          userTelemetry.video,
        )()

        const audioResult = await onlyUseAudioSubscriber(
          the_client,
          audioTrackAlias,
          audioFullTrackName,
          userTelemetry.audio,
        )()

        const subscriptionResult = {
          videoRequestId: videoResult.videoRequestId,
          audioRequestId: audioResult.audioRequestId,
        }

        if (subscriptionResult) {
          setUserSubscriptions((prev) => ({
            ...prev,
            [userId]: {
              videoSubscribed: true,
              audioSubscribed: true,
              videoRequestId: subscriptionResult.videoRequestId,
              audioRequestId: subscriptionResult.audioRequestId,
              intentionallyUnsubscribed: false, // Clear the flag when subscribing
            },
          }))
        }

        // Subscribe to chat if we have a valid chat track alias
        if (chatTrackAlias > 0) {
          console.log('Subscribing to chat track with alias:', chatTrackAlias)
          try {
            await subscribeToChatTrack({
              moqClient: the_client,
              chatTrackAlias: chatTrackAlias,
              chatFullTrackName,
              onMessage: (msgObj) => {
                setChatMessages((prev) => [
                  ...prev,
                  {
                    id: Math.random().toString(10).slice(2),
                    sender: msgObj.sender,
                    message: msgObj.message,
                    timestamp: msgObj.timestamp,
                  },
                ])
              },
            })
            console.log('Successfully subscribed to chat for user:', userId)
          } catch (error) {
            console.error('Failed to subscribe to chat for user:', userId, error)
          }
        } else {
          console.warn('Chat track alias is invalid or not set:', chatTrackAlias, 'for user:', userId)
          // Try to subscribe to chat later with a retry mechanism
          setTimeout(async () => {
            console.log('Retrying chat subscription for user:', userId)
            const retrychatTrackAlias = parseInt(canvasRef.current?.dataset.chattrackalias || '-1')
            if (retrychatTrackAlias > 0) {
              try {
                await subscribeToChatTrack({
                  moqClient: the_client,
                  chatTrackAlias: retrychatTrackAlias,
                  chatFullTrackName,
                  onMessage: (msgObj) => {
                    setChatMessages((prev) => [
                      ...prev,
                      {
                        id: Math.random().toString(10).slice(2),
                        sender: msgObj.sender,
                        message: msgObj.message,
                        timestamp: msgObj.timestamp,
                      },
                    ])
                  },
                })
                console.log('Successfully subscribed to chat on retry for user:', userId)
              } catch (error) {
                console.error('Failed to subscribe to chat on retry for user:', userId, error)
              }
            } else {
              console.warn('Chat track alias still invalid on retry for user:', userId)
            }
          }, 2000) // Wait 2 seconds before retrying chat subscription
        }
        //console.log('subscribeToTrack result', result)
        // TODO: result comes true all the time, refactor...
        canvasRef.current!.dataset.status = subscriptionResult ? 'playing' : ''
      }
    } catch (err) {
      console.error('Error in subscribing', roomName, userId, err)
      // reset status
      if (canvasRef.current) canvasRef.current.dataset.status = ''
    }
  }

  async function subscribeToHDVideoWithState(
    targetUserId: string,
    currentUsers: { [K: string]: RoomUser },
    currentCanvasRefs: { [id: string]: React.RefObject<HTMLCanvasElement> },
  ): Promise<boolean> {
    console.log(`🔍 subscribeToHDVideoWithState called for ${targetUserId}`)

    if (!roomState || !moqClientRef.current) {
      console.error('Room state or moqClient not available')
      return false
    }

    const roomName = roomState.name
    const targetUser = currentUsers[targetUserId]
    const canvasRef = currentCanvasRefs[targetUserId]

    if (!targetUser || !canvasRef?.current) {
      console.error(`Target user ${targetUserId} or canvas not found`, {
        targetUser,
        canvasRef: canvasRef?.current,
      })
      return false
    }

    const videoHDTrack = targetUser.publishedTracks['video-hd']
    if (!videoHDTrack || videoHDTrack.announced === 0) {
      console.warn(`HD video track not available for user ${targetUserId}`, {
        hasTrack: !!videoHDTrack,
        announced: videoHDTrack?.announced,
      })
      return false
    }

    try {
      const videoHDFullTrackName = getTrackname(roomName, targetUserId, 'video-hd')
      initializeTelemetryForUser(targetUserId)
      const userTelemetry = telemetryInstances.current[targetUserId]

      const hdResult = await onlyUseVideoHDSubscriber(
        moqClientRef.current,
        canvasRef,
        videoHDTrack.alias,
        videoHDFullTrackName,
        userTelemetry.video,
      )()

      if (hdResult.videoRequestId) {
        setUserSubscriptions((prev) => ({
          ...prev,
          [targetUserId]: {
            ...prev[targetUserId],
            videoHDSubscribed: true,
            videoHDRequestId: hdResult.videoRequestId,
          },
        }))
        console.log(`Successfully subscribed to HD video for user ${targetUserId}`)
        return true
      }
    } catch (error) {
      console.error(`Failed to subscribe to HD video for user ${targetUserId}:`, error)
    }
    return false
  }

  async function subscribeToSDVideo(targetUserId: string): Promise<boolean> {
    console.log(`subscribeToSDVideo called for ${targetUserId}`)

    if (!roomState || !moqClientRef.current) {
      console.error('Room state or moqClient not available for SD subscription')
      return false
    }

    const canvasRef = remoteCanvasRefs[targetUserId]
    if (!canvasRef?.current) {
      console.error(`Canvas not found for SD subscription to ${targetUserId}`)
      return false
    }

    const roomName = roomState.name
    const videoTrackAlias = parseInt(canvasRef.current.dataset.videotrackalias || '-1')

    if (videoTrackAlias === -1) {
      console.error(`Video track alias not available for ${targetUserId}`)
      return false
    }

    try {
      const videoFullTrackName = getTrackname(roomName, targetUserId, 'video')
      initializeTelemetryForUser(targetUserId)
      const userTelemetry = telemetryInstances.current[targetUserId]

      console.log(`About to subscribe to SD video:`, {
        targetUserId,
        trackAlias: videoTrackAlias,
        fullTrackName: videoFullTrackName.toString(),
      })

      // Reset canvas status to allow subscription
      canvasRef.current.dataset.status = ''

      const sdResult = await onlyUseVideoSubscriber(
        moqClientRef.current,
        canvasRef,
        videoTrackAlias,
        videoFullTrackName,
        userTelemetry.video,
      )()

      if (sdResult.videoRequestId) {
        setUserSubscriptions((prev) => ({
          ...prev,
          [targetUserId]: {
            ...prev[targetUserId],
            videoSubscribed: true,
            videoRequestId: sdResult.videoRequestId,
          },
        }))
        console.log(`Successfully subscribed to SD video for user ${targetUserId}`)
        return true
      }
    } catch (error) {
      console.error(`Failed to subscribe to SD video for user ${targetUserId}:`, error)
    }
    return false
  }

  async function subscribeToScreenshareTrack(
    roomName: string,
    userId: string,
    screenshareTrackAlias: number,
    screenshareCanvasRef: React.RefObject<HTMLCanvasElement>,
    client: MOQtailClient | undefined = undefined,
  ) {
    try {
      const the_client = client ? client : moqClient!

      if (screenshareCanvasRef.current && !screenshareCanvasRef.current.dataset.status) {
        const screenshareFullTrackName = getTrackname(roomName, userId, 'screenshare')
        screenshareCanvasRef.current!.dataset.status = 'pending'

        console.log(`Starting screenshare subscription for ${userId}`, {
          trackName: screenshareFullTrackName,
          trackAlias: screenshareTrackAlias,
        })

        initializeTelemetryForUser(userId)
        const userTelemetry = telemetryInstances.current[userId]

        const screenshareResult = await onlyUseScreenshareSubscriber(
          the_client,
          screenshareCanvasRef,
          screenshareTrackAlias,
          screenshareFullTrackName,
          userTelemetry.video,
        )()

        if (screenshareResult && screenshareResult.videoRequestId) {
          screenshareSubscriptionsRef.current[userId] = {
            requestId: screenshareResult.videoRequestId,
            subscribed: true,
          }

          setUserSubscriptions((prev) => ({
            ...prev,
            [userId]: {
              ...prev[userId],
              screenshareSubscribed: true,
              screenshareRequestId: screenshareResult.videoRequestId,
              screenshareIntentionallyUnsubscribed: false,
            },
          }))
        }

        screenshareCanvasRef.current!.dataset.status = screenshareResult ? 'playing' : ''
      } else {
        console.log(`Cannot subscribe to screenshare for ${userId}:`, {
          hasCanvasRef: !!screenshareCanvasRef.current,
          currentStatus: screenshareCanvasRef.current?.dataset.status,
        })
      }
    } catch (err) {
      console.error('Error in subscribing to screenshare', roomName, userId, err)
      if (screenshareCanvasRef.current) screenshareCanvasRef.current.dataset.status = ''
    }
  }

  const unsubscribeFromScreenshare = async (targetUserId: string, isManual: boolean = true) => {
    const client = moqClientRef.current

    if (!client || targetUserId === userId) {
      console.warn(
        `Cannot unsubscribe from screenshare: moqClient=${!!client}, targetUserId=${targetUserId}, userId=${userId}`,
      )
      return
    }

    const subscription = userSubscriptions[targetUserId]
    const refSubscription = screenshareSubscriptionsRef.current[targetUserId]

    const hasSubscription = subscription?.screenshareSubscribed || refSubscription?.subscribed
    const requestId = subscription?.screenshareRequestId || refSubscription?.requestId

    if (!hasSubscription || !requestId) {
      console.warn(`No screenshare subscription found for user ${targetUserId}`, {
        hasReactSubscription: subscription?.screenshareSubscribed,
        hasRefSubscription: refSubscription?.subscribed,
        reactRequestId: subscription?.screenshareRequestId,
        refRequestId: refSubscription?.requestId,
      })

      delete screenshareSubscriptionsRef.current[targetUserId]
      setUserSubscriptions((prev) => ({
        ...prev,
        [targetUserId]: {
          ...prev[targetUserId],
          screenshareSubscribed: false,
          screenshareRequestId: undefined,
          intentionallyUnsubscribed: true,
        },
      }))

      const screenshareCanvasRef = remoteScreenshareCanvasRefs[targetUserId]
      if (screenshareCanvasRef?.current) {
        screenshareCanvasRef.current.dataset.status = ''
        console.log(`Reset canvas status for ${targetUserId} screenshare (no subscription case)`)
      }

      return
    }

    let unsubscriptionSuccess = false

    try {
      console.log(`Attempting to unsubscribe from ${targetUserId} screenshare with requestId:`, requestId)
      await client.unsubscribe(requestId)
      console.log(`Successfully unsubscribed from ${targetUserId} screenshare`)
      unsubscriptionSuccess = true
    } catch (error) {
      console.error(`Failed to unsubscribe from ${targetUserId} screenshare:`, error)
    }

    delete screenshareSubscriptionsRef.current[targetUserId]
    setUserSubscriptions((prev) => ({
      ...prev,
      [targetUserId]: {
        ...prev[targetUserId],
        screenshareSubscribed: false,
        screenshareRequestId: undefined,
        screenshareIntentionallyUnsubscribed: isManual,
      },
    }))

    const screenshareCanvasRef = remoteScreenshareCanvasRefs[targetUserId]
    if (screenshareCanvasRef?.current) {
      screenshareCanvasRef.current.dataset.status = ''
      const canvas = screenshareCanvasRef.current
      clearScreenshareCanvas(canvas)
    }

    console.log(
      `Screenshare cleanup completed for ${targetUserId} (unsubscription: ${unsubscriptionSuccess ? 'success' : 'failed'})`,
      {
        refCleared: !screenshareSubscriptionsRef.current[targetUserId],
        stateUpdate: 'pending...',
      },
    )
  }

  function leaveRoom() {
    //console.log('Leaving room...');

    // Clean up any pending room closed messages and restore title
    setPendingRoomClosedMessage(null)
    document.title = originalTitle.current

    setMoqClient(undefined)
    moqClientRef.current = undefined
    if (selfMediaStream.current) {
      const tracks = selfMediaStream.current.getTracks()
      tracks.forEach((track) => {
        track.stop()
      })
      selfMediaStream.current = null
    }

    if (videoEncoderObjRef.current && videoEncoderObjRef.current.stop) {
      //console.log('Stopping video encoder...');
      videoEncoderObjRef.current.stop()
      videoEncoderObjRef.current = null
    }

    if (audioEncoderObjRef.current) {
      audioEncoderObjRef.current = null
    }

    if (selfVideoRef.current) {
      selfVideoRef.current.srcObject = null
    }

    if (contextSocket && contextSocket.connected) {
      contextSocket.disconnect()
    }
    moqClient?.disconnect()

    clearSession()

    window.location.href = '/'
  }

  const unsubscribeFromHDVideo = async (targetUserId: string): Promise<boolean> => {
    console.log(`🔍 unsubscribeFromHDVideo called for ${targetUserId}`)

    if (!moqClient || targetUserId === userId) {
      console.warn(
        `Cannot unsubscribe from HD: moqClient=${!!moqClient}, targetUserId=${targetUserId}, userId=${userId}`,
      )
      return false
    }

    const subscription = userSubscriptions[targetUserId]
    if (!subscription?.videoHDSubscribed || !subscription?.videoHDRequestId) {
      console.warn(`No HD video subscription found for user ${targetUserId}`)
      return false
    }

    try {
      console.log(
        `Attempting to unsubscribe from ${targetUserId} HD video with requestId:`,
        subscription.videoHDRequestId,
      )
      await moqClient.unsubscribe(subscription.videoHDRequestId)
      console.log(`Successfully unsubscribed from ${targetUserId} HD video`)

      setUserSubscriptions((prev) => ({
        ...prev,
        [targetUserId]: {
          ...prev[targetUserId],
          videoHDSubscribed: false,
          videoHDRequestId: undefined,
        },
      }))

      return true
    } catch (error) {
      console.error(`Failed to unsubscribe from ${targetUserId} HD video:`, error)
      return false
    }
  }

  const unsubscribeFromUser = async (targetUserId: string, type: 'video' | 'audio' | 'both') => {
    const _client = moqClientRef.current
    if (!_client || targetUserId === userId) {
      console.warn(`Cannot unsubscribe: moqClient=${!!_client}, targetUserId=${targetUserId}, userId=${userId}`)
      return
    }

    const subscription = userSubscriptionsRef.current[targetUserId]

    if (!subscription) {
      console.warn(`No subscription found for user ${targetUserId}`)
      return
    }

    let videoUnsubscribed = false
    let audioUnsubscribed = false

    if (
      (type === 'video' || type === 'both') &&
      subscription.videoSubscribed &&
      subscription.videoRequestId !== undefined
    ) {
      try {
        console.log(`Attempting to unsubscribe from ${targetUserId} video with requestId:`, subscription.videoRequestId)
        await _client.unsubscribe(subscription.videoRequestId)
        console.log(`Successfully unsubscribed from ${targetUserId} video`)
        videoUnsubscribed = true
      } catch (error) {
        console.error(`Failed to unsubscribe from ${targetUserId} video:`, error)
      }
    } else if (type === 'video' || type === 'both') {
      console.log(`Skipping video unsubscribe for ${targetUserId} - not subscribed or missing requestId`)
    }

    const audioTypeCheck = type === 'audio' || type === 'both'
    const audioSubscribedCheck = subscription.audioSubscribed
    const audioRequestIdCheck = subscription.audioRequestId !== undefined

    if (audioTypeCheck && audioSubscribedCheck && audioRequestIdCheck) {
      try {
        console.log(
          `Attempting to unsubscribe from ${targetUserId} audio with requestId:`,
          subscription.audioRequestId!,
        )
        await _client.unsubscribe(subscription.audioRequestId!)
        console.log(`Successfully unsubscribed from ${targetUserId} audio`)
        audioUnsubscribed = true
      } catch (error) {
        console.error(`Failed to unsubscribe from ${targetUserId} audio:`, error)
      }
    } else if (type === 'audio' || type === 'both') {
      console.log(`Skipping audio unsubscribe for ${targetUserId} - condition failed`)
    }

    setUserSubscriptions((prev) => {
      const currentSub = prev[targetUserId] || {}

      const newVideoSubscribed =
        (type === 'video' || type === 'both') && videoUnsubscribed ? false : currentSub.videoSubscribed || false
      const newAudioSubscribed =
        (type === 'audio' || type === 'both') && audioUnsubscribed ? false : currentSub.audioSubscribed || false

      const willBeCompletelyUnsubscribed = !newVideoSubscribed && !newAudioSubscribed

      const newSubscription = {
        ...currentSub,
        videoSubscribed: newVideoSubscribed,
        audioSubscribed: newAudioSubscribed,

        videoRequestId:
          (type === 'video' || type === 'both') && videoUnsubscribed ? undefined : currentSub.videoRequestId,

        audioRequestId:
          (type === 'audio' || type === 'both') && audioUnsubscribed ? undefined : currentSub.audioRequestId,

        intentionallyUnsubscribed: willBeCompletelyUnsubscribed,
      }

      console.log(`Updated subscription state for ${targetUserId}:`, newSubscription)
      return {
        ...prev,
        [targetUserId]: newSubscription,
      }
    })

    if ((type === 'video' || type === 'both') && videoUnsubscribed) {
      const canvasRef = remoteCanvasRefs[targetUserId]
      if (canvasRef?.current) {
        canvasRef.current.dataset.status = ''
        // Don't cleanup the canvas worker, just reset status
        // The worker will be reused and reconfigured for HD if needed
        console.log(`Reset canvas status for ${targetUserId}`)
      }
    }
  }

  const resubscribeToUser = async (targetUserId: string, type: 'video' | 'audio' | 'both') => {
    if (!moqClient || !roomState || targetUserId === userId) return

    const canvasRef = remoteCanvasRefs[targetUserId]
    if (!canvasRef?.current) return

    const roomName = roomState.name
    const videoTrackAlias = parseInt(canvasRef.current.dataset.videotrackalias || '-1')
    const audioTrackAlias = parseInt(canvasRef.current.dataset.audiotrackalias || '-1')

    if (videoTrackAlias === -1 || audioTrackAlias === -1) {
      console.warn(`Track aliases not available for user ${targetUserId}`)
      return
    }

    try {
      const currentSubscription = userSubscriptions[targetUserId]

      const hasVideoSub = currentSubscription?.videoSubscribed && currentSubscription?.videoRequestId !== undefined
      const hasVideoHDSub =
        currentSubscription?.videoHDSubscribed && currentSubscription?.videoHDRequestId !== undefined
      const hasAudioSub = currentSubscription?.audioSubscribed && currentSubscription?.audioRequestId !== undefined

      const needsVideoSub = (type === 'video' || type === 'both') && !hasVideoSub && !hasVideoHDSub
      const needsAudioSub = (type === 'audio' || type === 'both') && !hasAudioSub

      if (!needsVideoSub && !needsAudioSub) {
        console.log(`Already subscribed to ${targetUserId} ${type}`)
        return
      }

      if (canvasRef.current.dataset.status) {
        console.log(`Resetting canvas status for ${targetUserId} to allow resubscription`)
        canvasRef.current.dataset.status = ''
      }

      if (needsVideoSub && needsAudioSub) {
        console.log(`Subscribing to both video and audio for ${targetUserId}`)
        await subscribeToTrack(
          roomName,
          targetUserId,
          videoTrackAlias,
          audioTrackAlias,
          parseInt(canvasRef.current.dataset.chattrackalias || '-1'),
          canvasRef,
        )
      } else if (needsVideoSub) {
        console.log(`Adding video subscription for ${targetUserId}`)
        const videoFullTrackName = getTrackname(roomName, targetUserId, 'video')
        initializeTelemetryForUser(targetUserId)
        const userTelemetry = telemetryInstances.current[targetUserId]

        try {
          const videoResult = await onlyUseVideoSubscriber(
            moqClient,
            canvasRef,
            videoTrackAlias,
            videoFullTrackName,
            userTelemetry.video,
          )()

          if (videoResult.videoRequestId) {
            setUserSubscriptions((prev) => ({
              ...prev,
              [targetUserId]: {
                ...prev[targetUserId],
                videoSubscribed: true,
                videoRequestId: videoResult.videoRequestId,
                intentionallyUnsubscribed: false,
              },
            }))

            canvasRef.current.dataset.status = 'playing'
            console.log(`Video subscription added for ${targetUserId}, requestId: ${videoResult.videoRequestId}`)
          } else {
            console.error(`Video subscription failed for ${targetUserId}`)
          }
        } catch (error) {
          console.error(`Failed to add video subscription for ${targetUserId}:`, error)
        }
      } else if (needsAudioSub) {
        console.log(`Adding audio subscription for ${targetUserId}`)

        const audioFullTrackName = getTrackname(roomName, targetUserId, 'audio')
        initializeTelemetryForUser(targetUserId)
        const userTelemetry = telemetryInstances.current[targetUserId]

        try {
          const audioResult = await onlyUseAudioSubscriber(
            moqClient,
            audioTrackAlias,
            audioFullTrackName,
            userTelemetry.audio,
          )()

          if (audioResult.audioRequestId) {
            setUserSubscriptions((prev) => ({
              ...prev,
              [targetUserId]: {
                ...prev[targetUserId],
                audioSubscribed: true,
                audioRequestId: audioResult.audioRequestId,
                intentionallyUnsubscribed: false,
              },
            }))

            console.log(`Audio subscription added for ${targetUserId}, requestId: ${audioResult.audioRequestId}`)
          } else {
            console.error(`Audio subscription failed for ${targetUserId}`)
          }
        } catch (error) {
          console.error(`Failed to add audio subscription for ${targetUserId}:`, error)
        }
      }
    } catch (error) {
      console.error(`Failed to resubscribe to ${targetUserId} ${type}:`, error)
    }
  }

  const toggleUserSubscription = async (targetUserId: string, type: 'video' | 'audio') => {
    const subscription = userSubscriptions[targetUserId]
    const isSubscribed = type === 'video' ? subscription?.videoSubscribed : subscription?.audioSubscribed

    if (isSubscribed) {
      await unsubscribeFromUser(targetUserId, type)
    } else {
      await resubscribeToUser(targetUserId, type)
    }
  }

  const toggleScreenshareSubscription = async (targetUserId: string) => {
    const subscription = userSubscriptions[targetUserId]
    const isSubscribed = subscription?.screenshareSubscribed

    if (isSubscribed) {
      await unsubscribeFromScreenshare(targetUserId)
    } else {
      const canvasRef = remoteScreenshareCanvasRefs[targetUserId]
      if (!canvasRef?.current) {
        console.warn(`Cannot resubscribe to screenshare for ${targetUserId} - no canvas ref`)
        return
      }

      const screenshareTrackAlias = parseInt(canvasRef.current.dataset.screensharetrackalias || '-1')
      if (screenshareTrackAlias === -1) {
        console.warn(`Cannot resubscribe to screenshare for ${targetUserId} - no track alias`)
        return
      }

      if (!roomState) {
        console.warn(`Cannot resubscribe to screenshare for ${targetUserId} - no room state`)
        return
      }

      await subscribeToScreenshareTrack(roomState.name, targetUserId, screenshareTrackAlias, canvasRef)
    }
  }

  useEffect(() => {
    if (chatMessagesRef.current && !isUserScrolling) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight
    }
  }, [chatMessages, isUserScrolling])

  const handleChatScroll = () => {
    if (chatMessagesRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatMessagesRef.current
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 5 // 5px tolerance
      setIsUserScrolling(!isAtBottom)
    }
  }

  const userCount = getUserCount()

  const usersPerPage = 3
  const [pageIndex, setPageIndex] = useState(0)

  const userList = Object.entries(users)
    .sort((a, b) => (isSelf(b[0]) ? 1 : 0) - (isSelf(a[0]) ? 1 : 0))
    .map((item) => item[1])
    .slice(0, 6)

  const usersWithScreenshare = [...userList]
  Object.entries(users).forEach(([userId, user]) => {
    if (user.hasScreenshare && !usersWithScreenshare.find((u) => u.id === `${userId}-screenshare`)) {
      const virtualUserId = `${userId}-screenshare`
      usersWithScreenshare.push({
        ...user,
        id: virtualUserId,
        name: `${user.name} - Screen`,
        hasVideo: true,
        hasAudio: false,
        hasScreenshare: false,
        originalUserId: userId,
      } as any)

      if (!codecData[virtualUserId]) {
        setCodecData((prev) => ({
          ...prev,
          [virtualUserId]: getScreenshareCodecData(),
        }))
      }
    }
  })

  useEffect(() => {
    if (pageIndex > 0 && userCount <= 3) {
      setPageIndex(0)
    }
  }, [userCount, pageIndex])

  const [isSmallScreen, setIsSmallScreen] = useState(false)

  useEffect(() => {
    function handleResize() {
      setIsSmallScreen(window.innerWidth < 768)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const usersToRender = isSmallScreen
    ? pageIndex === 0
      ? usersWithScreenshare.slice(0, 3)
      : usersWithScreenshare.slice(3, 6)
    : usersWithScreenshare

  useEffect(() => {
    if (maximizedUserId && !usersToRender.find((u) => u.id === maximizedUserId)) {
      console.log(`Maximized user ${maximizedUserId} no longer exists, clearing maximized state`)
      setMaximizedUserId(null)
    }
  }, [maximizedUserId, usersToRender])

  useEffect(() => {
    const handleCanvasResize = () => {
      Object.keys(remoteScreenshareCanvasRefs).forEach((userId) => {
        const canvasRef = remoteScreenshareCanvasRefs[userId]
        if (canvasRef?.current) {
          const isMaximized = maximizedUserId === `${userId}-screenshare`

          if (isMaximized) {
            const screenWidth = window.innerWidth
            const screenHeight = window.innerHeight
            const dpr = window.devicePixelRatio || 1

            const maxWidth = Math.min(screenWidth * dpr, window.appSettings.canvasResolutionConfig.screenshare.maxWidth)
            const maxHeight = Math.min(
              screenHeight * dpr,
              window.appSettings.canvasResolutionConfig.screenshare.maxHeight,
            )

            resizeCanvasWorker(canvasRef.current, maxWidth, maxHeight)
          } else {
            resizeCanvasWorker(
              canvasRef.current,
              window.appSettings.canvasResolutionConfig.screenshare.defaultWidth,
              window.appSettings.canvasResolutionConfig.screenshare.defaultHeight,
            )
          }
        }
      })
    }

    handleCanvasResize()
  }, [maximizedUserId, remoteScreenshareCanvasRefs])

  // Handle canvas resizing for maximized regular videos
  useEffect(() => {
    Object.entries(remoteCanvasRefs).forEach(([userId, canvasRef]) => {
      if (canvasRef?.current) {
        const isMaximized = maximizedUserId === userId
        const currentQuality = userVideoQualities[userId] || 'SD'
        const isHD = currentQuality === 'HD'

        resizeCanvasForMaximization(canvasRef.current, isMaximized, isHD)
      }
    })
  }, [maximizedUserId, remoteCanvasRefs, userVideoQualities])

  return (
    <div className="h-screen bg-gray-900 flex flex-col overflow-hidden" style={{ height: '100dvh' }}>
      {/* Header */}
      <div className="bg-gray-800 px-6 py-3 flex justify-between items-center border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center space-x-4">
          <h1 className="text-white text-xl font-semibold">MOQtail Demo - Room: {roomState?.name}</h1>
          <div className="flex items-center space-x-2 text-gray-300">
            <Users className="w-4 h-4" />
            <span className="text-sm">
              {getUserCount()} participant{userCount > 1 ? 's' : ''}
            </span>
          </div>
        </div>
        <div className={`flex items-center space-x-2 ${timeRemainingColor}`}>
          <span className="text-base font-semibold">⏱️ Remaining Time: {timeRemaining}</span>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex min-h-0">
        {/* Video Grid Area */}
        <div className={`flex-1 p-4 ${isChatOpen ? 'pr-2' : 'pr-4'} min-h-0`}>
          <div className="grid gap-3 h-full grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
            {usersToRender.map((user) => (
              <div
                key={user.id}
                className={`bg-gray-800 rounded-lg overflow-hidden group aspect-video transition-all duration-300 ${
                  maximizedUserId === user.id
                    ? 'absolute inset-0 w-full h-full z-20'
                    : maximizedUserId
                      ? 'hidden'
                      : 'relative'
                }`}
              >
                {(user as any).originalUserId ? (
                  <>
                    {/* This is a screenshare virtual user */}
                    {isSelf((user as any).originalUserId) ? (
                      <video ref={selfScreenshareRef} autoPlay muted className="w-full h-full object-cover" />
                    ) : (
                      <canvas
                        ref={remoteScreenshareCanvasRefs[(user as any).originalUserId]}
                        id={(user as any).originalUserId}
                        data-screensharetrackalias={
                          users[(user as any).originalUserId]?.publishedTracks?.screenshare?.alias
                        }
                        data-announced={users[(user as any).originalUserId]?.publishedTracks?.screenshare?.announced}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'contain',
                          imageRendering: 'pixelated',
                        }}
                      />
                    )}
                    <div className="absolute bottom-1 left-1 bg-green-600 text-white text-xs px-1 rounded">
                      Screen Share
                    </div>
                  </>
                ) : isSelf(user.id) ? (
                  <>
                    {/* Self participant regular video */}
                    <video
                      ref={selfVideoRef}
                      autoPlay
                      muted
                      style={{
                        transform: 'scaleX(-1)',
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      }}
                    />
                    {/* Show initials when video is off */}
                    {!user.hasVideo && (
                      <div className="absolute inset-0 flex items-center justify-center bg-gray-700">
                        <div
                          className={`w-20 h-20 rounded-full flex items-center justify-center ${getUserColor(user.id)}`}
                        >
                          <div className="text-white text-2xl font-bold">{getUserInitials(user.name)}</div>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* Remote participant regular video */}
                    <canvas
                      ref={remoteCanvasRefs[user.id]}
                      id={user.id}
                      data-videotrackalias={user?.publishedTracks?.video?.alias}
                      data-videohdalias={user?.publishedTracks?.['video-hd']?.alias}
                      data-audiotrackalias={user?.publishedTracks?.audio?.alias}
                      data-chattrackalias={user?.publishedTracks?.chat?.alias}
                      data-screensharetrackalias={user?.publishedTracks?.screenshare?.alias}
                      data-announced={user?.publishedTracks?.video?.announced}
                      data-videoquality={userVideoQualities[user.id] || 'SD'}
                      className="w-full h-full object-cover"
                    />

                    {/* Video Quality Toggle Button for Remote User */}
                    <div className="absolute top-3 left-3">
                      <button
                        onClick={() => handleToggleRemoteUserQuality(user.id)}
                        className={`px-2 py-1 rounded-md transition-all duration-200 text-xs font-semibold min-w-[2.5rem] shadow-lg ${
                          pendingHDRequests.has(user.id)
                            ? 'bg-gray-500 text-gray-300 cursor-not-allowed'
                            : (userVideoQualities[user.id] || 'SD') === 'HD'
                              ? 'bg-lime-600 hover:bg-lime-700 text-white'
                              : 'bg-orange-600 hover:bg-orange-700 text-white'
                        }`}
                        disabled={isRewindCleaningUp.current || pendingHDRequests.has(user.id)}
                        title={
                          pendingHDRequests.has(user.id)
                            ? 'Waiting for HD permission response...'
                            : `Switch to ${(userVideoQualities[user.id] || 'SD') === 'SD' ? 'HD (1280x720)' : 'SD (640x360)'} quality`
                        }
                      >
                        {pendingHDRequests.has(user.id) ? '...' : userVideoQualities[user.id] || 'SD'}
                      </button>
                    </div>
                    {/* Show initials when remote video is off */}
                    {!user.hasVideo && (
                      <div className="absolute inset-0 flex items-center justify-center bg-gray-700">
                        <div
                          className={`w-20 h-20 rounded-full flex items-center justify-center ${getUserColor(user.id)}`}
                        >
                          <div className="text-white text-2xl font-bold">{getUserInitials(user.name)}</div>
                        </div>
                      </div>
                    )}
                  </>
                )}
                {/* Participant Info Overlay - Hide for screenshare virtual users */}
                {!(user as any).originalUserId && (
                  <div className="absolute bottom-3 left-3 right-3 flex justify-between items-center">
                    <div className="bg-black bg-opacity-60 px-2 py-1 rounded text-white text-sm font-medium">
                      <div>
                        {user.name} {isSelf(user.id) && '(You)'}
                      </div>
                      {telemetryData[user.id] &&
                        !isSelf(user.id) && ( // TODO: Calculate throughputs for self user
                          <div className="hidden md:block text-xs text-gray-300 mt-1">
                            {telemetryData[user.id].latency}ms | {telemetryData[user.id].videoBitrate.toFixed(0)}Kbit/s
                            | {telemetryData[user.id].audioBitrate.toFixed(0)}Kbit/s
                          </div>
                        )}
                    </div>
                    <div className="flex space-x-1">
                      {/* Rewind button for remote users */}
                      {!isSelf(user.id) && (
                        <button
                          onClick={() => handleOpenRewindPlayer(user.id)}
                          disabled={isFetching}
                          className={`p-1 rounded transition-colors ${
                            isFetching ? 'bg-gray-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                          }`}
                          title={isFetching ? 'Fetching rewind data...' : 'Rewind video'}
                        >
                          <RotateCcw className="w-3 h-3 text-white" />
                        </button>
                      )}
                      <div className={user.hasAudio ? 'bg-gray-700 p-1 rounded' : 'bg-red-600 p-1 rounded'}>
                        {user.hasAudio ? (
                          <Mic className="w-3 h-3 text-white" />
                        ) : (
                          <MicOff className="w-3 h-3 text-white" />
                        )}
                      </div>
                      <div className={user.hasVideo ? 'bg-gray-700 p-1 rounded' : 'bg-red-600 p-1 rounded'}>
                        {user.hasVideo ? (
                          <Video className="w-3 h-3 text-white" />
                        ) : (
                          <VideoOff className="w-3 h-3 text-white" />
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {/* Screen sharing indicator (local only for now) */}
                {user.hasScreenshare && (
                  <div className="absolute top-3 left-3 bg-green-600 px-2 py-1 rounded text-white text-xs font-medium">
                    Sharing Screen
                  </div>
                )}
                {/* Info card toggle buttons */}
                <div className="absolute top-3 right-3 flex space-x-1">
                  {/* Subscription Controls - Only for remote users and not screenshare virtual users */}
                  {!isSelf(user.id) && !(user as any).originalUserId && (
                    <>
                      {/* Video Subscription Toggle - Disabled in HD mode */}
                      <button
                        onClick={() => toggleUserSubscription(user.id, 'video')}
                        disabled={(userVideoQualities[user.id] || 'SD') === 'HD'}
                        className={`p-1 rounded-full transition-all duration-200 ${
                          (userVideoQualities[user.id] || 'SD') === 'HD'
                            ? 'bg-gray-500 text-gray-300 cursor-not-allowed'
                            : userSubscriptions[user.id]?.videoSubscribed
                              ? 'bg-green-600 hover:bg-green-700 text-white'
                              : 'bg-gray-700 hover:bg-red-600 text-white'
                        }`}
                        title={
                          (userVideoQualities[user.id] || 'SD') === 'HD'
                            ? 'Video subscription controlled by HD toggle in HD mode'
                            : `${userSubscriptions[user.id]?.videoSubscribed ? 'Unsubscribe from' : 'Subscribe to'} ${user.name}'s video`
                        }
                      >
                        {userSubscriptions[user.id]?.videoSubscribed ? (
                          <Eye className="w-4 h-4" />
                        ) : (
                          <EyeOff className="w-4 h-4" />
                        )}
                      </button>
                      {/* Audio Subscription Toggle */}
                      <button
                        onClick={() => toggleUserSubscription(user.id, 'audio')}
                        className={`p-1 rounded-full transition-all duration-200 ${
                          userSubscriptions[user.id]?.audioSubscribed
                            ? 'bg-green-600 hover:bg-green-700 text-white'
                            : 'bg-gray-700 hover:bg-red-600 text-white'
                        }`}
                        title={`${userSubscriptions[user.id]?.audioSubscribed ? 'Unsubscribe from' : 'Subscribe to'} ${user.name}'s audio`}
                      >
                        {userSubscriptions[user.id]?.audioSubscribed ? (
                          <Volume2 className="w-4 h-4" />
                        ) : (
                          <VolumeX className="w-4 h-4" />
                        )}
                      </button>
                      {/* Screenshare Subscription Toggle - Only show if user has screenshare */}
                      {user.hasScreenshare && (
                        <button
                          onClick={() => toggleScreenshareSubscription(user.id)}
                          className={`p-1 rounded-full transition-all duration-200 ${
                            userSubscriptions[user.id]?.screenshareSubscribed
                              ? 'bg-green-600 hover:bg-green-700 text-white'
                              : 'bg-gray-700 hover:bg-red-600 text-white'
                          }`}
                          title={`${userSubscriptions[user.id]?.screenshareSubscribed ? 'Unsubscribe from' : 'Subscribe to'} ${user.name}'s screenshare`}
                        >
                          <MonitorUp className="w-4 h-4" />
                        </button>
                      )}
                    </>
                  )}
                  {/* Network Stats Button - Only for regular users, not screenshare virtual users */}
                  {!isSelf(user.id) &&
                    !(user as any).originalUserId && ( // TODO: Calculate throughputs for self user
                      <button
                        onClick={() => toggleInfoCard(user.id, 'network')}
                        className={`p-1 rounded-full transition-all duration-200 ${
                          showInfoCards[user.id] && infoPanelType[user.id] === 'network'
                            ? 'bg-blue-600 hover:bg-blue-700 text-white'
                            : 'bg-gray-700 hover:bg-blue-600 text-white'
                        }`}
                        title="Network Statistics"
                      >
                        <Activity className="w-4 h-4" />
                      </button>
                    )}
                  {/* Media Info Button */}
                  <button
                    onClick={() => toggleInfoCard(user.id, 'codec')}
                    className={`p-1 rounded-full transition-all duration-200 ${
                      showInfoCards[user.id] && infoPanelType[user.id] === 'codec'
                        ? 'bg-purple-600 hover:bg-purple-700 text-white'
                        : 'bg-gray-700 hover:bg-purple-600 text-white'
                    }`}
                    title="Media Information"
                  >
                    <Info className="w-4 h-4" />
                  </button>
                  {/* Maximize / Minimize Button — shown for all users */}
                  <button
                    onClick={() => setMaximizedUserId(maximizedUserId === user.id ? null : user.id)}
                    className="p-1 rounded-full bg-gray-700 hover:bg-gray-600 text-white"
                    title={maximizedUserId === user.id ? 'Minimize View' : 'Maximize View'}
                  >
                    {maximizedUserId === user.id ? <Minimize className="w-4 h-4" /> : <Expand className="w-4 h-4" />}
                  </button>
                </div>

                {/* Info card overlay */}
                {showInfoCards[user.id] && (
                  <div className="absolute inset-0 bg-white flex flex-col p-3 rounded-lg overflow-hidden">
                    {/* Close button */}
                    <div className="absolute top-3 right-3 z-10">
                      <button
                        onClick={() => toggleInfoCard(user.id, infoPanelType[user.id] || 'network')}
                        className="p-1 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-600 transition-all duration-200"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="w-full h-full flex flex-col min-h-0">
                      {/* Conditional rendering based on panel type */}
                      {!infoPanelType[user.id] || infoPanelType[user.id] === 'network' ? (
                        <>
                          {/* Network Stats Panel */}
                          {/* Header */}
                          <div className="mb-2 flex-shrink-0">
                            <h3 className="text-lg font-bold text-black leading-tight">Network Stats</h3>
                          </div>

                          {/* Legend */}
                          <div className="grid grid-cols-3 gap-1 mb-2 flex-shrink-0">
                            <div className="flex items-center space-x-1">
                              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                              <span className="text-xs font-medium text-gray-700">VIDEO</span>
                            </div>
                            <div className="flex items-center space-x-1">
                              <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
                              <span className="text-xs font-medium text-gray-700">AUDIO</span>
                            </div>
                            <div className="flex items-center space-x-1">
                              <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                              <span className="text-xs font-medium text-gray-700">LATENCY</span>
                            </div>
                          </div>

                          {/* Values with smooth transitions */}
                          <div className="grid grid-cols-3 gap-1 mb-3 flex-shrink-0">
                            <span className="text-xs font-bold text-black transition-all duration-200 ease-in-out">
                              {telemetryData[user.id]
                                ? `${telemetryData[user.id].videoBitrate.toFixed(0)} Kbit/s`
                                : 'N/A'}
                            </span>
                            <span className="text-xs font-bold text-black transition-all duration-200 ease-in-out">
                              {telemetryData[user.id]
                                ? `${telemetryData[user.id].audioBitrate.toFixed(0)} Kbit/s`
                                : 'N/A'}
                            </span>
                            <span className="text-xs font-bold text-black transition-all duration-200 ease-in-out">
                              {!isSelf(user.id) && telemetryData[user.id]
                                ? `${telemetryData[user.id].latency}ms`
                                : 'N/A'}
                            </span>
                          </div>

                          {/* Network Stats Graph */}
                          <div className="flex-1 relative min-h-0">
                            {/* Graph container */}
                            <div className="h-full bg-gray-50 rounded relative overflow-hidden border border-gray-200 min-h-16">
                              {/* Left Y-axis labels (Bitrate) */}
                              <div className="absolute left-1 top-1 text-xs text-gray-500 leading-none">500K</div>
                              <div className="absolute left-1 top-1/2 text-xs text-gray-500 leading-none">250K</div>
                              <div className="absolute left-1 bottom-1 text-xs text-gray-500 leading-none">0</div>

                              {/* Right Y-axis labels (Latency) */}
                              <div className="absolute right-1 top-1 text-xs text-red-500 leading-none">200ms</div>
                              <div className="absolute right-1 top-1/2 text-xs text-red-500 leading-none">100ms</div>
                              <div className="absolute right-1 bottom-1 text-xs text-red-500 leading-none">0ms</div>

                              {/* Grid lines */}
                              <div className="absolute inset-0 flex flex-col justify-between p-1">
                                {[...Array(3)].map((_, i) => (
                                  <div key={i} className="border-t border-gray-300 opacity-30"></div>
                                ))}
                              </div>

                              {/* Video bitrate line */}
                              <div className="absolute inset-0 p-2">
                                <svg className="w-full h-full" viewBox="0 0 300 100" preserveAspectRatio="none">
                                  <polyline
                                    fill="none"
                                    stroke="#3b82f6"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    points={
                                      videoBitrateHistory[user.id] && videoBitrateHistory[user.id].length > 0
                                        ? videoBitrateHistory[user.id]
                                            .map((videoBitrate, index) => {
                                              const x =
                                                (index / Math.max(videoBitrateHistory[user.id].length - 1, 1)) * 300
                                              const y = 100 - Math.min((videoBitrate / 500) * 100, 100)
                                              return `${x},${y}`
                                            })
                                            .join(' ')
                                        : ''
                                    }
                                  />
                                </svg>
                              </div>

                              {/* Audio bitrate line */}
                              <div className="absolute inset-0 p-2">
                                <svg className="w-full h-full" viewBox="0 0 300 100" preserveAspectRatio="none">
                                  <polyline
                                    fill="none"
                                    stroke="#6b7280"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    points={
                                      audioBitrateHistory[user.id] && audioBitrateHistory[user.id].length > 0
                                        ? audioBitrateHistory[user.id]
                                            .map((audioBitrate, index) => {
                                              const x =
                                                (index / Math.max(audioBitrateHistory[user.id].length - 1, 1)) * 300
                                              const y = 100 - Math.min((audioBitrate / 500) * 100, 100)
                                              return `${x},${y}`
                                            })
                                            .join(' ')
                                        : ''
                                    }
                                  />
                                </svg>
                              </div>

                              {/* Latency line */}
                              <div className="absolute inset-0 p-2">
                                <svg className="w-full h-full" viewBox="0 0 300 100" preserveAspectRatio="none">
                                  <polyline
                                    fill="none"
                                    stroke="#ef4444"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    points={
                                      !isSelf(user.id) && latencyHistory[user.id] && latencyHistory[user.id].length > 0
                                        ? latencyHistory[user.id]
                                            .map((latency: number, index: number) => {
                                              const x = (index / Math.max(latencyHistory[user.id].length - 1, 1)) * 300
                                              const y = 100 - Math.min((latency / 200) * 100, 100)
                                              return `${x},${y}`
                                            })
                                            .join(' ')
                                        : isSelf(user.id)
                                          ? '' // No line for self user
                                          : ''
                                    }
                                  />
                                </svg>
                              </div>
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          {/* Media Info Panel */}
                          {/* Header */}
                          <div className="mb-2 flex-shrink-0">
                            <h3 className="text-lg font-bold text-black leading-tight">Media Info</h3>
                          </div>

                          {/* Media Information Grid*/}
                          <div className="space-y-1 flex-1 text-xs overflow-y-auto">
                            {/* Video & Audio*/}
                            <div className="bg-gray-50 rounded p-1">
                              <div className="grid grid-cols-2 gap-2">
                                {/* Video */}
                                <div>
                                  <div className="font-semibold text-blue-600 mb-1 flex items-center text-xs">
                                    <Video className="w-3 h-3 mr-1" />
                                    Video
                                  </div>
                                  <div className="space-y-0.5">
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Codec:</span>
                                      <span className="font-medium text-black">
                                        {codecData[user.id]?.videoCodec || 'N/A'}
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Resolution:</span>
                                      <span className="font-medium text-black">
                                        {codecData[user.id]?.resolution || 'N/A'}
                                      </span>
                                    </div>

                                    {codecData[user.id]?.videoBitrate && (
                                      <div className="flex justify-between">
                                        <span className="text-gray-600">Bitrate:</span>
                                        <span className="font-medium text-black">
                                          {(codecData[user.id].videoBitrate! / 1000).toFixed(0)}kbps
                                        </span>
                                      </div>
                                    )}
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">FPS:</span>
                                      <span className="font-medium text-black">
                                        {codecData[user.id]?.frameRate || 'N/A'}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                {/* Audio */}
                                <div>
                                  <div className="font-semibold text-green-600 mb-1 flex items-center text-xs">
                                    <Mic className="w-3 h-3 mr-1" />
                                    Audio
                                  </div>
                                  <div className="space-y-0.5">
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Codec:</span>
                                      <span className="font-medium text-black">
                                        {codecData[user.id]?.audioCodec || 'N/A'}
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Sample Rate:</span>
                                      <span className="font-medium text-black">
                                        {codecData[user.id]?.sampleRate !== undefined
                                          ? codecData[user.id].sampleRate === 0
                                            ? '0'
                                            : (codecData[user.id].sampleRate / 1000).toFixed(0) + 'k'
                                          : 'N/A'}
                                      </span>
                                    </div>
                                    {codecData[user.id]?.audioBitrate && (
                                      <div className="flex justify-between">
                                        <span className="text-gray-600">Bitrate:</span>
                                        <span className="font-medium text-black">
                                          {(codecData[user.id].audioBitrate! / 1000).toFixed(0)}kbps
                                        </span>
                                      </div>
                                    )}
                                    {codecData[user.id]?.numberOfChannels && (
                                      <div className="flex justify-between">
                                        <span className="text-gray-600">Channels:</span>
                                        <span className="font-medium text-black">
                                          {codecData[user.id].numberOfChannels}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Sync Information */}
                            <div className="bg-gray-50 rounded p-1">
                              <div className="font-semibold text-purple-600 mb-1 flex items-center text-xs">
                                <Activity className="w-3 h-3 mr-1" />
                                Sync & Buffer
                              </div>
                              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                                <div className="flex justify-between">
                                  <span className="text-gray-600">A/V Drift: </span>
                                  <span className="font-semibold text-green-600">N/A</span>
                                  {/* <span className={`font-semibold ${Math.abs(codecData[user.id]?.syncDrift || 0) > 10 ? 'text-red-600' : 'text-green-600'}`}> */}
                                  {/* {codecData[user.id]?.syncDrift !== undefined */}
                                  {/* ? `${codecData[user.id].syncDrift > 0 ? '+' : ''}${codecData[user.id].syncDrift}ms` */}
                                  {/* : '0ms' */}
                                  {/* } */}
                                  {/* </span> */}
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Buffer duration:</span>
                                  <span className="font-semibold text-green-600">N/A</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        {/* Chat Panel */}
        {isChatOpen && (
          <div className="w-80 bg-white border-l border-gray-200 flex flex-col flex-shrink-0">
            {/* Chat Header */}
            <div className="p-4 border-b border-gray-200 flex justify-between items-center flex-shrink-0">
              <div className="flex items-center space-x-2">
                <MessageSquare className="w-5 h-5 text-gray-600" />
                <h3 className="font-semibold text-gray-900">MOQtail Chat</h3>
              </div>
              <button
                onClick={() => setIsChatOpen(false)}
                className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600 transition-colors"
              >
                ×
              </button>
            </div>
            {/* Chat Messages */}
            <div
              ref={chatMessagesRef}
              className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0"
              onScroll={handleChatScroll}
            >
              {chatMessages.map((message) => {
                const isOwnMessage = message.sender === username
                const senderUserId = getSenderUserId(message.sender)
                return (
                  <div key={message.id} className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-xs lg:max-w-md ${isOwnMessage ? 'order-2' : 'order-1'}`}>
                      <div
                        className={`flex items-center space-x-2 mb-1 ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
                      >
                        <span
                          className={`text-sm font-medium`}
                          style={{ color: isOwnMessage ? '#3b82f6' : getUserColorHex(senderUserId) }}
                        >
                          {isOwnMessage ? 'You' : message.sender}
                        </span>
                        <span className="text-xs text-gray-500">{message.timestamp}</span>
                      </div>
                      <div
                        className={`text-sm px-3 py-2 rounded-lg ${
                          isOwnMessage
                            ? 'bg-blue-500 text-white rounded-br-none'
                            : 'bg-gray-100 text-gray-800 rounded-bl-none'
                        }`}
                        style={{
                          wordBreak: 'break-word',
                          whiteSpace: 'pre-wrap',
                          fontSize: '14px',
                          lineHeight: '1.4',
                        }}
                      >
                        {renderMessageWithEmojis(message.message)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            {/* Chat Input */}
            <div className="p-4 border-t border-gray-200 flex-shrink-0 relative">
              {/* Quick Emoji Reactions */}
              <div className="mb-3">
                <div className="flex items-center space-x-1">
                  <span className="text-xs text-gray-500 mr-2">Quick:</span>
                  {quickEmojis.map((emoji, index) => (
                    <button
                      key={index}
                      onClick={() => addEmoji(emoji)}
                      className="text-lg hover:bg-gray-100 rounded p-1 transition-colors duration-150 hover:scale-110 transform"
                      title={`Add ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              {/* Emoji Picker */}
              {showEmojiPicker && (
                <div
                  ref={emojiPickerRef}
                  className="absolute bottom-full left-4 right-4 mb-2 bg-white border border-gray-200 rounded-lg shadow-lg z-10"
                >
                  <div className="p-2 border-b border-gray-100">
                    <p className="text-xs text-gray-500 font-medium">Choose an emoji</p>
                  </div>
                  <div className="p-3 max-h-40 overflow-y-auto">
                    <div className="grid grid-cols-8 gap-1">
                      {allEmojis.map((emoji, index) => (
                        <button
                          key={index}
                          onClick={() => addEmoji(emoji)}
                          className="text-xl hover:bg-gray-100 rounded p-2 transition-colors duration-150 hover:scale-110 transform"
                          title={`Add ${emoji}`}
                          style={{ fontSize: '18px' }}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex space-x-2">
                <div className="flex-1 relative">
                  <input
                    ref={chatInputRef}
                    type="text"
                    value={chatMessage}
                    onChange={(e) => setChatMessage(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        handleSendMessage()
                      }
                    }}
                    placeholder="Type a message..."
                    className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                  <button
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 hover:bg-gray-100 rounded transition-colors"
                    title="Add emoji"
                  >
                    <Smile className="w-4 h-4 text-gray-500" />
                  </button>
                </div>
                <button
                  onClick={handleSendMessage}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Bottom Controls */}
      <div className="bg-gray-800 px-6 py-4 flex justify-center items-center space-x-4 border-t border-gray-700 flex-shrink-0">
        {/* Mic Button */}
        <button
          onClick={handleToggleMic}
          className={`p-3 rounded-full transition-all duration-200 ${
            isMicOn ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-red-600 hover:bg-red-700 text-white'
          }`}
        >
          {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
        </button>
        {/* Video Button */}
        <button
          onClick={handleToggleCam}
          className={`p-3 rounded-full transition-all duration-200 ${
            isCamOn ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-red-600 hover:bg-red-700 text-white'
          }`}
          disabled={!mediaReady}
        >
          {isCamOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
        </button>
        {/* Screen Share Button */}
        <button
          onClick={handleToggleScreenShare}
          className={`p-3 rounded-full transition-all duration-200 ${
            isScreenSharing ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-gray-700 hover:bg-gray-600 text-white'
          }`}
        >
          <MonitorUp className="w-5 h-5" />
        </button>
        {/* Pagination Buttons */}
        {userCount > usersPerPage && isSmallScreen && (
          <>
            <button
              onClick={() => setPageIndex(0)}
              disabled={pageIndex === 0}
              className="px-3 py-1 bg-gray-700 rounded text-white disabled:opacity-50"
            >
              1
            </button>
            <button
              onClick={() => setPageIndex(1)}
              disabled={pageIndex === 1}
              className="px-3 py-1 bg-gray-700 rounded text-white disabled:opacity-50"
            >
              2
            </button>
          </>
        )}
        {/* End Call Button */}
        <button
          onClick={leaveRoom}
          className="p-3 rounded-full bg-red-600 hover:bg-red-700 text-white transition-all duration-200 ml-8"
        >
          <PhoneOff className="w-5 h-5 transform rotate-135" />
        </button>
        {/* Chat Toggle Button (when chat is closed) */}
        {!isChatOpen && (
          <button
            onClick={() => setIsChatOpen(true)}
            className="p-3 rounded-full bg-gray-700 hover:bg-gray-600 text-white transition-all duration-200"
          >
            <MessageSquare className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Rewind Player */}
      {isRewindPlayerOpen && selectedRewindUserId && (
        <RewindPlayer
          isOpen={isRewindPlayerOpen}
          onClose={handleCloseRewindPlayer}
          videoObjects={fetchedRewindData[selectedRewindUserId]?.video || []}
          audioObjects={fetchedRewindData[selectedRewindUserId]?.audio || []}
          userName={users[selectedRewindUserId]?.name || 'Unknown User'}
          userColor={getUserColorHex(selectedRewindUserId)}
        />
      )}

      {/* HD Permission Dialog */}
      {hdPermissionRequest && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md mx-4 border border-gray-600">
            <div className="flex items-center mb-4">
              <Eye className="w-6 h-6 text-blue-500 mr-3" />
              <h3 className="text-white text-lg font-semibold">HD Video Permission Request</h3>
            </div>
            <p className="text-gray-300 mb-6">
              <span className="font-medium text-white">{hdPermissionRequest.requesterName}</span> wants to view your
              video in HD quality.
            </p>
            <div className="flex space-x-3">
              <button
                onClick={handleHDPermissionAccept}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                Allow HD
              </button>
              <button
                onClick={handleHDPermissionReject}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                Keep SD
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SessionPage
