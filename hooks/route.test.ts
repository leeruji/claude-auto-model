import { expect, test } from 'claude-code/testing'

import { classify, decide } from './register'

test('규칙 판정', async () => {
  expect(classify('이거 뭐야?')[0]).toBe('haiku')
  expect(classify('버튼 색 바꿔 줘')[0]).toBe('sonnet')
  expect(classify('앱 전체 구조를 다시 설계하자')[0]).toBe('opus')
})

test('올리기는 바로, 내리기는 두 번째 가벼운 판정이나 캐시가 식었을 때', async () => {
  expect(decide('sonnet', 'opus', 0, 0)).toEqual({ tier: 'opus', streak: 0 })
  expect(decide('opus', 'haiku', 0, 0)).toEqual({ tier: 'opus', streak: 1 })
  expect(decide('opus', 'haiku', 1, 0)).toEqual({ tier: 'haiku', streak: 0 })
  expect(decide('opus', 'sonnet', 0, 10 * 60_000)).toEqual({ tier: 'sonnet', streak: 0 })
  expect(decide(undefined, 'haiku', 0, 0)).toEqual({ tier: 'haiku', streak: 0 })
})
