import { randomUUID } from 'node:crypto'

import type { ConfigData, MappingRecord, SpeakerRecord } from '../types'

import { ConfigStore } from '../shared/configStore'

/**
 * Owns mapping persistence, validation, and lookup.
 *
 * This service keeps the mapping rules close together so the bridge can
 * ask simple questions like "which mapping matches this speaker/preset?"
 * without worrying about storage details.
 */
export class MappingService {
    private config: ConfigData

    /**
     * Creates a mapping service backed by the shared config store.
     *
     * @param configStore - Shared config store used for persistence.
     * @param speakerLookup - Lookup function used to validate speaker ids.
     */
    constructor(
        private readonly configStore: ConfigStore,
        private readonly speakerLookup: (speakerId: string) => SpeakerRecord | undefined
    ) {
        this.config = this.configStore.getConfig()
    }

    /**
     * Loads the latest mapping state from disk.
     *
     * @returns A promise that resolves once mappings have been reloaded.
     */
    async init(): Promise<void> {
        this.config = await this.configStore.load()
    }

    /**
     * Reloads mapping state after an external speaker or config change.
     *
     * @returns A promise that resolves once mappings have been reloaded.
     */
    async reload(): Promise<void> {
        this.config = await this.configStore.load()
    }

    /**
     * Returns the number of configured mappings.
     *
     * @returns The current mapping count.
     */
    getMappingCount(): number {
        return this.config.mappings.length
    }

    /**
     * Returns all mappings in their current order.
     *
     * @returns A shallow copy of the mapping list.
     */
    listMappings(): MappingRecord[] {
        return [...this.config.mappings]
    }

    /**
     * Looks up a mapping by id or throws if it does not exist.
     *
     * @param id - Mapping id to look up.
     * @returns The matching mapping.
     */
    getMappingOrThrow(id: string): MappingRecord {
        const mapping = this.config.mappings.find((item) => item.id === id)
        if (!mapping) {
            throw new Error('Mapping not found')
        }

        return mapping
    }

    /**
     * Finds the enabled mapping for a speaker and preset number, if any.
     *
     * @param speakerId - Speaker id to match.
     * @param presetNumber - Preset slot number to match.
     * @returns The matching mapping, if present.
     */
    findEnabledMappingForSpeakerPreset(speakerId: string, presetNumber: number): MappingRecord | undefined {
        return this.config.mappings.find((item) => item.enabled && item.speakerId === speakerId && item.presetNumber === presetNumber)
    }

    /**
     * Creates or replaces a mapping after validating the speaker and input.
     *
     * @param input - Mapping payload from the UI or API.
     * @returns The saved mapping.
     */
    async createMapping(input: Omit<MappingRecord, 'id'> & { id?: string }): Promise<MappingRecord> {
        this.requireSpeaker(input.speakerId)
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
     * Updates an existing mapping and persists the result.
     *
     * @param id - Mapping id to update.
     * @param updates - Partial mapping fields to apply.
     * @returns The updated mapping.
     */
    async updateMapping(id: string, updates: Partial<MappingRecord>): Promise<MappingRecord> {
        const current = this.getMappingOrThrow(id)

        const next: MappingRecord = {
            id,
            speakerId: updates.speakerId ?? current.speakerId,
            presetNumber: updates.presetNumber ?? current.presetNumber,
            stationName: (updates.stationName ?? current.stationName).trim(),
            streamUrl: (updates.streamUrl ?? current.streamUrl).trim(),
            enabled: updates.enabled ?? current.enabled,
        }

        this.requireSpeaker(next.speakerId)
        this.validateMapping(next)
        this.config.mappings = this.config.mappings.map((item) => (item.id === id ? next : item))
        await this.configStore.setMappings(this.config.mappings)
        return next
    }

    /**
     * Deletes a mapping by id.
     *
     * @param id - Mapping id to delete.
     * @returns A promise that resolves once the mapping is removed.
     */
    async deleteMapping(id: string): Promise<void> {
        this.config.mappings = this.config.mappings.filter((item) => item.id !== id)
        await this.configStore.setMappings(this.config.mappings)
    }

    private requireSpeaker(speakerId: string): SpeakerRecord {
        const speaker = this.speakerLookup(speakerId)
        if (!speaker) {
            throw new Error('Speaker not found')
        }

        return speaker
    }

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
}
