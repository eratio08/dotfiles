import { type KeybindingsManager, keyHint, type Theme } from '@earendil-works/pi-coding-agent'
import {
  type Component,
  Editor,
  type EditorTheme,
  type Focusable,
  Text,
  type TUI,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui'
import {
  type EffectToolDefinition,
  Pi,
  PiExtension,
  type PiOperationsError,
  type PiRegistrationContext,
  type PiRegistrationError,
  PiToolContext,
  type PiToolContextTag,
  type PiToolResult,
  PiUi,
  PiUiUnavailableError,
} from '@eratio/pi-effect'
import { Effect, Option, Schema } from 'effect'
import { type Static, Type } from 'typebox'

type QuestionOption = {
  label: string
  description: string
}

type QuestionInput = {
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

type QuestionState = {
  question: string
  header: string
  options: QuestionOption[]
  multiple: boolean
  custom: boolean
}

type QuestionToolDetails = {
  questions: Array<{
    question: string
    header: string
    options: string[]
    multiple: boolean
    custom: boolean
  }>
  answers: string[][]
  cancelled: boolean
}

type ToolOutcome = {
  answers: string[][]
  cancelled: boolean
}

class QuestionInputError extends Schema.TaggedError<QuestionInputError>()('QuestionInputError', {
  message: Schema.String,
}) {}

type QuestionToolError = QuestionInputError | PiOperationsError | PiUiUnavailableError

const OptionSchema = Type.Object({
  label: Type.String({ description: 'Display text (1-5 words, concise)' }),
  description: Type.String({ description: 'Explanation of choice' }),
})

const QuestionSchema = Type.Object({
  question: Type.String({ description: 'Complete question' }),
  header: Type.String({ description: 'Very short label (max 30 chars)' }),
  options: Type.Array(OptionSchema, { description: 'Available choices' }),
  multiple: Type.Optional(Type.Boolean({ description: 'Allow selecting multiple choices' })),
  custom: Type.Optional(Type.Boolean({ description: 'Allow typing a custom answer (default: true)' })),
})

const Params = Type.Object({
  questions: Type.Array(QuestionSchema, { description: 'Questions to ask' }),
})

type QuestionToolDefinition = EffectToolDefinition<typeof Params, Pi | PiUi, QuestionToolError, QuestionToolDetails>
type QuestionToolRenderCall = NonNullable<QuestionToolDefinition['renderCall']>
type QuestionToolRenderResult = NonNullable<QuestionToolDefinition['renderResult']>

function normalizeQuestion(question: QuestionInput): QuestionState {
  return {
    question: question.question,
    header: question.header,
    options: question.options,
    multiple: question.multiple === true,
    custom: question.custom !== false,
  }
}

function isSingleQuestionFlow(questions: readonly QuestionState[]): boolean {
  return questions.length === 1 && questions[0]?.multiple !== true
}

function toModelOutput(questions: readonly QuestionState[], answers: readonly string[][]): string {
  const formatted = questions
    .map((question, index) => {
      const answer = answers[index]
      return `"${question.question}"="${answer?.length ? answer.join(', ') : 'Unanswered'}"`
    })
    .join(', ')

  return `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`
}

function toDetails(
  questions: readonly QuestionState[],
  answers: readonly string[][],
  cancelled: boolean,
): QuestionToolDetails {
  return {
    questions: questions.map((question) => ({
      question: question.question,
      header: question.header,
      options: question.options.map((option) => option.label),
      multiple: question.multiple,
      custom: question.custom,
    })),
    answers: answers.map((answer) => [...answer]),
    cancelled,
  }
}

class QuestionComponent implements Component, Focusable {
  private _focused = false
  private readonly editor: Editor
  private readonly answers: string[][]
  private readonly customValues: string[]
  private readonly singleQuestionFlow: boolean
  private tab = 0
  private selected = 0
  private editing = false
  private cachedWidth?: number
  private cachedLines?: string[]
  private readonly abortListener = (): void => this.finish(true)

  constructor(
    private readonly questions: readonly QuestionState[],
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly keybindings: KeybindingsManager,
    private readonly done: (result: ToolOutcome) => void,
    private readonly toolSignal?: AbortSignal,
  ) {
    this.answers = questions.map(() => [])
    this.customValues = questions.map(() => '')
    this.singleQuestionFlow = isSingleQuestionFlow(questions)

    const editorTheme: EditorTheme = {
      borderColor: (text: string) => this.theme.fg('borderAccent', text),
      selectList: {
        selectedPrefix: (text: string) => this.theme.fg('accent', text),
        selectedText: (text: string) => this.theme.fg('accent', text),
        description: (text: string) => this.theme.fg('muted', text),
        scrollInfo: (text: string) => this.theme.fg('dim', text),
        noMatch: (text: string) => this.theme.fg('warning', text),
      },
    }

    this.editor = new Editor(this.tui, editorTheme)
    this.editor.disableSubmit = true
    this.editor.onChange = (): void => {
      this.invalidate()
      this.tui.requestRender()
    }

    if (this.toolSignal?.aborted) {
      this.finish(true)
    } else {
      this.toolSignal?.addEventListener('abort', this.abortListener, { once: true })
    }
  }

  get focused(): boolean {
    return this._focused
  }

  set focused(value: boolean) {
    this._focused = value
    this.editor.focused = value
  }

  private get confirmTab(): boolean {
    return !this.singleQuestionFlow && this.tab === this.questions.length
  }

  private currentQuestion(): QuestionState | undefined {
    return this.questions[this.tab]
  }

  private totalTabs(): number {
    return this.singleQuestionFlow ? 1 : this.questions.length + 1
  }

  private answeredCount(): number {
    return this.answers.filter((answer) => answer.length > 0).length
  }

  private optionCount(question: QuestionState | undefined = this.currentQuestion()): number {
    if (!question) return 0
    return question.options.length + (question.custom ? 1 : 0)
  }

  private isOtherSelected(question: QuestionState | undefined = this.currentQuestion()): boolean {
    if (!question?.custom) return false
    return this.selected === question.options.length
  }

  private invalidateAndRender(): void {
    this.invalidate()
    this.tui.requestRender()
  }

  private selectTab(index: number): void {
    const totalTabs = this.totalTabs()
    if (index < 0 || index >= totalTabs) return
    this.tab = index
    this.selected = 0
    this.editing = false
    this.editor.setText(this.customValues[this.tab] ?? '')
    this.invalidate()
  }

  private moveTab(step: -1 | 1): void {
    if (this.singleQuestionFlow) return
    const totalTabs = this.totalTabs()
    this.selectTab((this.tab + step + totalTabs) % totalTabs)
  }

  private moveSelection(step: -1 | 1): void {
    const total = this.optionCount()
    if (total === 0) return
    this.selected = (this.selected + step + total) % total
    this.invalidate()
  }

  private finish(cancelled: boolean): void {
    this.dispose()
    this.done({
      answers: this.answers.map((answer) => [...answer]),
      cancelled,
    })
  }

  dispose(): void {
    this.toolSignal?.removeEventListener('abort', this.abortListener)
  }

  private beginEditing(): void {
    this.editing = true
    this.editor.setText(this.customValues[this.tab] ?? '')
    this.invalidate()
  }

  private cancelEditing(): void {
    this.editing = false
    this.editor.setText(this.customValues[this.tab] ?? '')
    this.invalidate()
  }

  private setSingleAnswer(answer: string, custom: boolean): void {
    this.answers[this.tab] = [answer]
    this.customValues[this.tab] = custom ? answer : ''
    this.editing = false
    this.editor.setText(this.customValues[this.tab] ?? '')

    if (this.singleQuestionFlow) {
      this.finish(false)
      return
    }

    if (this.tab < this.questions.length - 1) {
      this.selectTab(this.tab + 1)
    } else {
      this.selectTab(this.questions.length)
    }
  }

  private toggleAnswer(answer: string): void {
    const list = [...(this.answers[this.tab] ?? [])]
    const index = list.indexOf(answer)
    if (index === -1) {
      list.push(answer)
    } else {
      list.splice(index, 1)
    }
    this.answers[this.tab] = list
    this.invalidate()
  }

  private saveCustomAnswer(): void {
    const question = this.currentQuestion()
    if (!question) return

    const previous = this.customValues[this.tab] ?? ''
    const value = this.editor.getText().trim()

    if (!value) {
      if (previous) {
        this.answers[this.tab] = (this.answers[this.tab] ?? []).filter((item) => item !== previous)
        this.customValues[this.tab] = ''
      }
      this.editing = false
      this.editor.setText('')
      this.invalidate()
      return
    }

    if (question.multiple) {
      const list = [...(this.answers[this.tab] ?? [])]
      if (previous && previous !== value) {
        const previousIndex = list.indexOf(previous)
        if (previousIndex !== -1) {
          list.splice(previousIndex, 1)
        }
      }
      if (!list.includes(value)) {
        list.push(value)
      }
      this.answers[this.tab] = list
      this.customValues[this.tab] = value
      this.editing = false
      this.editor.setText(value)
      this.invalidate()
      return
    }

    this.setSingleAnswer(value, true)
  }

  private chooseSelected(): void {
    const question = this.currentQuestion()
    if (!question) return

    if (this.isOtherSelected(question)) {
      const value = this.customValues[this.tab] ?? ''
      if (question.multiple && value && (this.answers[this.tab] ?? []).includes(value)) {
        this.toggleAnswer(value)
        return
      }
      this.beginEditing()
      return
    }

    const option = question.options[this.selected]
    if (!option) return

    if (question.multiple) {
      this.toggleAnswer(option.label)
      return
    }

    this.setSingleAnswer(option.label, false)
  }

  handleInput(data: string): void {
    if (this.editing) {
      if (this.keybindings.matches(data, 'tui.select.cancel')) {
        this.cancelEditing()
        this.tui.requestRender()
        return
      }
      if (this.keybindings.matches(data, 'tui.select.confirm')) {
        this.saveCustomAnswer()
        this.tui.requestRender()
        return
      }
      this.editor.handleInput(data)
      this.invalidateAndRender()
      return
    }

    if (this.keybindings.matches(data, 'tui.select.cancel')) {
      this.finish(true)
      return
    }

    if (!this.singleQuestionFlow && this.keybindings.matches(data, 'tui.input.tab')) {
      this.moveTab(1)
      this.tui.requestRender()
      return
    }

    if (!this.singleQuestionFlow && (data === 'h' || data === 'H')) {
      this.moveTab(-1)
      this.tui.requestRender()
      return
    }

    if (this.confirmTab) {
      if (this.keybindings.matches(data, 'tui.select.confirm')) {
        this.finish(false)
      }
      return
    }

    if (this.keybindings.matches(data, 'tui.select.up')) {
      this.moveSelection(-1)
      this.tui.requestRender()
      return
    }

    if (this.keybindings.matches(data, 'tui.select.down')) {
      this.moveSelection(1)
      this.tui.requestRender()
      return
    }

    if (this.keybindings.matches(data, 'tui.select.confirm')) {
      this.chooseSelected()
      this.tui.requestRender()
    }
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines
    }

    const lines: string[] = []
    const boxWidth = Math.min(Math.max(width, 1), 120)
    const innerWidth = Math.max(1, boxWidth - 2)
    const contentWidth = Math.max(1, innerWidth - 2)
    const border = (text: string): string => this.theme.fg('border', text)
    const answeredCount = this.answeredCount()

    const pushBoxLine = (content: string = ''): void => {
      const line = truncateToWidth(content, innerWidth, '…')
      const padding = Math.max(0, innerWidth - visibleWidth(line))
      lines.push(border('│') + line + ' '.repeat(padding) + border('│'))
    }

    const pushWrapped = (prefix: string, text: string): void => {
      const prefixWidth = visibleWidth(prefix)
      const wrapped = wrapTextWithAnsi(text, Math.max(1, contentWidth - prefixWidth))
      for (let index = 0; index < wrapped.length; index++) {
        pushBoxLine(` ${index === 0 ? prefix : ' '.repeat(prefixWidth)}${wrapped[index]}`)
      }
    }

    lines.push(border(`╭${'─'.repeat(innerWidth)}╮`))
    pushBoxLine(
      ` ${this.theme.fg('accent', this.theme.bold('Question'))}${this.theme.fg('dim', ` (${answeredCount}/${this.questions.length} answered)`)}`,
    )

    if (!this.singleQuestionFlow) {
      const tabs = [
        ...this.questions.map((question, index) => {
          const label = truncateToWidth(question.header, 18, '…')
          if (index === this.tab) {
            return this.theme.bg('selectedBg', this.theme.fg('text', ` ${label} `))
          }
          if ((this.answers[index] ?? []).length > 0) {
            return this.theme.fg('success', label)
          }
          return this.theme.fg('dim', label)
        }),
        this.tab === this.questions.length
          ? this.theme.bg('selectedBg', this.theme.fg('text', ' Submit '))
          : this.theme.fg('dim', 'Submit'),
      ].join(' ')
      pushBoxLine(` ${tabs}`)
    }

    lines.push(border(`├${'─'.repeat(innerWidth)}┤`))

    if (this.confirmTab) {
      pushWrapped(this.theme.bold('Review: '), 'Submit answers')
      pushBoxLine()
      for (let index = 0; index < this.questions.length; index++) {
        const question = this.questions[index]
        const answers = this.answers[index]
        const answer = answers?.length ? answers.join(', ') : 'Unanswered'
        pushWrapped(this.theme.bold(`${question.header}: `), answer)
      }
    } else {
      const question = this.currentQuestion()
      if (question) {
        pushWrapped(this.theme.bold('Q: '), question.question)
        pushBoxLine()
        const showDigits = this.optionCount(question) <= 9
        for (let index = 0; index < question.options.length; index++) {
          const option = question.options[index]
          const selected = this.selected === index
          const picked = (this.answers[this.tab] ?? []).includes(option.label)
          const mark = question.multiple ? (picked ? '[x]' : '[ ]') : picked ? '(*)' : '( )'
          const number = showDigits ? `${index + 1}. ` : ''
          const prefix = selected ? this.theme.fg('accent', `> ${mark} ${number}`) : `  ${mark} ${number}`
          const label = selected ? this.theme.fg('accent', option.label) : option.label
          pushWrapped(prefix, label)
          pushWrapped('    ', this.theme.fg('muted', option.description))
        }

        if (question.custom) {
          const otherIndex = question.options.length
          const selected = this.selected === otherIndex
          const value = this.customValues[this.tab] ?? ''
          const picked = value.length > 0 && (this.answers[this.tab] ?? []).includes(value)
          const mark = question.multiple ? (picked ? '[x]' : '[ ]') : picked ? '(*)' : '( )'
          const number = showDigits && otherIndex < 9 ? `${otherIndex + 1}. ` : ''
          const prefix = selected ? this.theme.fg('accent', `> ${mark} ${number}`) : `  ${mark} ${number}`
          const label = selected ? this.theme.fg('accent', 'Type your own answer') : 'Type your own answer'
          pushWrapped(prefix, label)
          if (value) {
            pushWrapped('    ', this.theme.fg('muted', value))
          }
        }

        if (this.editing) {
          pushBoxLine()
          pushWrapped(this.theme.bold('Custom: '), 'Enter your answer')
          const editorLines = this.editor.render(Math.max(1, contentWidth))
          for (let index = 1; index < editorLines.length - 1; index++) {
            pushBoxLine(` ${editorLines[index]}`)
          }
        }
      }
    }

    pushBoxLine()
    lines.push(border(`├${'─'.repeat(innerWidth)}┤`))

    const controls = this.editing
      ? ` ${keyHint('tui.select.confirm', 'save')} • ${keyHint('tui.input.newLine', 'newline')} • ${keyHint('tui.select.cancel', 'cancel')}`
      : this.confirmTab
        ? ` ${keyHint('tui.select.confirm', 'submit')} • ${keyHint('tui.select.cancel', 'dismiss')}`
        : this.singleQuestionFlow
          ? ` ${keyHint('tui.select.up', 'move up')} • ${keyHint('tui.select.down', 'move down')} • ${keyHint('tui.select.confirm', 'select')} • ${keyHint('tui.select.cancel', 'dismiss')}`
          : ` ${keyHint('tui.input.tab', 'next question')} • ${keyHint('tui.select.up', 'move up')} • ${keyHint('tui.select.down', 'move down')} • ${keyHint('tui.select.confirm', 'select')} • ${keyHint('tui.select.cancel', 'dismiss')}`
    pushBoxLine(this.theme.fg('dim', truncateToWidth(controls, innerWidth - 1, '…')))
    lines.push(border(`╰${'─'.repeat(innerWidth)}╯`))

    this.cachedWidth = width
    this.cachedLines = lines
    return lines
  }

  invalidate(): void {
    this.cachedWidth = undefined
    this.cachedLines = undefined
  }
}

const executeQuestion = Effect.fn('question.execute')(function* (
  params: Static<typeof Params>,
): Effect.fn.Return<PiToolResult<QuestionToolDetails>, QuestionToolError, Pi | PiUi | PiToolContextTag> {
  const toolContext = yield* PiToolContext
  if (toolContext.mode !== 'tui' || !toolContext.hasUI) {
    return yield* new PiUiUnavailableError({
      operation: 'custom',
      mode: toolContext.mode,
      message: 'question requires interactive mode',
    })
  }

  if (params.questions.length === 0) {
    return yield* new QuestionInputError({ message: 'No questions provided' })
  }

  const questions = params.questions.map(normalizeQuestion)
  const pi = yield* Pi
  const ui = yield* PiUi
  const uiResult = yield* Effect.acquireUseRelease(
    pi.events.emit('herdr:blocked', { active: true, label: 'Waiting for answer' }),
    () =>
      ui.custom<ToolOutcome>(
        (tui: TUI, theme: Theme, keybindings: KeybindingsManager, done: (result: ToolOutcome) => void): Component =>
          new QuestionComponent(questions, tui, theme, keybindings, done, toolContext.toolSignal),
      ),
    () => pi.events.emit('herdr:blocked', { active: false }),
  )
  const result = Option.isSome(uiResult) ? uiResult.value : { answers: questions.map(() => []), cancelled: true }

  if (result.cancelled) {
    return {
      content: [{ type: 'text', text: 'User dismissed the question request.' }],
      details: toDetails(questions, result.answers, true),
      terminate: true,
    }
  }

  return {
    content: [{ type: 'text', text: toModelOutput(questions, result.answers) }],
    details: toDetails(questions, result.answers, false),
  }
})

const questionTool: QuestionToolDefinition = {
  name: 'question',
  label: 'Question',
  exposure: 'codemode',
  description:
    'Ask the user questions during execution to gather preferences, clarify requirements, or get decisions before continuing.',
  promptSnippet: 'Ask user clarifying questions during execution and continue with selected answers',
  promptGuidelines: [
    'Use question when user input or a decision is required before continuing work.',
    "When question.custom is enabled, do not add an 'Other' option because question adds a custom-answer option automatically.",
    'Question answers are returned as arrays of labels, so set question.multiple to true only when multiple selections are needed.',
    "If you recommend an option for question, put it first and suffix the label with '(Recommended)'.",
  ],
  parameters: Params,
  execute: executeQuestion,
  renderCall(args: Parameters<QuestionToolRenderCall>[0], theme: Parameters<QuestionToolRenderCall>[1]): Component {
    const questions = Array.isArray(args.questions) ? args.questions : []
    const title = `${questions.length} question${questions.length === 1 ? '' : 's'}`
    const headers = questions
      .map((question) => (typeof question?.header === 'string' ? question.header : undefined))
      .filter((header): header is string => Boolean(header))
      .join(', ')
    let text = theme.fg('toolTitle', theme.bold('question ')) + theme.fg('muted', title)
    if (headers) {
      text += `\n${theme.fg('dim', `  ${headers}`)}`
    }
    return new Text(text, 0, 0)
  },
  renderResult(
    result: Parameters<QuestionToolRenderResult>[0],
    { expanded }: Parameters<QuestionToolRenderResult>[1],
    theme: Parameters<QuestionToolRenderResult>[2],
  ): Component {
    const details = result.details as QuestionToolDetails | undefined
    if (!details) {
      const text = result.content[0]
      return new Text(text?.type === 'text' ? text.text : '', 0, 0)
    }

    if (details.cancelled) {
      return new Text(theme.fg('warning', 'Cancelled'), 0, 0)
    }

    const questions = details.questions.map((question, index) => {
      const answers = details.answers[index]
      return {
        question,
        answer: answers?.length ? answers.join(', ') : 'Unanswered',
      }
    })

    if (!expanded) {
      const summary = questions
        .map(
          ({ question, answer }) =>
            `${theme.fg('success', '✓')} ${theme.bold(question.header)} ${theme.fg('accent', answer)}`,
        )
        .join(' · ')
      return new Text(`${summary}${theme.fg('muted', ` (${keyHint('app.tools.expand', 'to expand')})`)}`, 0, 0)
    }

    const lines = questions.flatMap(({ question, answer }) => [
      `${theme.fg('success', '✓')} ${theme.bold(question.header)}`,
      `  ${theme.fg('muted', 'Question:')} ${question.question}`,
      `  ${theme.fg('muted', 'Options:')} ${question.options.join(', ')}`,
      `  ${theme.fg('accent', 'Answer:')} ${answer}`,
    ])
    return new Text(lines.join('\n'), 0, 0)
  },
}

const questionPlugin = PiExtension.define({
  id: 'question',
  effect: (context: PiRegistrationContext<never>): Effect.Effect<void, PiRegistrationError> =>
    context.tools.register(questionTool),
})

export { questionPlugin }
