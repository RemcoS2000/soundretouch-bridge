import fastifyStatic from '@fastify/static'

import path from 'node:path'

import Fastify from 'fastify'

import { SpeakerManager } from './services/speakerManager.js'

export function buildServer(manager: SpeakerManager) {
    const server = Fastify({ logger: false })

    void server.register(fastifyStatic, {
        root: path.join(process.cwd(), 'public'),
        prefix: '/',
        wildcard: false,
    })

    server.get('/api/status', async () => manager.getStatus())
    server.get('/api/speakers', async () => manager.listSpeakers())
    server.post('/api/speakers/discover', async () => ({ speakers: await manager.discoverSpeakers() }))
    server.post('/api/speakers/manual', async (request, reply) => {
        const body = request.body as { ip?: string }
        if (!body?.ip) {
            return reply.status(400).send({ error: 'ip is required' })
        }
        return { speaker: await manager.addManualSpeaker(body.ip) }
    })
    server.delete('/api/speakers/:id', async (request) => {
        await manager.removeSpeaker((request.params as { id: string }).id)
        return { ok: true }
    })

    server.get('/api/mappings', async () => manager.listMappings())
    server.post('/api/mappings', async (request) => manager.createMapping(request.body as never))
    server.put('/api/mappings/:id', async (request) => manager.updateMapping((request.params as { id: string }).id, request.body as never))
    server.delete('/api/mappings/:id', async (request) => {
        await manager.deleteMapping((request.params as { id: string }).id)
        return { ok: true }
    })
    server.post('/api/mappings/:id/play', async (request) => manager.playMapping((request.params as { id: string }).id))

    server.get('/api/logs', async () => manager.listLogs())

    server.setErrorHandler((error, _request, reply) => {
        reply.status(500).send({ error: error instanceof Error ? error.message : String(error) })
    })

    server.get('/*', async (_request, reply) => reply.sendFile('index.html'))

    return server
}
