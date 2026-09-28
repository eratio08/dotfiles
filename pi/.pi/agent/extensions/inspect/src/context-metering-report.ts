import type { ContextUsage } from '@earendil-works/pi-coding-agent'
import type { Contribution, EntryStatistics, MessageView, SessionAnalysis } from './analysis.ts'

type VisibleEntryMessage = {
  message: MessageView
  historical: boolean
}

type ToolLinkTargets = {
  calls: Map<string, string>
  results: Map<string, string>
  tools: Map<string, string>
}

type SourceMetrics = {
  loadoutTokens: number | null
  oneTimeTokens: number | null
  latestRequestTokens: number
  latestIncluded: boolean
}

type SourceGroupDescription = {
  key: keyof SessionAnalysis['sourceGroups']
  label: string
  color: string
}

const sourceGroupDescriptions: readonly SourceGroupDescription[] = [
  { key: 'systemPromptAndInstructionFiles', label: 'System prompt and instruction files', color: '#61a5c2' },
  { key: 'toolDefinitionsAndPromptText', label: 'Tool definitions and attributable prompt text', color: '#9b8bd1' },
  { key: 'toolCallsAndResults', label: 'Tool calls and results', color: '#e1a85d' },
  { key: 'otherConversation', label: 'Other conversation', color: '#77b889' },
  { key: 'unattributedContent', label: 'Unattributed content', color: '#d77777' },
]

const reportStyles = `
:root{color-scheme:dark;--bg:#111820;--panel:#19232d;--panel-2:#202d38;--text:#e8eef3;--muted:#a6b3bf;--line:#354552;--accent:#70c1d6;--warning:#f1c979;--good:#83c99b;--bad:#ef9191;font:15px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text)}
a{color:#9bd8e8}
a:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.skip-link{position:absolute;left:16px;top:-60px;z-index:50;background:var(--accent);color:#0b171d;padding:8px 12px;border-radius:6px}
.skip-link:focus{top:8px}
button{font:inherit}
header,.page{width:min(1240px,100% - 32px);margin:0 auto}
header{padding:32px 0 20px}
h1,h2,h3,h4,p{margin-top:0}
h1{font-size:clamp(2rem,4vw,3rem);line-height:1.1;margin-bottom:12px}
h2{font-size:1.45rem;margin:32px 0 14px}
h3{font-size:1.05rem;margin-bottom:8px}
.eyebrow,.muted,.subtle{color:var(--muted)}
.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:.76rem;font-weight:700}
.warning{border:1px solid #725f34;border-left:4px solid var(--warning);background:#292518;color:#f7e7bf;padding:12px 14px;border-radius:8px}
.metadata{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px 18px;margin:20px 0}
.metadata div,.card,.panel,.entry,.loadout-event{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:13px}
.metadata dt,.metric-label{font-size:.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.metadata dd{margin:2px 0 0;overflow-wrap:anywhere}
.tabs{position:sticky;top:0;z-index:20;display:flex;gap:8px;padding:10px max(16px,calc((100vw - 1240px)/2));background:#111820ed;border-bottom:1px solid var(--line);backdrop-filter:blur(12px)}
.tab{border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--text);padding:9px 16px;cursor:pointer}
.tab[aria-selected="true"]{background:var(--accent);border-color:var(--accent);color:#0b171d;font-weight:700}
.page{padding-bottom:56px}
[hidden]{display:none!important}
.metrics-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
.metric-card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:15px}
.metric-value{font-size:1.45rem;font-variant-numeric:tabular-nums;font-weight:700;margin:5px 0 0}
.metric-note{color:var(--muted);font-size:.82rem;margin:4px 0 0}
.loadout{display:grid;gap:10px}
.loadout-summary{color:var(--muted);margin-bottom:10px}
.source-row,.detail-popover,.message-detail{position:relative;border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:9px 11px;margin:8px 0}
.source-row>summary,.detail-popover>summary,.message-detail>summary,.inline-cost-details>summary{cursor:pointer;font-weight:650}
.source-row pre,.detail-popover pre,.message-detail pre,.message-text,.tool-output,.tool-arguments{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}
.source-row pre,.detail-popover pre,.message-detail pre{margin:10px 0 0;background:#10171d;padding:10px;border-radius:6px;max-height:420px;overflow:auto}
.popover{display:none;position:absolute;z-index:30;left:0;top:calc(100% + 6px);width:min(440px,85vw);padding:12px;background:#0c1217;border:1px solid #6b8494;border-radius:8px;box-shadow:0 12px 32px #0009}
.detail-popover:hover .popover,.detail-popover:focus-within .popover,.detail-popover[open] .popover{display:block}
.source-row:not([open]):hover>:not(summary),.source-row:not([open]):focus-within>:not(summary){display:block}
.source-row:hover .detail-popover .popover,.source-row:focus-within .detail-popover .popover{display:block}
.inline-cost-details{margin-top:8px}
.inline-cost-detail-content{padding-top:8px}
.popover dl,.inline-cost-detail-content dl{display:grid;grid-template-columns:minmax(130px,.8fr) 1.2fr;gap:4px 10px;margin:0}
.popover dt,.inline-cost-detail-content dt{color:var(--muted)}
.popover dd,.inline-cost-detail-content dd{margin:0;overflow-wrap:anywhere}
.detail-list{display:grid;gap:8px}
.detail-list .source-row{margin:0}
.timeline{list-style:none;padding:0;margin:0;display:grid;gap:12px}
.entry{scroll-margin-top:80px;padding:0;overflow:hidden}
.entry[open]{overflow:visible;position:relative;z-index:1}
.entry[open]:hover,.entry[open]:focus-within{z-index:2}
.entry-node{margin:0}
.entry-summary{list-style:none;display:grid;grid-template-columns:16px minmax(180px,1fr) minmax(112px,auto) minmax(118px,auto) minmax(100px,auto) auto;align-items:center;gap:12px;padding:12px;cursor:pointer}
.entry-summary::-webkit-details-marker,.tool-card-summary::-webkit-details-marker,.invocation-summary::-webkit-details-marker{display:none}
.disclosure-glyph{color:var(--accent);font-size:1.15rem;line-height:1;transition:transform .15s ease}
.entry[open]>.entry-summary .disclosure-glyph,.tool-card[open]>.tool-card-summary .disclosure-glyph,.invocation-row[open]>.invocation-summary .disclosure-glyph{transform:rotate(90deg)}
.entry-summary:hover,.tool-card-summary:hover,.invocation-summary:hover{background:var(--panel-2)}
.entry[open]>.entry-summary,.tool-card[open]>.tool-card-summary{border-bottom:1px solid var(--line);background:var(--panel-2)}
.entry-main{display:flex;align-items:center;gap:9px;min-width:0}
.entry-role{font-weight:700;white-space:nowrap}
.entry-preview{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)}
.entry-timestamp{color:var(--muted);font-size:.78rem;white-space:nowrap}
.entry-token-count,.entry-share{display:grid;gap:1px;white-space:nowrap;font-variant-numeric:tabular-nums}
.entry-token-count small,.entry-share small{font-size:.7rem;color:var(--muted)}
.entry-expanded{padding:0 13px 13px}
.nested-entry-list{list-style:none;margin:8px 0 0 22px;padding:0 0 0 14px;border-left:2px solid var(--line);display:grid;gap:8px}
.nested-entry-list>.entry-node{position:relative}
.nested-entry-list>.entry-node::before{content:"";position:absolute;left:-16px;top:22px;width:14px;border-top:2px solid var(--line)}
.entry-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.entry-title{margin:0}
.entry-meta,.badges{display:flex;gap:7px;align-items:center;flex-wrap:wrap;color:var(--muted);font-size:.84rem}
.badge{display:inline-block;border:1px solid var(--line);border-radius:99px;padding:2px 8px;font-size:.78rem;color:var(--muted)}
.badge-current{border-color:#416e51;color:#b7e8c3}.badge-omitted,.badge-compacted,.badge-historical{border-color:#79524f;color:#f0b3a9}.badge-replaced{border-color:#826c3e;color:#f3d68d}
.entry-metrics{display:flex;gap:14px;flex-wrap:wrap;padding:8px 0;color:var(--muted);font-size:.84rem}
.message{border-top:1px solid var(--line);padding:12px 0 2px;overflow-wrap:anywhere}
.message.historical{opacity:.78}
.message-role{font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:700}
.message-text{margin:7px 0}
.tool-message{background:var(--panel-2);border-left:3px solid #c5904f;border-radius:6px;padding:10px;margin:9px 0}
.tool-message.error{border-left-color:var(--bad)}
.tool-heading{display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap}
.tool-links{display:flex;gap:10px;flex-wrap:wrap;font-size:.86rem}
.tool-definition{margin:8px 0}
.tool-definition summary{cursor:pointer;color:#c6b6ed}
.tool-list{display:grid;gap:10px}
.tool-card{border:1px solid var(--line);border-radius:10px;background:var(--panel)}
.tool-card-summary{list-style:none;display:grid;grid-template-columns:16px minmax(130px,1fr) minmax(180px,1.15fr) minmax(180px,1.2fr) minmax(190px,1.2fr);align-items:center;gap:12px;padding:12px;cursor:pointer}
.tool-card-name{font-weight:750;overflow-wrap:anywhere}
.tool-card-static,.tool-card-dynamic,.tool-card-outcomes{display:grid;gap:2px;line-height:1.35}
.tool-card-static small,.tool-card-dynamic small,.tool-card-outcomes small{font-size:.75rem;color:var(--muted)}
.tool-card-static strong,.tool-card-dynamic strong,.tool-card-outcomes strong{font-variant-numeric:tabular-nums}
.tool-card-expanded{border-top:1px solid var(--line);padding:12px}
.tool-total-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;margin:10px 0}
.tool-total-metrics div{border:1px solid var(--line);border-radius:8px;background:var(--panel-2);padding:8px}
.tool-total-metrics dt{font-size:.75rem;color:var(--muted)}
.tool-total-metrics dd{margin:2px 0 0;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.invocation-timeline{list-style:none;display:grid;gap:8px;margin:0;padding:0}
.invocation-node{margin:0}
.invocation-row{border:1px solid var(--line);border-radius:8px;background:var(--panel-2)}
.invocation-summary{list-style:none;display:grid;grid-template-columns:16px minmax(140px,1fr) minmax(90px,auto) minmax(230px,1.2fr);align-items:center;gap:12px;padding:10px;cursor:pointer}
.invocation-summary time{font-size:.82rem;color:var(--muted);font-variant-numeric:tabular-nums}
.outcome{display:inline-block;width:max-content;border:1px solid var(--line);border-radius:99px;padding:1px 8px;font-size:.8rem;white-space:nowrap}
.outcome-success{border-color:#416e51;color:#b7e8c3}
.outcome-failure{border-color:#79524f;color:#f0b3a9}
.outcome-unknown{border-color:#826c3e;color:#f3d68d}
.invocation-token-summary{display:flex;justify-content:flex-end;align-items:center;gap:6px;font-variant-numeric:tabular-nums}
.invocation-token-summary span{font-size:.76rem;color:var(--muted)}
.invocation-expanded{padding:0 10px 10px}
.tool-invocation-links{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:.86rem}
.tool-invocation-links>span{color:var(--muted)}
.tool-arguments,.tool-output{margin:8px 0 0;background:#10171d;padding:10px;border-radius:6px;max-height:420px;overflow:auto}
.prompt-change{border-color:#547b89;background:#172831}
.prompt-change h3{margin-bottom:4px}
.image-preview{display:block;max-width:min(100%,640px);max-height:480px;object-fit:contain;margin:8px 0;border:1px solid var(--line);border-radius:8px}
.request-composition,.advanced-estimates{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:12px;margin:12px 0}
.request-composition-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}
.request-composition-heading h3{margin-bottom:4px}
.request-composition-heading p{margin-bottom:0}
.request-composition-heading>strong{font-size:1.2rem;white-space:nowrap;font-variant-numeric:tabular-nums}
.request-composition-bar{display:flex;overflow:hidden;height:18px;border:1px solid var(--line);border-radius:99px;background:var(--panel-2)}
.request-composition-segment{display:block;height:100%;min-width:1px}
.legend-name{display:flex;align-items:center;gap:8px;min-width:0}
.advanced-estimates>summary{cursor:pointer;font-weight:700}
.chart-layout{display:grid;grid-template-columns:minmax(200px,280px) 1fr;gap:20px;align-items:center}
.donut{width:100%;max-width:260px;height:auto}
.chart-legend{list-style:none;margin:0;padding:0;display:grid;gap:7px}
.chart-legend li{display:flex;justify-content:space-between;gap:14px;border-bottom:1px solid var(--line);padding:6px 0}
.legend-label{display:flex;align-items:center;gap:8px}
.swatch{width:12px;height:12px;border-radius:3px;flex:0 0 12px}
.legend-value,.number{font-variant-numeric:tabular-nums;white-space:nowrap}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:9px}
table{border-collapse:collapse;width:100%;min-width:920px;background:var(--panel)}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{position:sticky;top:0;background:var(--panel-2);font-size:.8rem;color:var(--muted)}
td.number{text-align:right}
.largest{color:#ffe09b;font-weight:750;background:#43371e}
.largest::after{content:" largest";display:block;font-size:.68rem;color:#f1d49a}
.status-note{padding:10px 12px;background:var(--panel-2);border-radius:8px;color:var(--muted)}
.section-heading{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap}
.provider-table{min-width:700px}
footer{border-top:1px solid var(--line);margin-top:32px;padding:16px 0;color:var(--muted);font-size:.85rem}
@media(max-width:680px){header,.page{width:calc(100% - 22px)}header{padding-top:22px}.chart-layout{grid-template-columns:1fr}.donut{max-width:220px;margin:auto}.popover{position:fixed;left:5vw;top:auto;bottom:12px;width:90vw;max-height:65vh;overflow:auto}.entry-metrics{gap:8px}.tab{flex:1}}
.tool-definition-details{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:9px 11px;margin:8px 0}
.tool-definition-details>summary{cursor:pointer;font-weight:650}
.tool-definition-content{padding-top:8px}
.tool-definition-content p{margin:0}
.tool-definition-content pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:10px 0 0;background:#10171d;padding:10px;border-radius:6px;max-height:420px;overflow:auto}
@media(max-width:680px){.entry-summary{grid-template-columns:16px minmax(0,1fr) auto;gap:7px}.entry-main{grid-column:2/-1}.entry-timestamp{grid-column:2;grid-row:2}.entry-token-count{grid-column:3;grid-row:2;justify-self:end}.entry-share{grid-column:2;grid-row:3}.entry-summary>.badge{grid-column:3;grid-row:3;justify-self:end}.nested-entry-list{margin-left:12px;padding-left:10px}.tool-card-summary{grid-template-columns:16px minmax(0,1fr) minmax(0,1fr);gap:8px}.tool-card-name{grid-column:2/-1}.tool-card-static{grid-column:2}.tool-card-dynamic{grid-column:3}.tool-card-outcomes{grid-column:2/-1}.invocation-summary{grid-template-columns:16px minmax(0,1fr) auto;gap:8px}.invocation-summary time{grid-column:2}.invocation-summary .outcome{grid-column:3;grid-row:1}.invocation-token-summary{grid-column:2/-1;justify-content:flex-start}.request-composition-heading{flex-direction:column}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`

const reportScript = `
const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
function activateTab(tab) {
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(item.getAttribute('aria-controls'));
    if (panel) panel.hidden = !selected;
  }
}
for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => activateTab(tab));
  tab.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(index + offset + tabs.length) % tabs.length];
    if (next) {
      next.focus();
      activateTab(next);
    }
  });
}
function activateHashTarget() {
  if (!location.hash) return;
  const target = document.getElementById(location.hash.slice(1));
  if (!target) return;
  const panel = target.closest('[role="tabpanel"]');
  const tab = tabs.find((item) => item.getAttribute('aria-controls') === panel?.id);
  if (tab) activateTab(tab);
  for (let current = target; current; current = current.parentElement) {
    if (current instanceof HTMLDetailsElement) current.open = true;
  }
  target.scrollIntoView({ block: 'start' });
}
window.addEventListener('hashchange', activateHashTarget);
activateHashTarget();
`

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === '&') return '&amp;'
    if (character === '<') return '&lt;'
    if (character === '>') return '&gt;'
    if (character === '"') return '&quot;'
    return '&#39;'
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Unavailable'
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(value)
}

function tokenLabel(value: number | null | undefined): string {
  const formatted = formatTokens(value)
  return formatted === 'Unavailable' ? formatted : `${formatted} ${value === 1 ? 'token' : 'tokens'}`
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Unavailable'
  return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(value)}%`
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return '[Structured content could not be displayed]'
  }
}

function getVisibleEntryMessages(entry: EntryStatistics): VisibleEntryMessage[] {
  const replaced = entry.contextStatus === 'replaced'
  const historical =
    entry.contextStatus === 'compacted' || entry.contextStatus === 'omitted' || entry.contextStatus === 'historical'
  const messages = entry.rawMessages.map((message) => ({ message, historical: historical || replaced }))
  if (replaced) messages.push(...entry.effectiveMessages.map((message) => ({ message, historical: false })))
  return messages
}

function getContentBlocks(content: unknown): Record<string, unknown>[] {
  return Array.isArray(content) ? content.filter(isRecord) : []
}

function createToolLinkTargets(analysis: SessionAnalysis): ToolLinkTargets {
  const calls = new Map<string, string>()
  const results = new Map<string, string>()
  const tools = new Map<string, string>()

  for (const [entryIndex, entry] of analysis.entries.entries()) {
    for (const [messageIndex, visible] of getVisibleEntryMessages(entry).entries()) {
      const message = visible.message
      if (message.role === 'assistant') {
        for (const [blockIndex, block] of getContentBlocks(message.content).entries()) {
          if (block.type === 'toolCall' && typeof block.id === 'string') {
            calls.set(block.id, `call-${entryIndex}-${messageIndex}-${blockIndex}`)
          }
        }
      } else if (message.role === 'toolResult' && typeof message.toolCallId === 'string') {
        results.set(message.toolCallId, `result-${entryIndex}-${messageIndex}`)
      }
    }
  }

  for (const [index, tool] of analysis.tools.entries()) tools.set(tool.name, `tool-card-${index}`)

  return { calls, results, tools }
}

function sumTokens(contributions: readonly Contribution[]): number {
  return contributions.reduce((total, contribution) => total + contribution.tokens, 0)
}

function renderCostRows(source: string, identifier: string, metrics: SourceMetrics): string {
  const latestLabel = metrics.latestIncluded ? 'Included' : 'Not included'
  return `<dl><dt>Source</dt><dd>${escapeHtml(source)}</dd><dt>Source, entry, or call ID</dt><dd>${escapeHtml(identifier || 'Unavailable')}</dd><dt>Per-request loadout cost</dt><dd>${tokenLabel(metrics.loadoutTokens)}</dd><dt>One-time message addition</dt><dd>${tokenLabel(metrics.oneTimeTokens)}</dd><dt>Latest request cost</dt><dd>${tokenLabel(metrics.latestRequestTokens)}</dd><dt>Latest request inclusion</dt><dd>${latestLabel}</dd></dl>`
}

function renderCostDetails(label: string, source: string, identifier: string, metrics: SourceMetrics): string {
  return `<details class="inline-cost-details"><summary>${escapeHtml(label)}</summary><div class="inline-cost-detail-content">${renderCostRows(source, identifier, metrics)}</div></details>`
}

function contributionMetrics(
  analysis: SessionAnalysis,
  contributions: readonly Contribution[],
  loadoutTokens: number | null = contributions.length > 0 ? sumTokens(contributions) : null,
): SourceMetrics {
  const identifiers = new Set(contributions.map((item) => item.id))
  const latestRequest = analysis.requests.at(-1)
  const latestRequestTokens =
    latestRequest?.contributions.reduce((total, item) => total + (identifiers.has(item.id) ? item.tokens : 0), 0) ?? 0
  return {
    loadoutTokens,
    oneTimeTokens: null,
    latestRequestTokens,
    latestIncluded: latestRequest?.contributions.some((item) => identifiers.has(item.id)) ?? false,
  }
}

function getSectionContributions(
  sectionName: string,
  text: string,
  contributions: readonly Contribution[],
): Contribution[] {
  if (sectionName.startsWith('metering:instruction:')) {
    const source = sectionName.split(':').slice(3).join(':')
    return contributions.filter((item) => item.kind === 'instruction-file' && item.source === source)
  }
  if (sectionName.startsWith('metering:tool-prompt:')) {
    const toolName = sectionName.slice('metering:tool-prompt:'.length)
    return contributions.filter((item) => item.kind === 'tool-prompt' && item.toolName === toolName)
  }
  if (sectionName === 'metering:unattributed') {
    return contributions.filter((item) => item.id === 'unattributed:current-prompt')
  }
  if (sectionName === 'project_context') {
    return contributions.filter(
      (item) =>
        item.source === 'project_context' ||
        (item.kind === 'instruction-file' && item.source !== undefined && text.includes(`path="${item.source}"`)),
    )
  }
  return contributions.filter(
    (item) =>
      item.source === sectionName ||
      item.id === `prompt-section:${sectionName}` ||
      (sectionName === 'tools' && item.kind === 'tool-prompt'),
  )
}

function sectionLabel(sectionName: string): string {
  if (sectionName === 'metering:unattributed') return 'Unattributed current prompt text'
  if (sectionName.startsWith('metering:instruction:')) {
    return `Instruction file: ${sectionName.split(':').slice(3).join(':')}`
  }
  if (sectionName.startsWith('metering:tool-prompt:')) {
    return `Tool prompt text: ${sectionName.slice('metering:tool-prompt:'.length)}`
  }
  return sectionName
}

function renderInstructionFiles(
  section: string,
  analysis: SessionAnalysis,
  contributions: readonly Contribution[],
): string {
  const pattern = /<project_instructions path="([^"]+)">([\s\S]*?)<\/project_instructions>/g
  const matches = [...section.matchAll(pattern)]
  if (matches.length === 0) return `<pre>${escapeHtml(section)}</pre>`

  const parts: string[] = []
  let cursor = 0
  for (const match of matches) {
    const start = match.index
    const matchedText = match[0] ?? ''
    if (start === undefined || !matchedText) continue
    if (start > cursor) parts.push(`<pre>${escapeHtml(section.slice(cursor, start))}</pre>`)
    const path = match[1] ?? 'Unknown path'
    const content = match[2] ?? ''
    const contribution = contributions.find((item) => item.kind === 'instruction-file' && item.source === path)
    const metrics = contributionMetrics(analysis, contribution ? [contribution] : [], contribution?.tokens ?? null)
    parts.push(
      `<details class="source-row"><summary>Instruction file: ${escapeHtml(path)} · ${tokenLabel(contribution?.tokens)}</summary><pre>${escapeHtml(content)}</pre>${renderCostDetails('Instruction file details', path, contribution?.id ?? path, metrics)}</details>`,
    )
    cursor = start + matchedText.length
  }
  if (cursor < section.length) parts.push(`<pre>${escapeHtml(section.slice(cursor))}</pre>`)
  return parts.join('')
}

function renderToolPromptSources(
  section: string,
  analysis: SessionAnalysis,
  contributions: readonly Contribution[],
): string {
  const toolNames = [
    ...new Set(
      contributions
        .filter((item) => item.kind === 'tool-prompt')
        .map((item) => item.toolName)
        .filter((name): name is string => name !== undefined),
    ),
  ].sort((left, right) => right.length - left.length)
  const lines = section.match(/[^\n]*\n|[^\n]+$/g) ?? []
  if (lines.length === 0) return '<p class="muted">No tool prompt text is saved.</p>'

  return lines
    .map((line, index) => {
      const content = line.endsWith('\n') ? line.slice(0, -1) : line
      const toolName = toolNames.find((name) => content.startsWith(`- ${name}:`))
      const contribution = toolName
        ? contributions.find((item) => item.kind === 'tool-prompt' && item.toolName === toolName)
        : contributions.find((item) => item.id === `prompt-section:tools:${index}`)
      const source = toolName ? `${toolName} prompt snippet` : 'Shared or unattributed tool prompt text'
      const identifier = contribution?.id ?? `prompt-section:tools:${index}`
      const metrics = contributionMetrics(analysis, contribution ? [contribution] : [], contribution?.tokens ?? null)
      return `<details class="source-row"><summary>${escapeHtml(source)} · ${tokenLabel(contribution?.tokens)} per request</summary><pre>${escapeHtml(line)}</pre>${renderCostDetails('Tool prompt details', source, identifier, metrics)}</details>`
    })
    .join('')
}

function renderPromptSection(
  sectionName: string,
  text: string,
  analysis: SessionAnalysis,
  contributions: readonly Contribution[],
): string {
  const matching = getSectionContributions(sectionName, text, contributions)
  const cost = sumTokens(matching)
  const label = sectionLabel(sectionName)
  const content =
    sectionName === 'project_context'
      ? renderInstructionFiles(text, analysis, matching)
      : sectionName === 'tools'
        ? renderToolPromptSources(text, analysis, matching)
        : `<pre>${escapeHtml(text)}</pre>`
  const metrics = contributionMetrics(analysis, matching, cost)

  const identifier = matching.map((item) => item.id).join(', ') || sectionName
  return `<details class="source-row"><summary>${escapeHtml(label)} · ${tokenLabel(cost)} per request</summary>${content}${renderCostDetails('Prompt section details', label, identifier, metrics)}</details>`
}

function renderToolDefinition(
  tool: { name: string; description?: unknown; parameters?: unknown },
  analysis: SessionAnalysis,
  contributions: readonly Contribution[],
): string {
  const contribution = contributions.find((item) => item.kind === 'tool-definition' && item.toolName === tool.name)
  const loadoutTokens = contribution?.tokens ?? null
  const metrics = contributionMetrics(analysis, contribution ? [contribution] : [], loadoutTokens)
  const schema = tool.parameters === undefined ? 'Unavailable' : jsonText(tool.parameters)
  const description = stringValue(tool.description, 'No description saved.')

  return `<details class="source-row tool-definition"><summary>Tool definition: ${escapeHtml(tool.name)} · ${tokenLabel(loadoutTokens)} per request</summary><p>${escapeHtml(description)}</p><pre>${escapeHtml(schema)}</pre>${renderCostDetails('Tool definition details', tool.name, contribution?.id ?? tool.name, metrics)}</details>`
}

function renderSystemSnapshot(
  message: MessageView | undefined,
  analysis: SessionAnalysis,
  contributions: readonly Contribution[],
  includeToolDefinitions = true,
): string {
  if (!message) return '<p class="status-note">No saved system snapshot is available.</p>'
  const rows: string[] = []
  const hasContent =
    typeof message.content === 'string'
      ? message.content.length > 0
      : Array.isArray(message.content) && message.content.length > 0
  const contentContributions = contributions.filter((item) => item.kind === 'system-content')
  if (hasContent) {
    const cost = sumTokens(contentContributions)
    const metrics = contributionMetrics(analysis, contentContributions, cost)
    rows.push(
      `<details class="source-row"><summary>System prompt content · ${tokenLabel(cost)} per request</summary>${renderPromptContent(message.content)}${renderCostDetails('System prompt details', 'System prompt content', contentContributions.map((item) => item.id).join(', '), metrics)}</details>`,
    )
  }
  for (const [sectionName, value] of Object.entries(message.sections ?? {})) {
    if (value === null) continue
    rows.push(renderPromptSection(sectionName, value, analysis, contributions))
  }
  if (includeToolDefinitions) {
    for (const tool of message.toolsAdded ?? []) {
      rows.push(renderToolDefinition(tool, analysis, contributions))
    }
  }
  const formatting = contributions.find((item) => item.id === 'tool-definition-formatting')
  if (formatting) {
    rows.push(`<p class="subtle">Shared tool declaration formatting: ${tokenLabel(formatting.tokens)} per request.</p>`)
  }
  if (rows.length === 0) rows.push('<p class="muted">The saved loadout is empty.</p>')
  return `<div class="loadout">${rows.join('')}</div>`
}

function renderToolDefinitionDetails(
  name: string,
  label: string,
  description: unknown,
  parameters: unknown,
  estimatedTokens: number,
  scopeLabel: string,
): string {
  const schema = parameters === undefined ? 'Unavailable' : jsonText(parameters)
  return `<details class="tool-definition-details"><summary>${escapeHtml(label)}: ${escapeHtml(name)} · ${tokenLabel(estimatedTokens)} estimated ${escapeHtml(scopeLabel)}</summary><div class="tool-definition-content"><p><strong>Description</strong></p><p>${escapeHtml(stringValue(description, 'No description saved.'))}</p><p><strong>Schema</strong></p><pre>${escapeHtml(schema)}</pre></div></details>`
}

function renderToolContextDetails(analysis: SessionAnalysis, toolName: string): string {
  const definitionVersions = new Map<
    string,
    { description: unknown; parameters: unknown; tokens: number; requestIndexes: Set<number> }
  >()
  const promptVersions = new Map<string, { text: string; tokens: number; requestIndexes: Set<number> }>()
  const requests =
    analysis.requests.length > 0
      ? analysis.requests
      : analysis.baseline.systemMessage
        ? [
            {
              index: 0,
              loadoutMessage: analysis.baseline.systemMessage,
              contributions: analysis.baseline.contributions,
            },
          ]
        : []

  for (const request of requests) {
    const message = request.loadoutMessage
    if (!message) continue

    const definition = message.toolsAdded?.find((item) => item.name === toolName)
    if (definition) {
      const description = stringValue(definition.description, 'No description saved.')
      const key = JSON.stringify([description, jsonText(definition.parameters)])
      const version = definitionVersions.get(key) ?? {
        description,
        parameters: definition.parameters,
        tokens: 0,
        requestIndexes: new Set<number>(),
      }
      version.tokens += sumTokens(
        request.contributions.filter((item) => item.kind === 'tool-definition' && item.toolName === toolName),
      )
      version.requestIndexes.add(request.index)
      definitionVersions.set(key, version)
    }

    const sections = message.sections ?? {}
    const toolPromptLines =
      typeof sections.tools === 'string'
        ? sections.tools
            .split(/\r?\n/)
            .filter((line) => line.startsWith(`- ${toolName}:`))
            .join('\n')
        : ''
    const promptText = [sections[`metering:tool-prompt:${toolName}`], toolPromptLines]
      .filter((text): text is string => typeof text === 'string' && text.length > 0)
      .join('\n')
    if (!promptText) continue

    const version = promptVersions.get(promptText) ?? {
      text: promptText,
      tokens: 0,
      requestIndexes: new Set<number>(),
    }
    version.tokens += sumTokens(
      request.contributions.filter((item) => item.kind === 'tool-prompt' && item.toolName === toolName),
    )
    version.requestIndexes.add(request.index)
    promptVersions.set(promptText, version)
  }

  const definitionRows = [...definitionVersions.values()]
    .map((version, index) => {
      const label = definitionVersions.size === 1 ? 'Definition' : `Definition version ${formatTokens(index + 1)}`
      const scopeLabel =
        analysis.requests.length === 0
          ? 'in the saved baseline'
          : `across ${formatTokens(version.requestIndexes.size)} ${version.requestIndexes.size === 1 ? 'request' : 'requests'}`
      return renderToolDefinitionDetails(
        toolName,
        label,
        version.description,
        version.parameters,
        version.tokens,
        scopeLabel,
      )
    })
    .join('')
  const promptRows = [...promptVersions.values()]
    .map((version) => {
      const scopeLabel =
        analysis.requests.length === 0
          ? 'in the saved baseline'
          : `across ${formatTokens(version.requestIndexes.size)} ${version.requestIndexes.size === 1 ? 'request' : 'requests'}`
      return `<details class="tool-prompt-source"><summary>Prompt guidance and examples · ${tokenLabel(version.tokens)} estimated ${scopeLabel}</summary><pre>${escapeHtml(version.text)}</pre></details>`
    })
    .join('')
  const definitionContent = definitionRows || '<p class="muted">No saved tool description or schema is available.</p>'
  const promptContent =
    promptRows || '<p class="muted">No saved tool-specific prompt guidance or examples are available.</p>'

  return `<section class="tool-context-details"><h4>Static tool context</h4><p class="subtle">Each source shows its estimated exposure across requests that include the saved text.</p>${definitionContent}${promptContent}</section>`
}

function renderImage(block: Record<string, unknown>): string {
  const mimeType = stringValue(block.mimeType).toLowerCase()
  const data = stringValue(block.data)
  if (!data || !/^image\/(png|jpeg|webp|gif|bmp)$/.test(mimeType) || !/^[a-z\d+/=\r\n]+$/i.test(data)) {
    return '<p class="muted">[Image content is not available for safe inline display]</p>'
  }
  const source = `data:${mimeType};base64,${data.replace(/\s/g, '')}`
  return `<img class="image-preview" alt="Conversation image" loading="lazy" src="${escapeHtml(source)}">`
}

function renderPromptContent(content: unknown): string {
  if (typeof content === 'string') return `<pre>${escapeHtml(content)}</pre>`
  const blocks = getContentBlocks(content)
  if (blocks.length === 0) return `<pre>${escapeHtml(jsonText(content))}</pre>`
  return blocks
    .map((block) => {
      if (block.type === 'text') return `<pre>${escapeHtml(stringValue(block.text))}</pre>`
      if (block.type === 'image') return renderImage(block)
      return `<p class="muted">[${escapeHtml(stringValue(block.type, 'Unknown'))} prompt block]</p>`
    })
    .join('')
}

function renderToolCallBlock(
  block: Record<string, unknown>,
  entryIndex: number,
  messageIndex: number,
  blockIndex: number,
  targets: ToolLinkTargets,
): string {
  const toolName = stringValue(block.name, 'Unknown tool')
  const toolCallId = stringValue(block.id, 'Unknown call ID')
  const argumentsText = jsonText(block.arguments)
  const callTarget = `call-${entryIndex}-${messageIndex}-${blockIndex}`
  const resultTarget = targets.results.get(toolCallId)
  const toolTarget = targets.tools.get(toolName)
  const toolLink = toolTarget ? `<a href="#${escapeHtml(toolTarget)}">View tool details</a>` : ''
  const resultLink = resultTarget
    ? `<a href="#${escapeHtml(resultTarget)}">View tool result</a>`
    : '<span class="muted">No saved result</span>'

  return `<section class="tool-message" id="${callTarget}"><div class="tool-heading"><strong>${escapeHtml(toolName)} call</strong></div><p>Call ID: <code>${escapeHtml(toolCallId)}</code></p><div class="tool-links">${toolLink}${resultLink}</div><pre class="tool-arguments">Arguments\n${escapeHtml(argumentsText)}</pre></section>`
}

function renderToolResultMessage(
  message: MessageView,
  entryIndex: number,
  messageIndex: number,
  targets: ToolLinkTargets,
): string {
  const toolCallId = stringValue(message.toolCallId, 'Unknown call ID')
  const toolName = stringValue(message.toolName, 'Unknown tool')
  const callTarget = targets.calls.get(toolCallId)
  const callLink = callTarget
    ? `<a href="#${escapeHtml(callTarget)}">View tool call</a>`
    : '<span class="muted">No saved call</span>'
  const error = message.isError ? ' error' : ''
  const state = message.isError ? 'Error result' : 'Tool result'

  return `<section class="tool-message${error}" id="result-${entryIndex}-${messageIndex}"><div class="tool-heading"><strong>${escapeHtml(toolName)} · ${state}</strong></div><p>Call ID: <code>${escapeHtml(toolCallId)}</code></p><div class="tool-links">${callLink}</div>${renderMessageContent(message.content, entryIndex, messageIndex, targets)}</section>`
}

function renderMessageContent(
  content: unknown,
  entryIndex: number,
  messageIndex: number,
  targets: ToolLinkTargets,
): string {
  if (typeof content === 'string') return `<div class="message-text">${escapeHtml(content)}</div>`
  const blocks = getContentBlocks(content)
  if (blocks.length === 0)
    return content === undefined ? '' : `<pre class="message-text">${escapeHtml(jsonText(content))}</pre>`

  return blocks
    .map((block, blockIndex) => {
      if (block.type === 'text') return `<div class="message-text">${escapeHtml(stringValue(block.text))}</div>`
      if (block.type === 'thinking')
        return `<details class="message-detail"><summary>Thinking</summary><pre>${escapeHtml(stringValue(block.thinking))}</pre></details>`
      if (block.type === 'toolCall') return renderToolCallBlock(block, entryIndex, messageIndex, blockIndex, targets)
      if (block.type === 'image') return renderImage(block)
      return `<p class="muted">[${escapeHtml(stringValue(block.type, 'Unknown'))} content block]</p>`
    })
    .join('')
}

function renderSystemDelta(message: MessageView, analysis: SessionAnalysis): string {
  const pieces: string[] = []
  const latestLoadout = analysis.requests.at(-1)?.loadoutMessage
  const hasContent =
    typeof message.content === 'string'
      ? message.content.length > 0
      : Array.isArray(message.content) && message.content.length > 0
  if (hasContent) {
    const latestContent = latestLoadout?.content
    const contentIncluded =
      typeof message.content === 'string'
        ? typeof latestContent === 'string' && latestContent.includes(message.content)
        : Array.isArray(message.content) &&
          Array.isArray(latestContent) &&
          message.content.every((block) => latestContent.some((current) => jsonText(current) === jsonText(block)))
    const latestStatus = contentIncluded ? 'Included in latest request' : 'Not included in latest request'
    pieces.push(
      `<div class="message-text"><strong>System prompt text · ${latestStatus}</strong>${renderPromptContent(message.content)}</div>`,
    )
  }
  for (const [sectionName, value] of Object.entries(message.sections ?? {})) {
    if (value === null) {
      pieces.push(
        `<p class="muted">Section removed: ${escapeHtml(sectionName)}. Removed content is not included in the latest request.</p>`,
      )
    } else {
      const latestIncluded = latestLoadout?.sections?.[sectionName] === value
      pieces.push(
        `<details class="message-detail"><summary>Prompt section changed: ${escapeHtml(sectionLabel(sectionName))}</summary><pre>${escapeHtml(value)}</pre><p class="subtle">${latestIncluded ? 'Included in latest request.' : 'Not included in latest request.'}</p></details>`,
      )
    }
  }
  for (const tool of message.toolsAdded ?? []) {
    const latestIncluded = latestLoadout?.toolsAdded?.some((current) => jsonText(current) === jsonText(tool)) ?? false
    pieces.push(
      `<p>Tool added: <strong>${escapeHtml(tool.name)}</strong> — ${escapeHtml(tool.description)}. ${latestIncluded ? 'Included in latest request.' : 'Not included in latest request.'}</p>`,
    )
  }
  for (const tool of message.toolsRemoved ?? []) {
    const latestIncluded = latestLoadout?.toolsAdded?.some((current) => jsonText(current) === jsonText(tool)) ?? false
    pieces.push(
      `<p class="muted">Tool removed: ${escapeHtml(tool.name)}. ${latestIncluded ? 'Included in latest request.' : 'Not included in latest request.'}</p>`,
    )
  }
  if (pieces.length === 0) pieces.push('<p class="muted">System loadout checkpoint.</p>')
  return `<div class="system-delta">${pieces.join('')}</div>`
}

function renderMessage(
  visible: VisibleEntryMessage,
  entryIndex: number,
  messageIndex: number,
  analysis: SessionAnalysis,
  targets: ToolLinkTargets,
): string {
  const message = visible.message
  const historicalClass = visible.historical ? ' historical' : ''
  if (message.role === 'system')
    return `<div class="message${historicalClass}"><div class="message-role">System prompt and tool-loadout change</div>${renderSystemDelta(message, analysis)}</div>`
  if (message.role === 'toolResult')
    return `<div class="message${historicalClass}"><div class="message-role">Tool result</div>${renderToolResultMessage(message, entryIndex, messageIndex, targets)}</div>`
  if (message.role === 'bashExecution') {
    return `<div class="message${historicalClass}"><div class="message-role">Bash execution</div><p><strong>Command</strong></p><pre>${escapeHtml(stringValue(message.command))}</pre><p><strong>Output</strong></p><pre>${escapeHtml(stringValue(message.output))}</pre></div>`
  }
  if (message.role === 'branchSummary' || message.role === 'compactionSummary') {
    return `<div class="message${historicalClass}"><div class="message-role">${escapeHtml(message.role)}</div><div class="message-text">${escapeHtml(stringValue(message.summary))}</div></div>`
  }
  const role =
    message.role === 'custom' ? `Extension message · ${stringValue(message.customType, 'custom')}` : message.role
  return `<div class="message${historicalClass}"><div class="message-role">${escapeHtml(role)}</div>${renderMessageContent(message.content, entryIndex, messageIndex, targets)}${message.role === 'custom' ? `<p class="subtle">Saved customType: ${escapeHtml(stringValue(message.customType, 'unknown'))}</p>` : ''}</div>`
}

function renderEntryDetails(entry: EntryStatistics): string {
  const source = entry.customType ?? entry.role ?? entry.entryType
  const latestLabel = entry.latestRequestIncluded ? 'Included' : 'Not included'
  return `<details class="detail-popover"><summary>Entry estimates</summary><div class="popover"><dl><dt>Source</dt><dd>${escapeHtml(source)}</dd><dt>Entry ID</dt><dd>${escapeHtml(entry.entryId)}</dd><dt>Timestamp</dt><dd>${escapeHtml(entry.timestamp)}</dd><dt>One-time message addition</dt><dd>${tokenLabel(entry.messageAdditionTokens)}</dd><dt>Historical message estimate</dt><dd>${tokenLabel(entry.historicalTokens)}</dd><dt>Latest request inclusion</dt><dd>${latestLabel}</dd></dl></div></details>`
}

function contextStatusLabel(status: EntryStatistics['contextStatus']): string {
  if (status === 'current') return 'Current context'
  if (status === 'compacted') return 'Compacted history'
  if (status === 'replaced') return 'Context-edited'
  if (status === 'omitted') return 'Omitted'
  if (status === 'historical') return 'History only'
  return 'Not model content'
}

function renderEntry(
  entry: EntryStatistics,
  entryIndex: number,
  analysis: SessionAnalysis,
  targets: ToolLinkTargets,
  latestRequestTokensByEntry: ReadonlyMap<string, number>,
  nestedResults: readonly { entry: EntryStatistics; entryIndex: number }[] = [],
): string {
  const messages = getVisibleEntryMessages(entry)
  const toolResult = messages.find((visible) => visible.message.role === 'toolResult')?.message
  const role = entry.customType
    ? `Extension · ${entry.customType}`
    : entry.role === 'toolResult'
      ? `Tool result · ${stringValue(toolResult?.toolName) || 'tool'}`
      : (entry.role ?? entry.entryType)
  const previewText =
    messages
      .map(({ message }) => {
        if (typeof message.content === 'string') return message.content
        if (typeof message.summary === 'string') return message.summary
        if (typeof message.command === 'string') return message.command
        const text = getContentBlocks(message.content)
          .map((block) =>
            block.type === 'text'
              ? stringValue(block.text)
              : block.type === 'toolCall'
                ? `Call ${stringValue(block.name) || 'tool'}`
                : block.type === 'image'
                  ? 'Image'
                  : '',
          )
          .filter(Boolean)
          .join(' ')
        if (text) return text
        if (message.role === 'toolResult') return `Result from ${stringValue(message.toolName) || 'tool'}`
        return ''
      })
      .find((text) => text.trim().length > 0) ?? role
  const preview = escapeHtml(previewText.replace(/\s+/g, ' ').trim())
  const statusClass =
    entry.contextStatus === 'current'
      ? 'badge-current'
      : entry.contextStatus === 'replaced'
        ? 'badge-replaced'
        : entry.contextStatus === 'omitted' ||
            entry.contextStatus === 'compacted' ||
            entry.contextStatus === 'historical'
          ? 'badge-historical'
          : ''
  const latestRequest = analysis.requests.at(-1)
  const latestTokens = latestRequestTokensByEntry.get(entry.entryId) ?? 0
  const hasLatestContribution = latestRequestTokensByEntry.has(entry.entryId)
  const includedInLatestPrompt = entry.latestRequestIncluded && hasLatestContribution
  const includedInLoadout =
    entry.latestRequestIncluded && !hasLatestContribution && messages.some(({ message }) => message.role === 'system')
  const requestTokens =
    latestRequest?.footprintTokens ??
    latestRequest?.contributions.reduce((sum, contribution) => sum + contribution.tokens, 0) ??
    null
  const share = includedInLatestPrompt
    ? requestTokens && requestTokens > 0
      ? formatPercent((latestTokens / requestTokens) * 100)
      : 'Unavailable'
    : includedInLoadout
      ? 'In loadout'
      : entry.latestRequestIncluded
        ? 'Unavailable'
        : 'Not in latest input'
  const displayedTokens = includedInLatestPrompt ? latestTokens : includedInLoadout ? null : entry.messageAdditionTokens
  const tokenScope = includedInLatestPrompt
    ? 'latest input'
    : includedInLoadout
      ? 'loadout shown above'
      : entry.latestRequestIncluded
        ? 'latest estimate unavailable'
        : 'one-time addition'
  const body = messages
    .map((visible, messageIndex) => renderMessage(visible, entryIndex, messageIndex, analysis, targets))
    .join('')
  const emptyBody =
    body ||
    `<p class="muted">${escapeHtml(entry.customType ? `Extension message: ${entry.customType}` : entry.entryType)}</p>`
  const nestedResultsHtml = nestedResults.length
    ? `<ol class="nested-entry-list" aria-label="Tool results">${nestedResults
        .map(({ entry: resultEntry, entryIndex: resultIndex }) =>
          renderEntry(resultEntry, resultIndex, analysis, targets, latestRequestTokensByEntry),
        )
        .join('')}</ol>`
    : ''

  return `<li class="entry-node"><details class="entry" id="entry-${entryIndex}"><summary class="entry-summary"><span class="disclosure-glyph" aria-hidden="true">›</span><span class="entry-main"><span class="entry-role">${escapeHtml(role)}</span><span class="entry-preview">${preview}</span></span><time class="entry-timestamp" datetime="${escapeHtml(entry.timestamp)}">${escapeHtml(entry.timestamp)}</time><span class="entry-token-count"><strong>${tokenLabel(displayedTokens)}</strong><small>${tokenScope}</small></span><span class="entry-share">${escapeHtml(share)}<small>${includedInLatestPrompt ? 'of latest request' : includedInLoadout ? 'see loadout' : ''}</small></span><span class="badge ${statusClass}">${contextStatusLabel(entry.contextStatus)}</span></summary><div class="entry-expanded"><div class="entry-header"><h3 class="entry-title">${escapeHtml(role)} · ${escapeHtml(entry.entryId)}</h3><div class="badges"><span class="badge ${statusClass}">${contextStatusLabel(entry.contextStatus)}</span><span class="badge">${entry.latestRequestIncluded ? 'In latest request' : 'Not in latest request'}</span></div></div><div class="entry-meta"><span>${escapeHtml(entry.timestamp)}</span>${entry.customType ? `<span>customType: ${escapeHtml(entry.customType)}</span>` : ''}</div><div class="entry-metrics"><span>Latest request contribution: ${includedInLatestPrompt ? tokenLabel(latestTokens) : includedInLoadout ? 'Counted in loadout estimate' : entry.latestRequestIncluded ? 'Estimate unavailable' : 'Not in latest request'}</span><span>One-time addition: ${tokenLabel(entry.messageAdditionTokens)} estimated tokens</span><span>Cumulative exposure: ${tokenLabel(entry.cumulativeRequestExposure)} estimated tokens</span><span>Selected-branch share: ${formatPercent(entry.exposureShare)}</span></div>${renderEntryDetails(entry)}${entry.contextStatus === 'replaced' ? '<p class="status-note">The saved entry is historical. The effective replacement below is model-visible.</p>' : ''}${entry.contextStatus === 'omitted' ? '<p class="status-note">Pi omitted this saved entry from requests after the context edit.</p>' : ''}${emptyBody}</div></details>${nestedResultsHtml}</li>`
}

function sameLoadout(left: MessageView | undefined, right: MessageView | undefined): boolean {
  if (!left || !right) return left === right
  return (
    jsonText([left.content, left.sections, left.toolsAdded]) ===
    jsonText([right.content, right.sections, right.toolsAdded])
  )
}

function renderLoadoutChange(request: SessionAnalysis['requests'][number], analysis: SessionAnalysis): string {
  const loadoutContributions = request.contributions.filter((contribution) => contribution.entryId === undefined)
  return `<li class="loadout-event prompt-change"><h3>Effective loadout before request ${request.index}</h3><p class="subtle">Estimated empty-history loadout cost: ${tokenLabel(request.loadoutTokens)}. This snapshot applies before assistant entry ${escapeHtml(request.responseEntryId)}.</p>${renderSystemSnapshot(request.loadoutMessage, analysis, loadoutContributions)}</li>`
}

function renderConversationTab(
  analysis: SessionAnalysis,
  contextWindowTokens?: number,
  runtimeContextUsage?: ContextUsage,
): string {
  const targets = createToolLinkTargets(analysis)
  const requestsByResponse = new Map(analysis.requests.map((request) => [request.responseEntryId, request]))
  const latestRequest = analysis.requests.at(-1)
  const latestRequestTokensByEntry = new Map<string, number>()
  for (const contribution of latestRequest?.contributions ?? []) {
    if (!contribution.entryId) continue
    const tokens = latestRequestTokensByEntry.get(contribution.entryId) ?? 0
    latestRequestTokensByEntry.set(contribution.entryId, tokens + contribution.tokens)
  }

  const callEntryIndexes = new Map<string, number>()
  const resultEntryIndexesByCallId = new Map<string, number[]>()
  for (const [entryIndex, entry] of analysis.entries.entries()) {
    for (const { message } of getVisibleEntryMessages(entry)) {
      if (message.role === 'assistant') {
        for (const block of getContentBlocks(message.content)) {
          if (block.type === 'toolCall' && typeof block.id === 'string') callEntryIndexes.set(block.id, entryIndex)
        }
      }
      if (message.role === 'toolResult' && typeof message.toolCallId === 'string') {
        const results = resultEntryIndexesByCallId.get(message.toolCallId) ?? []
        results.push(entryIndex)
        resultEntryIndexesByCallId.set(message.toolCallId, results)
      }
    }
  }

  const resultParents = new Map<number, Set<number>>()
  for (const [toolCallId, callEntryIndex] of callEntryIndexes) {
    for (const resultEntryIndex of resultEntryIndexesByCallId.get(toolCallId) ?? []) {
      if (resultEntryIndex <= callEntryIndex) continue
      const parents = resultParents.get(resultEntryIndex) ?? new Set<number>()
      parents.add(callEntryIndex)
      resultParents.set(resultEntryIndex, parents)
    }
  }

  const nestedResultsByEntryIndex = new Map<number, number[]>()
  const nestedResultIndexes = new Set<number>()
  for (const [resultEntryIndex, parentIndexes] of resultParents) {
    if (parentIndexes.size !== 1) continue
    const [parentIndex] = parentIndexes
    if (parentIndex === undefined) continue
    const results = nestedResultsByEntryIndex.get(parentIndex) ?? []
    results.push(resultEntryIndex)
    nestedResultsByEntryIndex.set(parentIndex, results)
    nestedResultIndexes.add(resultEntryIndex)
  }

  const timeline: string[] = []
  let previousLoadout = analysis.baseline.systemMessage
  for (const [entryIndex, entry] of analysis.entries.entries()) {
    if (nestedResultIndexes.has(entryIndex)) continue
    const request = requestsByResponse.get(entry.entryId)
    if (request?.loadoutMessage && !sameLoadout(previousLoadout, request.loadoutMessage))
      timeline.push(renderLoadoutChange(request, analysis))
    if (request?.loadoutMessage) previousLoadout = request.loadoutMessage

    const nestedResults = (nestedResultsByEntryIndex.get(entryIndex) ?? [])
      .sort((left, right) => left - right)
      .flatMap((nestedIndex) => {
        const nestedEntry = analysis.entries[nestedIndex]
        return nestedEntry ? [{ entry: nestedEntry, entryIndex: nestedIndex }] : []
      })
    timeline.push(renderEntry(entry, entryIndex, analysis, targets, latestRequestTokensByEntry, nestedResults))
  }

  const conversation = timeline.length
    ? `<ol class="timeline">${timeline.join('')}</ol>`
    : '<p class="status-note">No selected-branch conversation entries are available.</p>'

  return `<section id="conversation-panel" class="page" role="tabpanel" aria-labelledby="conversation-tab" tabindex="0"><h2>Latest request context</h2>${renderLatestRequestComposition(analysis, contextWindowTokens, runtimeContextUsage)}<h2>Selected branch conversation</h2><p class="subtle">Rows show each entry once. Tool results appear under their call. Shares use the latest request when an entry was included. Other entries show their one-time token estimate.</p>${conversation}</section>`
}

function renderMetricCard(label: string, value: string, note: string): string {
  return `<div class="metric-card"><div class="metric-label">${escapeHtml(label)}</div><div class="metric-value">${escapeHtml(value)}</div><p class="metric-note">${escapeHtml(note)}</p></div>`
}

function renderLatestRequestComposition(
  analysis: SessionAnalysis,
  contextWindowTokens?: number,
  runtimeContextUsage?: ContextUsage,
): string {
  const request = analysis.requests.at(-1)
  if (!request) return '<p class="status-note">No model request is available for this session.</p>'

  const tokensByGroup = new Map<keyof SessionAnalysis['sourceGroups'], number>()
  for (const group of sourceGroupDescriptions) tokensByGroup.set(group.key, 0)
  for (const contribution of request.contributions) {
    const tokens = tokensByGroup.get(contribution.group) ?? 0
    tokensByGroup.set(contribution.group, tokens + contribution.tokens)
  }

  const groupTotal = sourceGroupDescriptions.reduce((sum, group) => sum + (tokensByGroup.get(group.key) ?? 0), 0)
  const totalTokens = request.footprintTokens ?? groupTotal
  if (totalTokens <= 0) return '<p class="status-note">No token estimates are available for the latest request.</p>'

  const runtimeContextWindow =
    runtimeContextUsage && Number.isFinite(runtimeContextUsage.contextWindow) && runtimeContextUsage.contextWindow > 0
      ? runtimeContextUsage.contextWindow
      : undefined
  const validContextWindow =
    runtimeContextWindow ??
    (contextWindowTokens !== undefined && Number.isFinite(contextWindowTokens) && contextWindowTokens > 0
      ? contextWindowTokens
      : undefined)
  const contextWindowPercent =
    validContextWindow !== undefined && request.footprintTokens !== null && Number.isFinite(request.footprintTokens)
      ? (request.footprintTokens / validContextWindow) * 100
      : undefined
  const piContextPercent =
    runtimeContextWindow !== undefined &&
    runtimeContextUsage?.percent !== null &&
    runtimeContextUsage?.percent !== undefined &&
    Number.isFinite(runtimeContextUsage.percent)
      ? runtimeContextUsage.percent
      : undefined
  const contextPercent = piContextPercent ?? contextWindowPercent
  const contextPercentLabel = piContextPercent === undefined ? 'Context window estimate' : 'Pi context estimate'
  const piContextTokensLabel =
    piContextPercent !== undefined && runtimeContextUsage && runtimeContextUsage.tokens !== null
      ? ` · ${formatTokens(runtimeContextUsage.tokens)} tokens`
      : ''
  const runtimeUnavailableNote =
    runtimeContextUsage !== undefined && piContextPercent === undefined
      ? '<p class="subtle">Pi context estimate is unavailable for this session.</p>'
      : ''
  const reconstructionNote =
    piContextPercent === undefined
      ? '<p class="subtle">Source shares use the reconstructed request estimate.</p>'
      : contextWindowPercent === undefined
        ? '<p class="subtle">The reconstructed request estimate is unavailable. Source shares use known input tokens.</p>'
        : `<p class="subtle">Reconstructed request estimate: ${tokenLabel(request.footprintTokens)} · ${formatPercent(contextWindowPercent)} of ${formatTokens(validContextWindow ?? 0)} tokens. Source shares use this estimate.</p>`
  const contextWarnings = [
    piContextPercent !== undefined && piContextPercent > 100
      ? '<p class="status-note">Pi context estimate exceeds the model context window.</p>'
      : '',
    contextWindowPercent !== undefined && contextWindowPercent > 100
      ? `<p class="status-note">${piContextPercent === undefined ? 'The request estimate exceeds the model context window.' : 'The reconstructed request estimate exceeds the model context window.'}</p>`
      : '',
  ].join('')
  const windowUsage =
    validContextWindow === undefined
      ? '<p class="subtle">Context window size is unavailable for this model.</p>'
      : contextPercent === undefined
        ? '<p class="subtle">Context window percentage is unavailable because no trusted token count is available.</p>'
        : `<div class="context-window-summary"><div class="window-heading"><span class="column-label">${contextPercentLabel}</span><strong>${formatPercent(contextPercent)} of ${formatTokens(validContextWindow)} tokens${piContextTokensLabel}</strong></div><meter min="0" max="100" value="${Math.min(100, Math.max(0, contextPercent))}" style="width:100%" aria-label="${escapeHtml(contextPercentLabel)}">${formatPercent(contextPercent)}</meter>${runtimeUnavailableNote}${reconstructionNote}${contextWarnings}</div>`

  const unattributedTokens = Math.max(0, totalTokens - groupTotal)
  tokensByGroup.set('unattributedContent', (tokensByGroup.get('unattributedContent') ?? 0) + unattributedTokens)

  const entries = sourceGroupDescriptions
    .map((group) => {
      const tokens = tokensByGroup.get(group.key) ?? 0
      return { ...group, tokens, share: (tokens / totalTokens) * 100 }
    })
    .filter((group) => group.tokens > 0)
  const segments = entries
    .map(
      (group) =>
        `<span class="request-composition-segment" style="width:${group.share}%;background:${group.color}" title="${escapeHtml(group.label)}: ${tokenLabel(group.tokens)} · ${formatPercent(group.share)}"></span>`,
    )
    .join('')
  const legend = entries
    .map(
      (group) =>
        `<li><span class="legend-name"><span class="swatch" style="background:${group.color}"></span>${escapeHtml(group.label)}</span><span class="legend-value">${tokenLabel(group.tokens)} · ${formatPercent(group.share)}</span></li>`,
    )
    .join('')
  const ariaLabel = entries
    .map((group) => `${group.label}: ${tokenLabel(group.tokens)}, ${formatPercent(group.share)}`)
    .join('; ')
  const totalLabel =
    request.footprintTokens === null ? `${tokenLabel(totalTokens)} known tokens` : tokenLabel(request.footprintTokens)
  const scopeLabel =
    request.footprintTokens === null ? 'Known input breakdown' : `Request ${request.index} input breakdown`
  const status =
    request.footprintTokens === null
      ? '<p class="subtle">The full request footprint is unavailable. Shares use the known input tokens.</p>'
      : '<p class="subtle">Shares use the estimated input sent before the latest assistant response.</p>'

  return `<section class="request-composition" aria-labelledby="request-composition-title"><div class="request-composition-heading"><div><h3 id="request-composition-title">${scopeLabel}</h3>${status}</div><strong>${totalLabel}</strong></div>${windowUsage}<div class="request-composition-bar" role="img" aria-label="${escapeHtml(ariaLabel)}">${segments}</div><ul class="chart-legend request-composition-legend">${legend}</ul></section>`
}

function renderOverview(analysis: SessionAnalysis): string {
  const exposure =
    analysis.requestExposure.tokens === null
      ? `${formatTokens(analysis.requestExposure.knownTokens)} known tokens · incomplete`
      : tokenLabel(analysis.requestExposure.tokens)
  return `<div class="metrics-grid">${renderMetricCard('Empty-history loadout estimate', tokenLabel(analysis.baseline.tokens), analysis.baseline.available ? analysis.baseline.source : 'Baseline unavailable')}${renderMetricCard('Latest request footprint', tokenLabel(analysis.latestRequestFootprintTokens), 'Estimated loadout plus projected conversation')}${renderMetricCard('Reconstructed requests', formatTokens(analysis.requestCount), 'One snapshot before each assistant response')}${renderMetricCard('Estimated tokens across all requests', exposure, 'Repeated context is counted again on each request')}${renderMetricCard('One-time message additions', tokenLabel(analysis.oneTimeMessageAdditionsTokens), 'Each selected-branch entry counted once')}</div>`
}

function renderProviderUsage(analysis: SessionAnalysis): string {
  const rows = analysis.requests
    .filter((request) => request.providerUsage !== undefined)
    .map((request) => {
      const usage = request.providerUsage
      if (!usage) return ''
      return `<tr><td>Request ${request.index}</td><td>${escapeHtml(request.model ?? 'Unknown model')}</td><td class="number">${formatTokens(usage.input)} input tokens</td><td class="number">${formatTokens(usage.output)} output tokens</td><td class="number">${formatTokens(usage.cacheRead)} cache-read tokens</td><td class="number">${formatTokens(usage.cacheWrite)} cache-write tokens</td><td class="number">${formatTokens(usage.totalTokens)} total tokens</td></tr>`
    })
    .join('')
  if (!rows) return '<p class="status-note">No assistant response contains provider-reported Usage.</p>'
  return `<div class="table-wrap"><table class="provider-table"><thead><tr><th>Request</th><th>Model</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cache write</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table></div>`
}

function renderDonut(analysis: SessionAnalysis): string {
  const values = sourceGroupDescriptions.map((group) => {
    const tokens = analysis.sourceGroups[group.key]
    return { ...group, tokens: Number.isFinite(tokens) ? Math.max(0, tokens) : 0 }
  })
  const total = values.reduce((sum, group) => sum + group.tokens, 0)
  const circumference = 2 * Math.PI * 58
  let offset = 0
  const segments = values
    .map((group) => {
      const length = total > 0 ? (circumference * group.tokens) / total : 0
      const segment =
        group.tokens > 0
          ? `<circle cx="80" cy="80" r="58" fill="none" stroke="${group.color}" stroke-width="22" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 80 80)"/>`
          : ''
      offset += length
      return segment
    })
    .join('')
  const denominator = total
  const legend = values
    .map((group) => {
      const share = denominator > 0 ? (group.tokens / denominator) * 100 : 0
      return `<li><span class="legend-label"><span class="swatch" style="background:${group.color}"></span>${escapeHtml(group.label)}</span><span class="legend-value">${tokenLabel(group.tokens)} · ${formatPercent(share)}</span></li>`
    })
    .join('')
  const note = analysis.requestExposure.complete
    ? 'Repeated context is counted again for each request.'
    : 'The chart shows known contributions only. The across-request estimate is incomplete.'

  return `<div class="chart-layout"><svg class="donut" viewBox="0 0 160 160" role="img" aria-labelledby="exposure-chart-title exposure-chart-description"><title id="exposure-chart-title">Estimated request-context tokens by source group</title><desc id="exposure-chart-description">${escapeHtml(note)}</desc><circle cx="80" cy="80" r="58" fill="none" stroke="#354552" stroke-width="22"/>${segments}<text x="80" y="76" text-anchor="middle" fill="#e8eef3" font-size="15">${escapeHtml(formatTokens(total))}</text><text x="80" y="96" text-anchor="middle" fill="#a6b3bf" font-size="10">${analysis.requestExposure.complete ? 'estimated tokens' : 'known tokens'}</text></svg><div><p class="subtle">${escapeHtml(note)}</p><ul class="chart-legend">${legend}</ul></div></div>`
}

function largestValue<T>(items: readonly T[], getValue: (item: T) => number): number {
  return items.reduce((largest, item) => Math.max(largest, getValue(item)), 0)
}

function largestClass(value: number, largest: number): string {
  return largest > 0 && value === largest ? 'largest' : ''
}

function renderToolTable(analysis: SessionAnalysis, targets: ToolLinkTargets): string {
  const sharedExposure = `<p class="subtle">Shared or unattributed tool context: ${tokenLabel(analysis.sharedToolContextExposureTokens)} estimated across the selected branch. This amount is separate from per-tool totals.</p>`
  const incompleteExposure = analysis.requestExposure.complete
    ? ''
    : '<p class="status-note">Some request loadouts are unavailable, so cumulative tool exposure may be incomplete.</p>'
  if (analysis.tools.length === 0)
    return `<p class="status-note">No tool definitions or tool interactions appear on this branch.</p>${sharedExposure}${incompleteExposure}`

  const initialCosts = analysis.tools.map((tool) => {
    const contributions = analysis.baseline.contributions.filter((item) => item.toolName === tool.name)
    const definitions = contributions.filter((item) => item.kind === 'tool-definition')
    const prompts = contributions.filter((item) => item.kind === 'tool-prompt')
    return {
      tool,
      definitionTokens: sumTokens(definitions),
      promptTokens: sumTokens(prompts),
      totalTokens: sumTokens([...definitions, ...prompts]),
      hasDefinition: definitions.length > 0,
      hasPrompt: prompts.length > 0,
      hasInitialCost: definitions.length > 0 || prompts.length > 0,
    }
  })
  const maxExposure = largestValue(analysis.tools, (tool) => tool.estimatedContextExposureTokens)
  const maxArguments = largestValue(analysis.tools, (tool) => tool.estimatedArgumentExposureTokens)
  const maxResults = largestValue(analysis.tools, (tool) => tool.estimatedResultExposureTokens)
  const rows = initialCosts
    .map(({ tool, definitionTokens, promptTokens, totalTokens, hasDefinition, hasPrompt, hasInitialCost }, index) => {
      const toolCalls = analysis.toolInvocations.filter(
        (invocation) => invocation.toolName === tool.name && invocation.callEntryId,
      )
      const successfulCalls = toolCalls.filter((invocation) => invocation.isError === false).length
      const failedCalls = toolCalls.filter((invocation) => invocation.isError === true).length
      const noResultCalls = toolCalls.filter((invocation) => invocation.isError === null).length
      const initialDefinition = !analysis.baseline.available
        ? 'Unavailable'
        : hasDefinition
          ? tokenLabel(definitionTokens)
          : 'Not in first request'
      const initialPrompt = !analysis.baseline.available
        ? 'Unavailable'
        : hasPrompt
          ? tokenLabel(promptTokens)
          : 'Not in first request'
      const initialCost = !analysis.baseline.available
        ? 'Unavailable'
        : hasInitialCost
          ? tokenLabel(totalTokens)
          : 'Not in first request'
      return `<details class="tool-card" id="tool-card-${index}"><summary class="tool-card-summary"><span class="disclosure-glyph" aria-hidden="true">›</span><span class="tool-card-name">${escapeHtml(tool.name)}</span><span class="tool-card-static"><small>Cumulative estimated context exposure across selected branch</small><strong class="${largestClass(tool.estimatedContextExposureTokens, maxExposure)}">${tokenLabel(tool.estimatedContextExposureTokens)}</strong><small>Definition ${tokenLabel(tool.estimatedDefinitionExposureTokens)} · prompt ${tokenLabel(tool.estimatedPromptExposureTokens)}</small><small>Initial tool-specific estimate ${initialCost}</small></span><span class="tool-card-dynamic"><small>Estimated call and result exposure</small><strong class="${largestClass(tool.estimatedArgumentExposureTokens, maxArguments)}">Arguments ${tokenLabel(tool.estimatedArgumentExposureTokens)}</strong><small class="${largestClass(tool.estimatedResultExposureTokens, maxResults)}">Results ${tokenLabel(tool.estimatedResultExposureTokens)}</small></span><span class="tool-card-outcomes"><small>${formatTokens(tool.callCount)} calls</small><strong>${formatTokens(successfulCalls)} success · ${formatTokens(failedCalls)} failed</strong><small>${formatTokens(noResultCalls)} with no result</small></span></summary><div class="tool-card-expanded">${renderToolContextDetails(analysis, tool.name)}<dl class="tool-total-metrics"><div><dt>Estimated context exposure across selected branch</dt><dd>${tokenLabel(tool.estimatedContextExposureTokens)}</dd></div><div><dt>Estimated definition exposure</dt><dd>${tokenLabel(tool.estimatedDefinitionExposureTokens)}</dd></div><div><dt>Estimated prompt guidance and examples exposure</dt><dd>${tokenLabel(tool.estimatedPromptExposureTokens)}</dd></div><div><dt>Estimated call-argument exposure</dt><dd>${tokenLabel(tool.estimatedArgumentExposureTokens)}</dd></div><div><dt>Estimated tool-result exposure</dt><dd>${tokenLabel(tool.estimatedResultExposureTokens)}</dd></div><div><dt>Initial definition estimate</dt><dd>${initialDefinition}</dd></div><div><dt>Initial prompt estimate</dt><dd>${initialPrompt}</dd></div><div><dt>Initial tool-specific estimate</dt><dd>${initialCost}</dd></div></dl><h4>Invocation timeline</h4>${renderToolInvocationTable(analysis, targets, tool.name)}</div></details>`
    })
    .join('')

  return `<div class="tool-list">${rows}</div>${sharedExposure}${incompleteExposure}`
}

function renderPromptSectionTable(analysis: SessionAnalysis): string {
  if (analysis.promptSections.length === 0)
    return '<p class="status-note">No prompt sections or instruction files are available for the first request.</p>'
  const initialSections = analysis.promptSections
    .map((section) => ({
      section,
      contributions: analysis.baseline.contributions.filter((item) => item.id === section.id),
      tokens: sumTokens(analysis.baseline.contributions.filter((item) => item.id === section.id)),
    }))
    .sort((left, right) => right.tokens - left.tokens || left.section.label.localeCompare(right.section.label))
  const maxInitial = largestValue(initialSections, (item) => item.tokens)
  const latestFootprint = analysis.latestRequestFootprintTokens ?? 0
  const rows = initialSections
    .map(({ section, contributions, tokens }) => {
      const latestShare =
        section.latestRequestTokens > 0 && latestFootprint > 0
          ? (section.latestRequestTokens / latestFootprint) * 100
          : null
      const initialTokens = !analysis.baseline.available
        ? 'Unavailable'
        : contributions.length > 0
          ? tokenLabel(tokens)
          : 'Not in first request'
      const initialClass = contributions.length > 0 ? largestClass(tokens, maxInitial) : ''
      return `<tr><th scope="row">${escapeHtml(section.label)}${section.source ? `<span class="subtle"><br>${escapeHtml(section.source)}</span>` : ''}</th><td>${escapeHtml(section.kind)}</td><td class="number ${initialClass}">${initialTokens}</td><td class="number">${tokenLabel(section.latestRequestTokens)}</td><td class="number">${formatPercent(latestShare)}</td></tr>`
    })
    .join('')
  return `<div class="table-wrap"><table><thead><tr><th>Prompt section or source</th><th>Type</th><th>Initial loadout tokens</th><th>Latest request tokens</th><th>Latest request share</th></tr></thead><tbody>${rows}</tbody></table></div>`
}

function renderWarnings(analysis: SessionAnalysis): string {
  if (analysis.warnings.length === 0) return ''
  return `<section><h2>Analysis limits</h2><ul>${analysis.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></section>`
}

function renderToolInvocationTable(analysis: SessionAnalysis, targets: ToolLinkTargets, toolName: string): string {
  const entriesById = new Map(analysis.entries.map((entry, index) => [entry.entryId, { entry, index }]))
  const invocations = analysis.toolInvocations.filter((invocation) => invocation.toolName === toolName)
  if (invocations.length === 0)
    return `<p class="status-note">${escapeHtml(toolName)} was available but no invocation was recorded on this branch.</p>`

  const chronologicalInvocations = [...invocations].sort((left, right) => {
    const leftEntry = entriesById.get(left.callEntryId ?? '') ?? entriesById.get(left.resultEntryId ?? '')
    const rightEntry = entriesById.get(right.callEntryId ?? '') ?? entriesById.get(right.resultEntryId ?? '')
    return (leftEntry?.index ?? Number.MAX_SAFE_INTEGER) - (rightEntry?.index ?? Number.MAX_SAFE_INTEGER)
  })
  const rows = chronologicalInvocations
    .map((invocation) => {
      const callTarget = targets.calls.get(invocation.toolCallId)
      const resultTarget = targets.results.get(invocation.toolCallId)
      const callEntry = entriesById.get(invocation.callEntryId ?? '')?.entry
      const resultEntry = entriesById.get(invocation.resultEntryId ?? '')?.entry
      const timestamp = callEntry?.timestamp ?? resultEntry?.timestamp ?? 'Timestamp unavailable'
      const callBlock = callEntry?.rawMessages
        .filter((message) => message.role === 'assistant')
        .flatMap((message) => getContentBlocks(message.content))
        .find((block) => block.type === 'toolCall' && block.id === invocation.toolCallId)
      const resultMessage = resultEntry?.rawMessages.find(
        (message) => message.role === 'toolResult' && message.toolCallId === invocation.toolCallId,
      )
      const status = invocation.isError === null ? 'No result' : invocation.isError ? 'Failed' : 'Success'
      const statusClass =
        invocation.isError === null ? 'outcome-unknown' : invocation.isError ? 'outcome-failure' : 'outcome-success'
      const callLink = callTarget
        ? `<a href="#${escapeHtml(callTarget)}">Open call input</a>`
        : '<span class="muted">No saved call</span>'
      const resultLink = resultTarget
        ? `<a href="#${escapeHtml(resultTarget)}">Open tool result</a>`
        : '<span class="muted">No saved result</span>'
      const requestImpacts = analysis.requests
        .map((request) => {
          const contributions = request.contributions.filter(
            (item) =>
              item.toolName === toolName &&
              item.toolCallId === invocation.toolCallId &&
              (item.kind === 'tool-call' || item.kind === 'tool-result'),
          )
          return {
            request,
            contributions,
            argumentTokens: sumTokens(contributions.filter((item) => item.kind === 'tool-call')),
            resultTokens: sumTokens(contributions.filter((item) => item.kind === 'tool-result')),
          }
        })
        .filter((impact) => impact.contributions.length > 0)
      const exposureTokens = requestImpacts.reduce(
        (total, impact) => total + impact.argumentTokens + impact.resultTokens,
        0,
      )
      const exposureRows = requestImpacts
        .map((impact) => {
          const requestTokens = impact.argumentTokens + impact.resultTokens
          return `<li>Request ${formatTokens(impact.request.index)} · ${escapeHtml(impact.request.timestamp)} · arguments ${tokenLabel(impact.argumentTokens)} · results ${tokenLabel(impact.resultTokens)} · ${tokenLabel(requestTokens)} estimated</li>`
        })
        .join('')
      const requestExposure =
        requestImpacts.length === 0
          ? '<p class="muted">No saved request included this call or result.</p>'
          : `<details class="invocation-request-impact"><summary>Estimated exposure across ${formatTokens(requestImpacts.length)} ${requestImpacts.length === 1 ? 'request' : 'requests'} · ${tokenLabel(exposureTokens)}</summary><ol>${exposureRows}</ol></details>`
      const argumentsContent = callBlock
        ? `<section class="invocation-content"><h5>Arguments</h5><pre>${escapeHtml(jsonText(callBlock.arguments))}</pre></section>`
        : '<p class="muted">No saved arguments are available.</p>'
      const resultContent = resultMessage
        ? `<section class="invocation-content"><h5>Result text</h5>${renderPromptContent(resultMessage.content)}</section>`
        : '<p class="muted">No saved result text is available.</p>'
      return `<li class="invocation-node"><details class="invocation-row"><summary class="invocation-summary"><span class="disclosure-glyph" aria-hidden="true">›</span><time>${escapeHtml(timestamp)}</time><span class="outcome ${statusClass}">${status}</span><span class="invocation-token-summary"><span>Call estimate</span> ${tokenLabel(invocation.argumentTokens)} <span>Result estimate</span> ${tokenLabel(invocation.resultTokens)}</span></summary><div class="invocation-expanded"><dl class="invocation-metrics"><div><dt>Call ID</dt><dd><code>${escapeHtml(invocation.toolCallId)}</code></dd></div><div><dt>Call text estimate</dt><dd>${tokenLabel(invocation.argumentTokens)}</dd></div><div><dt>Result text estimate</dt><dd>${tokenLabel(invocation.resultTokens)}</dd></div><div><dt>Outcome</dt><dd>${status}</dd></div></dl>${argumentsContent}${resultContent}${requestExposure}<div class="tool-invocation-links"><span>Conversation content</span>${callLink}${resultLink}</div></div></details></li>`
    })
    .join('')

  return `<ol class="invocation-timeline" aria-label="${escapeHtml(toolName)} invocation timeline">${rows}</ol>`
}

function renderStatisticsTab(analysis: SessionAnalysis): string {
  const targets = createToolLinkTargets(analysis)
  return `<section id="statistics-panel" class="page" role="tabpanel" aria-labelledby="statistics-tab" tabindex="0" hidden><h2>Tool context exposure and activity</h2><p class="subtle">Per-tool totals add attributed contributions from every request across the selected branch. Repeated content adds exposure each time. Shared or unattributed tool text stays separate. These values are estimates, not provider billing or exact tokenizer counts.</p><div class="section-heading"><h3>Initial loadout sources</h3><span class="subtle">First request · estimated tokens</span></div><p class="subtle">Expand a source to inspect the system prompt or tool guidance and examples behind its estimate.</p>${renderSystemSnapshot(analysis.baseline.systemMessage, analysis, analysis.baseline.contributions, false)}<div class="section-heading"><h3>Available tools</h3><span class="subtle">Estimated exposure across selected branch</span></div>${renderToolTable(analysis, targets)}<details class="advanced-estimates"><summary>Other session estimates</summary><h2>Session estimates</h2><p class="subtle">Token estimates use Pi's estimator and character-based loadout method. Provider Usage is separate.</p>${renderOverview(analysis)}<h2>Estimated request-context tokens by source group</h2>${renderDonut(analysis)}<div class="section-heading"><h2>Prompt sections and instruction files</h2><span class="subtle">Sorted by initial loadout cost</span></div>${renderPromptSectionTable(analysis)}<h2>Provider-reported usage</h2><p class="subtle">These values come from assistant message Usage. They are not source-level estimates.</p>${renderProviderUsage(analysis)}${renderWarnings(analysis)}</details></section>`
}

function renderMetadata(analysis: SessionAnalysis): string {
  const model = [...analysis.requests].reverse().find((request) => request.model)?.model ?? 'Unknown'
  const leaf = analysis.selectedLeafId ?? 'No selected leaf'
  return `<dl class="metadata"><div><dt>Session ID</dt><dd>${escapeHtml(analysis.sessionId)}</dd></div><div><dt>Working directory</dt><dd>${escapeHtml(analysis.cwd || 'Unavailable')}</dd></div><div><dt>Selected leaf</dt><dd>${escapeHtml(leaf)}</dd></div><div><dt>Model</dt><dd>${escapeHtml(model)}</dd></div><div><dt>Analyzed at</dt><dd>${escapeHtml(analysis.analyzedAt)}</dd></div><div><dt>Token-estimate method</dt><dd>${escapeHtml(analysis.tokenEstimateMethod)}</dd></div></dl>`
}

function renderTabControls(): string {
  return '<nav class="tabs" role="tablist" aria-label="Report sections"><button class="tab" id="conversation-tab" type="button" role="tab" aria-selected="true" aria-controls="conversation-panel" tabindex="0">Conversation</button><button class="tab" id="statistics-tab" type="button" role="tab" aria-selected="false" aria-controls="statistics-panel" tabindex="-1">Tools</button></nav>'
}

function renderHeader(analysis: SessionAnalysis): string {
  return `<header><p class="eyebrow">Pi Inspect</p><h1>Context estimates</h1>${renderMetadata(analysis)}<p class="warning" role="note">This local report contains the selected branch's full conversation, including tool arguments, tool results, and prompt text. Treat this file as sensitive.</p></header>`
}

function renderReportDocument(
  analysis: SessionAnalysis,
  contextWindowTokens?: number,
  runtimeContextUsage?: ContextUsage,
): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Pi Inspect · ${escapeHtml(analysis.sessionId)}</title><style>${reportStyles}</style></head><body><a class="skip-link" href="#main-content">Skip to report content</a>${renderHeader(analysis)}${renderTabControls()}<main id="main-content" tabindex="-1">${renderConversationTab(analysis, contextWindowTokens, runtimeContextUsage)}${renderStatisticsTab(analysis)}</main><footer><p>All source breakdown values are estimates. The report-wide total repeats context tokens across requests and is not provider billing or a count of unique session tokens.</p></footer><script>${reportScript}</script></body></html>`
}

/** Renders a self-contained HTML report and escapes all session and prompt text. */
function renderContextMeteringReport(
  analysis: SessionAnalysis,
  contextWindowTokens?: number,
  runtimeContextUsage?: ContextUsage,
): string {
  return renderReportDocument(analysis, contextWindowTokens, runtimeContextUsage)
}

export { renderContextMeteringReport }
