import { type Preset, SoundTouchDevice } from '@soundretouch/api/device'

import { Logger } from '../shared/logger'
import type { MappingRecord, SpeakerRecord } from '../types'

const RECONNECT_DELAY_MS = 5000

/**
 * Owns speaker connections, preset listeners, and stream playback.
 *
 * This service keeps all of the device-facing state in one place so the
 * bridge coordinator can stay focused on routing and policy.
 */
export class PlaybackService {
    private readonly deviceMap = new Map<string, SoundTouchDevice>()
    private readonly listenerMap = new Map<string, Array<() => void>>()
    private readonly logger: Logger

    /**
     * Creates a playback service using the shared application logger.
     *
     * @param logger - Shared application logger used for service-scoped logs.
     */
    constructor(logger: Logger) {
        this.logger = logger.child('PlaybackService')
    }

    /**
     * Attaches preset and error listeners for a speaker connection.
     *
     * @param speaker - Speaker to attach listeners for.
     * @param onPresetSelection - Callback invoked when the speaker reports a preset change.
     * @param forceReconnect - Whether to replace existing listeners.
     */
    attachSpeaker(speaker: SpeakerRecord, onPresetSelection: (speakerId: string, preset: Preset) => Promise<void>, forceReconnect = false): void {
        const existing = this.listenerMap.get(speaker.id)
        if (existing && !forceReconnect) {
            return
        }

        if (existing) {
            this.detachSpeaker(speaker.id)
        }

        const device = this.getDeviceForSpeaker(speaker)
        let reconnecting = false
        const unsubscribers = [
            device.onNowSelectionUpdated((preset: Preset) => {
                void onPresetSelection(speaker.id, preset).catch((error) => {
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

                // Attempt to reconnect on error
                if (reconnecting) {
                    return
                }

                reconnecting = true
                this.detachSpeaker(speaker.id)
                this.attachSpeaker(speaker, onPresetSelection, true)
            }),
        ]

        this.listenerMap.set(speaker.id, unsubscribers)
        this.logger.info('preset listener attached', {
            speakerId: speaker.id,
            ip: speaker.ip,
        })
    }

    /**
     * Detaches listeners and drops any cached device handle for a speaker.
     *
     * @param id - Speaker id to detach.
     */
    detachSpeaker(id: string): void {
        const unsubscribers = this.listenerMap.get(id)
        if (unsubscribers) {
            for (const unsubscribe of unsubscribers) {
                unsubscribe()
            }
            this.listenerMap.delete(id)
        }

        this.deviceMap.delete(id)
    }

    /**
     * Stops the current transport and starts playback for a mapping.
     *
     * @param speaker - Speaker to target.
     * @param mapping - Mapping that provides the stream URL.
     * @returns The mapping and target IP that were used for playback.
     */
    async playStreamForMapping(speaker: SpeakerRecord, mapping: MappingRecord): Promise<{ mapping: MappingRecord; ip: string }> {
        const device = this.getDeviceForSpeaker(speaker)

        this.logger.info('stream playback started', {
            mappingId: mapping.id,
            speakerId: speaker.id,
            ip: speaker.ip,
            streamUrl: mapping.streamUrl,
        })

        await device.keyPressAndRelease('STOP')
        await new Promise((resolve) => setTimeout(resolve, 300))
        await device.playStreamUrl(mapping.streamUrl)

        this.logger.info('stream playback completed', {
            mappingId: mapping.id,
            speakerId: speaker.id,
            ip: speaker.ip,
        })

        return {
            mapping,
            ip: speaker.ip,
        }
    }

    /**
     * Releases all listeners and cached device handles.
     *
     * @returns A promise that resolves once shutdown work is complete.
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

    private toErrorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message
        }

        return String(error)
    }
}
