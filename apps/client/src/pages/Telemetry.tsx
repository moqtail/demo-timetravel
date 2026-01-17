import React, { useState, useEffect } from 'react'
import { telemetryDB, TelemetryEntry, UserInfo } from '@/util/telemetryDB'
import InfoTooltip from '@/components/InfoTooltip'
import TelemetryChart from '@/components/TelemetryChart'
import { TelemetryStreamType } from '@/util/telemetryDB'

const Telemetry: React.FC = () => {
  const [sessions, setSessions] = useState<string[]>([])
  const [users, setUsers] = useState<UserInfo[]>([])
  const [selectedSession, setSelectedSession] = useState<string>('')
  const [selectedUser, setSelectedUser] = useState<string>('')
  const [selectedStreamType, setSelectedStreamType] = useState<TelemetryStreamType | ''>('')
  const [data, setData] = useState<TelemetryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshInterval, setRefreshInterval] = useState<number | null>(null)
  const [timeWindow, setTimeWindow] = useState<number | null>(null) // in milliseconds, null for full session

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

  const exportToCSV = async () => {
    if (!selectedSession) return

    try {
      const allEntries = await telemetryDB.getEntries(selectedSession)

      if (allEntries.length === 0) {
        alert('No data to export for this session')
        return
      }

      // Create CSV header
      const headers = ['Session ID', 'User ID', 'User Name', 'Stream Type', 'Unit', 'Timestamp', 'Value']
      const csvContent = [
        headers.join(','),
        ...allEntries.map((entry) =>
          [
            entry.sessionId,
            entry.userId,
            entry.userName || '',
            entry.streamType,
            getStreamTypeUnit(entry.streamType as TelemetryStreamType),
            new Date(entry.timestamp).toISOString(),
            entry.value,
          ]
            .map((field) => `"${String(field).replace(/"/g, '""')}"`)
            .join(','),
        ),
      ].join('\n')

      // Create blob and download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      link.setAttribute('href', url)
      link.setAttribute('download', `telemetry-${selectedSession}-${new Date().toISOString().slice(0, 10)}.csv`)
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (error) {
      console.error('Failed to export data:', error)
      alert('Failed to export data')
    }
  }

  const getDataForStreamType = (streamType: TelemetryStreamType) => {
    return data.filter((entry) => entry.streamType === streamType)
  }

  const getFilteredDataByTimeWindow = (streamType: TelemetryStreamType) => {
    const streamData = getDataForStreamType(streamType)
    if (streamData.length === 0) return []

    // If timeWindow is null, return all data (Full Session)
    if (timeWindow === null) return streamData

    const now = Date.now()
    return streamData.filter((entry) => now - entry.timestamp <= timeWindow)
  }

  const getMaxValue = (streamType: TelemetryStreamType) => {
    const streamData = getFilteredDataByTimeWindow(streamType)
    if (streamData.length === 0) return 0
    return Math.max(...streamData.map((d) => d.value))
  }

  const getStreamTypeColor = (type: TelemetryStreamType) => {
    switch (type) {
      case TelemetryStreamType.VideoBitrate:
        return '#3b82f6'
      case TelemetryStreamType.AudioBitrate:
        return '#6b7280'
      case TelemetryStreamType.ScreenshareBitrate:
        return '#8b5cf6'
      case TelemetryStreamType.VideoLatency:
        return '#ef4444'
      case TelemetryStreamType.AudioLatency:
        return '#f97316'
      case TelemetryStreamType.ScreenshareLatency:
        return '#ec4892'
      case TelemetryStreamType.StartupLatency:
        return '#10b981'
      case TelemetryStreamType.HdToSdToggleLatency:
        return '#14b8a6'
      case TelemetryStreamType.SdToHdToggleLatency:
        return '#0ea5e9'
      case TelemetryStreamType.RewindLatency:
        return '#f59e0b'
      case TelemetryStreamType.AudioResubLatency:
        return '#6366f1'
      case TelemetryStreamType.VideoResubLatency:
        return '#f43f5e'
      default:
        return '#cccccc'
    }
  }

  const getStreamTypeLabel = (type: TelemetryStreamType) => {
    switch (type) {
      case TelemetryStreamType.VideoBitrate:
        return `Video Bitrate (${getStreamTypeUnit(type)})`
      case TelemetryStreamType.AudioBitrate:
        return `Audio Bitrate (${getStreamTypeUnit(type)})`
      case TelemetryStreamType.ScreenshareBitrate:
        return `Screenshare Bitrate (${getStreamTypeUnit(type)})`
      case TelemetryStreamType.VideoLatency:
        return `Video Latency (${getStreamTypeUnit(type)})`
      case TelemetryStreamType.AudioLatency:
        return `Audio Latency (${getStreamTypeUnit(type)})`
      case TelemetryStreamType.ScreenshareLatency:
        return `Screenshare Latency (${getStreamTypeUnit(type)})`
      case TelemetryStreamType.StartupLatency:
        return `Startup Latency (${getStreamTypeUnit(type)})`
      case TelemetryStreamType.HdToSdToggleLatency:
        return `HD to SD Toggle Latency (${getStreamTypeUnit(type)})`
      case TelemetryStreamType.SdToHdToggleLatency:
        return `SD to HD Toggle Latency (${getStreamTypeUnit(type)})`
      case TelemetryStreamType.RewindLatency:
        return `Rewind Latency (${getStreamTypeUnit(type)})`
      case TelemetryStreamType.AudioResubLatency:
        return `Audio Resubscription Latency (${getStreamTypeUnit(type)})`
      case TelemetryStreamType.VideoResubLatency:
        return `Video Resubscription Latency (${getStreamTypeUnit(type)})`
    }
  }

  const getStreamTypeUnit = (type: TelemetryStreamType): string => {
    switch (type) {
      case TelemetryStreamType.VideoBitrate:
      case TelemetryStreamType.AudioBitrate:
      case TelemetryStreamType.ScreenshareBitrate:
        return 'Kbit/s'
      case TelemetryStreamType.VideoLatency:
      case TelemetryStreamType.AudioLatency:
      case TelemetryStreamType.ScreenshareLatency:
      case TelemetryStreamType.StartupLatency:
      case TelemetryStreamType.HdToSdToggleLatency:
      case TelemetryStreamType.SdToHdToggleLatency:
      case TelemetryStreamType.RewindLatency:
      case TelemetryStreamType.AudioResubLatency:
      case TelemetryStreamType.VideoResubLatency:
        return 'ms'
      default:
        return ''
    }
  }

  const streamTypes: TelemetryStreamType[] = [
    TelemetryStreamType.VideoBitrate,
    TelemetryStreamType.AudioBitrate,
    TelemetryStreamType.ScreenshareBitrate,
    TelemetryStreamType.VideoLatency,
    TelemetryStreamType.AudioLatency,
    TelemetryStreamType.ScreenshareLatency,
    TelemetryStreamType.StartupLatency,
    TelemetryStreamType.HdToSdToggleLatency,
    TelemetryStreamType.SdToHdToggleLatency,
    TelemetryStreamType.RewindLatency,
    TelemetryStreamType.AudioResubLatency,
    TelemetryStreamType.VideoResubLatency,
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
                {streamTypes.map((type) => (
                  <option key={type} value={type}>
                    {getStreamTypeLabel(type)}
                  </option>
                ))}
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

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
            <div>
              <label className="block text-sm font-medium mb-2">Time Window</label>
              <select
                value={timeWindow === null ? '' : timeWindow}
                onChange={(e) => setTimeWindow(e.target.value === '' ? null : parseInt(e.target.value))}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
              >
                <option value="">Full Session</option>
                <option value="30000">Last 30 sec</option>
                <option value="60000">Last 1 min</option>
                <option value="300000">Last 5 min</option>
                <option value="900000">Last 15 min</option>
                <option value="3600000">Last 1 hour</option>
              </select>
            </div>

            {/* Export Button */}
            {selectedSession && (
              <div className="pt-7">
                <button
                  onClick={exportToCSV}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded font-medium transition-colors"
                >
                  📥 Export to CSV
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Charts */}
        {selectedSession && (
          <div className="space-y-6">
            {activeStreamTypes.map((streamType) => {
              const streamData = getDataForStreamType(streamType)
              const unit = getStreamTypeUnit(streamType)
              const maxValue = getMaxValue(streamType) || (unit === 'ms' ? 200 : 500)
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
                        <span className="text-gray-400 ml-2">{unit}</span>
                      </div>

                      {/* Chart */}
                      <div className="mt-4">
                        <TelemetryChart
                          data={streamData}
                          streamType={streamType}
                          color={color}
                          maxValue={maxValue}
                          timeWindow={timeWindow}
                          label={getStreamTypeLabel(streamType)}
                        />
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
