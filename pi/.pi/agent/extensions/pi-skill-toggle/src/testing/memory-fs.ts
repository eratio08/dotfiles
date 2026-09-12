import { Effect, Layer } from 'effect'
import { type DirectoryEntry, FileSystem, FileSystemError } from '../ports/fs.ts'

const DEFAULT_CONTENT = '---\nname: test\ndescription: Test skill.\n---\n'

export class MemoryFileSystem {
  private readonly files = new Map<string, string>()
  private readonly dirs = new Set<string>(['/'])
  private readonly canonicalPaths: ReadonlyMap<string, string>
  readonly service: FileSystem['Service']
  readonly layer: Layer.Layer<FileSystem>

  constructor(
    pathsOrContents: readonly string[] | ReadonlyMap<string, string>,
    canonicalPaths: ReadonlyMap<string, string> = new Map(),
  ) {
    this.canonicalPaths = canonicalPaths
    if (Array.isArray(pathsOrContents)) {
      for (const path of pathsOrContents) this.addFile(path, DEFAULT_CONTENT)
    } else {
      const contents = pathsOrContents as ReadonlyMap<string, string>
      contents.forEach((content, path) => {
        this.addFile(path, content)
      })
    }

    this.service = FileSystem.of({
      readFile: (path) => {
        const content = this.files.get(path)
        return content === undefined
          ? Effect.fail(this.error('readFile', path, `missing file: ${path}`))
          : Effect.succeed(content)
      },
      writeFileAtomic: (path, content) => {
        this.addFile(path, content)
        return Effect.void
      },
      access: (path) => Effect.succeed(this.files.has(path) || this.dirs.has(path)),
      readdir: (path) => {
        if (!this.dirs.has(path)) return Effect.fail(this.error('readdir', path, `missing directory: ${path}`))
        const prefix = path === '/' ? '/' : `${path}/`
        const names = new Set<string>()
        for (const directory of this.dirs) {
          if (directory === path || !directory.startsWith(prefix)) continue
          const [name] = directory.slice(prefix.length).split('/')
          if (name) names.add(name)
        }
        for (const file of this.files.keys()) {
          if (!file.startsWith(prefix)) continue
          const [name] = file.slice(prefix.length).split('/')
          if (name) names.add(name)
        }
        return Effect.succeed(
          [...names].sort().map((name): DirectoryEntry => {
            const fullPath = path === '/' ? `/${name}` : `${path}/${name}`
            return {
              name,
              isDirectory: this.dirs.has(fullPath),
              isFile: this.files.has(fullPath),
              isSymbolicLink: false,
            }
          }),
        )
      },
      realpath: (path) => Effect.succeed(this.canonicalPaths.get(path) ?? path),
      stat: (path) => Effect.succeed({ isDirectory: this.dirs.has(path), isFile: this.files.has(path), mode: 0o644 }),
    })
    this.layer = Layer.succeed(FileSystem, this.service)
  }

  content(path: string): string | undefined {
    return this.files.get(path)
  }

  private addFile(path: string, content: string): void {
    this.files.set(path, content)
    const parts = path.split('/').filter(Boolean)
    let current = ''
    for (const part of parts.slice(0, -1)) {
      current += `/${part}`
      this.dirs.add(current)
    }
  }

  private error(operation: string, path: string, message: string): FileSystemError {
    return new FileSystemError({ operation, path, message, cause: undefined })
  }
}
