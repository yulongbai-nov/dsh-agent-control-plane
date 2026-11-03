/**
 * Reusable DSH workflow scripts, loaded from ./templates.
 *
 * Each template is a plain script body for the official `workflow` tool / workflow
 * engine: top-level await, hooks agent/parallel/pipeline/phase/log and `args`,
 * ending with a JSON return value. `meta` follows the official WorkflowMeta schema
 * ({ name, description, whenToUse?, phases: [{ title, detail? }] }).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(readFileSync(join(ROOT, 'templates/manifest.json'), 'utf8'))

export const WORKFLOW_TEMPLATES = manifest.templates.map((entry) => ({
  name: entry.name,
  whenToUse: entry.whenToUse,
  file: entry.file,
  meta: {
    name: entry.name,
    description: entry.whenToUse,
    whenToUse: entry.whenToUse,
    phases: entry.phases.map((title) => ({ title })),
  },
  script: readFileSync(join(ROOT, 'templates', entry.file), 'utf8'),
}))

export function findTemplate(name) {
  return WORKFLOW_TEMPLATES.find((template) => template.name === name)
}

export const HOST_CONTRACT = manifest.hostContract
