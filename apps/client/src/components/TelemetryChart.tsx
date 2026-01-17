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

import React, { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import { TelemetryEntry, TelemetryStreamType } from '@/util/telemetryDB'

interface TelemetryChartProps {
  data: TelemetryEntry[]
  streamType: TelemetryStreamType
  color: string
  maxValue: number
  timeWindow: number | null
  label: string
}

const TelemetryChart: React.FC<TelemetryChartProps> = ({ data, streamType, color, maxValue, timeWindow, label }) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return

    const now = Date.now()
    const margin = { top: 20, right: 20, bottom: 30, left: 50 }
    const width = containerRef.current?.clientWidth ?? 800
    const height = 250

    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    // Determine time domain based on timeWindow
    const xDomain =
      timeWindow === null
        ? [data[0]?.timestamp || now - 60000, data[data.length - 1]?.timestamp || now]
        : [now - timeWindow, now]

    // Create scales
    const xScale = d3.scaleTime().domain(xDomain).range([0, innerWidth])

    const yScale = d3.scaleLinear().domain([0, maxValue]).range([innerHeight, 0])

    // Create line generator
    const line = d3
      .line<TelemetryEntry>()
      .x((d) => xScale(d.timestamp))
      .y((d) => yScale(d.value))

    // Clear previous content
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    // Create main group
    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    // Add background grid
    g.append('g')
      .attr('class', 'grid')
      .attr('opacity', 0.1)
      .call(
        d3
          .axisLeft(yScale)
          .tickSize(-innerWidth)
          .tickFormat(() => ''),
      )

    // Add path
    g.append('path')
      .attr('d', line(data))
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 2.5)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round')

    // Add X axis
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(xScale)
          .ticks(4)
          .tickFormat((d) => {
            const date = d as Date
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          }),
      )
      .attr('class', 'text-xs text-gray-500')

    // Add Y axis
    g.append('g').call(d3.axisLeft(yScale).ticks(5)).attr('class', 'text-xs text-gray-500')

    // Add Y axis label
    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', 0 - margin.left)
      .attr('x', 0 - innerHeight / 2)
      .attr('dy', '1em')
      .attr('class', 'text-xs text-gray-500')
      .style('text-anchor', 'middle')
      .text(label.split('(')[1]?.replace(')', '').trim() || '')

    // Style axes
    svg.selectAll('.tick line').attr('stroke', '#d1d5db').attr('stroke-width', 0.5)
    svg.selectAll('.tick text').attr('fill', '#6b7280')
    svg.selectAll('.domain').attr('stroke', '#d1d5db').attr('stroke-width', 1)
  }, [data, color, maxValue, timeWindow, label])

  return (
    <div ref={containerRef} className="w-full">
      <svg ref={svgRef} className="w-full" style={{ backgroundColor: '#f9fafb', borderRadius: '0.5rem' }}></svg>
    </div>
  )
}

export default TelemetryChart
