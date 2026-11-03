import { useEffect, useRef, useState } from 'react'

import { fetchGeocodeSuggestions } from '../../api/routingApi'
import type { LocationInputProps, LocationPoint } from '../../interfaces'

export function LocationInput({
  id,
  label,
  placeholder,
  dotColor,
  value,
  onChange,
}: LocationInputProps) {
  const [suggestions, setSuggestions] = useState<LocationPoint[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)

  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const skipNextFetchRef = useRef(false)

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  useEffect(() => {
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false
      return
    }

    const query = value.text.trim()
    if (query.length < 2 || value.point !== null) {
      setSuggestions([])
      setLoading(false)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const items = await fetchGeocodeSuggestions(query, controller.signal, 5)
        setSuggestions(items)
        setHighlightIndex(-1)
        setOpen(items.length > 0)
      } catch {
        if (!controller.signal.aborted) {
          setSuggestions([])
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }, 260)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [value.text, value.point])

  const selectSuggestion = (item: LocationPoint) => {
    skipNextFetchRef.current = true
    onChange({ text: item.label, point: item })
    setSuggestions([])
    setOpen(false)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) {
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightIndex((prev) => (prev + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1))
    } else if (event.key === 'Enter' && highlightIndex >= 0) {
      event.preventDefault()
      selectSuggestion(suggestions[highlightIndex])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={wrapperRef} className="loc-field">
      <label htmlFor={id} className="field-label">
        <span className="loc-dot" style={{ backgroundColor: dotColor }} />
        {label}
        {value.point && <span className="loc-resolved-tag">Pinned</span>}
      </label>

      <div className="loc-input-wrap">
        <input
          id={id}
          type="text"
          className="text-input"
          placeholder={placeholder}
          autoComplete="off"
          value={value.text}
          onFocus={() => {
            if (suggestions.length > 0) {
              setOpen(true)
            }
          }}
          onChange={(e) => onChange({ text: e.target.value, point: null })}
          onKeyDown={handleKeyDown}
        />
        {loading && <span className="loc-spinner" aria-hidden="true" />}
      </div>

      {open && suggestions.length > 0 && (
        <ul className="loc-dropdown" role="listbox">
          {suggestions.map((item, idx) => (
            <li
              key={`${item.lat}-${item.lng}-${idx}`}
              role="option"
              aria-selected={idx === highlightIndex}
              className={`loc-option ${idx === highlightIndex ? 'highlighted' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                selectSuggestion(item)
              }}
            >
              <span className="loc-option-main">{item.label}</span>
              <span className="loc-option-coords">
                {item.lat.toFixed(2)}, {item.lng.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

