// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// macOS's keychain prompts (SecurityAgent windows), for scripts/keychain-vault.mjs --locked. It acts only on a
// prompt whose text names the given keychain, the throwaway one that script made, so no other prompt is touched.
// It reads static texts and button titles through the accessibility API, never a field's value, and needs this
// terminal to have Accessibility access (System Settings › Privacy & Security); `trusted` asks nothing.
//
//   keychain-prompt trusted                 true or false
//   keychain-prompt list <keychain>         a line per prompt naming it
//   keychain-prompt answer <keychain>       types the password read from stdin and presses OK
//   keychain-prompt cancel <keychain>       presses Cancel
import AppKit
import ApplicationServices

func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
  var value: AnyObject?
  return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

func walk(_ element: AXUIElement, _ visit: (AXUIElement) -> Void) {
  visit(element)
  for child in (attribute(element, kAXChildrenAttribute) as? [AXUIElement]) ?? [] { walk(child, visit) }
}

struct Prompt {
  var texts: [String] = []
  var buttons: [String: AXUIElement] = [:]
  var passwordField: AXUIElement?
}

func prompts(naming keychain: String) -> [Prompt] {
  var found: [Prompt] = []
  for agent in NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.SecurityAgent") {
    let app = AXUIElementCreateApplication(agent.processIdentifier)
    for window in (attribute(app, kAXWindowsAttribute) as? [AXUIElement]) ?? [] {
      var prompt = Prompt()
      walk(window) { element in
        let role = attribute(element, kAXRoleAttribute) as? String ?? ""
        if role == kAXStaticTextRole, let text = attribute(element, kAXValueAttribute) as? String {
          prompt.texts.append(text)
        }
        if role == kAXButtonRole, let title = attribute(element, kAXTitleAttribute) as? String {
          prompt.buttons[title] = element
        }
        if attribute(element, kAXSubroleAttribute) as? String == kAXSecureTextFieldSubrole {
          prompt.passwordField = element
        }
      }
      if prompt.texts.joined(separator: " ").contains("“\(keychain)”") { found.append(prompt) }
    }
  }
  return found
}

let args = CommandLine.arguments
switch (args.count, args.count > 1 ? args[1] : "") {
case (2, "trusted"):
  let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: false] as CFDictionary
  print(AXIsProcessTrustedWithOptions(options))
case (3, "list"):
  for prompt in prompts(naming: args[2]) {
    print("\(prompt.texts.joined(separator: " | ")) [\(prompt.buttons.keys.sorted().joined(separator: ", "))]")
  }
case (3, "answer"):
  let password = (readLine(strippingNewline: true) ?? "")
  var answered = 0
  for prompt in prompts(naming: args[2]) {
    guard let field = prompt.passwordField, let ok = prompt.buttons["OK"] else { continue }
    AXUIElementSetAttributeValue(field, kAXValueAttribute as CFString, password as CFString)
    if AXUIElementPerformAction(ok, kAXPressAction as CFString) == .success { answered += 1 }
  }
  print("answered \(answered)")
case (3, "cancel"):
  var cancelled = 0
  for prompt in prompts(naming: args[2]) {
    guard let cancel = prompt.buttons["Cancel"] else { continue }
    if AXUIElementPerformAction(cancel, kAXPressAction as CFString) == .success { cancelled += 1 }
  }
  print("cancelled \(cancelled)")
default:
  FileHandle.standardError.write(Data("usage: keychain-prompt trusted | list|answer|cancel <keychain>\n".utf8))
  exit(2)
}
