import type { EngineInterface, Register } from 'claude-code'

export type Tier = 'haiku' | 'sonnet' | 'opus'
type Mode = { kind: 'auto' } | { kind: 'off' } | { kind: 'pin'; tier: Tier }
type Entry = { at: string; tier: Tier; why: string; text: string }

const RANK: Record<Tier, number> = { haiku: 0, sonnet: 1, opus: 2 }
const MODEL: Record<Tier, string> = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
}
// 이만큼 쉬면 prompt cache 가 식어서, 모델을 내려도 다시 읽는 손해가 없다
const COLD_MS = 5 * 60_000
// 가벼운 판정이 이만큼 이어져야 내린다 (캐시를 자주 버리지 않으려고)
const DOWN_AFTER = 2

const BIG = /설계|구조|아키텍처|리팩터|마이그레이션|전체|기획|계획|원인|디버그|분석/
const WORK = /고쳐|수정|만들|구현|추가|짜 ?줘|바꿔|작성|테스트|커밋|```/
const OVERRIDE = /^!(opus|sonnet|haiku)\b\s*/

// shortcut: 규칙만으로 판정, /route 기록에서 !지정이 자주 보이면 haiku 분류를 붙인다
export function classify(text: string): [Tier, string] {
  if (BIG.test(text)) return ['opus', '큰 작업 낱말']
  if (text.length > 1500) return ['opus', '긴 글']
  if (text.length < 80 && !WORK.test(text)) return ['haiku', '짧은 질문']
  return ['sonnet', '보통 작업']
}

// 올리기는 바로, 내리기는 가벼운 판정이 이어지거나 캐시가 식었을 때만
export function decide(
  cur: Tier | undefined,
  want: Tier,
  streak: number,
  idleMs: number,
): { tier: Tier; streak: number } {
  if (cur === undefined || RANK[want] >= RANK[cur]) return { tier: want, streak: 0 }
  if (idleMs > COLD_MS || streak + 1 >= DOWN_AFTER) return { tier: want, streak: 0 }
  return { tier: cur, streak: streak + 1 }
}

async function getMode($: EngineInterface): Promise<Mode> {
  return ((await $.store.get('mode')) as Mode | undefined) ?? { kind: 'auto' }
}

export const register: Register = on => {
  // 다시 로드되면 처음부터: 첫 턴은 판정대로 간다
  let current: Tier | undefined
  let streak = 0
  let lastEnd = 0
  let seenModel: string | undefined
  let paused = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'route',
      description: '자동 모델 선택: 상태·기록 보기, on | off | pin <opus|sonnet|haiku>',
    })
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // 사람이 친 메시지만 판정한다 (데스크톱 앱은 sdk 로 들어온다)
    const isTyped = ['composer', 'bridge', 'sdk'].includes(e.origin.kind)
    if (e.command || e.isMeta || !isTyped) return next(e)

    // 루지가 앱에서 직접 모델을 바꿨으면 그 선택을 존중해 쉰다
    const model = await $.session.model()
    if (seenModel !== undefined && model !== seenModel && !paused) {
      paused = true
      $.ui.toast('앱에서 모델을 바꿔서 자동 선택을 쉬어요. /route on 으로 다시 켜요')
    }
    seenModel = model

    const mode = await getMode($)
    if (paused || mode.kind === 'off') {
      current = undefined
      $.ui.status(undefined)
      return next(e)
    }

    const forced = OVERRIDE.exec(e.text)
    const text = forced ? e.text.slice(forced[0].length) : e.text
    const before = current
    let label: string
    let why: string

    if (forced) {
      current = forced[1] as Tier
      label = '지정'
      why = '!지정'
    } else if (mode.kind === 'pin') {
      current = mode.tier
      label = '고정'
      why = '고정'
    } else {
      const [want, reason] = classify(text)
      const idle = lastEnd === 0 ? 0 : (await $.clock.now()) - lastEnd
      const d = decide(current, want, streak, idle)
      current = d.tier
      streak = d.streak
      label = '자동'
      why = d.tier === want ? reason : `${reason}, 아직 ${d.tier} 유지`
    }

    $.ui.status(`🤖 ${current}로 답함 (${label}) · 설정은 ${await $.session.model()}`)
    if (before !== undefined && before !== current) {
      $.ui.toast(`${why} → ${current}로 ${RANK[current] > RANK[before] ? '올렸어요' : '내렸어요'}`)
    }

    const log = ((await $.store.get('log')) as Entry[] | undefined) ?? []
    const entry: Entry = { at: new Date(await $.clock.now()).toISOString(), tier: current, why, text: text.slice(0, 40) }
    await $.store.set('log', [...log, entry].slice(-100))

    return next(forced ? { ...e, text } : e)
  }).catch(($, e, next) => next(e)) // 판정이 실패해도 메시지는 그대로 나간다

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) lastEnd = await $.clock.now()
    return next(e)
  })

  // 메인 대화 요청만 바꾸고, 서브에이전트는 원래 모델 그대로
  on('turn.step', async function* ($, e, next) {
    if (e.agentId || current === undefined) return yield* next(e)
    return yield* next({ ...e, model: MODEL[current] })
  })

  on('command.run', { command: 'route' }, async ($, e) => {
    const [arg, tier] = e.args.trim().split(/\s+/)

    if (arg === 'on' || arg === 'unpin') {
      paused = false
      await $.store.set('mode', { kind: 'auto' })
      return { text: '자동 모델 선택을 켰어요. 다음 메시지부터 적용돼요.' }
    }
    if (arg === 'off') {
      await $.store.set('mode', { kind: 'off' })
      current = undefined
      $.ui.status(undefined)
      return { text: '자동 모델 선택을 껐어요. 앱에서 고른 모델 그대로 가요.' }
    }
    if (arg === 'pin') {
      if (tier !== 'opus' && tier !== 'sonnet' && tier !== 'haiku') {
        return { text: '/route pin opus | sonnet | haiku 중 하나로 써 주세요.' }
      }
      paused = false
      await $.store.set('mode', { kind: 'pin', tier })
      return { text: `${tier}로 고정했어요. /route on 으로 자동으로 돌아가요.` }
    }

    const mode = await getMode($)
    const state = paused ? '쉬는 중 (앱에서 모델을 바꿈)'
      : mode.kind === 'off' ? '꺼짐'
      : mode.kind === 'pin' ? `${mode.tier} 고정`
      : '자동'
    const log = ((await $.store.get('log')) as Entry[] | undefined) ?? []
    const rows = log.slice(-10).map(x => `${x.at.slice(5, 16).replace('T', ' ')}  ${x.tier.padEnd(6)} ${x.why} · ${x.text}`)
    return { text: [`상태: ${state}${current ? ` · 지금 ${current}` : ''}`, ...rows].join('\n') }
  })
}
