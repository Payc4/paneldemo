// Prototype versions: each lives at /hpanelN/ with its own copy of index.html, styles.css and app.js.
// The live editor changes these copies; public/ stays the template new versions start from.
//
// versions/<slug>/
//   index.html, styles.css, app.js   the version's files
//   meta.json                         { created, from, seedHash, edited }
//   .history/undo.json, redo.json     stacks of snapshot ids (newest last)
//   .history/<id>.json                { label, at, files: { name: content } }
//
// Keep versions/ on a persistent volume (Coolify: /app/versions), otherwise edits are lost on redeploy.

import { mkdir, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FILES = ['index.html', 'styles.css', 'app.js']
/** Emits 'change' (slug) whenever a version's files are written — used to live-reload open previews. */
export const changes = new EventEmitter()
changes.setMaxListeners(500)
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url))
const ROOT = process.env.VERSIONS_DIR || fileURLToPath(new URL('../versions/', import.meta.url))
const MAX_HISTORY = 30

export const validSlug = s => /^hpanel\d{1,3}$/.test(String(s || ''))
const dir = slug => join(ROOT, slug)
const hist = slug => join(dir(slug), '.history')
const num = slug => Number(slug.slice(6))

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch { return fallback }
}
const writeJson = (file, data) => writeFile(file, JSON.stringify(data))

async function publicFiles() {
  const out = {}
  for (const f of FILES) out[f] = await readFile(join(PUBLIC, f), 'utf8')
  return out
}
const hashOf = files => createHash('sha256').update(FILES.map(f => files[f]).join('\u0000')).digest('hex').slice(0, 16)

export async function exists(slug) {
  if (!validSlug(slug)) return false
  try { return (await stat(join(dir(slug), 'index.html'))).isFile() } catch { return false }
}

/**
 * On startup: create hpanel1 from public/ if there are no versions yet, and refresh any version
 * that has never been edited, so code updates from the repo still reach untouched versions.
 */
export async function init() {
  await mkdir(ROOT, { recursive: true })
  const pub = await publicFiles()
  const seedHash = hashOf(pub)
  const list = await listVersions()
  if (!list.length) {
    await writeVersion('hpanel1', pub, { created: new Date().toISOString(), from: 'template', seedHash, edited: false })
    return
  }
  for (const v of list) {
    const meta = await readJson(join(dir(v.slug), 'meta.json'), {})
    if (!meta.edited && meta.seedHash !== seedHash) {
      await writeVersion(v.slug, pub, { ...meta, seedHash, refreshed: new Date().toISOString() })
    }
  }
}

async function writeVersion(slug, files, meta) {
  await mkdir(hist(slug), { recursive: true })
  for (const f of FILES) await writeFile(join(dir(slug), f), files[f])
  await writeJson(join(dir(slug), 'meta.json'), meta)
}

export async function listVersions() {
  let names = []
  try { names = await readdir(ROOT) } catch { return [] }
  const out = []
  for (const n of names.filter(validSlug)) {
    if (!(await exists(n))) continue
    const meta = await readJson(join(dir(n), 'meta.json'), {})
    const st = await stat(join(dir(n), 'index.html'))
    out.push({ slug: n, from: meta.from || '', created: meta.created || '', edited: Boolean(meta.edited), updated: st.mtime.toISOString() })
  }
  return out.sort((a, b) => num(a.slug) - num(b.slug))
}

export async function readVersionFile(slug, name) {
  if (!validSlug(slug) || !FILES.includes(name)) throw new Error('Not found')
  return readFile(join(dir(slug), name), 'utf8')
}

export async function writeVersionFile(slug, name, content) {
  if (!validSlug(slug) || !FILES.includes(name)) throw new Error('Not found')
  await writeFile(join(dir(slug), name), content)
  changes.emit('change', slug)
  const metaFile = join(dir(slug), 'meta.json')
  const meta = await readJson(metaFile, {})
  if (!meta.edited) await writeJson(metaFile, { ...meta, edited: true })
}

async function currentFiles(slug) {
  const out = {}
  for (const f of FILES) out[f] = await readVersionFile(slug, f)
  return out
}

async function stacks(slug) {
  return { undo: await readJson(join(hist(slug), 'undo.json'), []), redo: await readJson(join(hist(slug), 'redo.json'), []) }
}
async function saveStacks(slug, s) {
  await mkdir(hist(slug), { recursive: true })
  await writeJson(join(hist(slug), 'undo.json'), s.undo)
  await writeJson(join(hist(slug), 'redo.json'), s.redo)
}
async function storeSnapshot(slug, label, files) {
  const id = Date.now().toString(36) + randomUUID().slice(0, 6)
  await writeJson(join(hist(slug), id + '.json'), { label, at: new Date().toISOString(), files })
  return { id, label }
}
async function dropSnapshots(slug, entries) {
  for (const e of entries) await rm(join(hist(slug), e.id + '.json'), { force: true })
}

/** Save the current files before a change, so it can be undone. Clears the redo stack. */
export async function snapshot(slug, label) {
  const s = await stacks(slug)
  s.undo.push(await storeSnapshot(slug, label, await currentFiles(slug)))
  await dropSnapshots(slug, s.redo)
  s.redo = []
  if (s.undo.length > MAX_HISTORY) await dropSnapshots(slug, s.undo.splice(0, s.undo.length - MAX_HISTORY))
  await saveStacks(slug, s)
}

async function step(slug, from, to) {
  const s = await stacks(slug)
  const entry = s[from].pop()
  if (!entry) return null
  const snap = await readJson(join(hist(slug), entry.id + '.json'), null)
  if (!snap) { await saveStacks(slug, s); return null }
  s[to].push(await storeSnapshot(slug, entry.label, await currentFiles(slug)))
  for (const f of FILES) if (typeof snap.files[f] === 'string') await writeVersionFile(slug, f, snap.files[f])
  await rm(join(hist(slug), entry.id + '.json'), { force: true })
  await saveStacks(slug, s)
  return entry.label
}
export const undo = slug => step(slug, 'undo', 'redo')
export const redo = slug => step(slug, 'redo', 'undo')

export async function historyInfo(slug) {
  const s = await stacks(slug)
  return { undo: s.undo.length, redo: s.redo.length, nextUndo: s.undo.at(-1)?.label || '', nextRedo: s.redo.at(-1)?.label || '' }
}

/** Copy a version into the next free hpanelN and return the new slug. */
export async function saveAsNew(fromSlug) {
  const list = await listVersions()
  const next = 'hpanel' + (Math.max(0, ...list.map(v => num(v.slug))) + 1)
  if (!validSlug(next)) throw new Error('Too many versions')
  await writeVersion(next, await currentFiles(fromSlug), { created: new Date().toISOString(), from: fromSlug, seedHash: '', edited: true })
  return next
}
