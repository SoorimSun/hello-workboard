/**
 * 마지막으로 호출된 도구. 도구 이름과 호출된 루프만 담고, 도구 인자는 담지 않는다.
 */
export type LastTool = {
  name: string
  /** 서브에이전트 루프에서 호출됐으면 true */
  isSubagent: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'hello-workboard': {
      /** Mod가 관찰을 시작한 뒤 끝난 메인 루프 턴 수 */
      turns: number
      /** 아직 관찰한 도구 호출이 없으면 null */
      lastTool: LastTool | null
      /** 엔진이 보고한 컨텍스트 사용률(0~100 정수). 보고된 값이 없으면 null */
      contextPercent: number | null
    }
  }
}
