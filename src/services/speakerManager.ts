import { SoundTouchDiscovery } from '@soundretouch/api/discovery'
import { type Preset, SoundTouchDevice } from '@soundretouch/api/device'

import { randomUUID } from 'node:crypto'

import type { ConfigData, MappingRecord, SpeakerOrigin, SpeakerRecord } from '../types.js'

import { ConfigStore } from './configStore.js'
import { Logger } from './logger.js'

const RECONNECT_DELAY_MS = 5000
const DISCOVERY_WAIT_MS = 1800

/**
 * Coordinates speaker discovery, preset mappings, listener wiring, and playback.
 */
export class SpeakerManager {
    private readonly speakerMap = new Map<string, SpeakerRecord>()
    private readonly deviceMap = new Map<string, SoundTouchDevice>()
    private readonly listenerMap = new Map<string, Array<() => void>>()
    private config: ConfigData
    private readonly startedAt = new Date()

    /**
     * Creates a manager for speaker discovery, mappings, and preset playback.
     *
     * @param configStore Persistent bridge configuration store.
     * @param logger Structured application logger.
     */
    constructor(
        private readonly configStore: ConfigStore,
        private readonly logger: Logger
    ) {
        this.config = this.configStore.getConfig()
    }

    /**
     * Loads persisted state and attaches listeners for known speakers.
     */
    async init(): Promise<void> {
        this.config = await this.configStore.load()
        this.rebuildSpeakerMap()

        for (const speaker of this.speakerMap.values()) {
            this.connectSpeaker(speaker)
        }
    }

    /**
     * Returns the service status used by the dashboard.
     */
    getStatus(): Record<string, unknown> {
        return {
            startedAt: this.startedAt.toISOString(),
            speakerCount: this.speakerMap.size,
            mappingCount: this.config.mappings.length,
        }
    }

    /**
     * Lists all known speakers in name order.
     */
    listSpeakers(): SpeakerRecord[] {
        return [...this.speakerMap.values()].sort((a, b) => a.name.localeCompare(b.name))
    }

    /**
     * Lists all configured preset mappings.
     */
    listMappings(): MappingRecord[] {
        return [...this.config.mappings]
    }

    /**
     * Returns the recent structured log buffer.
     */
    listLogs(): ReturnType<Logger['list']> {
        return this.logger.list()
    }

    /**
     * Discovers speakers via the SoundTouch discovery API and persists them.
     */
    async discoverSpeakers(): Promise<SpeakerRecord[]> {
        const discovered = await this.discoverViaApi()

        this.config.discoveredSpeakers = this.mergeSpeakers(this.config.discoveredSpeakers, discovered, 'ssdp')
        await this.configStore.setDiscoveredSpeakers(this.config.discoveredSpeakers)
        this.rebuildSpeakerMap()

        for (const speaker of discovered) {
            this.connectSpeaker(speaker, true)
        }

        return discovered
    }

    /**
     * Adds a speaker by IP address when discovery is unavailable.
     *
     * @param ip Speaker IP address.
     */
    async addManualSpeaker(ip: string): Promise<SpeakerRecord> {
        const speaker = await this.inspectSpeaker(ip, 'manual')
        this.config.manualSpeakers = this.mergeSpeakers(this.config.manualSpeakers, [speaker], 'manual')
        await this.configStore.setManualSpeakers(this.config.manualSpeakers)
        this.rebuildSpeakerMap()
        this.connectSpeaker(speaker, true)
        return speaker
    }

    /**
     * Removes a speaker and any mappings that reference it.
     *
     * @param id Speaker identifier.
     */
    async removeSpeaker(id: string): Promise<void> {
        const speaker = this.speakerMap.get(id)
        if (!speaker) {
            throw new Error('Speaker not found')
        }

        const unsubscribers = this.listenerMap.get(id)
        if (unsubscribers) {
            for (const unsubscribe of unsubscribers) {
                unsubscribe()
            }
            this.listenerMap.delete(id)
        }

        this.deviceMap.delete(id)
        await this.configStore.removeSpeaker(id)
        this.rebuildSpeakerMap()

        this.logger.info('speaker removed', {
            speakerId: speaker.id,
            name: speaker.name,
            ip: speaker.ip,
            origin: speaker.origin,
        })
    }

    /**
     * Creates or replaces a preset mapping.
     *
     * @param input Mapping payload from the UI.
     */
    async createMapping(input: Omit<MappingRecord, 'id'> & { id?: string }): Promise<MappingRecord> {
        this.getSpeakerOrThrow(input.speakerId)
        const mapping: MappingRecord = {
            id: input.id && input.id.trim() ? input.id : randomUUID(),
            speakerId: input.speakerId,
            presetNumber: input.presetNumber,
            stationName: input.stationName.trim(),
            streamUrl: input.streamUrl.trim(),
            enabled: input.enabled,
        }

        this.validateMapping(mapping)
        this.config.mappings = [...this.config.mappings.filter((item) => item.id !== mapping.id), mapping]
        await this.configStore.setMappings(this.config.mappings)
        return mapping
    }

    /**
     * Updates an existing mapping.
     *
     * @param id Mapping identifier.
     * @param updates Partial mapping updates.
     */
    async updateMapping(id: string, updates: Partial<MappingRecord>): Promise<MappingRecord> {
        const current = this.config.mappings.find((item) => item.id === id)
        if (!current) {
            throw new Error('Mapping not found')
        }

        const next: MappingRecord = {
            id,
            speakerId: updates.speakerId ?? current.speakerId,
            presetNumber: updates.presetNumber ?? current.presetNumber,
            stationName: (updates.stationName ?? current.stationName).trim(),
            streamUrl: (updates.streamUrl ?? current.streamUrl).trim(),
            enabled: updates.enabled ?? current.enabled,
        }

        this.getSpeakerOrThrow(next.speakerId)
        this.validateMapping(next)
        this.config.mappings = this.config.mappings.map((item) => (item.id === id ? next : item))
        await this.configStore.setMappings(this.config.mappings)
        return next
    }

    /**
     * Deletes a mapping by identifier.
     *
     * @param id Mapping identifier.
     */
    async deleteMapping(id: string): Promise<void> {
        this.config.mappings = this.config.mappings.filter((item) => item.id !== id)
        await this.configStore.setMappings(this.config.mappings)
    }

    /**
     * Plays a configured mapping immediately.
     *
     * @param id Mapping identifier.
     */
    async playMapping(id: string): Promise<{ mapping: MappingRecord; ip: string }> {
        const mapping = this.config.mappings.find((item) => item.id === id)
        if (!mapping) {
            throw new Error('Mapping not found')
        }

        return this.playStreamForMapping(mapping)
    }

    /**
     * Stops all active listeners and clears device references.
     */
    async shutdown(): Promise<void> {
        for (const unsubscribers of this.listenerMap.values()) {
            for (const unsubscribe of unsubscribers) {
                unsubscribe()
            }
        }

        this.listenerMap.clear()
        this.deviceMap.clear()
    }

    /**
     * Rebuilds the in-memory speaker lookup from the persisted config.
     */
    private rebuildSpeakerMap(): void {
        this.config = this.configStore.getConfig()
        this.speakerMap.clear()

        for (const speaker of this.config.discoveredSpeakers) {
            this.speakerMap.set(speaker.id, speaker)
        }

        for (const speaker of this.config.manualSpeakers) {
            this.speakerMap.set(speaker.id, speaker)
        }
    }

    /**
     * Inspects a speaker at a given IP and records it with an origin tag.
     *
     * @param ip Speaker IP address.
     * @param origin Source of the speaker record.
     */
    private async inspectSpeaker(ip: string, origin: SpeakerOrigin): Promise<SpeakerRecord> {
        return this.inspectDevice(new SoundTouchDevice(ip), origin)
    }

    /**
     * Reads speaker metadata from a connected SoundTouch device.
     *
     * @param device Connected SoundTouch device wrapper.
     * @param origin Source of the speaker record.
     */
    private async inspectDevice(device: SoundTouchDevice, origin: SpeakerOrigin): Promise<SpeakerRecord> {
        const info = await device.info()
        const ip = device.host
        const deviceId = this.pickString(info.deviceID) ?? ip
        const name = this.pickString(info.name) ?? ip
        const model = this.pickString(info.type)

        const speaker: SpeakerRecord = {
            id: deviceId,
            deviceId,
            name,
            ip,
            model,
            lastSeen: new Date().toISOString(),
            origin,
        }

        this.logger.info('speaker discovered', {
            speakerId: speaker.id,
            name: speaker.name,
            ip: speaker.ip,
            origin,
        })

        return speaker
    }

    /**
     * Merges a set of speaker records into the current config slice.
     *
     * @param current Existing speakers for the same origin.
     * @param incoming Newly discovered speakers.
     * @param origin Origin bucket to merge into.
     */
    private mergeSpeakers(current: SpeakerRecord[], incoming: SpeakerRecord[], origin: SpeakerOrigin): SpeakerRecord[] {
        const merged = new Map<string, SpeakerRecord>()

        for (const speaker of current.filter((item) => item.origin === origin)) {
            merged.set(speaker.id, speaker)
        }

        for (const speaker of incoming) {
            merged.set(speaker.id, speaker)
        }

        return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name))
    }

    /**
     * Runs a short discovery scan using the SoundTouch discovery API.
     */
    private async discoverViaApi(): Promise<SpeakerRecord[]> {
        const pending: Array<Promise<SpeakerRecord>> = []
        const seenHosts = new Set<string>()

        const handle = SoundTouchDiscovery.start((device: SoundTouchDevice) => {
            if (seenHosts.has(device.host)) {
                return
            }

            seenHosts.add(device.host)
            pending.push(this.inspectDevice(device, 'ssdp'))
        })

        await new Promise((resolve) => setTimeout(resolve, DISCOVERY_WAIT_MS))
        handle.stop()

        const results = await Promise.allSettled(pending)
        const discovered: SpeakerRecord[] = []

        for (const result of results) {
            if (result.status === 'fulfilled') {
                discovered.push(result.value)
                continue
            }

            this.logger.warn('speaker discovery inspect failed', {
                error: this.toErrorMessage(result.reason),
            })
        }

        this.logger.info('soundretouch-api discovery finished', {
            count: discovered.length,
            ips: [...seenHosts],
        })

        return discovered
    }

    /**
     * Attaches preset listeners for a speaker device.
     *
     * @param speaker Speaker record to attach listeners for.
     * @param forceReconnect Forces listener re-creation.
     */
    private connectSpeaker(speaker: SpeakerRecord, forceReconnect = false): void {
        const existing = this.listenerMap.get(speaker.id)
        if (existing && !forceReconnect) {
            return
        }

        if (existing) {
            for (const unsubscribe of existing) {
                unsubscribe()
            }
            this.listenerMap.delete(speaker.id)
        }

        const device = this.getDeviceForSpeaker(speaker)
        const unsubscribers = [
            device.onNowSelectionUpdated((preset: Preset) => {
                void this.handlePresetSelection(speaker.id, preset).catch((error) => {
                    this.logger.error('preset selection handling failed', {
                        speakerId: speaker.id,
                        error: this.toErrorMessage(error),
                    })
                })
            }),
            device.onWebSocketError((error: unknown) => {
                this.logger.warn('preset listener error', {
                    speakerId: speaker.id,
                    ip: speaker.ip,
                    error: this.toErrorMessage(error),
                })
            }),
        ]

        this.listenerMap.set(speaker.id, unsubscribers)
        this.logger.info('preset listener attached', {
            speakerId: speaker.id,
            ip: speaker.ip,
        })
    }

    /**
     * Handles a preset selection event and triggers a mapped stream when found.
     *
     * @param speakerId Speaker identifier.
     * @param preset Parsed preset payload.
     */
    private async handlePresetSelection(speakerId: string, preset: Preset): Promise<void> {
        const speaker = this.getSpeakerOrThrow(speakerId)
        const presetNumber = this.parsePresetValue(preset.id)

        this.logger.info('preset selection received', {
            speakerId,
            speakerName: speaker.name,
            presetId: preset.id,
            presetNumber,
        })

        if (!presetNumber) {
            return
        }

        const mapping = this.config.mappings.find((item) => item.enabled && item.speakerId === speakerId && item.presetNumber === presetNumber)
        if (!mapping) {
            return
        }

        this.logger.info('mapping matched', {
            speakerId,
            mappingId: mapping.id,
            presetNumber,
            stationName: mapping.stationName,
        })

        await this.playStreamForMapping(mapping)
    }

    /**
     * Plays a stream URL on the target speaker.
     *
     * @param mapping Mapping that owns the stream URL.
     */
    private async playStreamForMapping(mapping: MappingRecord): Promise<{ mapping: MappingRecord; ip: string }> {
        const speaker = this.getSpeakerOrThrow(mapping.speakerId)
        const ip = speaker.ip
        const device = this.getDeviceForSpeaker(speaker)

        this.logger.info('stream playback started', {
            mappingId: mapping.id,
            speakerId: speaker.id,
            ip,
            streamUrl: mapping.streamUrl,
        })

        await device.keyPressAndRelease('STOP')
        await new Promise((resolve) => setTimeout(resolve, 300))
        await device.playStreamUrl(mapping.streamUrl)

        this.logger.info('stream playback completed', {
            mappingId: mapping.id,
            speakerId: speaker.id,
            ip,
        })

        return {
            mapping,
            ip,
        }
    }

    /**
     * Returns a cached SoundTouch device for the current speaker IP.
     *
     * @param speaker Speaker record to resolve.
     */
    private getDeviceForSpeaker(speaker: SpeakerRecord): SoundTouchDevice {
        const existing = this.deviceMap.get(speaker.id)
        if (existing?.host === speaker.ip) {
            return existing
        }

        const device = new SoundTouchDevice(speaker.ip, {
            ws: {
                autoReconnect: true,
                reconnectDelayMs: RECONNECT_DELAY_MS,
            },
        })
        this.deviceMap.set(speaker.id, device)
        return device
    }

    /**
     * Validates a mapping payload before persisting it.
     *
     * @param mapping Mapping payload to validate.
     */
    private validateMapping(mapping: MappingRecord): void {
        if (!Number.isInteger(mapping.presetNumber) || mapping.presetNumber < 1 || mapping.presetNumber > 6) {
            throw new Error('presetNumber must be between 1 and 6')
        }

        if (!mapping.stationName) {
            throw new Error('stationName is required')
        }

        if (!mapping.streamUrl) {
            throw new Error('streamUrl is required')
        }
    }

    /**
     * Parses a preset identifier into a numeric preset slot.
     *
     * @param value Raw preset identifier from the device.
     */
    private parsePresetValue(value: string | number | undefined): number | undefined {
        if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6) {
            return value
        }

        if (typeof value === 'string') {
            const parsed = Number.parseInt(value, 10)
            if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 6) {
                return parsed
            }
        }

        return undefined
    }

    /**
     * Looks up a speaker or throws if it is missing.
     *
     * @param id Speaker identifier.
     */
    private getSpeakerOrThrow(id: string): SpeakerRecord {
        const speaker = this.speakerMap.get(id)
        if (!speaker) {
            throw new Error('Speaker not found')
        }

        return speaker
    }

    /**
     * Returns the first non-empty trimmed string from the provided values.
     *
     * @param values Candidate values to inspect.
     */
    private pickString(...values: unknown[]): string | undefined {
        for (const value of values) {
            if (typeof value === 'string' && value.trim()) {
                return value.trim()
            }
        }

        return undefined
    }

    /**
     * Normalizes an unknown error value to a string.
     *
     * @param error Error-like value.
     */
    private toErrorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message
        }

        return String(error)
    }
}
