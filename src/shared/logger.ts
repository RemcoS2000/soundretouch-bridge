import { randomUUID } from 'node:crypto'

import type { LogEntry } from '../types'

const MAX_LOGS = 300

export class Logger {
    private readonly state: { entries: LogEntry[] }
    private readonly service?: string

    /**
     * Creates a logger, optionally bound to a service name and shared log state.
     *
     * @param service - Optional service label to stamp onto log entries.
     * @param state - Shared log buffer used by child loggers.
     */
    constructor(service?: string, state?: { entries: LogEntry[] }) {
        this.service = service
        this.state = state ?? { entries: [] }
    }

    /**
     * Creates a child logger that writes to the same log buffer.
     *
     * @param service - Service label for the child logger.
     * @returns A scoped logger instance.
     */
    child(service: string): Logger {
        return new Logger(service, this.state)
    }

    /**
     * Writes an informational log entry.
     *
     * @param message - Human-readable log message.
     * @param context - Optional structured context.
     * @returns Nothing.
     */
    info(message: string, context?: Record<string, unknown>): void {
        this.push('info', message, context)
    }

    /**
     * Writes a warning log entry.
     *
     * @param message - Human-readable log message.
     * @param context - Optional structured context.
     * @returns Nothing.
     */
    warn(message: string, context?: Record<string, unknown>): void {
        this.push('warn', message, context)
    }

    /**
     * Writes an error log entry.
     *
     * @param message - Human-readable log message.
     * @param context - Optional structured context.
     * @returns Nothing.
     */
    error(message: string, context?: Record<string, unknown>): void {
        this.push('error', message, context)
    }

    /**
     * Returns the buffered logs in reverse chronological order.
     *
     * @returns The current log entries, newest first.
     */
    list(): LogEntry[] {
        return [...this.state.entries].reverse()
    }

    private push(level: LogEntry['level'], message: string, context?: Record<string, unknown>): void {
        const entry: LogEntry = {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            level,
            service: this.service,
            message,
            context,
        }

        this.state.entries.push(entry)
        if (this.state.entries.length > MAX_LOGS) {
            this.state.entries.splice(0, this.state.entries.length - MAX_LOGS)
        }

        const renderedContext = context ? ' ' + JSON.stringify(context) : ''
        const renderedService = this.service ? ' [' + this.service + ']' : ''
        const line = '[' + entry.timestamp + '] ' + level.toUpperCase() + renderedService + ' ' + message + renderedContext
        if (level === 'error') {
            console.error(line)
        } else if (level === 'warn') {
            console.warn(line)
        } else {
            console.log(line)
        }
    }
}
