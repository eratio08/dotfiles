/** Error classes returned by host operations, registrations, tools, and runtime shutdown. */
export {
  type PiExtensionError,
  PiHostError,
  PiRegistrationError,
  PiRuntimeDisposedError,
  PiToolError,
  PiUiUnavailableError,
} from './errors.ts'
/** Plugin definition types accepted by the installation API. */
export type { PiPlugin, PiPluginDefinition } from './plugin.ts'
/** Plugin definition and installation helpers. */
export { PiExtension } from './plugin.ts'
/** Event, command, shortcut, flag, tool, and renderer registration types. */
export type {
  PiCommandDefinition,
  PiCommandRegistry,
  PiEventHandler,
  PiEventMap,
  PiEventName,
  PiEventOptions,
  PiEventRegistry,
  PiEventResultMap,
  PiFailurePolicy,
  PiFlagDefinition,
  PiFlagRegistry,
  PiRegistrationContext,
  PiRendererRegistry,
  PiShortcutDefinition,
  PiShortcutRegistry,
  PiToolRegistry,
} from './registries.ts'
/** Renderer types supported by Pi extensions. */
export type { PiEntryRenderer, PiMessageRenderer } from './renderers.ts'
/** Context, session, host, UI, and service operation types. */
export type {
  PiCommandContextValue,
  PiCompactOptions,
  PiContent,
  PiContextUsage,
  PiContextValue,
  PiCustomFactory,
  PiCustomMessage,
  PiInvocationServices,
  PiMode,
  PiSendMessageOptions,
  PiSendUserMessageOptions,
  PiSessionChangeOptions,
  PiSessionChangeResult,
  PiSessionContextValue,
  PiSessionReplacement,
  PiStableServices,
  PiTheme,
  PiToolContextValue,
  PiToolExecutionMode,
  PiToolUpdate,
  PiTui,
  PiUiDialogOptions,
  PiUiService,
  PiWidgetOptions,
  PiWorkingIndicatorOptions,
} from './services.ts'
/** Effect service tags for Pi operations and invocation context. */
export {
  Pi,
  PiCommandContext,
  PiContext,
  PiFlags,
  PiHostService,
  PiMessages,
  PiProcess,
  type PiServices,
  PiSession,
  PiSessionContext,
  PiToolContext,
  PiTools,
  PiUi,
} from './services.ts'
/** Types for Effect-based tools and their results. */
export type { EffectToolDefinition, PiToolResult } from './tools.ts'
