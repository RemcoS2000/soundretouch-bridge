import { SoundTouchDiscovery } from '@soundretouch/api/discovery'
import { SoundTouchDevice } from '@soundretouch/api/device'

import type { ConfigData, SpeakerOrigin, SpeakerRecord } from '../types'

import { ConfigStore } from '../shared/configStore'
import { Logger } from '../shared/logger'

const DISCOVERY_WAIT_MS = 1800

/**
 * Owns the speaker catalog, discovery, and persistence.
 *
 * The registry is the source of truth for which speakers the bridge knows
 * about, regardless of whether they were discovered automatically or added
 * manually.
 */
export class SpeakerRegistryService {
    private readonly speakerMap = new Map<string, SpeakerRecord>()
    private readonly logger: Logger
    private config: ConfigData

    /**
     * Creates a registry backed by the shared config store.
     *
     * @param configStore - Shared config store used for persistence.
     * @param logger - Shared application logger used for service-scoped logs.
     */
    constructor(
        private readonly configStore: ConfigStore,
        logger: Logger
    ) {
        this.logger = logger.child('SpeakerRegistryService')
        this.config = this.configStore.getConfig()
    }

    /**
     * Loads speaker state from disk and rebuilds the in-memory catalog.
     *
     * @returns A promise that resolves once the catalog is rebuilt.
     */
    async init(): Promise<void> {
        this.config = await this.configStore.load()
        this.rebuildSpeakerMap()
    }

    /**
     * Returns the number of speakers in the current catalog.
     *
     * @returns The current speaker count.
     */
    getSpeakerCount(): number {
        return this.speakerMap.size
    }

    /**
     * Returns all known speakers sorted by name.
     *
     * @returns A shallow copy of the speaker list.
     */
    listSpeakers(): SpeakerRecord[] {
        return [...this.speakerMap.values()].sort((a, b) => a.name.localeCompare(b.name))
    }

    /**
     * Looks up a speaker by id or throws if it is missing.
     *
     * @param id - Speaker id to look up.
     * @returns The matching speaker.
     */
    getSpeakerOrThrow(id: string): SpeakerRecord {
        const speaker = this.speakerMap.get(id)
        if (!speaker) {
            throw new Error('Speaker not found')
        }

        return speaker
    }

    /**
     * Runs SSDP discovery and persists any newly discovered speakers.
     *
     * @returns A promise that resolves to the speakers discovered during this run.
     */
    async discoverSpeakers(): Promise<SpeakerRecord[]> {
        const discovered = await this.discoverViaApi()

        this.config.discoveredSpeakers = this.mergeSpeakers(this.config.discoveredSpeakers, discovered, 'ssdp')
        await this.configStore.setDiscoveredSpeakers(this.config.discoveredSpeakers)
        this.rebuildSpeakerMap()

        return discovered
    }

    /**
     * Adds a speaker by IP address and persists it as a manual speaker.
     *
     * @param ip - Speaker IP address to inspect.
     * @returns The stored speaker record.
     */
    async addManualSpeaker(ip: string): Promise<SpeakerRecord> {
        const speaker = await this.inspectSpeaker(ip, 'manual')
        this.config.manualSpeakers = this.mergeSpeakers(this.config.manualSpeakers, [speaker], 'manual')
        await this.configStore.setManualSpeakers(this.config.manualSpeakers)
        this.rebuildSpeakerMap()
        return speaker
    }

    /**
     * Removes a speaker and any mappings that point at it.
     *
     * @param id - Speaker id to remove.
     * @returns The removed speaker record.
     */
    async removeSpeaker(id: string): Promise<SpeakerRecord> {
        const speaker = this.getSpeakerOrThrow(id)
        await this.configStore.removeSpeaker(id)
        this.rebuildSpeakerMap()

        this.logger.info('speaker removed', {
            speakerId: speaker.id,
            name: speaker.name,
            ip: speaker.ip,
            origin: speaker.origin,
        })

        return speaker
    }

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

    private async inspectSpeaker(ip: string, origin: SpeakerOrigin): Promise<SpeakerRecord> {
        return this.inspectDevice(new SoundTouchDevice(ip), origin)
    }

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

    private pickString(...values: unknown[]): string | undefined {
        for (const value of values) {
            if (typeof value === 'string' && value.trim()) {
                return value.trim()
            }
        }

        return undefined
    }

    private toErrorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message
        }

        return String(error)
    }
}
