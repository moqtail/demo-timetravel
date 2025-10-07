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

import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { JoinResponse, ErrorResponse } from '@/types/types'
import { useSession } from '@/contexts/SessionContext'
import { useSocket } from '@/sockets/SocketContext'
import { SocketClock } from '@/util/socketClock'
import { setClock } from '@/composables/useVideoPipeline'

// Check for required browser APIs
function checkBrowserCompatibility() {
  const missingApis: string[] = []
  const missingDetails: { api: string; link?: string; message?: string }[] = []
  const criticalMissing: string[] = []
  const mediaStreamTrackProcessorMissing = !('MediaStreamTrackProcessor' in window)

  try {
    // Check for WebTransport
    if (!('WebTransport' in window)) {
      missingApis.push('WebTransport')
      missingDetails.push({
        api: 'WebTransport',
      })
      criticalMissing.push('WebTransport')
    }

    // Check for WebCodecs
    if (!('VideoEncoder' in window) || !('VideoDecoder' in window)) {
      missingApis.push('WebCodecs')
      criticalMissing.push('WebCodecs')
      missingDetails.push({ api: 'WebCodecs' })
    }

    // Check for MediaStreamTrackProcessor (non-critical)
    if (mediaStreamTrackProcessorMissing) {
      missingApis.push('MediaStreamTrackProcessor')
      missingDetails.push({
        api: 'MediaStreamTrackProcessor',
        link: 'https://caniuse.com/?search=MediaStreamTrackProcessor',
        message: 'Video publishing will not be available',
      })
    }

    // Check for AudioWorklet - more robust check
    try {
      if (!('AudioContext' in window) && !('webkitAudioContext' in window)) {
        missingApis.push('AudioContext')
        criticalMissing.push('AudioContext')
        missingDetails.push({ api: 'AudioContext' })
      } else {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
        if (!AudioCtx || !AudioCtx.prototype || !('audioWorklet' in AudioCtx.prototype)) {
          missingApis.push('AudioWorklet')
          criticalMissing.push('AudioWorklet')
          missingDetails.push({ api: 'AudioWorklet' })
        }
      }
    } catch (e) {
      missingApis.push('AudioWorklet')
      criticalMissing.push('AudioWorklet')
      missingDetails.push({ api: 'AudioWorklet' })
    }

    // Check for ReadableStream
    if (!('ReadableStream' in window)) {
      missingApis.push('ReadableStream')
      criticalMissing.push('ReadableStream')
      missingDetails.push({ api: 'ReadableStream' })
    }
  } catch (error) {
    console.error('Error checking browser compatibility:', error)
    // If we can't check, assume incompatible
    missingApis.push('Browser compatibility check failed')
    criticalMissing.push('Browser compatibility check failed')
    missingDetails.push({ api: 'Browser compatibility check failed' })
  }

  return {
    missingApis,
    missingDetails,
    criticalMissing,
    mediaStreamTrackProcessorMissing,
  }
}

export default function JoinPage() {
  const [username, setUsername] = useState('')
  const [roomName, setRoomName] = useState('')
  const [error, setError] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [compatibilityError, setCompatibilityError] = useState<string | null>(null)
  const [compatibilityDetails, setCompatibilityDetails] = useState<{ api: string; link?: string; message?: string }[]>(
    [],
  )
  const [hasCriticalMissing, setHasCriticalMissing] = useState(false)
  const [hasMediaStreamTrackProcessorMissing, setHasMediaStreamTrackProcessorMissing] = useState(false)
  const [roomLimits, setRoomLimits] = useState({
    maxRooms: 5,
    maxUsersPerRoom: 6,
    sessionDurationMinutes: 10,
  })
  const navigate = useNavigate()
  const { setSession } = useSession()
  const { socket: contextSocket, reconnect } = useSocket()

  // Check browser compatibility on component mount
  useEffect(() => {
    try {
      const { missingApis, missingDetails, criticalMissing, mediaStreamTrackProcessorMissing } =
        checkBrowserCompatibility()

      if (criticalMissing.length > 0) {
        // Critical APIs missing - block joining and redirect to wiki
        setHasCriticalMissing(true)
        setHasMediaStreamTrackProcessorMissing(mediaStreamTrackProcessorMissing)
        setCompatibilityError(
          `Your browser is missing critical APIs required for MOQtail: ${criticalMissing.join(', ')}.`,
        )
        setCompatibilityDetails(missingDetails)
      } else if (mediaStreamTrackProcessorMissing) {
        // Only MediaStreamTrackProcessor missing - allow joining with warning
        setHasCriticalMissing(false)
        setHasMediaStreamTrackProcessorMissing(true)
        setCompatibilityError(
          'MediaStreamTrackProcessor is not available. You can join the session but video publishing will be limited.',
        )
        setCompatibilityDetails(missingDetails)
      } else if (missingApis.length > 0) {
        // Other non-critical APIs missing
        setHasMediaStreamTrackProcessorMissing(false)
        setCompatibilityError(`Some APIs are not fully supported: ${missingApis.join(', ')}.`)
        setCompatibilityDetails(missingDetails)
      } else {
        // No missing APIs
        setHasMediaStreamTrackProcessorMissing(false)
      }
    } catch (error) {
      console.error('Error during compatibility check:', error)
      setHasCriticalMissing(true)
      setCompatibilityError('Unable to verify browser compatibility. Please use a recent version of Google Chrome.')
      setCompatibilityDetails([])
    }
  }, [])

  useEffect(() => {
    // Fetch room limits from the server
    const fetchRoomLimits = async () => {
      try {
        const response = await fetch('/api/rooms/limits')
        if (response.ok) {
          const data = await response.json()
          if (data.success && data.limits) {
            setRoomLimits(data.limits)
          }
        }
      } catch (error) {
        console.error('Failed to fetch room limits:', error)
        // Keep default values on error
      }
    }

    fetchRoomLimits()
  }, [])

  useEffect(() => {
    if (!contextSocket) return

    const socket = contextSocket
    const clock = new SocketClock(socket)
    setClock(clock)

    socket.on('joined-room', (response: JoinResponse) => {
      setSession(
        response.userId,
        username,
        response.roomState,
        response.sessionDurationMinutes,
        response.rewindFetchGroupSize,
        hasMediaStreamTrackProcessorMissing,
      )
      console.log(
        'Navigating to /session',
        response.roomState,
        'Duration:',
        response.sessionDurationMinutes,
        'minutes',
        'Rewind fetch group size:',
        response.rewindFetchGroupSize,
      )
      navigate('/session')
    })

    socket.on('error', (errorResponse: ErrorResponse) => {
      setError(errorResponse.text || 'Failed to join room')
      setConnecting(false)
    })

    // Cleanup listeners only (do NOT disconnect the socket here!)
    return () => {
      socket.off('joined-room')
      socket.off('error')
    }
    // eslint-disable-next-line
  }, [contextSocket, username, setSession, navigate])
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    // Check for critical compatibility errors first
    if (hasCriticalMissing) {
      // Redirect to wiki for critical missing APIs
      window.open('https://github.com/moqtail/demo-timetravel/wiki', '_blank')
      setError('Redirecting to setup guide for browser compatibility information.')
      return
    }

    const trimmedUsername = username.trim()
    const trimmedRoomName = roomName.trim()

    if (trimmedUsername.length > 30 || trimmedUsername.length === 0) {
      setError('Username must be between 1-30 characters')
      return
    }

    if (trimmedRoomName.length > 20 || trimmedRoomName.length === 0) {
      setError('Room name must be between 1-20 characters')
      return
    }

    if (!contextSocket || !contextSocket.connected) {
      setError('Socket not connected. Please wait a moment and try again.')
      return
    }

    setConnecting(true)
    contextSocket.emit('join-room', { username: trimmedUsername, roomName: trimmedRoomName })
  }

  return (
    <div className="join-container">
      <div className="join-logo">
        <img src="/moqtail.svg" alt="MoqTail Logo" width="100%" height="100%" />
      </div>
      <div className="join-content">
        <nav className="join-nav"></nav>
        <h1>
          <b>MOQtail Demo</b>
        </h1>
        <h2>Join a Room</h2>
        {compatibilityError && (
          <div className="compatibility-error">
            <strong>⚠️ Browser Compatibility Issue</strong>
            <p>{compatibilityError}</p>
            {compatibilityDetails.length > 0 && (
              <div className="compatibility-details">
                <p>
                  <strong>Missing APIs:</strong>
                </p>
                <ul>
                  {compatibilityDetails.map((detail, index) => (
                    <li key={index}>
                      <strong>{detail.api}</strong>
                      {detail.message && <div className="compatibility-message">{detail.message}</div>}
                      {detail.link && (
                        <div>
                          <a
                            href={detail.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="compatibility-link"
                          >
                            → Browser Support Info
                          </a>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {hasCriticalMissing && (
              <div className="wiki-link-section">
                <a
                  href="https://github.com/moqtail/demo-timetravel/wiki"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="wiki-link-button"
                >
                  📖 View Setup Guide & Browser Requirements
                </a>
              </div>
            )}
          </div>
        )}
        <div className="browser-compatibility">
          Use a recent version of Google Chrome that supports the WebCodecs and WebTransport APIs.
        </div>
        <form onSubmit={handleSubmit} className="join-form">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Your Name"
            required
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            data-form-type="other"
            data-lpignore="true"
            role="textbox"
            inputMode="text"
            className="join-input"
            disabled={connecting || hasCriticalMissing}
            maxLength={30}
          />
          <input
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder="Room Name"
            required
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            data-form-type="other"
            data-lpignore="true"
            role="textbox"
            inputMode="text"
            className="join-input"
            disabled={connecting || hasCriticalMissing}
            maxLength={20}
          />
          <button className="join-button" disabled={connecting || hasCriticalMissing}>
            {hasCriticalMissing ? 'Browser Not Compatible - Check Wiki' : connecting ? 'Connecting...' : 'Join'}
          </button>
        </form>
        <div className="privacy-notice">
          * Session duration in each room is limited to {roomLimits.sessionDurationMinutes} minute
          {roomLimits.sessionDurationMinutes !== 1 ? 's' : ''} and session size is limited to{' '}
          {roomLimits.maxUsersPerRoom} participants.
        </div>
        {error && <div className="error-message">{error}</div>}
      </div>

      <style>{`
      .join-container {
        max-height: 100dvh;
        height: 100dvh;
        width: 100vw;
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        padding: 2.5rem 4rem;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        text-align: center;
        gap: 6rem;
      }
      .join-logo {
        flex-shrink: 1;
        min-height: 200px;
        // padding-top: 1rem;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .join-logo img {
        max-height: 100%;
        width: 100%;
        display: block;
        object-fit: contain;
        max-height: 500px;
      }
      .join-content {
        max-width: 360px;
        display: flex;
        flex-grow: 1;
        flex-direction: column;
        align-items: center;
        width: 100%;
      }
      .join-nav {
        display: flex;
        gap: 1.8rem;
        margin-bottom: 0rem;
        font-size: 1.08rem;
        font-weight: 500;
      }
      .join-link {
        color: #577B9F;
        text-decoration: none;
        transition: color .2s;
      }
      .join-link:hover {
        color: #34495e;
        text-decoration: underline;
      }
      h1 {
        font-size: 3rem;
        margin-bottom: 0.2rem;
        color: #2c3e50;
        font-family: 'MoqBold', 'Segoe UI', sans-serif;
      }
      h2 {
        font-family: 'MoqSemiBold', 'Segoe UI', sans-serif;
        font-weight: 400;
        margin-bottom: 2rem;
        color: #34495e;
        margin-top: 0;
      }
      .join-form {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 1.2rem;
      }
      .join-input {
        padding: 0.8rem 1rem;
        font-size: 1.1rem;
        border: 1.8px solid #ddd;
        border-radius: 6px;
        background-color: transparent;
        transition: border-color 0.3s, box-shadow 0.3s;
        outline-offset: 2px;
      }
      .join-input:focus {
        border-color: #D74401;
        box-shadow: 0 0 8px rgb(52, 74, 96);
      }
      .join-button {
        padding: 0.9rem 1rem;
        font-size: 1.15rem;
        font-weight: 600;
        background-color: #577B9F;
        border: none;
        border-radius: 6px;
        color: white;
        cursor: pointer;
        transition: background-color 0.25s;
      }
      .join-button:hover {
        background-color: #D74401;
      }
      .error-message {
        color: #e74c3c;
        margin-top: 1rem;
        font-weight: 600;
      }
      .compatibility-error {
        background-color: #fdf2f2;
        border: 2px solid #f8d7da;
        color: #721c24;
        padding: 1rem;
        border-radius: 6px;
        margin-bottom: 1rem;
        text-align: left;
      }
      .compatibility-error strong {
        display: block;
        margin-bottom: 0.5rem;
        font-size: 1rem;
      }
      .compatibility-error p {
        margin: 0;
        font-size: 0.9rem;
        line-height: 1.4;
      }
      .compatibility-details {
        margin-top: 0.75rem;
      }
      .compatibility-details p {
        margin-bottom: 0.5rem;
        font-weight: 600;
      }
      .compatibility-details ul {
        margin: 0;
        padding-left: 1.2rem;
        list-style-type: disc;
      }
      .compatibility-details li {
        margin-bottom: 0.3rem;
        font-size: 0.85rem;
        line-height: 1.3;
      }
      .compatibility-link {
        color: #577B9F;
        text-decoration: underline;
        font-weight: 500;
        transition: color 0.2s;
      }
      .compatibility-link:hover {
        color: #D74401;
      }
      .wiki-link-section {
        margin-top: 1rem;
        text-align: center;
      }
      .wiki-link-button {
        display: inline-block;
        background-color: #577B9F;
        color: white;
        padding: 0.8rem 1.2rem;
        border-radius: 6px;
        text-decoration: none;
        font-weight: 600;
        font-size: 0.9rem;
        transition: background-color 0.2s;
      }
      .wiki-link-button:hover {
        background-color: #D74401;
        color: white;
        text-decoration: none;
      }
      .join-input:disabled {
        background-color: #f5f5f5;
        color: #999;
        cursor: not-allowed;
        opacity: 0.6;
      }
      .join-button:disabled {
        background-color: #bdc3c7;
        cursor: not-allowed;
        opacity: 0.7;
      }
      .join-button:disabled:hover {
        background-color: #bdc3c7;
      }
      .privacy-notice {
        font-size: 0.75rem;
        color: #7f8c8d;
        margin-top: 0.8rem;
        margin-bottom: 0.5rem;
        opacity: 0.8;
      }
      .browser-compatibility {
        font-size: 0.726rem;
        color: #577B9F;
        margin-bottom: 1.5rem;
        padding: 0.8rem 1rem;
        background-color: #ecf0f1;
        border-radius: 6px;
        line-height: 1.4;
      }
      .github-link {
        color: #577B9F;
        text-decoration: underline;
        font-weight: 600;
        transition: color 0.2s;
      }
      .github-link:hover {
        color: #D74401;
      }
      @media (max-width: 600px) {
        .join-logo {
          max-height: 250px;
          min-height: 100px;
          width: 100%;
          margin-top: -10px;
        }
        .join-logo img {
          max-height: 100%;
          max-width: 100%;
          width: auto;
          height: auto;
          object-fit: contain;
       }
        .join-content {
          max-width: 100%;     
          max-height: 500px;       
          padding: 1px;
          overflow: hidden;         
       }
        .browser-compatibility {
          font-size: 0.726rem;
          color: #577B9F;
          margin-bottom: 0.5rem;
          padding: 0.8rem 0.2rem;
          background-color: #ecf0f1;
          border-radius: 3px;
          line-height: 1.4;
        }
        h1 {
          font-size: 2rem;
          margin-bottom: 0.0rem;
          color: #2c3e50;
          font-family: 'MoqBold', 'Segoe UI', sans-serif;
        }
        h2 {
          font-family: 'MoqSemiBold', 'Segoe UI', sans-serif;
          font-weight: 400;
          margin-bottom: 0.1rem;
          color: #34495e;
          margin-top: 0;
        }
        .join-form {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
        }
        .join-input {
          padding: 0.3rem 1rem;
          font-size: 1.0rem;
          border: 1.8px solid #ddd;
          border-radius: 6px;
          background-color: transparent;
          transition: border-color 0.3s, box-shadow 0.3s;
          outline-offset: 2px;
        }
        .join-container {
          flex-direction: column;
          gap: 0rem;
          padding: 1rem;
        }
        .join-content {
          max-width: 100%;     
          max-height: 60rem;       
          padding: 1px;
          overflow: hidden;  
        }
        .join-button {
          padding: 0.5rem 0.8rem;
          font-size: 0.9rem;
          font-weight: 600;
          background-color: #577B9F;
          border: none;
          border-radius: 6px;
          color: white;
          cursor: pointer;
          transition: background-color 0.25s;
        }
      }
      `}</style>
    </div>
  )
}
