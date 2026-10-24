# auto-model

질문 크기에 따라 Claude Code 메인 대화의 모델(haiku · sonnet · opus)을 질문마다 자동으로 고르는 mod입니다.

- 짧은 질문은 haiku, 보통 작업은 sonnet, "설계·구조·전체" 같은 큰 작업은 opus
- 올리기는 바로, 내리기는 가벼운 질문이 두 번 이어지거나 5분 넘게 쉬었을 때만
- 상태 줄에 답한 모델과 설정값을 함께 보여 줌
- 서브에이전트 요청은 건드리지 않음

## 설치

```bash
/plugin install auto-model --marketplace leeruji/claude-auto-model
```

## 명령

- `!opus`, `!sonnet`, `!haiku`: 그 질문 하나만 해당 모델로
- `/route`: 상태와 최근 판정 10개 보기
- `/route off`, `/route on`: 자동 선택 끄기 · 켜기
- `/route pin <opus|sonnet|haiku>`: 한 모델로 고정
