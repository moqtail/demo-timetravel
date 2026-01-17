import React, { useState, useRef, useEffect } from 'react'

interface InfoTooltipProps {
  title: string
  children: React.ReactNode
}

const InfoTooltip: React.FC<InfoTooltipProps> = ({ title, children }) => {
  const [showTooltip, setShowTooltip] = useState(false)
  const [isClickedOpen, setIsClickedOpen] = useState(false)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsClickedOpen(!isClickedOpen)
  }

  const handleMouseEnter = () => {
    if (!isClickedOpen) {
      setShowTooltip(true)
    }
  }

  const handleMouseLeave = () => {
    if (!isClickedOpen) {
      setShowTooltip(false)
    }
  }

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        setIsClickedOpen(false)
      }
    }

    if (isClickedOpen) {
      document.addEventListener('click', handleOutsideClick)
      return () => document.removeEventListener('click', handleOutsideClick)
    }
  }, [isClickedOpen])

  return (
    <div className="relative inline-block ml-2" ref={tooltipRef}>
      <button
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        className="text-gray-400 hover:text-gray-300 transition-colors cursor-help"
        title="Click or hover for more information"
      >
        <span className="text-xl">*</span>
      </button>
      {(showTooltip || isClickedOpen) && (
        <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 w-64 bg-gray-700 text-gray-100 text-sm rounded-lg shadow-lg p-3 z-50">
          <p className="mb-2 font-semibold">{title}</p>
          {children}
        </div>
      )}
    </div>
  )
}

export default InfoTooltip
