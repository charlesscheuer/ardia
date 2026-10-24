import AppKit
import Darwin
import ExpoModulesCore
import Foundation

public class ProjectsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaProjects")

    AsyncFunction("chooseProject") { (path: String?, promise: Promise) in
      ProjectRunner.choose(path: path) { promise.resolve($0) }
    }.runOnQueue(.main)

    AsyncFunction("inspectProject") { (path: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async { promise.resolve(ProjectRunner.inspect(path)) }
    }

    AsyncFunction("runProject") { (path: String, command: String, promise: Promise) in
      ProjectRunner.shared.run(path: path, command: command) { promise.resolve($0) }
    }

    AsyncFunction("stopProject") { (path: String, promise: Promise) in
      ProjectRunner.shared.stop(path: path) { promise.resolve($0) }
    }

    AsyncFunction("runningProjects") { (promise: Promise) in
      ProjectRunner.shared.running { promise.resolve($0) }
    }

    AsyncFunction("projectForPort") { (port: Int, promise: Promise) in
      ProjectRunner.shared.project(forPort: port) { promise.resolve($0) }
    }
  }
}

final class ProjectRunner {
  static let shared = ProjectRunner()

  private static let background = ProcessInfo.processInfo.environment["ARDIA_BACKGROUND"] == "1"
  private static let firstPort = 5173
  private static let portSpan = 400
  private static let startDeadline: TimeInterval = 60
  private static let pollInterval: TimeInterval = 0.25
  private static let stopGrace: TimeInterval = 3
  private static let logTailBytes = 4096

  private final class Entry {
    let path: String
    let name: String
    let command: String
    let log: String
    let pid: pid_t
    let startedAt: Double
    var port: Int
    var ready = false
    var waiters: [([String: Any]) -> Void] = []
    var exitSource: DispatchSourceProcess?

    init(path: String, name: String, command: String, log: String, pid: pid_t, port: Int) {
      self.path = path
      self.name = name
      self.command = command
      self.log = log
      self.pid = pid
      self.port = port
      startedAt = Date().timeIntervalSince1970 * 1000
    }

    var url: String { "http://localhost:\(port)/" }

    func payload(reused: Bool) -> [String: Any] {
      [
        "ok": true, "path": path, "name": name, "port": port, "url": url, "pid": Int(pid), "command": command, "log": log,
        "startedAt": startedAt, "reused": reused,
      ]
    }

    var summary: [String: Any] {
      ["path": path, "name": name, "port": port, "url": url, "pid": Int(pid), "command": command, "log": log, "startedAt": startedAt, "ready": ready]
    }
  }

  private let queue = DispatchQueue(label: "dev.ardia.projects")
  private var entries: [String: Entry] = [:]
  private var quitHooksInstalled = false

  static func standardized(_ path: String) -> String {
    URL(fileURLWithPath: (path as NSString).expandingTildeInPath).standardizedFileURL.resolvingSymlinksInPath().path
  }

  static func isDirectory(_ path: String) -> Bool {
    var directory: ObjCBool = false
    return FileManager.default.fileExists(atPath: path, isDirectory: &directory) && directory.boolValue
  }

  static func choose(path: String?, done: @escaping (String?) -> Void) {
    if let path, !path.isEmpty {
      let folder = standardized(path)
      return done(isDirectory(folder) ? folder : nil)
    }
    if background {
      NSLog("ArdiaProjects: background instance, not showing the project folder panel")
      return done(nil)
    }
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.allowsMultipleSelection = false
    panel.canCreateDirectories = false
    panel.prompt = "Open"
    panel.message = "Choose a project folder to run on localhost"
    panel.begin { response in
      done(response == .OK ? panel.url.map { standardized($0.path) } : nil)
    }
  }

  static func inspect(_ path: String) -> [String: Any]? {
    let folder = standardized(path)
    guard isDirectory(folder) else { return nil }
    let root = URL(fileURLWithPath: folder, isDirectory: true)
    let names = ((try? FileManager.default.contentsOfDirectory(atPath: folder)) ?? []).sorted().prefix(2000)
    var info: [String: Any] = ["path": folder, "name": root.lastPathComponent, "files": Array(names)]
    if let ikdev = try? String(contentsOf: root.appendingPathComponent(".ikdev"), encoding: .utf8) { info["ikdev"] = ikdev }
    if let package = try? String(contentsOf: root.appendingPathComponent("package.json"), encoding: .utf8) { info["packageJson"] = package }
    return info
  }

  func run(path rawPath: String, command: String, done: @escaping ([String: Any]) -> Void) {
    let path = Self.standardized(rawPath)
    queue.async {
      if let entry = self.entries[path], kill(entry.pid, 0) == 0 {
        if entry.ready { return done(entry.payload(reused: true)) }
        entry.waiters.append(done)
        return
      }
      guard Self.isDirectory(path) else { return done(Self.failure("That folder doesn't exist.", log: nil)) }
      let trimmed = command.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmed.isEmpty else { return done(Self.failure("No dev command to run.", log: nil)) }
      self.installQuitHooks()
      let taken = Set(self.entries.values.map(\.port))
      guard let port = Self.freePort(excluding: taken) else {
        return done(Self.failure("No free port between \(Self.firstPort) and \(Self.firstPort + Self.portSpan).", log: nil))
      }
      let name = URL(fileURLWithPath: path).lastPathComponent
      let log: String
      do {
        log = try Self.logPath(name: name, port: port)
      } catch {
        return done(Self.failure("Couldn't create the log file: \(error.localizedDescription)", log: nil))
      }
      let pid: pid_t
      do {
        pid = try Self.spawn(command: trimmed, in: path, port: port, log: log)
      } catch let error as SpawnError {
        return done(Self.failure(error.message, log: log))
      } catch {
        return done(Self.failure(error.localizedDescription, log: log))
      }
      let entry = Entry(path: path, name: name, command: trimmed, log: log, pid: pid, port: port)
      entry.waiters.append(done)
      self.entries[path] = entry
      let source = DispatchSource.makeProcessSource(identifier: pid, eventMask: .exit, queue: self.queue)
      source.setEventHandler { [weak self] in _ = self?.reap(entry) }
      entry.exitSource = source
      source.resume()
      self.awaitReady(entry, until: Date().addingTimeInterval(Self.startDeadline))
    }
  }

  private func awaitReady(_ entry: Entry, until deadline: Date) {
    guard entries[entry.path] === entry, !entry.ready else { return }
    let port = entry.port
    let pgid = entry.pid
    DispatchQueue.global(qos: .userInitiated).async {
      let found: Int? =
        Self.accepts(port: port) ? port : Self.portsInLog(entry.log).first { $0 != port && Self.accepts(port: $0) && Self.listenerGroup(port: $0) == pgid }
      self.queue.async {
        guard self.entries[entry.path] === entry, !entry.ready, !self.reap(entry) else { return }
        if let found {
          entry.port = found
          entry.ready = true
          let waiters = entry.waiters
          entry.waiters = []
          waiters.forEach { $0(entry.payload(reused: false)) }
          return
        }
        if Date() >= deadline {
          let tail = Self.tail(of: entry.log)
          self.terminate(entry)
          let waiters = entry.waiters
          entry.waiters = []
          waiters.forEach { $0(Self.failure("The dev server didn't open port \(port) within \(Int(Self.startDeadline)) seconds.", log: entry.log, tail: tail)) }
          return
        }
        self.queue.asyncAfter(deadline: .now() + Self.pollInterval) { self.awaitReady(entry, until: deadline) }
      }
    }
  }

  private func reap(_ entry: Entry) -> Bool {
    var status: Int32 = 0
    guard waitpid(entry.pid, &status, WNOHANG) == entry.pid else { return false }
    exited(entry, status: status)
    return true
  }

  private func exited(_ entry: Entry, status: Int32) {
    entry.exitSource?.cancel()
    entry.exitSource = nil
    kill(-entry.pid, SIGTERM)
    if entries[entry.path] === entry { entries[entry.path] = nil }
    guard !entry.waiters.isEmpty else { return }
    let waiters = entry.waiters
    entry.waiters = []
    let code = (status & 0x7f) == 0 ? "exited with code \((status >> 8) & 0xff)" : "was killed by signal \(status & 0x7f)"
    let tail = Self.tail(of: entry.log)
    waiters.forEach { $0(Self.failure("The dev server \(code) before it opened a port.", log: entry.log, tail: tail)) }
  }

  private func terminate(_ entry: Entry) {
    if entries[entry.path] === entry { entries[entry.path] = nil }
    let group = entry.pid
    kill(-group, SIGTERM)
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + Self.stopGrace) {
      if kill(-group, 0) == 0 { kill(-group, SIGKILL) }
    }
  }

  func stop(path rawPath: String, done: @escaping (Bool) -> Void) {
    let path = Self.standardized(rawPath)
    queue.async {
      guard let entry = self.entries[path] else { return done(false) }
      let waiters = entry.waiters
      entry.waiters = []
      self.terminate(entry)
      waiters.forEach { $0(Self.failure("Stopped.", log: entry.log)) }
      done(true)
    }
  }

  func running(done: @escaping ([[String: Any]]) -> Void) {
    queue.async {
      done(self.entries.values.sorted { $0.startedAt < $1.startedAt }.map(\.summary))
    }
  }

  func project(forPort port: Int, done: @escaping ([String: Any]?) -> Void) {
    queue.async {
      if let entry = self.entries.values.first(where: { $0.port == port }) {
        var info = Self.projectInfo(at: entry.path) ?? ["path": entry.path, "name": entry.name]
        info["port"] = port
        info["pid"] = Int(entry.pid)
        info["command"] = entry.command
        info["managed"] = true
        return done(info)
      }
      DispatchQueue.global(qos: .userInitiated).async {
        guard port > 0, port < 65536, let pid = Self.listenerPid(port: port), pid != getpid(),
          let cwd = Self.workingDirectory(of: pid), let root = Self.projectRoot(from: cwd),
          var info = Self.projectInfo(at: root)
        else { return done(nil) }
        info["port"] = port
        info["pid"] = Int(pid)
        info["managed"] = false
        done(info)
      }
    }
  }

  private func installQuitHooks() {
    guard !quitHooksInstalled else { return }
    quitHooksInstalled = true
    DispatchQueue.main.async {
      NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: nil) { _ in
        ProjectRunner.shared.stopAllNow()
      }
    }
    atexit { ProjectRunner.shared.stopAllNow() }
  }

  private let stopAllLock = NSLock()
  private var stoppedAll = false

  func stopAllNow() {
    stopAllLock.lock()
    defer { stopAllLock.unlock() }
    guard !stoppedAll else { return }
    stoppedAll = true
    let groups = queue.sync { () -> [pid_t] in
      let groups = entries.values.map(\.pid)
      entries.removeAll()
      return groups
    }
    guard !groups.isEmpty else { return }
    groups.forEach { kill(-$0, SIGTERM) }
    let deadline = Date().addingTimeInterval(1)
    while Date() < deadline, groups.contains(where: { kill(-$0, 0) == 0 }) { usleep(50_000) }
    groups.filter { kill(-$0, 0) == 0 }.forEach { kill(-$0, SIGKILL) }
  }

  private static func failure(_ message: String, log: String?, tail: String? = nil) -> [String: Any] {
    var result: [String: Any] = ["ok": false, "error": message]
    if let log { result["log"] = log }
    if let tail = tail ?? log.flatMap({ Self.tail(of: $0) }), !tail.isEmpty { result["logTail"] = tail }
    return result
  }

  private static func logPath(name: String, port: Int) throws -> String {
    let dir = try ShellModule.documentURL("projects").deletingLastPathComponent().appendingPathComponent("projects", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let safe = String(name.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" || $0 == "." ? $0 : "-" }).prefix(80)
    return dir.appendingPathComponent("\(safe.isEmpty ? "project" : String(safe))-\(port).log").path
  }

  static func tail(of path: String) -> String {
    guard let handle = FileHandle(forReadingAtPath: path) else { return "" }
    defer { try? handle.close() }
    let size = (try? handle.seekToEnd()) ?? 0
    try? handle.seek(toOffset: size > UInt64(logTailBytes) ? size - UInt64(logTailBytes) : 0)
    let data = (try? handle.readToEnd()) ?? Data()
    return String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
  }

  static func portsInLog(_ path: String) -> [Int] {
    let text = tail(of: path)
    guard let regex = try? NSRegularExpression(pattern: #"https?://(?:localhost|127\.0\.0\.1|\[::1?\]|0\.0\.0\.0):(\d{2,5})"#) else { return [] }
    var ports: [Int] = []
    for match in regex.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
      guard let range = Range(match.range(at: 1), in: text), let port = Int(text[range]), port < 65536, !ports.contains(port) else { continue }
      ports.append(port)
    }
    return ports
  }

  struct SpawnError: Error { let message: String }

  private static let launcherScript =
    #"parent=$1; shift; ( while kill -0 $parent 2>/dev/null; do sleep 2; done; kill -TERM 0 ) & exec /bin/zsh -lc "$1""#

  private static func childEnvironment(port: Int) -> [String] {
    var env = ProcessInfo.processInfo.environment.filter { !$0.key.hasPrefix("ARDIA_") && !$0.key.hasPrefix("DYLD_") && !$0.key.hasPrefix("CHROME_") }
    env["PORT"] = String(port)
    env["IK_PORT"] = String(port)
    env["BROWSER"] = "none"
    if env["HOME"] == nil { env["HOME"] = NSHomeDirectory() }
    let inherited = (env["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin").split(separator: ":").map(String.init)
    var seen = Set<String>()
    env["PATH"] = (toolDirectories() + inherited).filter { seen.insert($0).inserted }.joined(separator: ":")
    return env.map { "\($0.key)=\($0.value)" }
  }

  private static func toolDirectories() -> [String] {
    let home = NSHomeDirectory()
    let fm = FileManager.default
    let nvm = (home as NSString).appendingPathComponent(".nvm/versions/node")
    let newestNode = ((try? fm.contentsOfDirectory(atPath: nvm)) ?? [])
      .filter { $0.hasPrefix("v") }
      .max { $0.compare($1, options: .numeric) == .orderedAscending }
      .map { "\(nvm)/\($0)/bin" }
    let candidates =
      [".local/bin", ".bun/bin", "Library/pnpm", ".volta/bin", ".deno/bin", ".cargo/bin", ".npm-global/bin"].map {
        (home as NSString).appendingPathComponent($0)
      } + [newestNode, "/opt/homebrew/bin", "/usr/local/bin"].compactMap { $0 }
    return candidates.filter { isDirectory($0) }
  }

  private static func spawn(command: String, in directory: String, port: Int, log: String) throws -> pid_t {
    var actions: posix_spawn_file_actions_t?
    var attributes: posix_spawnattr_t?
    posix_spawn_file_actions_init(&actions)
    posix_spawnattr_init(&attributes)
    defer {
      posix_spawn_file_actions_destroy(&actions)
      posix_spawnattr_destroy(&attributes)
    }
    posix_spawn_file_actions_addopen(&actions, 0, "/dev/null", O_RDONLY, 0)
    posix_spawn_file_actions_addopen(&actions, 1, log, O_WRONLY | O_CREAT | O_TRUNC, 0o644)
    posix_spawn_file_actions_adddup2(&actions, 1, 2)
    if posix_spawn_file_actions_addchdir_np(&actions, directory) != 0 {
      throw SpawnError(message: "Couldn't enter \(directory).")
    }
    var defaults = sigset_t()
    sigfillset(&defaults)
    var mask = sigset_t()
    sigemptyset(&mask)
    posix_spawnattr_setsigdefault(&attributes, &defaults)
    posix_spawnattr_setsigmask(&attributes, &mask)
    posix_spawnattr_setpgroup(&attributes, 0)
    posix_spawnattr_setflags(
      &attributes, Int16(POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_SETSIGDEF | POSIX_SPAWN_SETSIGMASK | POSIX_SPAWN_CLOEXEC_DEFAULT))
    let arguments = ["/bin/zsh", "-c", launcherScript, "ardia-project", String(getpid()), command]
    let environment = childEnvironment(port: port)
    var argv: [UnsafeMutablePointer<CChar>?] = arguments.map { strdup($0) } + [nil]
    var envp: [UnsafeMutablePointer<CChar>?] = environment.map { strdup($0) } + [nil]
    defer {
      argv.forEach { free($0) }
      envp.forEach { free($0) }
    }
    var pid: pid_t = 0
    let status = posix_spawn(&pid, "/bin/zsh", &actions, &attributes, &argv, &envp)
    guard status == 0 else { throw SpawnError(message: "Couldn't start the dev server: \(String(cString: strerror(status))).") }
    return pid
  }

  private static func canBind(port: Int, family: Int32) -> Bool {
    let fd = socket(family, SOCK_STREAM, 0)
    guard fd >= 0 else { return family == AF_INET6 }
    defer { close(fd) }
    if family == AF_INET6 {
      var on: Int32 = 1
      setsockopt(fd, IPPROTO_IPV6, IPV6_V6ONLY, &on, socklen_t(MemoryLayout<Int32>.size))
      var address = sockaddr_in6()
      address.sin6_len = UInt8(MemoryLayout<sockaddr_in6>.size)
      address.sin6_family = sa_family_t(AF_INET6)
      address.sin6_port = in_port_t(UInt16(port).bigEndian)
      address.sin6_addr = in6addr_any
      return withUnsafePointer(to: &address) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in6>.size)) == 0 }
      }
    }
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = in_port_t(UInt16(port).bigEndian)
    address.sin_addr = in_addr(s_addr: INADDR_ANY)
    return withUnsafePointer(to: &address) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0 }
    }
  }

  private static func connects(port: Int, family: Int32) -> Bool {
    let fd = socket(family, SOCK_STREAM, 0)
    guard fd >= 0 else { return false }
    defer { close(fd) }
    _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)
    let result: Int32
    if family == AF_INET6 {
      var address = sockaddr_in6()
      address.sin6_len = UInt8(MemoryLayout<sockaddr_in6>.size)
      address.sin6_family = sa_family_t(AF_INET6)
      address.sin6_port = in_port_t(UInt16(port).bigEndian)
      address.sin6_addr = in6addr_loopback
      result = withUnsafePointer(to: &address) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in6>.size)) }
      }
    } else {
      var address = sockaddr_in()
      address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
      address.sin_family = sa_family_t(AF_INET)
      address.sin_port = in_port_t(UInt16(port).bigEndian)
      address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
      result = withUnsafePointer(to: &address) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
      }
    }
    if result == 0 { return true }
    guard errno == EINPROGRESS else { return false }
    var poller = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
    guard Darwin.poll(&poller, 1, 300) == 1 else { return false }
    var error: Int32 = 0
    var length = socklen_t(MemoryLayout<Int32>.size)
    return getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &length) == 0 && error == 0
  }

  static func accepts(port: Int) -> Bool {
    connects(port: port, family: AF_INET) || connects(port: port, family: AF_INET6)
  }

  static func freePort(excluding taken: Set<Int>) -> Int? {
    (firstPort..<(firstPort + portSpan)).first { port in
      !taken.contains(port) && canBind(port: port, family: AF_INET) && canBind(port: port, family: AF_INET6) && !accepts(port: port)
    }
  }

  private static func output(of executable: String, _ arguments: [String], timeout: TimeInterval = 4) -> String? {
    let task = Process()
    task.executableURL = URL(fileURLWithPath: executable)
    task.arguments = arguments
    let pipe = Pipe()
    task.standardOutput = pipe
    task.standardError = FileHandle.nullDevice
    task.standardInput = FileHandle.nullDevice
    do { try task.run() } catch { return nil }
    let timer = DispatchWorkItem { if task.isRunning { task.terminate() } }
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + timeout, execute: timer)
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    task.waitUntilExit()
    timer.cancel()
    return String(decoding: data, as: UTF8.self)
  }

  private static func listenerPid(port: Int) -> pid_t? {
    guard let text = output(of: "/usr/sbin/lsof", ["-nP", "-iTCP:\(port)", "-sTCP:LISTEN", "-Fp"]) else { return nil }
    return text.split(separator: "\n").lazy.compactMap { $0.hasPrefix("p") ? pid_t($0.dropFirst()) : nil }.first
  }

  private static func listenerGroup(port: Int) -> pid_t? {
    guard let pid = listenerPid(port: port) else { return nil }
    let group = getpgid(pid)
    return group > 0 ? group : nil
  }

  private static func workingDirectory(of pid: pid_t) -> String? {
    guard let text = output(of: "/usr/sbin/lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]) else { return nil }
    return text.split(separator: "\n").lazy.compactMap { $0.hasPrefix("n") ? String($0.dropFirst()) : nil }.first
  }

  static func projectRoot(from directory: String) -> String? {
    var url = URL(fileURLWithPath: directory, isDirectory: true).standardizedFileURL
    let stops: Set<String> = ["/", NSHomeDirectory(), "/Users", "/private", "/private/tmp", "/tmp", "/Volumes"]
    while !stops.contains(url.path) {
      let fm = FileManager.default
      if fm.fileExists(atPath: url.appendingPathComponent(".git").path) || fm.fileExists(atPath: url.appendingPathComponent("package.json").path) {
        return url.path
      }
      let parent = url.deletingLastPathComponent()
      if parent.path == url.path { return nil }
      url = parent
    }
    return nil
  }

  static func gitRoot(from directory: String) -> String? {
    var url = URL(fileURLWithPath: directory, isDirectory: true).standardizedFileURL
    while url.path != "/" {
      if FileManager.default.fileExists(atPath: url.appendingPathComponent(".git").path) { return url.path }
      url = url.deletingLastPathComponent()
    }
    return nil
  }

  static func gitBranch(root: String) -> String? {
    let dotGit = URL(fileURLWithPath: root).appendingPathComponent(".git")
    var gitDir = dotGit
    if !isDirectory(dotGit.path) {
      guard let pointer = try? String(contentsOf: dotGit, encoding: .utf8),
        let line = pointer.split(separator: "\n").first(where: { $0.hasPrefix("gitdir:") })
      else { return nil }
      let target = line.dropFirst("gitdir:".count).trimmingCharacters(in: .whitespaces)
      gitDir = target.hasPrefix("/") ? URL(fileURLWithPath: target) : URL(fileURLWithPath: root).appendingPathComponent(target)
    }
    guard let head = try? String(contentsOf: gitDir.appendingPathComponent("HEAD"), encoding: .utf8) else { return nil }
    let value = head.trimmingCharacters(in: .whitespacesAndNewlines)
    if value.hasPrefix("ref:") {
      let ref = value.dropFirst(4).trimmingCharacters(in: .whitespaces)
      return ref.hasPrefix("refs/heads/") ? String(ref.dropFirst("refs/heads/".count)) : ref
    }
    return value.isEmpty ? nil : String(value.prefix(7))
  }

  static func projectInfo(at path: String) -> [String: Any]? {
    guard isDirectory(path) else { return nil }
    var info: [String: Any] = ["path": path, "name": URL(fileURLWithPath: path).lastPathComponent]
    if let root = gitRoot(from: path) {
      info["gitRoot"] = root
      if let branch = gitBranch(root: root) { info["branch"] = branch }
    }
    return info
  }
}
