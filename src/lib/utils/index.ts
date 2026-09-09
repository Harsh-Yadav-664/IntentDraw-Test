import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Races a promise against a timeout. If `promise` doesn't settle within `ms`,
 * this rejects with a timeout error so callers can fail over / fail open fast
 * instead of hanging on a dead/slow upstream (a provider API or a paused DB).
 *
 * Note: this does NOT cancel the underlying work — pair it with an
 * AbortSignal at the fetch layer where possible for true cancellation.
 * Promise.race keeps a handler attached to `promise`, so a late rejection
 * after the timeout won't surface as an unhandled rejection.
 */
export function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  label = 'operation'
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    )
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay === 1) return 'yesterday'
  if (diffDay < 7) return `${diffDay}d ago`
  return formatDate(d)
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength - 3) + '...'
}

export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

export function extractJson(text: string): string {
  const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (jsonBlockMatch) return jsonBlockMatch[1].trim()

  const arrayMatch = text.match(/\[[\s\S]*\]/)
  if (arrayMatch) return arrayMatch[0]

  const objectMatch = text.match(/\{[\s\S]*\}/)
  if (objectMatch) return objectMatch[0]

  return text
}

export function extractHtml(text: string): string {
  const htmlBlockMatch = text.match(/```(?:html)?\s*([\s\S]*?)```/)
  if (htmlBlockMatch) return htmlBlockMatch[1].trim()

  const trimmed = text.trim()
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
    return trimmed
  }

  return text
}

/**
 * Extracts the React TSX payload from a model response.
 *
 * Handles the messy cases (audit: extractReact returned prose as code):
 *  1. Fenced code block (```tsx ... ```) → the block contents.
 *  2. Prose before the code ("Here is your site:\n\nimport React...") →
 *     slice from the first line that starts a TSX file.
 *  3. Trailing prose after the final closing brace of the default export
 *     → trimmed, but only when the tail clearly isn't code.
 */
export function extractReact(text: string): string {
  const tsxBlockMatch = text.match(/```(?:tsx|jsx|typescript|javascript|react)?\s*([\s\S]*?)```/)
  if (tsxBlockMatch) return tsxBlockMatch[1].trim()

  let t = text.trim()

  // Prose preamble: find the first line that plausibly starts the file.
  if (!/^(import\s|export\s|const\s|type\s|\/\/|\/\*|\s*$)/.test(t)) {
    const m = t.match(/^(?:import\s|\/\/|\/\*|export\s|const\s|type\s)/m)
    if (m && m.index !== undefined) {
      t = t.slice(m.index).trim()
    }
  }

  // Trailing prose: cut after the last `}` when the remainder contains no
  // code punctuation (a real code tail would have braces/semicolons/parens).
  const lastBrace = t.lastIndexOf('}')
  if (lastBrace >= 0) {
    const tail = t.slice(lastBrace + 1)
    if (tail.trim() && !/[{}();=]|=>/.test(tail)) {
      t = t.slice(0, lastBrace + 1)
    }
  }

  return t
}

/**
 * Parses the MIME type out of a data URL ("data:image/jpeg;base64,..." →
 * "image/jpeg"). Falls back to image/png for bare base64 payloads.
 */
export function imageMimeFromDataUrl(dataUrl: string): string {
  const m = dataUrl.match(/^data:(image\/[\w.+-]+);/)
  return m ? m[1] : 'image/png'
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'An unexpected error occurred'
}