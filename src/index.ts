import path from 'node:path'

import WebSocket from 'ws'

import { buildServer } from './server.js'
import { ConfigStore } from './services/configStore.js'
import { Logger } from './services/logger.js'
import { SpeakerManager } from './services/speakerManager.js'

globalThis.WebSocket ??= WebSocket as unknown as typeof globalThis.WebSocket

const PORT = Number.parseInt(process.env.PORT ?? '4100', 10)
const HOST = process.env.HOST ?? '0.0.0.0'

async function main(): Promise<void> {
    const logger = new Logger()
    const configPath = path.join(process.cwd(), 'data', 'config.json')
    const configStore = new ConfigStore(configPath)
    await configStore.load()

    const manager = new SpeakerManager(configStore, logger)
    await manager.init()
    void manager.discoverSpeakers().catch((error) => {
        logger.warn('startup discovery failed', {
            error: error instanceof Error ? error.message : String(error),
        })
    })

    const server = buildServer(manager)
    await server.listen({ port: PORT, host: HOST })
    logger.info('soundretouch-bridge listening', { host: HOST, port: PORT, configPath })

    const shutdown = async () => {
        logger.info('shutdown requested')
        await server.close()
        await manager.shutdown()
        process.exit(0)
    }

    process.on('SIGINT', () => {
        void shutdown()
    })
    process.on('SIGTERM', () => {
        void shutdown()
    })
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
