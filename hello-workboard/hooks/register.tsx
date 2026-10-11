import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LastTool } from '../types'
import { boardLine, percentOf, toolName } from './format'

const turns = atom({ plugin: 'hello-workboard', key: 'turns' } as const, 0)
const lastTool = atom({ plugin: 'hello-workboard', key: 'lastTool' } as const, null)
const contextPercent = atom(
  { plugin: 'hello-workboard', key: 'contextPercent' } as const,
  null,
)

// 기록이 실패해도 상태판만 덜 정확해질 뿐, 관찰하던 이벤트는 그대로 이어져야 한다.
async function quietly(work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch {
    // 아무것도 하지 않는다.
  }
}

// 상태줄과 같은 수치를 읽는다. breakdown을 묻지 않으므로 토큰 계산 요청을 보내지 않는다.
function refreshContext($: EngineInterface): Promise<void> {
  return quietly(async () => {
    const { context } = await $.session.usage()
    await update($, contextPercent, () => percentOf(context))
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await refreshContext($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await quietly(() => update($, turns, count => count + 1))
    }

    return next(e)
  })

  // 관찰 전용: 이름만 기록하고, 같은 입력으로 이어 가며, 결과를 그대로 돌려준다.
  on('tool.call', async ($, e, next) => {
    const tool: LastTool = {
      name: toolName(String(e.tool)),
      isSubagent: e.agentId !== undefined,
    }
    await quietly(() => update($, lastTool, () => tool))

    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    await quietly(() => update($, contextPercent, () => percentOf(e.context)))

    return next(e)
  })

  // 압축 직후에는 다음 응답 전까지 사용률이 비어 있으므로 다시 읽는다.
  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    if (e.agentId === undefined && !('skip' in compacted)) {
      await refreshContext($)
    }

    return compacted
  }).catch(($, e, next) => next(e))

  // /clear는 새 대화를 시작하므로 세 값을 처음 상태로 되돌린다.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await quietly(async () => {
        await update($, turns, () => 0)
        await update($, lastTool, () => null)
        await update($, contextPercent, () => null)
      })
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { hasSurvey, maxRows, bodyColumns } = e.props
    if (hasSurvey || maxRows < 1 || bodyColumns < 1) {
      return next(e)
    }

    const line = boardLine(
      {
        turns: await read($, turns),
        lastTool: await read($, lastTool),
        contextPercent: await read($, contextPercent),
      },
      bodyColumns,
    )
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text dimColor wrap="truncate-end">
          {line}
        </Text>
      </Box>
    )
  })
}
