import type { Preset } from '@soundretouch/api/device'

import type { LogEntry, MappingRecord, SpeakerRecord } from '../types'

import { ConfigStore } from '../shared/configStore'
import { Logger } from '../shared/logger'
import { MappingService } from './mappingService'
import { PlaybackService } from './playbackService'
import { SpeakerRegistryService } from './speakerRegistry'

/**
 * Coordinates speaker registry, mapping, and playback services.
 *
 * This is the bridge-facing application coordinator that turns incoming UI
 * requests and preset events into registry, mapping, and playback actions.
 */
export class SoundRetouchBridge {
    private readonly registry: SpeakerRegistryService
    private readonly mappings: MappingService
    private readonly playback: PlaybackService
    private readonly logger: Logger
    private readonly startedAt = new Date()

    /**
     * Builds the bridge coordinator and wires the underlying services together.
     *
     * @param configStore - Shared config store for persistence.
     * @param logger - Shared application logger.
     */
    constructor(
        configStore: ConfigStore,
        logger: Logger
    ) {
        this.logger = logger.child('SoundRetouchBridge')
        this.registry = new SpeakerRegistryService(configStore, this.logger)
        this.mappings = new MappingService(configStore, (speakerId) => this.registry.getSpeakerOrThrow(speakerId))
        this.playback = new PlaybackService(this.logger)
    }

    /**
     * Loads persisted state and attaches preset listeners to known speakers.
     *
     * @returns A promise that resolves when initialization is complete.
     */
    async init(): Promise<void> {
        await this.registry.init()
        await this.mappings.init()

        this.attachSpeakers(this.registry.listSpeakers(), true)
    }

    /**
     * Returns a lightweight snapshot of current bridge state.
     *
     * @returns A status snapshot containing uptime and item counts.
     */
    getStatus(): Record<string, unknown> {
        return {
            startedAt: this.startedAt.toISOString(),
            speakerCount: this.registry.getSpeakerCount(),
            mappingCount: this.mappings.getMappingCount(),
        }
    }

    /**
     * Returns all known speakers.
     *
     * @returns The current speaker list.
     */
    listSpeakers(): SpeakerRecord[] {
        return this.registry.listSpeakers()
    }

    /**
     * Returns all configured mappings.
     *
     * @returns The current mapping list.
     */
    listMappings(): MappingRecord[] {
        return this.mappings.listMappings()
    }

    /**
     * Returns the in-memory log buffer.
     *
     * @returns The current log entries in reverse chronological order.
     */
    listLogs(): LogEntry[] {
        return this.logger.list()
    }

    /**
     * Runs SSDP discovery and attaches listeners to any discovered speakers.
     *
     * @returns A promise that resolves to the discovered speakers.
     */
    async discoverSpeakers(): Promise<SpeakerRecord[]> {
        const discovered = await this.registry.discoverSpeakers()
        this.attachSpeakers(discovered, true)

        return discovered
    }

    /**
     * Adds a speaker from a manually provided IP address.
     *
     * @param ip - Speaker IP address to inspect.
     * @returns The stored speaker record.
     */
    async addManualSpeaker(ip: string): Promise<SpeakerRecord> {
        const speaker = await this.registry.addManualSpeaker(ip)
        this.attachSpeaker(speaker, true)
        return speaker
    }

    /**
     * Removes a speaker and detaches any playback listeners.
     *
     * @param id - Speaker id to remove.
     * @returns A promise that resolves once the speaker is removed.
     */
    async removeSpeaker(id: string): Promise<void> {
        this.playback.detachSpeaker(id)
        await this.registry.removeSpeaker(id)
        await this.mappings.reload()
    }

    /**
     * Creates a mapping and persists it.
     *
     * @param input - Mapping payload to store.
     * @returns The created mapping.
     */
    async createMapping(input: Omit<MappingRecord, 'id'> & { id?: string }): Promise<MappingRecord> {
        return this.mappings.createMapping(input)
    }

    /**
     * Updates a mapping and persists the result.
     *
     * @param id - Mapping id to update.
     * @param updates - Partial mapping fields to apply.
     * @returns The updated mapping.
     */
    async updateMapping(id: string, updates: Partial<MappingRecord>): Promise<MappingRecord> {
        return this.mappings.updateMapping(id, updates)
    }

    /**
     * Deletes a mapping.
     *
     * @param id - Mapping id to delete.
     * @returns A promise that resolves once the mapping is removed.
     */
    async deleteMapping(id: string): Promise<void> {
        await this.mappings.deleteMapping(id)
    }

    /**
     * Starts playback for a stored mapping.
     *
     * @param id - Mapping id to play.
     * @returns The mapping and IP used for playback.
     */
    async playMapping(id: string): Promise<{ mapping: MappingRecord; ip: string }> {
        const mapping = this.mappings.getMappingOrThrow(id)
        const speaker = this.registry.getSpeakerOrThrow(mapping.speakerId)
        return this.playback.playStreamForMapping(speaker, mapping)
    }

    /**
     * Tears down playback listeners before process exit.
     */
    async shutdown(): Promise<void> {
        this.playback.shutdown()
    }

    private readonly handlePresetSelection = async (speakerId: string, preset: Preset): Promise<void> => {
        const speaker = this.registry.getSpeakerOrThrow(speakerId)

        this.logger.info('preset selection received', {
            speakerId,
            speakerName: speaker.name,
            presetId: preset.id,
            presetNumber: preset.id,
        })

        if (!preset.id) {
            return
        }

        const mapping = this.mappings.findEnabledMappingForSpeakerPreset(speakerId, preset.id)
        if (!mapping) {
            return
        }

        this.logger.info('mapping matched', {
            speakerId,
            mappingId: mapping.id,
            presetNumber: preset.id,
            stationName: mapping.stationName,
        })

        await this.playback.playStreamForMapping(speaker, mapping)
    }

    private attachSpeakers(speakers: SpeakerRecord[], forceReconnect = false): void {
        for (const speaker of speakers) {
            this.attachSpeaker(speaker, forceReconnect)
        }
    }

    private attachSpeaker(speaker: SpeakerRecord, forceReconnect = false): void {
        this.playback.attachSpeaker(speaker, this.handlePresetSelection, forceReconnect)
    }
}
