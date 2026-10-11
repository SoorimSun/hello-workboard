// 상태판 한 줄을 만드는 순수 함수들. 엔진을 부르지 않고 값과 폭만으로 계산한다.
import type { SessionContextUsage } from 'claude-code'

import type { LastTool } from '../types'

export const UNKNOWN = '확인 불가'

export type BoardValues = {
  turns: number
  lastTool: LastTool | null
  contextPercent: number | null
}

type Level = {
  lead: string
  turns: string
  tool: string
  context: string
  gap: string
  marksSubagent: boolean
}

// 넓은 것부터 차례로 시도한다. 가장 좁은 단계로도 넘치면 도구 이름을, 그다음 줄 끝을 자른다.
const NARROWEST: Level = {
  lead: '',
  turns: '턴 ',
  tool: '도구 ',
  context: '컨텍스트 ',
  gap: ' ',
  marksSubagent: false,
}
const LEVELS: readonly Level[] = [
  {
    lead: '작업판 | ',
    turns: '완료 턴 ',
    tool: '마지막 도구 ',
    context: '컨텍스트 ',
    gap: ' | ',
    marksSubagent: true,
  },
  {
    lead: '',
    turns: '완료 턴 ',
    tool: '마지막 도구 ',
    context: '컨텍스트 ',
    gap: ' | ',
    marksSubagent: true,
  },
  { ...NARROWEST, gap: ' | ' },
  NARROWEST,
]

const ELLIPSIS = '...'
const MIN_TOOL_COLUMNS = 4
const MAX_TOOL_NAME = 80

// 터미널에서 두 칸을 차지하는 문자 범위(한글, CJK, 전각, 그림 문자).
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
]

function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0
  const isControl = code < 0x20 || (code >= 0x7f && code < 0xa0)
  const isZeroWidth =
    (code >= 0x300 && code <= 0x36f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0xfe00 && code <= 0xfe0f)

  if (isControl || isZeroWidth) {
    return 0
  }

  return WIDE.some(([low, high]) => code >= low && code <= high) ? 2 : 1
}

/** 문자열이 터미널에서 차지하는 칸 수. */
export function cellWidth(text: string): number {
  let width = 0
  for (const char of text) {
    width += charWidth(char)
  }

  return width
}

/** 칸 수에 맞게 자른다. 넉넉하면 끝에 '...'를 붙인다. */
export function truncate(text: string, columns: number): string {
  if (cellWidth(text) <= columns) {
    return text
  }
  if (columns <= 0) {
    return ''
  }

  const mark = columns > ELLIPSIS.length ? ELLIPSIS : ''
  const room = columns - mark.length
  let kept = ''
  let used = 0
  for (const char of text) {
    const width = charWidth(char)
    if (used + width > room) {
      break
    }
    kept += char
    used += width
  }

  return kept + mark
}

/** 도구 이름에서 제어 문자를 지우고 길이를 묶는다. */
export function toolName(raw: string): string {
  const name = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()

  return name.length > MAX_TOOL_NAME ? name.slice(0, MAX_TOOL_NAME) : name
}

/** 엔진이 보고한 사용률만 쓴다. 없거나 숫자가 아니면 null(추측하지 않는다). */
export function percentOf(context: SessionContextUsage | undefined): number | null {
  const percent = context?.percent

  return typeof percent === 'number' && Number.isFinite(percent) && percent >= 0
    ? Math.round(percent)
    : null
}

function toolText(level: Level, tool: LastTool | null): string {
  if (tool === null || tool.name === '') {
    return UNKNOWN
  }

  return level.marksSubagent && tool.isSubagent ? `${tool.name} (서브에이전트)` : tool.name
}

function compose(level: Level, values: BoardValues, tool: string): string {
  const context = values.contextPercent === null ? UNKNOWN : `${values.contextPercent}%`

  return (
    level.lead +
    [
      `${level.turns}${values.turns}`,
      `${level.tool}${tool}`,
      `${level.context}${context}`,
    ].join(level.gap)
  )
}

/** `columns` 칸 안에 들어가는 상태판 한 줄. */
export function boardLine(values: BoardValues, columns: number): string {
  const widest = LEVELS[0] ?? NARROWEST
  if (!Number.isFinite(columns)) {
    return compose(widest, values, toolText(widest, values.lastTool))
  }

  const width = Math.max(0, Math.floor(columns))
  for (const level of LEVELS) {
    const line = compose(level, values, toolText(level, values.lastTool))
    if (cellWidth(line) <= width) {
      return line
    }
  }

  const tool = toolText(NARROWEST, values.lastTool)
  const room = width - cellWidth(compose(NARROWEST, values, ''))
  if (room >= MIN_TOOL_COLUMNS) {
    return compose(NARROWEST, values, truncate(tool, room))
  }

  return truncate(compose(NARROWEST, values, tool), width)
}
