import type { On, RenderPropsOf, SessionContextUsage, SessionMessage } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { boardLine, cellWidth, percentOf, toolName, UNKNOWN } from '../hooks/format'

const PLUGIN = 'hello-workboard'
const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

function band(
  bodyColumns: number,
  overrides: Partial<RenderPropsOf['AbovePrompt']> = {},
): RenderPropsOf['AbovePrompt'] {
  return {
    hasSurvey: false,
    isWorking: true,
    maxRows: 10,
    bodyColumns,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
    ...overrides,
  }
}

async function drawnLine($: Engine, surface: Surface, bodyColumns = 150): Promise<string> {
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'AbovePrompt',
    props: band(bodyColumns),
    viewport: { columns: bodyColumns + 5, rows: 40 },
  })
  const found = await ui.find({ type: 'Text' })
  await ui.unmount()

  return found?.text ?? ''
}

// 아래의 on(...) 훅들은 엔진 자리에 선다. 플러그인이 넘긴 입력을 그대로 받아 답한다.
function engineBeneath(on: On, context: () => SessionContextUsage) {
  on('session.usage', () => ({ value: { startedAt: 0, context: context(), rateLimits: [] } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
}

function turnsBeneath(on: On) {
  on('turn.complete', (_$, e) => ({ text: e.answer }))
}

function startSession($: Engine) {
  return $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
}

function completeTurn($: Engine, agentId?: string) {
  return $.turn.complete({
    answer: '끝났습니다.',
    durationMs: 1200,
    isAborted: false,
    turnId: `turn-${agentId ?? 'main'}`,
    reason: 'answer',
    ...(agentId === undefined ? {} : { agentId }),
  })
}

const NO_FIGURES: SessionContextUsage = { window: 200_000 }

describe('표시', () => {
  test('값이 없으면 추측하지 않고 확인 불가로 그린다', async ($, on) => {
    engineBeneath(on, () => NO_FIGURES)
    await startSession($)

    for (const surface of SURFACES) {
      expect(await drawnLine($, surface)).toBe(
        `작업판 | 완료 턴 0 | 마지막 도구 ${UNKNOWN} | 컨텍스트 ${UNKNOWN}`,
      )
    }
  })

  test('사용량 조회가 실패해도 상태판은 확인 불가로 그린다', async ($, on) => {
    on('session.usage', () => {
      throw new Error('usage unavailable')
    })
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    const started = await startSession($)

    expect(started).toEqual({ cwd: '/work' })
    expect(await drawnLine($, 'terminal')).toContain(`컨텍스트 ${UNKNOWN}`)
  })

  test('세션 시작 때 엔진이 보고한 사용률을 그린다', async ($, on) => {
    engineBeneath(on, () => ({ window: 200_000, tokens: 84_000, percent: 42 }))
    await startSession($)

    for (const surface of SURFACES) {
      expect(await drawnLine($, surface)).toContain('컨텍스트 42%')
    }
  })

  test('설문이 띠를 차지하면 엔진 쪽 그림에 양보한다', async ($, on) => {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)

      return <Text>engine-band</Text>
    })

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'AbovePrompt',
        props: band(120, { hasSurvey: true }),
      })
      expect((await ui.find({ type: 'Text' }))?.text).toBe('engine-band')
      await ui.unmount()
    }
  })

  test('그려진 띠는 새 값을 받으면 다시 그려진다', async ($, on) => {
    engineBeneath(on, () => NO_FIGURES)
    turnsBeneath(on)
    on('tool.call', () => ({ result: 'ok' }))
    await startSession($)

    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'AbovePrompt',
      props: band(150),
    })
    await $.tool.call({ tool: 'Read', tool_use_id: 'toolu_live', file_path: '/work/a.txt' })
    await completeTurn($)

    expect((await ui.find({ type: 'Text' }))?.text).toBe(
      `작업판 | 완료 턴 1 | 마지막 도구 Read | 컨텍스트 ${UNKNOWN}`,
    )
    await ui.unmount()
  })
})

describe('관찰 후 원래 이벤트 진행', () => {
  test('메인 턴만 세고 turn.complete의 입력과 결과를 바꾸지 않는다', async ($, on) => {
    const received: unknown[] = []
    engineBeneath(on, () => NO_FIGURES)
    on('turn.complete', (_$, e) => {
      received.push(e)

      return { text: `engine:${e.answer}` }
    })
    await startSession($)

    const main = await completeTurn($)
    const sub = await completeTurn($, 'agent-1')
    await completeTurn($)

    expect(main).toEqual({ text: 'engine:끝났습니다.' })
    expect(sub).toEqual({ text: 'engine:끝났습니다.' })
    expect(received).toHaveLength(3)
    expect(received[1]).toMatchObject({ agentId: 'agent-1', turnId: 'turn-agent-1' })
    expect(await drawnLine($, 'terminal')).toContain('완료 턴 2')
  })

  test('tool.call은 같은 입력으로 이어지고 결과가 그대로 돌아온다', async ($, on) => {
    const received: unknown[] = []
    engineBeneath(on, () => NO_FIGURES)
    on('tool.call', (_$, e) => {
      received.push(e)

      return { result: { stdout: 'a.txt', stderr: '', interrupted: false } }
    })
    await startSession($)

    const input = { tool: 'Bash', tool_use_id: 'toolu_1', command: 'cat secret.txt' } as const
    const ran = await $.tool.call(input)

    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject(input)
    expect(ran).toMatchObject({ result: { stdout: 'a.txt', stderr: '', interrupted: false } })
    expect(ran.deny).toBeUndefined()
    expect(await drawnLine($, 'terminal')).toContain('마지막 도구 Bash')
  })

  test('아래에서 거절된 도구 호출은 거절 그대로 돌아온다', async ($, on) => {
    engineBeneath(on, () => NO_FIGURES)
    on('tool.call', () => ({ deny: '사람이 거절함' }))
    await startSession($)

    const ran = await $.tool.call({ tool: 'Write', tool_use_id: 'toolu_2', file_path: '/work/x', content: 'x' })

    expect(ran.deny).toContain('사람이 거절함')
    expect(await drawnLine($, 'terminal')).toContain('마지막 도구 Write')
  })

  test('도구 인자는 상태에 남기지 않는다', async ($, on) => {
    const writes: unknown[] = []
    engineBeneath(on, () => NO_FIGURES)
    on('tool.call', () => ({ result: 'ok' }))
    on('state.set', (_$, e, next) => {
      writes.push({ key: e.key, value: e.value })

      return next(e)
    })
    await startSession($)

    await $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_3', command: 'echo TOP-SECRET-ARG' })

    expect(writes).toContainEqual({ key: 'lastTool', value: { name: 'Bash', isSubagent: false } })
    expect(JSON.stringify(writes)).not.toContain('TOP-SECRET-ARG')
  })

  test('서브에이전트의 도구 호출은 넓은 화면에서 표시를 붙인다', async ($, on) => {
    engineBeneath(on, () => NO_FIGURES)
    on('tool.call', () => ({ result: 'ok' }))
    await startSession($)

    // $.tool.call의 타입은 agentId를 받지 않지만, 서브에이전트 루프의 호출은 엔진이 agentId를 붙여 올린다.
    const fromSubagent = { tool: 'Grep', tool_use_id: 'toolu_4', pattern: 'x', agentId: 'agent-7' }
    await $.tool.call(fromSubagent as never)

    expect(await drawnLine($, 'terminal')).toContain('마지막 도구 Grep (서브에이전트)')
  })

  test('session.measure의 사용률을 반영하고 결과를 그대로 돌려준다', async ($, on) => {
    engineBeneath(on, () => NO_FIGURES)
    await startSession($)

    const measured = await $.session.measure({
      context: { window: 200_000, tokens: 130_000, percent: 65 },
      rateLimits: [],
      changed: ['context'],
    })
    expect(measured).toEqual({ changed: ['context'] })
    expect(await drawnLine($, 'terminal')).toContain('컨텍스트 65%')

    await $.session.measure({ context: NO_FIGURES, rateLimits: [], changed: ['context'] })
    expect(await drawnLine($, 'terminal')).toContain(`컨텍스트 ${UNKNOWN}`)
  })

  test('압축 뒤에는 사용률을 다시 읽고 압축 결과를 바꾸지 않는다', async ($, on) => {
    let context: SessionContextUsage = { window: 200_000, tokens: 170_000, percent: 85 }
    const summary: SessionMessage[] = [{ role: 'user', text: '지금까지의 요약', toolUses: [] }]
    engineBeneath(on, () => context)
    on('session.compact', () => ({ messages: summary }))
    await startSession($)
    expect(await drawnLine($, 'terminal')).toContain('컨텍스트 85%')

    context = NO_FIGURES
    const compacted = await $.session.compact({
      trigger: 'manual',
      messages: [{ role: 'user', text: '긴 대화', toolUses: [] }],
    })

    expect(compacted).toEqual({ messages: summary })
    expect(await drawnLine($, 'terminal')).toContain(`컨텍스트 ${UNKNOWN}`)
  })

  test('건너뛴 압축은 결과를 그대로 돌려주고 사용률을 다시 읽지 않는다', async ($, on) => {
    let context: SessionContextUsage = { window: 200_000, tokens: 170_000, percent: 85 }
    engineBeneath(on, () => context)
    on('session.compact', () => ({ skip: '다른 플러그인이 건너뜀' }))
    await startSession($)

    context = NO_FIGURES
    const compacted = await $.session.compact({
      trigger: 'auto',
      messages: [{ role: 'user', text: '긴 대화', toolUses: [] }],
    })

    expect(compacted).toEqual({ skip: '다른 플러그인이 건너뜀' })
    expect(await drawnLine($, 'terminal')).toContain('컨텍스트 85%')
  })

  test('/clear 뒤에는 처음 상태로 돌아간다', async ($, on) => {
    engineBeneath(on, () => ({ window: 200_000, tokens: 20_000, percent: 10 }))
    turnsBeneath(on)
    on('tool.call', () => ({ result: 'ok' }))
    await startSession($)
    await $.tool.call({ tool: 'Glob', tool_use_id: 'toolu_5', pattern: '*.md' })
    await completeTurn($)

    const ended = await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })

    expect(ended).toEqual({ sessionId: 's-1' })
    expect(await drawnLine($, 'terminal')).toBe(
      `작업판 | 완료 턴 0 | 마지막 도구 ${UNKNOWN} | 컨텍스트 ${UNKNOWN}`,
    )
  })
})

describe('좁은 화면', () => {
  const busy = {
    turns: 128,
    lastTool: { name: 'mcp__claude_ai_Claude_Docs__batch', isSubagent: true },
    contextPercent: 87,
  }

  test('어떤 폭에서도 한 줄이 주어진 칸을 넘지 않는다', () => {
    for (const columns of [200, 90, 60, 45, 36, 30, 24, 16, 10, 5, 3, 1, 0]) {
      const line = boardLine(busy, columns)
      expect(cellWidth(line) <= columns, `${columns}칸: "${line}"`).toBe(true)
    }
  })

  test('폭이 줄면 짧은 표기로 바꾸고, 긴 도구 이름부터 자른다', () => {
    expect(boardLine(busy, 200)).toBe(
      '작업판 | 완료 턴 128 | 마지막 도구 mcp__claude_ai_Claude_Docs__batch (서브에이전트) | 컨텍스트 87%',
    )
    expect(boardLine(busy, 64)).toBe('턴 128 | 도구 mcp__claude_ai_Claude_Docs__batch | 컨텍스트 87%')
    expect(boardLine(busy, 60)).toBe('턴 128 도구 mcp__claude_ai_Claude_Docs__batch 컨텍스트 87%')
    expect(boardLine(busy, 30)).toBe('턴 128 도구 mc... 컨텍스트 87%')
  })

  test('그려진 띠도 bodyColumns 안에 들어간다', async ($, on) => {
    engineBeneath(on, () => ({ window: 200_000, tokens: 90_000, percent: 45 }))
    on('tool.call', () => ({ result: 'ok' }))
    await startSession($)
    await $.tool.call({ tool: 'WebFetch', tool_use_id: 'toolu_6', url: 'https://example.com', prompt: 'x' })

    for (const surface of SURFACES) {
      for (const columns of [120, 40, 20, 8]) {
        const line = await drawnLine($, surface, columns)
        expect(cellWidth(line) <= columns, `${surface} ${columns}칸: "${line}"`).toBe(true)
      }
    }
  })
})

describe('보조 함수', () => {
  test('한글은 두 칸, 영문은 한 칸으로 센다', () => {
    expect(cellWidth('한글')).toBe(4)
    expect(cellWidth('Bash')).toBe(4)
    expect(cellWidth('턴 3')).toBe(4)
  })

  test('엔진이 준 사용률만 쓰고 없으면 null', () => {
    expect(percentOf({ window: 200_000, tokens: 1000, percent: 0.4 })).toBe(0)
    expect(percentOf({ window: 200_000, tokens: 84_000 })).toBeNull()
    expect(percentOf(undefined)).toBeNull()
  })

  test('도구 이름의 제어 문자를 지운다', () => {
    expect(toolName('Ba\u001bsh\n')).toBe('Bash')
  })
})
