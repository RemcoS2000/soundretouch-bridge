export type SpeakerOrigin = 'manual' | 'ssdp'

export interface SpeakerRecord {
    id: string
    name: string
    ip: string
    model?: string
    deviceId?: string
    lastSeen: string
    origin: SpeakerOrigin
}

export interface MappingRecord {
    id: string
    speakerId: string
    presetNumber: number
    stationName: string
    streamUrl: string
    enabled: boolean
}

export interface ConfigData {
    manualSpeakers: SpeakerRecord[]
    discoveredSpeakers: SpeakerRecord[]
    mappings: MappingRecord[]
}

export interface LogEntry {
    id: string
    timestamp: string
    level: 'info' | 'warn' | 'error'
    message: string
    context?: Record<string, unknown>
}
