import React, { useState } from 'react'
import { cn } from '../../lib/utils'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
    const hintId = `${inputId}-hint`
    const errorId = `${inputId}-error`
    const describedBy = [hint && !error ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-gray-700">
            {label}
            {props.required && <span className="text-red-500 ml-1">*</span>}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-required={props.required}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={cn(
            'block w-full rounded-lg border px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
            error
              ? 'border-red-300 bg-red-50 focus:ring-red-500 focus:border-red-500'
              : 'border-gray-300 bg-white',
            className
          )}
          {...props}
        />
        {hint && !error && <p id={hintId} className="text-xs text-gray-500">{hint}</p>}
        {error && <p id={errorId} className="text-xs text-red-600">{error}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  hint?: string
  options: { value: string; label: string }[]
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, hint, options, className, id, ...props }, ref) => {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
    const hintId = `${selectId}-hint`
    const errorId = `${selectId}-error`
    const describedBy = [hint && !error ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={selectId} className="text-sm font-medium text-gray-700">
            {label}
            {props.required && <span className="text-red-500 ml-1">*</span>}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          aria-required={props.required}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={cn(
            'block w-full rounded-lg border px-3 py-2 text-sm text-gray-900 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white',
            error ? 'border-red-300' : 'border-gray-300',
            className
          )}
          {...props}
        >
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {hint && !error && <p id={hintId} className="text-xs text-gray-500">{hint}</p>}
        {error && <p id={errorId} className="text-xs text-red-600">{error}</p>}
      </div>
    )
  }
)

Select.displayName = 'Select'

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  hint?: string
  showCount?: boolean
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, hint, showCount, className, id, onChange, ...props }, ref) => {
    const [charCount, setCharCount] = useState(
      typeof props.value === 'string' ? props.value.length :
      typeof props.defaultValue === 'string' ? props.defaultValue.length : 0
    )

    const textareaId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
    const hintId = `${textareaId}-hint`
    const errorId = `${textareaId}-error`
    const describedBy = [hint && !error ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setCharCount(e.target.value.length)
      onChange?.(e)
    }

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={textareaId} className="text-sm font-medium text-gray-700">
            {label}
            {props.required && <span className="text-red-500 ml-1">*</span>}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          aria-required={props.required}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={cn(
            'block w-full rounded-lg border px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none',
            error
              ? 'border-red-300 bg-red-50 focus:ring-red-500 focus:border-red-500'
              : 'border-gray-300 bg-white',
            className
          )}
          onChange={handleChange}
          {...props}
        />
        {(showCount || props.maxLength) && (
          <p className="text-xs text-gray-400 text-right">
            {charCount}{props.maxLength ? ` / ${props.maxLength}` : ''}
          </p>
        )}
        {hint && !error && <p id={hintId} className="text-xs text-gray-500">{hint}</p>}
        {error && <p id={errorId} className="text-xs text-red-600">{error}</p>}
      </div>
    )
  }
)

Textarea.displayName = 'Textarea'
