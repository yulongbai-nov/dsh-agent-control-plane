/**
 * WebM → animated GIF evidence conversion.
 *
 * Discovery order for a video tool:
 *   1. `$DSH_E2E_FFMPEG` (explicit override, e.g. a system ffmpeg in CI)
 *   2. the ffmpeg bundled with Playwright under the ms-playwright cache
 *      (`~/Library/Caches/ms-playwright/ffmpeg-<rev>/ffmpeg-mac` on macOS,
 *      `ffmpeg-linux` / `ffmpeg-win64.exe` elsewhere)
 *   3. a `ffmpeg` found on PATH
 *
 * The Playwright build is intentionally minimal (`--disable-everything`): it can
 * decode its own VP9/WebM recordings and encode PNG frames, but it has **no GIF
 * encoder and no palette filters**. So:
 *   - if the discovered ffmpeg can encode GIF, convert in one command;
 *   - otherwise decode PNG frames with the discovered ffmpeg and assemble the
 *     animation with the pure-JS `gifenc` package (no native deps, CI-safe);
 *   - if no ffmpeg exists at all, report "gif unavailable" and keep the WebM.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'

const MAX_FRAMES = 60
const FRAME_WIDTH = 480
const NOMINAL_FPS = 25 // Chromium screencast cadence; only used for GIF frame delay

/** Run a tool and return stdout, or null on failure. */
function run(file, args, timeout = 120_000) {
  const res = spawnSync(file, args, { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 })
  if (res.error || res.status !== 0) return null
  return `${res.stdout ?? ''}${res.stderr ?? ''}`
}

/** Locate a usable ffmpeg binary, preferring Playwright's bundled build. */
export function findFfmpeg() {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const candidates = []
  if (process.env.DSH_E2E_FFMPEG) candidates.push(process.env.DSH_E2E_FFMPEG)

  const cacheRoots = []
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) cacheRoots.push(process.env.PLAYWRIGHT_BROWSERS_PATH)
  if (process.platform === 'darwin') cacheRoots.push(join(homedir(), 'Library/Caches/ms-playwright'))
  else if (process.platform === 'win32') cacheRoots.push(join(process.env.LOCALAPPDATA || join(homedir(), 'AppData/Local'), 'ms-playwright'))
  else cacheRoots.push(join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'ms-playwright'))

  for (const root of cacheRoots) {
    if (!existsSync(root)) continue
    for (const dir of readdirSync(root).filter((d) => d.startsWith('ffmpeg-')).sort().reverse()) {
      const base = join(root, dir)
      for (const name of ['ffmpeg-mac', 'ffmpeg-mac-arm64', 'ffmpeg-linux', 'ffmpeg-win64.exe', exe]) {
        const p = join(base, name)
        if (existsSync(p) && statSync(p).isFile()) candidates.push(p)
      }
    }
  }

  const onPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' })
  if (onPath.status === 0) {
    const found = onPath.stdout.trim().split(/\r?\n/)[0]
    if (found) candidates.push(found)
  }

  return candidates.find((p) => existsSync(p)) ?? null
}

/** Does this ffmpeg build have a GIF encoder and the palette filters? */
export function supportsGif(ffmpeg) {
  const encoders = run(ffmpeg, ['-hide_banner', '-encoders'])
  const filters = run(ffmpeg, ['-hide_banner', '-filters'])
  return Boolean(encoders && /\bgif\b/.test(encoders) && filters && /palettegen/.test(filters) && /paletteuse/.test(filters))
}

/** Extract downscaled PNG frames from a WebM recording. Returns frame file paths. */
export function extractPngFrames(ffmpeg, webmPath, framesDir) {
  mkdirSync(framesDir, { recursive: true })
  const out = run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', webmPath,
    '-vf', `scale=${FRAME_WIDTH}:-2:flags=lanczos`,
    '-frames:v', String(MAX_FRAMES * 3),
    '-f', 'image2', join(framesDir, 'frame-%05d.png'),
  ])
  if (out === null) throw new Error('ffmpeg failed to decode the WebM recording')
  return readdirSync(framesDir).filter((f) => f.endsWith('.png')).sort().map((f) => join(framesDir, f))
}

/** One-command conversion when the ffmpeg build supports GIF. */
function convertWithFfmpeg(ffmpeg, webmPath, gifPath) {
  const filter = `fps=${NOMINAL_FPS},scale=${FRAME_WIDTH}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`
  const out = run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', webmPath, '-vf', filter, '-loop', '0', gifPath])
  if (out === null || !existsSync(gifPath)) throw new Error('ffmpeg GIF conversion failed')
  return { mode: 'ffmpeg', frames: null }
}

// --- minimal PNG reader (8-bit RGB/RGBA, non-interlaced: what ffmpeg writes) ---

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG (depth=${bitDepth} color=${colorType} interlace=${interlace})`)
  }
  const bpp = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const out = new Uint8Array(stride * height)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const cur = new Uint8Array(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride))
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0
      const b = prev[x]
      const c = x >= bpp ? prev[x - bpp] : 0
      let v = cur[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[x] = v & 0xff
    }
    out.set(cur, y * stride)
    prev = cur
  }
  if (bpp === 4) return { width, height, rgba: out }
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0, j = 0; i < out.length; i += 3, j += 4) {
    rgba[j] = out[i]
    rgba[j + 1] = out[i + 1]
    rgba[j + 2] = out[i + 2]
    rgba[j + 3] = 255
  }
  return { width, height, rgba }
}

/** PNG frames → animated GIF with gifenc (pure JS, works on every CI runner). */
async function convertFramesWithJs(framePaths, gifPath) {
  let gifenc
  try {
    gifenc = (await import('gifenc')).default
  } catch {
    throw new Error('gifenc is not installed; run `npm install` in e2e/')
  }
  const { GIFEncoder, quantize, applyPalette } = gifenc
  const step = Math.max(1, Math.ceil(framePaths.length / MAX_FRAMES))
  const gif = GIFEncoder()
  const delay = Math.round(1000 / (NOMINAL_FPS / step))
  let frames = 0
  for (let i = 0; i < framePaths.length; i += step) {
    const { width, height, rgba } = decodePng(readFileSync(framePaths[i]))
    const palette = quantize(rgba, 256)
    const index = applyPalette(rgba, palette)
    gif.writeFrame(index, width, height, frames === 0 ? { palette, delay } : { delay })
    frames++
  }
  gif.finish()
  writeFileSync(gifPath, gif.bytes())
  return { mode: 'playwright-ffmpeg+js', frames }
}

/** Convert a Playwright WebM recording to GIF evidence. Never throws. */
export async function webmToGif(webmPath, gifPath) {
  const result = { gif: null, ok: false, mode: null, frames: null, ffmpeg: null, reason: null, gifBytes: 0 }
  let tmpDir = null
  try {
    const ffmpeg = findFfmpeg()
    result.ffmpeg = ffmpeg
    if (!ffmpeg) {
      result.reason = 'gif 不可用：未找到 ffmpeg（Playwright 缓存与 PATH 都没有），保留 webm'
      return result
    }
    if (supportsGif(ffmpeg)) {
      const conv = convertWithFfmpeg(ffmpeg, webmPath, gifPath)
      Object.assign(result, conv)
    } else {
      tmpDir = mkdtempSync(join(tmpdir(), 'dsh-e2e-frames-'))
      const framePaths = extractPngFrames(ffmpeg, webmPath, tmpDir)
      if (!framePaths.length) throw new Error('ffmpeg produced no frames')
      const conv = await convertFramesWithJs(framePaths, gifPath)
      Object.assign(result, conv)
    }
    if (!existsSync(gifPath)) throw new Error('GIF file was not produced')
    result.ok = true
    result.gif = gifPath
    result.gifBytes = statSync(gifPath).size
    return result
  } catch (err) {
    result.ok = false
    result.gif = existsSync(gifPath) ? gifPath : null
    result.reason = `gif 不可用：${err instanceof Error ? err.message : String(err)}（保留 webm）`
    return result
  } finally {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  }
}
