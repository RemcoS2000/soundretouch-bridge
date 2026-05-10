import { randomUUID } from 'node:crypto'

import type { LogEntry } from '../types.js'

const MAX_LOGS = 300

export class Logger {
    private readonly entries: LogEntry[] = []

    info(message: string, context?: Record<string, unknown>): void {
        this.push('info', message, context)
    }

    warn(message: string, context?: Record<string, unknown>): void {
        this.push('warn', message, context)
    }

    error(message: string, context?: Record<string, unknown>): void {
        this.push('error', message, context)
    }

    list(): LogEntry[] {
        return [...this.entries].reverse()
    }

    private push(level: LogEntry['level'], message: string, context?: Record<string, unknown>): void {
        const entry: LogEntry = {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            level,
            message,
            context,
        }

        this.entries.push(entry)
        if (this.entries.length > MAX_LOGS) {
            this.entries.splice(0, this.entries.length - MAX_LOGS)
        }

        const renderedContext = context ? ' ' + JSON.stringify(context) : ''
        const line = '[' + entry.timestamp + '] ' + level.toUpperCase() + ' ' + message + renderedContext
        if (level === 'error') {
            console.error(line)
        } else if (level === 'warn') {
            console.warn(line)
        } else {
            console.log(line)
        }
    }
}
