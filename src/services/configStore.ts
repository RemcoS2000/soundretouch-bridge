import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { ConfigData, MappingRecord, SpeakerRecord } from '../types.js'

const DEFAULT_CONFIG: ConfigData = {
    manualSpeakers: [],
    discoveredSpeakers: [],
    mappings: [],
}

export class ConfigStore {
    private config: ConfigData = structuredClone(DEFAULT_CONFIG)

    constructor(private readonly filePath: string) {}

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

    getConfig(): ConfigData {
        return structuredClone(this.config)
    }

    async setManualSpeakers(speakers: SpeakerRecord[]): Promise<void> {
        this.config.manualSpeakers = speakers
        await this.persist()
    }

    async setDiscoveredSpeakers(speakers: SpeakerRecord[]): Promise<void> {
        this.config.discoveredSpeakers = speakers
        await this.persist()
    }

    async removeSpeaker(id: string): Promise<void> {
        this.config.manualSpeakers = this.config.manualSpeakers.filter((speaker) => speaker.id !== id)
        this.config.discoveredSpeakers = this.config.discoveredSpeakers.filter((speaker) => speaker.id !== id)
        this.config.mappings = this.config.mappings.filter((mapping) => mapping.speakerId !== id)
        await this.persist()
    }

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
