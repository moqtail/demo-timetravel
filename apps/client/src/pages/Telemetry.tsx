import React, { useState, useEffect } from 'react'
import { telemetryDB, TelemetryEntry, UserInfo } from '@/util/telemetryDB'
import InfoTooltip from '@/components/InfoTooltip'
import { TelemetryStreamType } from '@/util/telemetryDB'

const Telemetry: React.FC = () => {
  const [sessions, setSessions] = useState<string[]>([])
  const [users, setUsers] = useState<UserInfo[]>([])
  const [selectedSession, setSelectedSession] = useState<string>('')
  const [selectedUser, setSelectedUser] = useState<string>('')
  const [selectedStreamType, setSelectedStreamType] = useState<TelemetryStreamType | ''>('')
  const [data, setData] = useState<TelemetryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshInterval, setRefreshInterval] = useState<number | null>(1000)

  useEffect(() => {
    loadSessions()
  }, [])

  useEffect(() => {
    if (selectedSession) {
      loadUsers(selectedSession)
    } else {
      setUsers([])
      setSelectedUser('')
    }
  }, [selectedSession])

  useEffect(() => {
    loadData()
  }, [selectedSession, selectedUser, selectedStreamType])

  useEffect(() => {
    if (!selectedSession || refreshInterval === null) return

    const interval = setInterval(() => {
      loadData()
    }, refreshInterval)

    return () => clearInterval(interval)
  }, [selectedSession, selectedUser, selectedStreamType, refreshInterval])

  const loadSessions = async () => {
    try {
      const sessionList = await telemetryDB.getSessions()
      setSessions(sessionList)
    } catch (error) {
      console.error('Failed to load sessions:', error)
    }
  }

  const loadUsers = async (sessionId: string) => {
    try {
      const userList = await telemetryDB.getUsers(sessionId)
      // parse the userName from session id
      let userIndex = 1
      let userName = sessionId.split('-')[userIndex]
      let filteredUserList = userList.filter((user) => {
        return user.userName !== userName
      })

      setUsers(filteredUserList)
    } catch (error) {
      console.error('Failed to load users:', error)
    }
  }

  const loadData = async () => {
    if (!selectedSession) return

    setLoading(true)
    try {
      const entries = await telemetryDB.getEntries(
        selectedSession,
        selectedUser || undefined,
        selectedStreamType || undefined,
      )
      // Sort by timestamp
      entries.sort((a, b) => a.timestamp - b.timestamp)
      setData(entries)
    } catch (error) {
      console.error('Failed to load data:', error)
      setData([])
    } finally {
      setLoading(false)
    }
  }

  const formatUserName = (userName: string): string => {
    // Truncate to max 20 characters
    return userName.length > 20 ? userName.substring(0, 17) + '...' : userName
  }

  const getDataForStreamType = (streamType: TelemetryStreamType) => {
    return data.filter((entry) => entry.streamType === streamType)
  }

  const getMaxValue = (streamType: TelemetryStreamType) => {
    const streamData = getDataForStreamType(streamType)
    if (streamData.length === 0) return 0
    return Math.max(...streamData.map((d) => d.value))
  }

  const renderChart = (streamType: TelemetryStreamType, color: string, maxValue: number) => {
    const streamData = getDataForStreamType(streamType)
    if (streamData.length === 0) return null

    const points = streamData
      .map((entry, index) => {
        const x = (index / Math.max(streamData.length - 1, 1)) * 300
        const y = 100 - Math.min((entry.value / maxValue) * 100, 100)
        return `${x},${y}`
      })
      .join(' ')

    return (
      <div className="absolute inset-0 p-2">
        <svg className="w-full h-full" viewBox="0 0 300 100" preserveAspectRatio="none">
          <polyline
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={points}
          />
        </svg>
      </div>
    )
  }

  const getStreamTypeColor = (type: TelemetryStreamType) => {
    switch (type) {
      case 'videoBitrate':
        return '#3b82f6'
      case 'audioBitrate':
        return '#6b7280'
      case 'screenshareBitrate':
        return '#8b5cf6'
      case 'videoLatency':
        return '#ef4444'
      case 'audioLatency':
        return '#f97316'
      case 'screenshareLatency':
        return '#ec4892'
    }
  }

  const getStreamTypeLabel = (type: TelemetryStreamType) => {
    switch (type) {
      case 'videoBitrate':
        return 'Video Bitrate (Kbit/s)'
      case 'audioBitrate':
        return 'Audio Bitrate (Kbit/s)'
      case 'screenshareBitrate':
        return 'Screenshare Bitrate (Kbit/s)'
      case 'videoLatency':
        return 'Video Latency (ms)'
      case 'audioLatency':
        return 'Audio Latency (ms)'
      case 'screenshareLatency':
        return 'Screenshare Latency (ms)'
    }
  }

  const streamTypes: TelemetryStreamType[] = [
    'videoBitrate',
    'audioBitrate',
    'screenshareBitrate',
    'videoLatency',
    'audioLatency',
    'screenshareLatency',
  ]
  const activeStreamTypes = selectedStreamType ? [selectedStreamType] : streamTypes

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center mb-6">
          <h1 className="text-3xl font-bold">Telemetry Data</h1>
          <InfoTooltip title="Data Storage & Session ID">
            <p className="mb-2">
              <strong>Storage:</strong> Data is stored locally in your browser using{' '}
              <a
                href="https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 underline"
              >
                IndexedDB
              </a>
              , not sent to any server.
            </p>
            <p>
              <strong>Session ID Format:</strong> YYYYmmDD-HHmmss-&lt;4 random chars&gt; (e.g., 20260117-143025-A7K2)
            </p>
          </InfoTooltip>
        </div>

        {/* Filters */}
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Session ID</label>
              <select
                value={selectedSession}
                onChange={(e) => setSelectedSession(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
              >
                <option value="">Select Session</option>
                {sessions.map((session) => (
                  <option key={session} value={session}>
                    {session}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">User ID</label>
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
                disabled={!selectedSession}
              >
                <option value="">All Users</option>
                {users.map((user) => (
                  <option key={user.userId} value={user.userId}>
                    {formatUserName(user.userName)} ({user.userId})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Stream Type</label>
              <select
                value={selectedStreamType}
                onChange={(e) => setSelectedStreamType(e.target.value as any)}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
              >
                <option value="">All Types</option>
                <option value="videoBitrate">Video Bitrate</option>
                <option value="audioBitrate">Audio Bitrate</option>
                <option value="screenshareBitrate">Screenshare Bitrate</option>
                <option value="videoLatency">Video Latency</option>
                <option value="audioLatency">Audio Latency</option>
                <option value="screenshareLatency">Screenshare Latency</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Refresh Interval</label>
              <select
                value={refreshInterval === null ? '' : refreshInterval}
                onChange={(e) => setRefreshInterval(e.target.value === '' ? null : parseInt(e.target.value))}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
              >
                <option value="1000">1 sec</option>
                <option value="5000">5 sec</option>
                <option value="15000">15 sec</option>
                <option value="">None</option>
              </select>
            </div>
          </div>
        </div>

        {/* Charts */}
        {selectedSession && (
          <div className="space-y-6">
            {activeStreamTypes.map((streamType) => {
              const streamData = getDataForStreamType(streamType)
              const maxValue = getMaxValue(streamType) || (streamType.includes('latency') ? 200 : 500)
              const color = getStreamTypeColor(streamType)

              return (
                <div key={streamType} className="bg-gray-800 rounded-lg p-4">
                  <h2 className="text-xl font-semibold mb-4">{getStreamTypeLabel(streamType)}</h2>

                  {loading ? (
                    <div className="flex justify-center items-center h-32">
                      <div className="text-gray-400">Loading...</div>
                    </div>
                  ) : streamData.length === 0 ? (
                    <div className="flex justify-center items-center h-32">
                      <div className="text-gray-400">No data available</div>
                    </div>
                  ) : (
                    <>
                      {/* Current Value */}
                      <div className="mb-4">
                        <span className="text-2xl font-bold" style={{ color }}>
                          {streamData[streamData.length - 1]?.value.toFixed(1) || 'N/A'}
                        </span>
                        <span className="text-gray-400 ml-2">{streamType.includes('latency') ? 'ms' : 'Kbit/s'}</span>
                      </div>

                      {/* Chart */}
                      <div className="relative h-32 bg-gray-50 rounded border border-gray-200">
                        {/* Y-axis labels */}
                        <div className="absolute left-1 top-1 text-xs text-gray-500 leading-none">
                          {maxValue.toFixed(0)}
                        </div>
                        <div className="absolute left-1 top-1/2 text-xs text-gray-500 leading-none">
                          {(maxValue / 2).toFixed(0)}
                        </div>
                        <div className="absolute left-1 bottom-1 text-xs text-gray-500 leading-none">0</div>

                        {/* Grid lines */}
                        <div className="absolute inset-0 flex flex-col justify-between p-1">
                          {[...Array(3)].map((_, i) => (
                            <div key={i} className="border-t border-gray-300 opacity-30"></div>
                          ))}
                        </div>

                        {renderChart(streamType, color, maxValue)}
                      </div>

                      {/* Stats */}
                      <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <div className="text-gray-400">Min</div>
                          <div className="font-semibold">{Math.min(...streamData.map((d) => d.value)).toFixed(1)}</div>
                        </div>
                        <div>
                          <div className="text-gray-400">Avg</div>
                          <div className="font-semibold">
                            {(streamData.reduce((sum, d) => sum + d.value, 0) / streamData.length).toFixed(1)}
                          </div>
                        </div>
                        <div>
                          <div className="text-gray-400">Max</div>
                          <div className="font-semibold">{Math.max(...streamData.map((d) => d.value)).toFixed(1)}</div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {!selectedSession && (
          <div className="text-center py-12">
            <div className="text-gray-400 text-lg">Select a session to view telemetry data</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default Telemetry
