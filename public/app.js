const state = {
    status: null,
    speakers: [],
    mappings: [],
    logs: [],
}

const els = {
    statusGrid: document.getElementById('status-grid'),
    speakersList: document.getElementById('speakers-list'),
    logsList: document.getElementById('logs-list'),
    discoverSpeakers: document.getElementById('discover-speakers'),
    mappingModal: document.getElementById('mapping-modal'),
    mappingModalClose: document.getElementById('mapping-modal-close'),
    manualSpeakerForm: document.getElementById('manual-speaker-form'),
    mappingForm: document.getElementById('mapping-form'),
    mappingDelete: document.getElementById('mapping-delete'),
    mappingSpeakerDisplay: document.getElementById('mapping-speaker-display'),
    mappingPresetDisplay: document.getElementById('mapping-preset-display'),
    mappingSpeaker: document.getElementById('mapping-speaker'),
    mappingId: document.getElementById('mapping-id'),
    mappingPreset: document.getElementById('mapping-preset'),
    mappingStation: document.getElementById('mapping-station'),
    mappingStream: document.getElementById('mapping-stream'),
    mappingEnabled: document.getElementById('mapping-enabled'),
    speakerTemplate: document.getElementById('speaker-template'),
}

async function api(path, options) {
    const requestOptions = { ...options }
    const headers = new Headers(requestOptions.headers || {})

    if (requestOptions.body && !headers.has('content-type')) {
        headers.set('content-type', 'application/json')
    }

    const response = await fetch(path, {
        ...requestOptions,
        headers,
    })

    if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || 'Request failed')
    }

    if (response.status === 204) {
        return null
    }

    return response.json()
}

async function refreshAll() {
    const [status, speakers, mappings, logs] = await Promise.all([
        api('/api/status'),
        api('/api/speakers'),
        api('/api/mappings'),
        api('/api/logs'),
    ])

    state.status = status
    state.speakers = speakers
    state.mappings = mappings
    state.logs = logs

    renderStatus()
    renderSpeakers()
    renderLogs()
}

function renderStatus() {
    const startedAt = state.status ? formatDateTime(state.status.startedAt) : ''

    const items = [
        ['Started', startedAt],
        ['Speakers', String(state.status ? state.status.speakerCount : 0)],
        ['Mappings', String(state.status ? state.status.mappingCount : 0)],
    ]

    els.statusGrid.innerHTML = items
        .map(function (item) {
            return '<div class="status-item"><strong>' + escapeHtml(item[0]) + '</strong><div class="muted">' + escapeHtml(item[1]) + '</div></div>'
        })
        .join('')
}

function renderSpeakers() {
    els.speakersList.innerHTML = ''
    if (!state.speakers.length) {
        els.speakersList.innerHTML = '<p class="muted">No speakers yet. Use discovery or add a manual IP.</p>'
        return
    }

    state.speakers.forEach(function (speaker) {
        const fragment = els.speakerTemplate.content.cloneNode(true)
        fragment.querySelector('.speaker-name').textContent = speaker.name
        fragment.querySelector('.speaker-meta').textContent = speaker.ip + ' · ' + (speaker.model || 'unknown model') + ' · ' + speaker.origin

        const presetContainer = fragment.querySelector('.speaker-presets')
        const mappedPresets = new Set(
            state.mappings
                .filter(function (mapping) {
                    return mapping.speakerId === speaker.id
                })
                .map(function (mapping) {
                    return mapping.presetNumber
                }),
        )

        presetContainer.innerHTML = Array.from({ length: 6 }, function (_, index) {
            const presetNumber = index + 1
            const isMapped = mappedPresets.has(presetNumber)
            return (
                '<button type="button" class="preset-badge ' +
                (isMapped ? 'preset-badge-mapped' : 'preset-badge-unmapped') +
                '" title="Preset ' +
                presetNumber +
                '" data-speaker-id="' +
                escapeHtml(speaker.id) +
                '" data-preset-number="' +
                presetNumber +
                '">' +
                presetNumber +
                '</button>'
            )
        }).join('')

        presetContainer.querySelectorAll('button[data-preset-number]').forEach(function (button) {
            button.addEventListener('click', function () {
                const speakerId = button.getAttribute('data-speaker-id')
                const presetNumber = Number.parseInt(button.getAttribute('data-preset-number') || '', 10)
                const mapping = state.mappings.find(function (item) {
                    return item.speakerId === speakerId && item.presetNumber === presetNumber
                })
                openMappingModal(speakerId, presetNumber, mapping || null)
            })
        })

        const removeButton = fragment.querySelector('.speaker-remove')
        removeButton.addEventListener('click', function () {
            removeSpeaker(speaker)
        })

        els.speakersList.appendChild(fragment)
    })
}

function renderLogs() {
    if (!state.logs.length) {
        els.logsList.innerHTML = '<div class="terminal-line muted">No logs yet.</div>'
        return
    }

    els.logsList.innerHTML = state.logs
        .slice(0, 40)
        .map(function (entry) {
            const context = entry.context && Object.keys(entry.context).length ? ' ' + JSON.stringify(entry.context) : ''
            return '<div class="terminal-line">' + escapeHtml(entry.timestamp + ' ' + entry.level.toUpperCase() + ' ' + entry.message + context) + '</div>'
        })
        .join('')
}

async function deleteMapping(id) {
    if (!window.confirm('Delete this mapping?')) {
        return
    }

    try {
        await api('/api/mappings/' + encodeURIComponent(id), { method: 'DELETE' })
        await refreshAll()
    } catch (error) {
        alert(error.message || error)
    }
}

async function removeSpeaker(speaker) {
    const message =
        speaker.origin === 'manual'
            ? 'Remove this manual speaker?'
            : 'Remove this discovered speaker?'

    if (!window.confirm(message)) {
        return
    }

    try {
        await api('/api/speakers/' + encodeURIComponent(speaker.id), {
            method: 'DELETE',
        })
        await refreshAll()
    } catch (error) {
        alert(error.message || error)
    }
}

function openMappingModal(speakerId, presetNumber, mapping) {
    els.mappingId.value = mapping ? mapping.id : ''
    const selectedSpeakerId = speakerId || (state.speakers[0] ? state.speakers[0].id : '')
    const selectedSpeaker = state.speakers.find(function (speaker) {
        return speaker.id === selectedSpeakerId
    })
    els.mappingSpeaker.value = selectedSpeakerId
    els.mappingSpeakerDisplay.textContent = selectedSpeaker ? selectedSpeaker.name + ' (' + selectedSpeaker.ip + ')' : selectedSpeakerId
    els.mappingPreset.value = String(presetNumber || 1)
    els.mappingPresetDisplay.textContent = String(presetNumber || 1)
    els.mappingStation.value = mapping ? mapping.stationName : ''
    els.mappingStream.value = mapping ? mapping.streamUrl : ''
    els.mappingEnabled.checked = mapping ? Boolean(mapping.enabled) : true
    els.mappingDelete.disabled = !mapping
    els.mappingModal.classList.add('modal-open')
    els.mappingModal.setAttribute('aria-hidden', 'false')
    els.mappingStation.focus()
}

function closeMappingModal() {
    els.mappingModal.classList.remove('modal-open')
    els.mappingModal.setAttribute('aria-hidden', 'true')
}

async function saveMappingFromForm() {
    const payload = {
        speakerId: els.mappingSpeaker.value,
        presetNumber: Number.parseInt(els.mappingPreset.value, 10),
        stationName: els.mappingStation.value,
        streamUrl: els.mappingStream.value,
        enabled: els.mappingEnabled.checked,
    }

    if (els.mappingId.value) {
        return api('/api/mappings/' + encodeURIComponent(els.mappingId.value), {
            method: 'PUT',
            body: JSON.stringify(payload),
        })
    }

    return api('/api/mappings', {
        method: 'POST',
        body: JSON.stringify(payload),
    })
}

function escapeHtml(value) {
    return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function formatDateTime(value) {
    if (!value) {
        return ''
    }

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        return String(value)
    }

    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(date)
}

els.mappingModalClose.addEventListener('click', closeMappingModal)

els.mappingDelete.addEventListener('click', async function () {
    if (!els.mappingId.value) {
        return
    }

    await deleteMapping(els.mappingId.value)
    closeMappingModal()
})

els.mappingModal.addEventListener('click', function (event) {
    const target = event.target
    if (target instanceof HTMLElement && target.dataset.closeModal === 'true') {
        closeMappingModal()
    }
})

document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && els.mappingModal.classList.contains('modal-open')) {
        closeMappingModal()
    }
})

els.discoverSpeakers.addEventListener('click', async function () {
    try {
        await api('/api/speakers/discover', { method: 'POST' })
        await refreshAll()
    } catch (error) {
        alert(error.message || error)
    }
})

els.manualSpeakerForm.addEventListener('submit', async function (event) {
    event.preventDefault()
    const formData = new FormData(els.manualSpeakerForm)
    try {
        await api('/api/speakers/manual', {
            method: 'POST',
            body: JSON.stringify({ ip: formData.get('ip') }),
        })
        els.manualSpeakerForm.reset()
        await refreshAll()
    } catch (error) {
        alert(error.message || error)
    }
})

els.mappingForm.addEventListener('submit', async function (event) {
    event.preventDefault()

    try {
        await saveMappingFromForm()
        closeMappingModal()
        await refreshAll()
    } catch (error) {
        alert(error.message || error)
    }
})

void refreshAll()
window.setInterval(function () {
    void refreshAll()
}, 5000)
