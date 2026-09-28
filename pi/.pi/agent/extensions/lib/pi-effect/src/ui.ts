import type { ExtensionUIContext, KeybindingsManager, Theme } from '@earendil-works/pi-coding-agent'
import type {
  AutocompleteProvider,
  Component,
  EditorComponent,
  EditorTheme,
  OverlayOptions,
  TUI,
} from '@earendil-works/pi-tui'
import { Context, Effect, Option } from 'effect'
import type { PiContextValue, PiMode } from './context.ts'
import { combinePiAbortSignals } from './context.ts'
import { type PiOperationsError, PiUiUnavailableError, piOperationTry, piOperationTryPromise } from './errors.ts'

type EffectSuccess<T> = T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never

type PiComponentWithDispose = Component & { dispose?: () => void }
type PiWidgetFactory = (tui: TUI, theme: Theme) => PiComponentWithDispose
type PiFooterFactory = (tui: TUI, theme: Theme, footerData: unknown) => PiComponentWithDispose
type PiHeaderFactory = (tui: TUI, theme: Theme) => PiComponentWithDispose

/** Cancellation and timeout options for interactive UI dialogs. */
type PiUiDialogOptions = {
  /** Signal that cancels the dialog when aborted. */
  readonly signal?: AbortSignal
  /** Dialog timeout in milliseconds. */
  readonly timeout?: number
}

/** Placement options for a terminal UI widget. */
type PiWidgetOptions = {
  /** Whether the widget appears above or below the editor. */
  readonly placement?: 'aboveEditor' | 'belowEditor'
}

/** Animation settings for the Pi working indicator. */
type PiWorkingIndicatorOptions = {
  /** Frames shown by the indicator. */
  readonly frames?: readonly string[]
  /** Delay between frames in milliseconds. */
  readonly intervalMs?: number
}

/**
 * Factory for a custom terminal UI component that completes with a value of type `A`.
 * @param tui Active terminal UI instance.
 * @param theme Theme used to draw the component.
 * @param keybindings Keybinding manager available to the component.
 * @param done Completes the custom UI operation with a result.
 */
type PiCustomFactory<A> = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (result: A) => void,
) => PiComponentWithDispose | Promise<PiComponentWithDispose>

/** Effect-based Pi UI operations. Interactive operations can fail when UI is unavailable. */
type PiUiService = {
  /** Opens a selection dialog and returns the selected option, or `undefined` when cancelled.
   * Fails with `PiUiUnavailableError` when UI is unavailable.
   */
  readonly select: (
    title: string,
    options: readonly string[],
    dialog?: PiUiDialogOptions,
  ) => Effect.Effect<string | undefined, PiUiUnavailableError | PiOperationsError>
  /** Opens a confirmation dialog and returns the user's choice.
   * Fails with `PiUiUnavailableError` when UI is unavailable.
   */
  readonly confirm: (
    title: string,
    message: string,
    dialog?: PiUiDialogOptions,
  ) => Effect.Effect<boolean, PiUiUnavailableError | PiOperationsError>
  /** Opens a text-input dialog and returns its value, or `undefined` when cancelled.
   * Fails with `PiUiUnavailableError` when UI is unavailable.
   */
  readonly input: (
    title: string,
    placeholder?: string,
    dialog?: PiUiDialogOptions,
  ) => Effect.Effect<string | undefined, PiUiUnavailableError | PiOperationsError>
  /** Shows a notification when UI is available; otherwise does nothing. */
  readonly notify: (message: string, type?: 'info' | 'warning' | 'error') => Effect.Effect<void, PiOperationsError>
  /** Registers a terminal-input handler and returns an unsubscribe function.
   * Fails with `PiUiUnavailableError` when UI is unavailable or the mode is not `tui`.
   */
  readonly onTerminalInput: (
    handler: (data: string) => { consume?: boolean; data?: string } | undefined,
  ) => Effect.Effect<() => void, PiOperationsError | PiUiUnavailableError>
  /** Sets or clears a status item when UI is available. */
  readonly setStatus: (key: string, text: string | undefined) => Effect.Effect<void, PiOperationsError>
  /** Sets the working message when UI is available. */
  readonly setWorkingMessage: (message?: string) => Effect.Effect<void, PiOperationsError>
  /** Shows or hides the working indicator when UI is available. */
  readonly setWorkingVisible: (visible: boolean) => Effect.Effect<void, PiOperationsError>
  /** Sets the working indicator animation when UI is available. */
  readonly setWorkingIndicator: (options?: PiWorkingIndicatorOptions) => Effect.Effect<void, PiOperationsError>
  /** Sets or clears a widget when UI is available. */
  readonly setWidget: (
    key: string,
    content: readonly string[] | PiWidgetFactory | undefined,
    options?: PiWidgetOptions,
  ) => Effect.Effect<void, PiOperationsError>
  /** Sets or clears a custom footer when UI is available. */
  readonly setFooter: (factory: PiFooterFactory | undefined) => Effect.Effect<void, PiOperationsError>
  /** Sets or clears a custom header when UI is available. */
  readonly setHeader: (factory: PiHeaderFactory | undefined) => Effect.Effect<void, PiOperationsError>
  /** Sets the terminal title when UI is available. */
  readonly setTitle: (title: string) => Effect.Effect<void, PiOperationsError>
  /** Opens a custom terminal UI component and returns an `Option` result.
   * The result is `Some` when the component calls `done`.
   * Fails with `PiUiUnavailableError` when UI is unavailable or the mode is not `tui`.
   */
  readonly custom: <A>(
    factory: PiCustomFactory<A>,
    options?: { readonly overlay?: boolean; readonly overlayOptions?: OverlayOptions },
  ) => Effect.Effect<Option.Option<A>, PiUiUnavailableError | PiOperationsError>
  /** Pastes text into the editor when UI is available. */
  readonly pasteToEditor: (text: string) => Effect.Effect<void, PiOperationsError>
  /** Replaces the editor text when UI is available. */
  readonly setEditorText: (text: string) => Effect.Effect<void, PiOperationsError>
  /** Reads the current editor text. */
  readonly getEditorText: () => Effect.Effect<string, PiOperationsError>
  /** Opens the full editor and returns its text, or `undefined` when cancelled.
   * Fails with `PiUiUnavailableError` when UI is unavailable or the mode is not `tui`.
   */
  readonly editor: (
    title: string,
    prefill?: string,
  ) => Effect.Effect<string | undefined, PiUiUnavailableError | PiOperationsError>
  /** Adds or wraps an autocomplete provider. */
  readonly addAutocompleteProvider: (
    factory: (current: AutocompleteProvider) => AutocompleteProvider,
  ) => Effect.Effect<void, PiOperationsError>
  /** Sets the custom terminal UI editor component.
   * Fails with `PiUiUnavailableError` when UI is unavailable or the mode is not `tui`.
   */
  readonly setEditorComponent: (
    factory: ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent) | undefined,
  ) => Effect.Effect<void, PiUiUnavailableError | PiOperationsError>
  /** Reads the custom terminal UI editor component factory, if one is set. */
  readonly getEditorComponent: () => Effect.Effect<
    ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent) | undefined,
    PiOperationsError
  >
  /** Reads the active theme, if Pi has one. */
  readonly theme: () => Effect.Effect<Theme | undefined, PiOperationsError>
  /** Lists available themes and their optional file paths. */
  readonly getAllThemes: () => Effect.Effect<
    readonly { readonly name: string; readonly path: string | undefined }[],
    PiOperationsError
  >
  /** Reads a theme by name, if it is available. */
  readonly getTheme: (name: string) => Effect.Effect<Theme | undefined, PiOperationsError>
  /** Selects a theme by name or theme value and reports success or an error. */
  readonly setTheme: (
    theme: string | Theme,
  ) => Effect.Effect<{ readonly success: boolean; readonly error?: string }, PiOperationsError>
  /** Reads the expanded state without wrapping the value in an Effect. */
  readonly getToolsExpandedValue: () => boolean
  /** Reads whether Pi expands tool output. */
  readonly getToolsExpanded: () => Effect.Effect<boolean, PiOperationsError>
  /** Sets whether Pi expands tool output. */
  readonly setToolsExpanded: (expanded: boolean) => Effect.Effect<void, PiOperationsError>
}

type PiUiAdapter = {
  readonly select: (...args: Parameters<PiUiService['select']>) => Promise<string | undefined>
  readonly confirm: (...args: Parameters<PiUiService['confirm']>) => Promise<boolean>
  readonly input: (...args: Parameters<PiUiService['input']>) => Promise<string | undefined>
  readonly notify: (...args: Parameters<PiUiService['notify']>) => void
  readonly onTerminalInput: (...args: Parameters<PiUiService['onTerminalInput']>) => () => void
  readonly setStatus: (...args: Parameters<PiUiService['setStatus']>) => void
  readonly setWorkingMessage: (...args: Parameters<PiUiService['setWorkingMessage']>) => void
  readonly setWorkingVisible: (...args: Parameters<PiUiService['setWorkingVisible']>) => void
  readonly setWorkingIndicator: (...args: Parameters<PiUiService['setWorkingIndicator']>) => void
  readonly setWidget: (...args: Parameters<PiUiService['setWidget']>) => void
  readonly setFooter: (...args: Parameters<PiUiService['setFooter']>) => void
  readonly setHeader: (...args: Parameters<PiUiService['setHeader']>) => void
  readonly setTitle: (...args: Parameters<PiUiService['setTitle']>) => void
  readonly custom: <A>(
    factory: PiCustomFactory<A>,
    options?: Parameters<PiUiService['custom']>[1],
  ) => Effect.Effect<A, PiOperationsError | PiUiUnavailableError>
  readonly pasteToEditor: (...args: Parameters<PiUiService['pasteToEditor']>) => void
  readonly setEditorText: (...args: Parameters<PiUiService['setEditorText']>) => void
  readonly getEditorText: () => string
  readonly editor: (...args: Parameters<PiUiService['editor']>) => Promise<string | undefined>
  readonly addAutocompleteProvider: (...args: Parameters<PiUiService['addAutocompleteProvider']>) => void
  readonly setEditorComponent: (...args: Parameters<PiUiService['setEditorComponent']>) => void
  readonly getEditorComponent: () => EffectSuccess<ReturnType<PiUiService['getEditorComponent']>>
  readonly theme: EffectSuccess<ReturnType<PiUiService['theme']>>
  readonly getAllThemes: () => EffectSuccess<ReturnType<PiUiService['getAllThemes']>>
  readonly getTheme: (
    ...args: Parameters<PiUiService['getTheme']>
  ) => EffectSuccess<ReturnType<PiUiService['getTheme']>>
  readonly setTheme: (
    ...args: Parameters<PiUiService['setTheme']>
  ) => EffectSuccess<ReturnType<PiUiService['setTheme']>>
  readonly getToolsExpanded: () => EffectSuccess<ReturnType<PiUiService['getToolsExpanded']>>
  readonly setToolsExpanded: (...args: Parameters<PiUiService['setToolsExpanded']>) => void
}

function createPiUiAdapter(ui: ExtensionUIContext): PiUiAdapter {
  return {
    select: (
      title: string,
      options: Parameters<PiUiAdapter['select']>[1],
      dialog?: Parameters<PiUiAdapter['select']>[2],
    ) => ui.select(title, [...options], dialog),
    confirm: (
      title: string,
      message: Parameters<PiUiAdapter['confirm']>[1],
      dialog?: Parameters<PiUiAdapter['confirm']>[2],
    ) => ui.confirm(title, message, dialog),
    input: (
      title: string,
      placeholder?: Parameters<PiUiAdapter['input']>[1],
      dialog?: Parameters<PiUiAdapter['input']>[2],
    ) => ui.input(title, placeholder, dialog),
    notify: (message: string, type?: Parameters<PiUiAdapter['notify']>[1]) => ui.notify(message, type),
    onTerminalInput: (handler: Parameters<PiUiAdapter['onTerminalInput']>[0]) => ui.onTerminalInput(handler),
    setStatus: (key: string, text: Parameters<PiUiAdapter['setStatus']>[1]) => ui.setStatus(key, text),
    setWorkingMessage: (message: string | undefined) => ui.setWorkingMessage(message),
    setWorkingVisible: (visible: boolean) => ui.setWorkingVisible(visible),
    setWorkingIndicator: (options: Parameters<PiUiAdapter['setWorkingIndicator']>[0]) =>
      ui.setWorkingIndicator(
        options ? { ...options, frames: options.frames ? [...options.frames] : undefined } : undefined,
      ),
    setWidget: (
      key: string,
      content: Parameters<PiUiAdapter['setWidget']>[1],
      options?: Parameters<PiUiAdapter['setWidget']>[2],
    ) =>
      typeof content === 'function'
        ? ui.setWidget(key, content, options)
        : ui.setWidget(key, content ? [...content] : undefined, options),
    setFooter: (factory: Parameters<PiUiAdapter['setFooter']>[0]) => ui.setFooter(factory),
    setHeader: (factory: Parameters<PiUiAdapter['setHeader']>[0]) => ui.setHeader(factory),
    setTitle: (title: string) => ui.setTitle(title),
    custom: <A>(factory: PiCustomFactory<A>, options?: Parameters<PiUiAdapter['custom']>[1]) =>
      piOperationTryPromise('custom', () => ui.custom(factory, options)),
    pasteToEditor: (text: string) => ui.pasteToEditor(text),
    setEditorText: (text: string) => ui.setEditorText(text),
    getEditorText: () => ui.getEditorText(),
    editor: (title: string, prefill?: Parameters<PiUiAdapter['editor']>[1]) => ui.editor(title, prefill),
    addAutocompleteProvider: (factory: Parameters<PiUiAdapter['addAutocompleteProvider']>[0]) =>
      ui.addAutocompleteProvider(factory),
    setEditorComponent: (factory: Parameters<PiUiAdapter['setEditorComponent']>[0]) => ui.setEditorComponent(factory),
    getEditorComponent: () => ui.getEditorComponent(),
    theme: ui.theme,
    getAllThemes: () => ui.getAllThemes(),
    getTheme: (name: string) => ui.getTheme(name),
    setTheme: (theme: Parameters<PiUiAdapter['setTheme']>[0]) => ui.setTheme(theme),
    getToolsExpanded: () => ui.getToolsExpanded(),
    setToolsExpanded: (expanded: boolean) => ui.setToolsExpanded(expanded),
  }
}

function emptyPiUiAdapter(mode: PiMode = 'print'): PiUiAdapter {
  return {
    select: async () => undefined,
    confirm: async () => false,
    input: async () => undefined,
    notify: () => undefined,
    onTerminalInput: () => () => undefined,
    setStatus: () => undefined,
    setWorkingMessage: () => undefined,
    setWorkingVisible: () => undefined,
    setWorkingIndicator: () => undefined,
    setWidget: () => undefined,
    setFooter: () => undefined,
    setHeader: () => undefined,
    setTitle: () => undefined,
    custom: <_A>() =>
      Effect.fail(
        new PiUiUnavailableError({
          operation: 'custom',
          mode,
          message: `UI is unavailable for ${mode}.`,
        }),
      ),
    pasteToEditor: () => undefined,
    setEditorText: () => undefined,
    getEditorText: () => '',
    editor: async () => undefined,
    addAutocompleteProvider: () => undefined,
    setEditorComponent: () => undefined,
    getEditorComponent: () => undefined,
    theme: undefined,
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => undefined,
  }
}

/**
 * Creates UI operations that respect the invocation's UI availability and execution mode.
 * Interactive operations fail with `PiUiUnavailableError` when the required UI mode is unavailable.
 * @param context Invocation values that describe the Pi mode, UI availability, and abort signal.
 * @param ui Functions that call the underlying Pi UI.
 * @returns Effect-based UI operations for the invocation.
 */
function createPiUiService(context: PiContextValue, ui: PiUiAdapter): PiUiService {
  const unavailable = (operation: string): Effect.Effect<never, PiUiUnavailableError> =>
    Effect.fail(
      new PiUiUnavailableError({ operation, mode: context.mode, message: `UI is unavailable for ${context.mode}.` }),
    )
  const requireUI = <A, E>(
    operation: string,
    effect: Effect.Effect<A, E>,
  ): Effect.Effect<A, PiUiUnavailableError | E> => (context.hasUI ? effect : unavailable(operation))
  const requireTui = <A, E>(
    operation: string,
    effect: Effect.Effect<A, E>,
  ): Effect.Effect<A, PiUiUnavailableError | E> =>
    context.mode === 'tui' && context.hasUI ? effect : unavailable(operation)
  const sync = <A>(operation: string, evaluate: () => A): Effect.Effect<A, PiOperationsError> =>
    piOperationTry(operation, evaluate)
  const promise = <A>(
    operation: string,
    evaluate: (signal: AbortSignal) => Promise<A>,
  ): Effect.Effect<A, PiOperationsError> => piOperationTryPromise(operation, evaluate)
  const dialogOptions = (
    dialog: Parameters<PiUiAdapter['select']>[2],
    signal: AbortSignal,
  ): Parameters<PiUiAdapter['select']>[2] => ({
    ...dialog,
    signal: combinePiAbortSignals(dialog?.signal, context.signal, signal),
  })

  return {
    select: (
      title: string,
      options: Parameters<PiUiService['select']>[1],
      dialog?: Parameters<PiUiService['select']>[2],
    ) =>
      requireUI(
        'select',
        promise('select', (signal) => ui.select(title, options, dialogOptions(dialog, signal))),
      ),
    confirm: (
      title: string,
      message: Parameters<PiUiService['confirm']>[1],
      dialog?: Parameters<PiUiService['confirm']>[2],
    ) =>
      requireUI(
        'confirm',
        promise('confirm', (signal) => ui.confirm(title, message, dialogOptions(dialog, signal))),
      ),
    input: (
      title: string,
      placeholder?: Parameters<PiUiService['input']>[1],
      dialog?: Parameters<PiUiService['input']>[2],
    ) =>
      requireUI(
        'input',
        promise('input', (signal) => ui.input(title, placeholder, dialogOptions(dialog, signal))),
      ),
    notify: (message: string, type?: Parameters<PiUiService['notify']>[1]) =>
      context.hasUI ? sync('notify', () => ui.notify(message, type)) : Effect.succeed(undefined),
    onTerminalInput: (handler: Parameters<PiUiService['onTerminalInput']>[0]) =>
      requireTui(
        'onTerminalInput',
        sync('onTerminalInput', () => ui.onTerminalInput(handler)),
      ),
    setStatus: (key: string, text: Parameters<PiUiService['setStatus']>[1]) =>
      context.hasUI ? sync('setStatus', () => ui.setStatus(key, text)) : Effect.succeed(undefined),
    setWorkingMessage: (message: string | undefined) =>
      context.hasUI ? sync('setWorkingMessage', () => ui.setWorkingMessage(message)) : Effect.succeed(undefined),
    setWorkingVisible: (visible: boolean) =>
      context.hasUI ? sync('setWorkingVisible', () => ui.setWorkingVisible(visible)) : Effect.succeed(undefined),
    setWorkingIndicator: (options: Parameters<PiUiService['setWorkingIndicator']>[0]) =>
      context.hasUI ? sync('setWorkingIndicator', () => ui.setWorkingIndicator(options)) : Effect.succeed(undefined),
    setWidget: (
      key: string,
      content: Parameters<PiUiService['setWidget']>[1],
      options?: Parameters<PiUiService['setWidget']>[2],
    ) => (context.hasUI ? sync('setWidget', () => ui.setWidget(key, content, options)) : Effect.succeed(undefined)),
    setFooter: (factory: Parameters<PiUiService['setFooter']>[0]) =>
      context.hasUI ? sync('setFooter', () => ui.setFooter(factory)) : Effect.succeed(undefined),
    setHeader: (factory: Parameters<PiUiService['setHeader']>[0]) =>
      context.hasUI ? sync('setHeader', () => ui.setHeader(factory)) : Effect.succeed(undefined),
    setTitle: (title: string) =>
      context.hasUI ? sync('setTitle', () => ui.setTitle(title)) : Effect.succeed(undefined),
    custom: <A>(factory: PiCustomFactory<A>, options?: Parameters<PiUiService['custom']>[1]) =>
      requireTui('custom', ui.custom(factory, options).pipe(Effect.map(Option.some))),
    pasteToEditor: (text: string) =>
      context.hasUI ? sync('pasteToEditor', () => ui.pasteToEditor(text)) : Effect.succeed(undefined),
    setEditorText: (text: string) =>
      context.hasUI ? sync('setEditorText', () => ui.setEditorText(text)) : Effect.succeed(undefined),
    getEditorText: () => sync('getEditorText', () => ui.getEditorText()),
    editor: (title: string, prefill?: Parameters<PiUiService['editor']>[1]) =>
      requireTui(
        'editor',
        promise('editor', () => ui.editor(title, prefill)),
      ),
    addAutocompleteProvider: (factory: Parameters<PiUiService['addAutocompleteProvider']>[0]) =>
      context.hasUI
        ? sync('addAutocompleteProvider', () => ui.addAutocompleteProvider(factory))
        : Effect.succeed(undefined),
    setEditorComponent: (factory: Parameters<PiUiService['setEditorComponent']>[0]) =>
      requireTui(
        'setEditorComponent',
        sync('setEditorComponent', () => ui.setEditorComponent(factory)),
      ),
    getEditorComponent: () => sync('getEditorComponent', () => ui.getEditorComponent()),
    theme: () => sync('theme', () => ui.theme),
    getAllThemes: () => sync('getAllThemes', () => ui.getAllThemes()),
    getTheme: (name: string) => sync('getTheme', () => ui.getTheme(name)),
    setTheme: (theme: Parameters<PiUiService['setTheme']>[0]) => sync('setTheme', () => ui.setTheme(theme)),
    getToolsExpandedValue: () => ui.getToolsExpanded(),
    getToolsExpanded: () => sync('getToolsExpanded', () => ui.getToolsExpanded()),
    setToolsExpanded: (expanded: boolean) => sync('setToolsExpanded', () => ui.setToolsExpanded(expanded)),
  }
}

/** Service tag for Pi UI operations. */
class PiUi extends Context.Service<PiUi, PiUiService>()('pi-effect/PiUi') {}

export {
  createPiUiAdapter,
  createPiUiService,
  emptyPiUiAdapter,
  type PiCustomFactory,
  PiUi,
  type PiUiAdapter,
  type PiUiDialogOptions,
  type PiUiService,
  type PiWidgetOptions,
  type PiWorkingIndicatorOptions,
}
