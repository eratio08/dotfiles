#!/usr/bin/swift

import Foundation

let script = """
tell application "System Events" to tell appearance preferences to set dark mode to not dark mode
tell application "System Events" to tell appearance preferences to get dark mode
"""

let task = Process()
task.launchPath = "/usr/bin/osascript"
task.arguments = ["-e", script]

let pipe = Pipe()
task.standardOutput = pipe
task.launch()
task.waitUntilExit()

if let output = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
    .trimmingCharacters(in: .whitespacesAndNewlines) {
    print(output == "true" ? "Dark" : "Light")
}
