import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { ConfigData, MappingRecord, SpeakerRecord } from '../types'

const DEFAULT_CONFIG: ConfigData = {
    manualSpeakers: [],
    discoveredSpeakers: [],
    mappings: [],
}

export class ConfigStore {
    private config: ConfigData = structuredClone(DEFAULT_CONFIG)

    /**
     * Creates a config store that reads and writes the given file path.
     *
     * @param filePath - Absolute or relative path to the JSON config file.
     */
    constructor(private readonly filePath: string) {}

    /**
     * Loads the config file into memory, creating it if it does not exist.
     *
     * @returns The current config snapshot after load.
     */
    async load(): Promise<ConfigData> {
        await mkdir(path.dirname(this.filePath), { recursive: true })

        try {
            const raw = await readFile(this.filePath, 'utf8')
            const parsed = JSON.parse(raw) as Partial<ConfigData>
            this.config = {
                manualSpeakers: parsed.manualSpeakers ?? [],
                discoveredSpeakers: parsed.discoveredSpeakers ?? [],
                mappings: parsed.mappings ?? [],
            }
        } catch (error) {
            const nodeError = error as NodeJS.ErrnoException
            if (nodeError.code !== 'ENOENT') {
                throw error
            }
            await this.persist()
        }

        return this.getConfig()
    }

    /**
     * Returns a cloned snapshot of the current in-memory config.
     *
     * @returns The current config data.
     */
    getConfig(): ConfigData {
        return structuredClone(this.config)
    }

    /**
     * Replaces the stored manual speakers list and persists it.
     *
     * @param speakers - Manual speakers to store.
     * @returns A promise that resolves once the config is written.
     */
    async setManualSpeakers(speakers: SpeakerRecord[]): Promise<void> {
        this.config.manualSpeakers = speakers
        await this.persist()
    }

    /**
     * Replaces the stored discovered speakers list and persists it.
     *
     * @param speakers - Discovered speakers to store.
     * @returns A promise that resolves once the config is written.
     */
    async setDiscoveredSpeakers(speakers: SpeakerRecord[]): Promise<void> {
        this.config.discoveredSpeakers = speakers
        await this.persist()
    }

    /**
     * Removes a speaker from the catalog and drops mappings that point at it.
     *
     * @param id - Speaker id to remove.
     * @returns A promise that resolves once the config is written.
     */
    async removeSpeaker(id: string): Promise<void> {
        this.config.manualSpeakers = this.config.manualSpeakers.filter((speaker) => speaker.id !== id)
        this.config.discoveredSpeakers = this.config.discoveredSpeakers.filter((speaker) => speaker.id !== id)
        this.config.mappings = this.config.mappings.filter((mapping) => mapping.speakerId !== id)
        await this.persist()
    }

    /**
     * Replaces the stored mapping list and persists it.
     *
     * @param mappings - Mappings to store.
     * @returns A promise that resolves once the config is written.
     */
    async setMappings(mappings: MappingRecord[]): Promise<void> {
        this.config.mappings = mappings
        await this.persist()
    }

    private async persist(): Promise<void> {
        const tempFilePath = this.filePath + '.tmp'
        const payload = JSON.stringify(this.config, null, 2) + '\n'
        await writeFile(tempFilePath, payload, 'utf8')
        await rename(tempFilePath, this.filePath)
    }
}
