# hello-workboard

AI가 작업하는 동안 사람이 상태를 바로 확인할 수 있도록, Claude Code 프롬프트 입력창 위에 한국어 한 줄 상태판을 띄우는 Mod입니다.

```
작업판 | 완료 턴 3 | 마지막 도구 Bash | 컨텍스트 42%
```

Claude Code 2.1.296의 Mods API(function hooks)로 작성했습니다. 이 API는 early access여서 버전이 바뀌면 동작이 달라질 수 있습니다.

## 표시하는 값

| 항목 | 출처 | '확인 불가'가 되는 경우 |
| --- | --- | --- |
| 완료 턴 | `turn.complete` 이벤트 중 `agentId`가 없는 것(메인 루프)만 셉니다. 정상 응답, 중단, 거절, 오류처럼 끝난 이유와 관계없이 끝난 턴은 모두 셉니다. 서브에이전트의 턴은 세지 않습니다. | 항상 숫자로 표시합니다. 세는 기준은 아래 '알아 둘 점'을 보세요. |
| 마지막 도구 | `tool.call` 이벤트의 도구 이름입니다. 호출이 시작될 때 기록하므로 지금 실행 중인 도구가 보입니다. 서브에이전트가 부른 도구는 화면이 넓을 때 `(서브에이전트)`를 붙입니다. | 아직 관찰한 도구 호출이 없을 때 |
| 컨텍스트 | 엔진이 보고한 `context.percent`입니다. 상태줄의 `used_percentage`와 같은 값입니다. 세션 시작 시 `$.session.usage()`로 한 번 읽고, 이후에는 메인 턴마다 오는 `session.measure`와 압축 직후에 갱신합니다. | 첫 응답 전, 압축 직후, `/clear` 직후, 조회가 실패했을 때. 토큰 수나 창 크기로 직접 계산하거나 추정하지 않습니다. |

`/clear`로 새 대화를 시작하면 세 값 모두 처음 상태로 돌아갑니다.

### 좁은 화면

엔진이 알려 주는 띠의 폭(`bodyColumns`)에 맞춰 표기를 줄입니다. 한글은 두 칸으로 계산합니다.

| 폭 | 예 |
| --- | --- |
| 넓음 | `작업판 \| 완료 턴 3 \| 마지막 도구 Bash \| 컨텍스트 42%` |
| 보통 | `완료 턴 3 \| 마지막 도구 Bash \| 컨텍스트 42%` |
| 좁음 | `턴 3 \| 도구 Bash \| 컨텍스트 42%` → `턴 3 도구 Bash 컨텍스트 42%` |
| 매우 좁음 | 긴 도구 이름을 먼저 줄이고(`도구 mc...`), 그래도 넘치면 줄 끝을 `...`로 자릅니다. |

설문이 띠를 차지하고 있거나, 띠에 쓸 수 있는 행이나 칸이 없으면 아무것도 그리지 않고 엔진에 양보합니다.

## 지키는 제한

- **도구 호출을 바꾸지 않습니다.** `tool.call` 훅은 이름만 기록한 뒤 받은 입력을 그대로 `next(e)`에 넘기고, 돌아온 결과(허용, 거절, 오류 모두)를 그대로 반환합니다. 기록에 실패해도 호출은 그대로 이어지고, 훅이 실패할 때의 `.catch`도 `next(e)`만 부릅니다. 다른 훅(`turn.complete`, `session.*`)도 입력과 결과를 바꾸지 않습니다.
- **외부 통신, 모델 호출, 외부 프로그램 실행을 하지 않습니다.** 이 Mod가 쓰는 엔진 기능은 `$.session.usage`, `$.state.get`/`set`, `$.ui.resolve` 네 가지뿐입니다(`claude plugin validate` 출력의 `calls:` 줄). `$.session.usage()`는 breakdown 없이 부르므로 토큰 계산 요청도 보내지 않습니다.
- **프로젝트 파일을 수정하지 않습니다.** `$.fs`를 쓰지 않습니다.
- **프롬프트 본문, 파일 내용, 도구 인자를 저장하지 않습니다.** 저장하는 값은 세션 동안 호스트 메모리(`$.state`)에 두는 세 가지뿐입니다. 턴 수(숫자), 마지막 도구(`{ name, isSubagent }`), 컨텍스트 사용률(숫자)입니다. `$.store`를 쓰지 않으므로 세션이 끝나면 아무것도 남지 않습니다. 압축 훅에는 대화 메시지가 입력으로 들어오지만 읽지 않고 그대로 넘깁니다.

## 설치와 실행

아래 명령은 이 저장소 루트(`hello-workboard` 폴더가 있는 곳)에서 실행한다고 가정합니다.

### 이번 세션에서만 쓰기

```
claude --plugin-dir ./hello-workboard
```

세션이 시작되면 프롬프트 입력창 바로 위에 상태판이 나타나고, 도구 호출과 턴이 끝날 때마다 갱신됩니다.

### 매 세션 자동으로 쓰기

사용자 설정 `~/.claude/settings.json`의 `env`에 Mod 폴더의 절대 경로를 넣습니다. 프로젝트 설정(`.claude/settings.json`)에 넣은 값은 읽지 않습니다.

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "C:\\sun\\lab\\hello-workboard\\hello-workboard"
  }
}
```

여러 폴더를 쓸 때는 Windows에서는 `;`, macOS와 Linux에서는 `:`로 구분합니다. 설정을 바꾼 뒤 Claude Code를 다시 시작하세요.

## 비활성화

- **잠시 접기:** 띠 오른쪽의 `[-]`를 누르거나 `ctrl+x ctrl+a`를 누릅니다.
- **`--plugin-dir`로 켠 경우:** 다음 세션을 플래그 없이 시작하면 됩니다.
- **`CLAUDE_CODE_PLUGIN_DIRS`로 켠 경우:** 설정에서 이 Mod의 경로(다른 폴더가 없다면 키 전체)를 지우고 Claude Code를 다시 시작합니다.
- **완전히 제거:** 위 설정을 지운 뒤 이 폴더를 삭제합니다.

## 알아 둘 점

- **턴 수는 이 Mod가 관찰을 시작한 뒤부터 셉니다.** `--resume`으로 이어 받은 대화나 세션 중간에 Mod를 켠 경우, 그 전의 턴은 포함되지 않습니다. Mod 코드를 다시 불러오는 것(핫 리로드)만으로는 값이 초기화되지 않습니다.
- **상태판(`AbovePrompt`)은 엔진이 터미널과 데스크톱 화면에서만 그립니다.** VS Code와 모바일에서는 보이지 않습니다.

## 개발과 검증

```
claude plugin validate ./hello-workboard
claude plugin test ./hello-workboard
```

| 파일 | 역할 |
| --- | --- |
| `.claude-plugin/plugin.json` | 매니페스트. `types`로 `$.state` 타입 계약을 가리킵니다. |
| `hooks/hooks.json` | 훅 모듈 목록 |
| `hooks/register.tsx` | 이벤트 관찰과 상태판 그리기 |
| `hooks/format.ts` | 한 줄 문구와 폭 계산을 하는 순수 함수 |
| `types/index.d.ts` | `$.state`에 두는 세 값의 타입 계약 |
| `tests/workboard.test.tsx` | `claude plugin test`로 도는 테스트 |

타입 검사에는 Claude Code가 만든 API 선언(`claude-code.d.ts`)이 필요합니다. 이 파일은 Mod 폴더 밖에 둔 `tsconfig.json`의 `include`에 이 Mod의 `hooks`, `types`, `tests`와 함께 넣고, `jsxFactory`를 `h`로 지정해 `tsc -p`로 검사했습니다.

### 검증 기록 (2026-10-11, Claude Code 2.1.296, Windows 11)

실행해서 확인한 것:

- `claude plugin validate ./hello-workboard`: 경고 없이 통과. `--strict`도 통과.
- `claude plugin test ./hello-workboard`: 20개 통과, 0개 실패. 확인한 동작은 다음과 같습니다.
  - 값이 없거나 사용량 조회가 실패하면 '확인 불가'로 표시
  - 메인 턴만 세기
  - `tool.call`, `turn.complete`, `session.measure`, `session.compact`, `session.end`의 입력과 결과가 그대로 이어지는지(거절도 그대로 돌아오는지)
  - 도구 인자가 상태에 기록되지 않는지
  - 압축과 `/clear` 뒤 값 갱신
  - 터미널과 데스크톱 화면에서 그리기, 좁은 폭에서 한 줄이 폭을 넘지 않는지(문구 함수는 0~200칸, 그려진 띠는 8~120칸)
- TypeScript 5.6.3 `strict` 타입 검사: 오류 없음.
- 테스트가 실제로 잘못을 잡는지 확인: 일부러 망가뜨린 사본 세 개(도구 입력 바꾸기, 서브에이전트 턴까지 세기, `turn.complete` 결과 바꿔치기)에서 각각 해당 테스트가 실패했습니다.
- 실제 엔진 실행: `claude -p --plugin-dir ./hello-workboard`로 Read 도구를 한 번 쓰는 질문을 실행했습니다. 디버그 로그에서 모듈 로드와 `session.start`, `tool.call`, `turn.complete`, `session.measure`, `session.end` 훅 실행을 확인했고, 건너뛰거나 거부된 훅은 없었습니다. 도구 결과와 답변도 정상이었습니다.

확인하지 못한 것:

- 대화형 터미널에서 상태판이 실제로 그려지는 모습을 눈으로 확인하지 않았습니다. 그리기는 테스트 킷의 마운트(`$.ui.mount`)로만 검증했습니다.
- `CLAUDE_CODE_PLUGIN_DIRS` 설정으로 켜는 방법과 `[-]`·`ctrl+x ctrl+a` 접기는 직접 실행해 보지 않았습니다. 2.1.296의 문서와 타입 선언에 적힌 내용을 따랐습니다.
