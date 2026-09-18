import AppKit
import SwiftUI
import ObjectiveC

@available(macOS 26.0, *)
private struct GlassSurface: View {
    let frost: Double
    @Environment(\.accessibilityReduceTransparency) private var reduced
    var body: some View {
        ZStack {
            if reduced { Color(nsColor: .windowBackgroundColor) }
            else {
                Color.clear.glassEffect(.clear, in: .rect)
                Rectangle().fill(.regularMaterial).opacity(frost)
                // Background density is independent of the WebUI component surfaces.
                Color.white.opacity(frost)
            }
        }.ignoresSafeArea().preferredColorScheme(.light).allowsHitTesting(false)
    }
}
@available(macOS 26.0, *)
private final class GlassHost: NSHostingView<GlassSurface> {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
private var hostKey: UInt8 = 0

// Called exclusively on Electron's main thread with its own NSView handle.
@_cdecl("betterlearn_set_glass")
public func setGlass(_ pointer: UnsafeMutableRawPointer?, _ frost: Double) -> Int32 {
    guard Thread.isMainThread, let pointer, frost.isFinite else { return 0 }
    guard #available(macOS 26.0, *) else { return 0 }
    let native = Unmanaged<NSView>.fromOpaque(pointer).takeUnretainedValue()
    guard let window = native.window, let content = window.contentView else { return 0 }
    let surface = GlassSurface(frost: max(0, min(1, frost / 100)))
    if let host = objc_getAssociatedObject(content, &hostKey) as? GlassHost {
        host.rootView = surface
    } else {
        let host = GlassHost(rootView: surface)
        host.sizingOptions = []
        host.frame = content.bounds
        host.autoresizingMask = [.width, .height]
        content.addSubview(host, positioned: .below, relativeTo: content.subviews.first)
        objc_setAssociatedObject(content, &hostKey, host, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    }
    window.isOpaque = false
    window.backgroundColor = .clear
    return 1
}
