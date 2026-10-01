import { expect, test } from 'bun:test'
import { initTheme } from '@earendil-works/pi-coding-agent'
import type { PiCustomFactory } from '@eratio/pi-effect'
import { createFakeExtensionContext, type FakeExtension, installFakePlugin } from '@eratio/pi-effect/testing'
import questionExtension from '../index.ts'

type QuestionOutcome = {
  answers: string[][]
  cancelled: boolean
}

function createQuestionContext(
  outcome: QuestionOutcome,
  options: {
    hasUI?: boolean
    failCustom?: boolean
    onCustomOpen?: () => void
    onCustomDone?: () => void
  } = {},
): Parameters<FakeExtension['invokeTool']>[3] {
  const context = createFakeExtensionContext()
  const tui = { requestRender: (): void => undefined } as unknown as Parameters<PiCustomFactory<unknown>>[0]
  const theme = {
    fg: (_color: string, text: string): string => text,
    bg: (_color: string, text: string): string => text,
    bold: (text: string): string => text,
  } as unknown as Parameters<PiCustomFactory<unknown>>[1]
  const keybindings = { matches: (): boolean => false } as unknown as Parameters<PiCustomFactory<unknown>>[2]
  return {
    ...context,
    hasUI: options.hasUI ?? context.hasUI,
    ui: {
      ...context.ui,
      custom: async <Result>(factory: PiCustomFactory<Result>): Promise<Result> => {
        if (options.failCustom) throw new Error('Custom UI failed.')
        if (!options.onCustomOpen) return outcome as Result

        return await new Promise<Result>((resolve) => {
          let component: Awaited<ReturnType<PiCustomFactory<Result>>> | undefined
          const done = (result: Result): void => {
            options.onCustomDone?.()
            resolve(result)
            component?.dispose?.()
          }
          const created = factory(tui, theme, keybindings, done)
          if (created instanceof Promise) {
            void created.then((value) => {
              component = value
              options.onCustomOpen?.()
            })
          } else {
            component = created
            options.onCustomOpen?.()
          }
        })
      },
    },
    tools: [],
    executeTool: async () => {
      throw new Error('Nested tool calls are not expected.')
    },
  }
}

function renderQuestionViews(extension: FakeExtension, details: unknown): { collapsed: string; expanded: string } {
  initTheme('dark')
  const tool = extension.tools.get('question')
  const renderResult = tool?.renderResult
  if (!renderResult) throw new Error('Question result renderer was not registered.')

  const result = {
    content: [{ type: 'text', text: '' }],
    details,
  } as Parameters<typeof renderResult>[0]
  const theme = {
    fg: (_color: string, text: string): string => text,
    bold: (text: string): string => text,
  } as unknown as Parameters<PiCustomFactory<unknown>>[1]
  const context = { lastComponent: undefined } as Parameters<typeof renderResult>[3]
  const render = (expanded: boolean): string =>
    renderResult(result, { expanded, isPartial: false }, theme, { ...context, expanded })
      .render(80)
      .join('\n')
      .trim()

  return { collapsed: render(false), expanded: render(true) }
}

test('should return the selected answer given a completed question', async () => {
  //given
  const extension = await installFakePlugin(questionExtension)
  const events: unknown[] = []
  extension.api.events.on('herdr:blocked', (data) => events.push(data))
  const context = createQuestionContext({ answers: [['Yes']], cancelled: false })
  const params = {
    questions: [
      {
        question: 'Continue?',
        header: 'Continue',
        options: [{ label: 'Yes', description: 'Continue the task.' }],
      },
    ],
  }

  //when
  const result = await extension.invokeTool('question', 'tool-1', params, context)

  //then
  expect(result).toEqual({
    content: [
      {
        type: 'text',
        text: 'User has answered your questions: "Continue?"="Yes". You can now continue with the user\'s answers in mind.',
      },
    ],
    details: {
      questions: [
        {
          question: 'Continue?',
          header: 'Continue',
          options: ['Yes'],
          multiple: false,
          custom: true,
        },
      ],
      answers: [['Yes']],
      cancelled: false,
    },
  })
  expect(events).toEqual([{ active: true, label: 'Waiting for answer' }, { active: false }])
})

test('should show full question data when expanded given a successful result', async () => {
  //given
  const extension = await installFakePlugin(questionExtension)
  const details = {
    questions: [
      {
        question: 'Continue the work?',
        header: 'Continue',
        options: ['Yes', 'No'],
        multiple: false,
        custom: true,
      },
    ],
    answers: [['Yes']],
    cancelled: false,
  }

  //when
  const views = renderQuestionViews(extension, details)

  //then
  expect(views.collapsed).toContain('Continue Yes')
  expect(views.collapsed).not.toContain('Continue the work?')
  expect(views.expanded).toContain('Question: Continue the work?')
  expect(views.expanded).toContain('Options: Yes, No')
  expect(views.expanded).toContain('Answer: Yes')
})

test('should terminate with a cancelled result given user dismissal', async () => {
  //given
  const extension = await installFakePlugin(questionExtension)
  const events: unknown[] = []
  extension.api.events.on('herdr:blocked', (data) => events.push(data))
  const context = createQuestionContext({ answers: [[]], cancelled: true })
  const params = {
    questions: [
      {
        question: 'Continue?',
        header: 'Continue',
        options: [{ label: 'Yes', description: 'Continue the task.' }],
      },
    ],
  }

  //when
  const result = await extension.invokeTool('question', 'tool-2', params, context)

  //then
  expect(result).toEqual({
    content: [{ type: 'text', text: 'User dismissed the question request.' }],
    details: {
      questions: [
        {
          question: 'Continue?',
          header: 'Continue',
          options: ['Yes'],
          multiple: false,
          custom: true,
        },
      ],
      answers: [[]],
      cancelled: true,
    },
    terminate: true,
  })
  expect(events).toEqual([{ active: true, label: 'Waiting for answer' }, { active: false }])
})

test('should reject with a typed input error given no questions', async () => {
  //given
  const extension = await installFakePlugin(questionExtension)
  const context = createQuestionContext({ answers: [], cancelled: false })
  const params = { questions: [] }

  //when
  const invocation = extension.invokeTool('question', 'tool-3', params, context)

  //then
  await expect(invocation).rejects.toMatchObject({
    _tag: 'PiToolError',
    message: 'No questions provided',
  })
})

test('should reject with a typed UI error given unavailable UI', async () => {
  //given
  const extension = await installFakePlugin(questionExtension)
  const context = createQuestionContext({ answers: [[]], cancelled: false }, { hasUI: false })
  const params = {
    questions: [
      {
        question: 'Continue?',
        header: 'Continue',
        options: [{ label: 'Yes', description: 'Continue the task.' }],
      },
    ],
  }

  //when
  const invocation = extension.invokeTool('question', 'tool-4', params, context)

  //then
  await expect(invocation).rejects.toMatchObject({
    _tag: 'PiToolError',
    message: 'question requires interactive mode',
  })
})

test('should clear the blocked state given a custom UI failure', async () => {
  //given
  const extension = await installFakePlugin(questionExtension)
  const events: unknown[] = []
  extension.api.events.on('herdr:blocked', (data) => events.push(data))
  const context = createQuestionContext({ answers: [[]], cancelled: false }, { failCustom: true })
  const params = {
    questions: [
      {
        question: 'Continue?',
        header: 'Continue',
        options: [{ label: 'Yes', description: 'Continue the task.' }],
      },
    ],
  }

  //when
  const invocation = extension.invokeTool('question', 'tool-5', params, context)

  //then
  await expect(invocation).rejects.toMatchObject({
    _tag: 'PiToolError',
    message: 'Custom UI failed.',
  })
  expect(events).toEqual([{ active: true, label: 'Waiting for answer' }, { active: false }])
})

test('should close the question UI given an aborted tool call', async () => {
  //given
  const extension = await installFakePlugin(questionExtension)
  const events: unknown[] = []
  extension.api.events.on('herdr:blocked', (data) => events.push(data))
  const controller = new AbortController()
  let uiClosed = false
  const context = createQuestionContext(
    { answers: [[]], cancelled: false },
    {
      onCustomOpen: () => controller.abort(),
      onCustomDone: () => {
        uiClosed = true
      },
    },
  )
  const params = {
    questions: [
      {
        question: 'Continue?',
        header: 'Continue',
        options: [{ label: 'Yes', description: 'Continue the task.' }],
      },
    ],
  }

  //when
  const invocation = extension.invokeTool('question', 'tool-6', params, context, controller.signal)

  //then
  await invocation.catch(() => undefined)
  expect(uiClosed).toBe(true)
  expect(events).toEqual([{ active: true, label: 'Waiting for answer' }, { active: false }])
})

export { createQuestionContext, renderQuestionViews }
