import type { VodDeath, VodFight, WowClass } from '../core/types'
import {
  WclAuthError,
  WclRequestError,
  type WclClient,
  type WclReport,
  type WclTokenSource,
} from './client'

const FIGHTS_QUERY = `
query Fights($code: String!) {
  reportData {
    report(code: $code) {
      title
      startTime
      fights(killType: Encounters) {
        id
        name
        encounterID
        difficulty
        kill
        bossPercentage
        startTime
        endTime
      }
    }
  }
}`

const DEATHS_QUERY = `
query Deaths($code: String!, $fightId: Int!, $start: Float!, $end: Float!) {
  reportData {
    report(code: $code) {
      masterData {
        actors(type: "Player") { id name subType }
      }
      events(
        fightIDs: [$fightId]
        dataType: Deaths
        startTime: $start
        endTime: $end
        limit: 500
      ) {
        data
      }
    }
  }
}`

const DIFFICULTY_NAMES: Record<number, string> = {
  1: 'LFR',
  3: 'Normal',
  4: 'Heroic',
  5: 'Mythic',
}

/** WCL reports class as a display name; the model uses kebab-case slugs. */
function toWowClass(subType: string | undefined): WowClass | undefined {
  if (!subType) return undefined
  const slug = subType.toLowerCase().replace(/\s+/g, '-')
  const known: WowClass[] = [
    'death-knight',
    'demon-hunter',
    'druid',
    'evoker',
    'hunter',
    'mage',
    'monk',
    'paladin',
    'priest',
    'rogue',
    'shaman',
    'warlock',
    'warrior',
  ]
  return known.find((c) => c === slug)
}

interface RawFight {
  id: number
  name: string
  encounterID: number
  difficulty: number | null
  kill: boolean | null
  bossPercentage: number | null
  startTime: number
  endTime: number
}

interface RawActor {
  id: number
  name: string
  subType: string
}

/**
 * Talks to the WCL v2 GraphQL API.
 *
 * Endpoint and credential are both injected, which is what makes this work
 * unchanged for either auth approach: point it at WCL with a user's token, or at
 * a proxy with no token at all.
 */
export class WclGraphQlClient implements WclClient {
  #endpoint: string
  #tokens: WclTokenSource

  constructor(endpoint: string, tokens: WclTokenSource) {
    this.#endpoint = endpoint
    this.#tokens = tokens
  }

  async #query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const token = await this.#tokens.getToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`

    let response: Response
    try {
      response = await fetch(this.#endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
      })
    } catch {
      // A CORS rejection is indistinguishable from an offline failure here, and
      // CORS is the likely one when someone points this at the wrong endpoint.
      throw new WclRequestError(
        'Could not reach Warcraft Logs. Check the endpoint, your connection, ' +
          'and whether the request was blocked by CORS.',
      )
    }

    if (response.status === 401 || response.status === 403) {
      throw new WclAuthError(
        'Warcraft Logs rejected the credential. If you pasted a token it has ' +
          'most likely expired — they are short-lived and need re-pasting.',
      )
    }
    if (response.status === 404) {
      // The GraphQL endpoint answers 404 rather than 401 when it will not serve
      // the request at all. A missing *report* comes back as a null field in a
      // 200, not as an HTTP 404 — so this is about the credential or the
      // endpoint, and saying "404" alone sends people hunting the wrong thing.
      throw new WclAuthError(
        'Warcraft Logs would not serve that request (HTTP 404). That usually ' +
          'means the token is missing, expired, or lacks access — not that the ' +
          'report is missing.',
      )
    }
    if (!response.ok) {
      throw new WclRequestError(`Warcraft Logs returned HTTP ${response.status}.`)
    }

    const body = (await response.json()) as {
      data?: T
      errors?: { message: string }[]
    }
    if (body.errors?.length) {
      throw new WclRequestError(body.errors.map((e) => e.message).join('; '))
    }
    if (!body.data) throw new WclRequestError('Warcraft Logs returned no data.')
    return body.data
  }

  async listFights(reportCode: string): Promise<WclReport> {
    const data = await this.#query<{
      reportData: {
        report: { title: string; startTime: number; fights: RawFight[] } | null
      }
    }>(FIGHTS_QUERY, { code: reportCode })

    const report = data.reportData.report
    if (!report) {
      throw new WclRequestError(
        `No report found with code "${reportCode}". Private reports are only ` +
          'visible to credentials that can see them.',
      )
    }

    // WCL numbers pulls per encounter, not per report, so it has to be derived.
    const seen = new Map<number, number>()
    const fights: VodFight[] = report.fights.map((raw) => {
      const pullNumber = (seen.get(raw.encounterID) ?? 0) + 1
      seen.set(raw.encounterID, pullNumber)
      return {
        reportCode,
        fightId: raw.id,
        encounterId: raw.encounterID,
        encounterName: raw.name,
        pullNumber,
        difficulty: raw.difficulty ?? undefined,
        difficultyName:
          raw.difficulty != null ? DIFFICULTY_NAMES[raw.difficulty] : undefined,
        kill: raw.kill ?? undefined,
        bossPercentage: raw.bossPercentage ?? undefined,
        durationMs: raw.endTime - raw.startTime,
        startTime: raw.startTime,
        endTime: raw.endTime,
      }
    })

    return {
      code: reportCode,
      title: report.title,
      startTime: report.startTime,
      fights,
    }
  }

  async listDeaths(fight: VodFight): Promise<VodDeath[]> {
    const data = await this.#query<{
      reportData: {
        report: {
          masterData: { actors: RawActor[] } | null
          events: { data: unknown } | null
        } | null
      }
    }>(DEATHS_QUERY, {
      code: fight.reportCode,
      fightId: fight.fightId,
      start: fight.startTime,
      end: fight.endTime,
    })

    const report = data.reportData.report
    if (!report) return []

    const actors = new Map<number, RawActor>()
    for (const actor of report.masterData?.actors ?? []) actors.set(actor.id, actor)

    // `events.data` is untyped JSON on WCL's side and its shape varies by event
    // type and game version, so every field is read defensively.
    const raw = report.events?.data
    if (!Array.isArray(raw)) return []

    const deaths: VodDeath[] = []
    for (const [index, event] of raw.entries()) {
      if (typeof event !== 'object' || event === null) continue
      const record = event as Record<string, unknown>

      const timestamp = record.timestamp
      const targetId = record.targetID
      if (typeof timestamp !== 'number') continue

      const actor = typeof targetId === 'number' ? actors.get(targetId) : undefined
      const killingBlow = record.killingBlow
      const abilityName =
        typeof killingBlow === 'object' && killingBlow !== null
          ? ((killingBlow as Record<string, unknown>).name as string | undefined)
          : undefined

      deaths.push({
        id: `${fight.reportCode}-${fight.fightId}-${index}`,
        // Events are report-relative; the timeline is pull-relative.
        atMs: timestamp - fight.startTime,
        playerName: actor?.name ?? 'Unknown',
        wowClass: toWowClass(actor?.subType),
        killingBlow: abilityName,
        sourceActorId: typeof targetId === 'number' ? targetId : undefined,
      })
    }

    return deaths.sort((a, b) => a.atMs - b.atMs)
  }
}
