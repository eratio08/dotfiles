import type { CleanOptions, CliCommandPlan } from './model.ts'

function planVersion(): CliCommandPlan {
  return { operation: 'version', args: ['--version'] }
}

function planList(): CliCommandPlan {
  return { operation: 'list', args: ['list', '--json'] }
}

function planFetch(specs: readonly string[], cwd: string): CliCommandPlan {
  return { operation: 'fetch', args: ['fetch', ...specs, '--cwd', cwd, '--quiet'] }
}

function planRemove(names: readonly string[]): CliCommandPlan {
  return { operation: 'remove', args: ['remove', ...names] }
}

function planClean(options: CleanOptions = {}): readonly CliCommandPlan[] {
  const scopeFlags = [options.packages ? '--packages' : undefined, options.repos ? '--repos' : undefined].filter(
    (value): value is string => value !== undefined,
  )
  const registryFlags = [
    options.npm ? '--npm' : undefined,
    options.pypi ? '--pypi' : undefined,
    options.crates ? '--crates' : undefined,
  ].filter((value): value is string => value !== undefined)
  if (registryFlags.length === 0) return [{ operation: 'clean', args: ['clean', ...scopeFlags] }]
  return registryFlags.map((registryFlag) => ({
    operation: 'clean' as const,
    args: ['clean', ...scopeFlags, registryFlag],
  }))
}

export { planClean, planFetch, planList, planRemove, planVersion }
