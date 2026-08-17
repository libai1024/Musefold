#!/usr/bin/env swift

import AppKit
import Foundation

let fileManager = FileManager.default
let scriptURL = URL(fileURLWithPath: #filePath)
let projectRoot = scriptURL.deletingLastPathComponent().deletingLastPathComponent()
let sourceURL = projectRoot.appendingPathComponent("logo.png")
let assistantSourceURL = projectRoot.appendingPathComponent("logo-circle.png")
let resourcesURL = projectRoot.appendingPathComponent("resources", isDirectory: true)
let iconURL = resourcesURL.appendingPathComponent("icon.png")
let sourceIconURL = resourcesURL.appendingPathComponent("icon-source.png")
let assistantIconURL = projectRoot
  .appendingPathComponent("src", isDirectory: true)
  .appendingPathComponent("components", isDirectory: true)
  .appendingPathComponent("brand", isDirectory: true)
  .appendingPathComponent("musefold-assistant-avatar.png")

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data("error: \(message)\n".utf8))
  exit(1)
}

func run(_ executable: String, _ arguments: [String]) {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: executable)
  process.arguments = arguments
  do {
    try process.run()
    process.waitUntilExit()
  } catch {
    fail("could not run \(executable): \(error)")
  }
  guard process.terminationStatus == 0 else {
    fail("\(executable) exited with status \(process.terminationStatus)")
  }
}

guard let input = NSImage(contentsOf: sourceURL) else {
  fail("could not read \(sourceURL.path)")
}

guard let assistantInput = NSImage(contentsOf: assistantSourceURL) else {
  fail("could not read \(assistantSourceURL.path)")
}

func renderClippedPNG(
  input: NSImage,
  canvasPixels: Int,
  destination: NSRect,
  source: NSRect,
  cornerRadius: CGFloat
) -> Data {
  guard
    let bitmap = NSBitmapImageRep(
      bitmapDataPlanes: nil,
      pixelsWide: canvasPixels,
      pixelsHigh: canvasPixels,
      bitsPerSample: 8,
      samplesPerPixel: 4,
      hasAlpha: true,
      isPlanar: false,
      colorSpaceName: .deviceRGB,
      bitmapFormat: [],
      bytesPerRow: canvasPixels * 4,
      bitsPerPixel: 32
    ),
    let context = NSGraphicsContext(bitmapImageRep: bitmap)
  else {
    fail("could not create a \(canvasPixels)px image context")
  }

  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = context
  context.imageInterpolation = .high
  context.shouldAntialias = true
  NSColor.clear.setFill()
  NSRect(x: 0, y: 0, width: canvasPixels, height: canvasPixels).fill(using: .copy)
  NSBezierPath(roundedRect: destination, xRadius: cornerRadius, yRadius: cornerRadius).addClip()
  input.draw(
    in: destination,
    from: source,
    operation: .copy,
    fraction: 1,
    respectFlipped: false,
    hints: [.interpolation: NSImageInterpolation.high]
  )
  NSGraphicsContext.restoreGraphicsState()

  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    fail("could not encode \(canvasPixels)px PNG data")
  }
  return data
}

let canvasSize = NSSize(width: 1024, height: 1024)
guard
  let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: 1024,
    pixelsHigh: 1024,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bitmapFormat: [],
    bytesPerRow: 4096,
    bitsPerPixel: 32
  ),
  let context = NSGraphicsContext(bitmapImageRep: bitmap)
else {
  fail("could not create a 1024px image context")
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
context.imageInterpolation = .high
context.shouldAntialias = true
NSColor.clear.setFill()
NSRect(origin: .zero, size: canvasSize).fill(using: .copy)

// The supplied PNG contains a baked checkerboard outside the icon. Crop to the
// rounded-square artwork and clip its corners so only the intended icon remains.
let destination = NSRect(x: 68, y: 68, width: 888, height: 888)
let source = NSRect(x: 279, y: 291, width: 697, height: 724)
NSGraphicsContext.saveGraphicsState()
NSBezierPath(roundedRect: destination, xRadius: 210, yRadius: 210).addClip()
input.draw(
  in: destination,
  from: source,
  operation: .copy,
  fraction: 1,
  respectFlipped: false,
  hints: [.interpolation: NSImageInterpolation.high]
)
NSGraphicsContext.restoreGraphicsState()
NSGraphicsContext.restoreGraphicsState()

guard let masterData = bitmap.representation(using: .png, properties: [:]) else {
  fail("could not encode PNG data")
}

let assistantData = renderClippedPNG(
  input: assistantInput,
  canvasPixels: 256,
  destination: NSRect(x: 0, y: 0, width: 256, height: 256),
  source: NSRect(x: 136, y: 150, width: 984, height: 984),
  cornerRadius: 128
)
do {
  try masterData.write(to: sourceIconURL, options: .atomic)
  try masterData.write(to: iconURL, options: .atomic)
  try assistantData.write(to: assistantIconURL, options: .atomic)
} catch {
  fail("could not write master icons: \(error)")
}

let temporaryRoot = fileManager.temporaryDirectory
  .appendingPathComponent("musefold-app-icon-\(UUID().uuidString)", isDirectory: true)
let iconsetURL = temporaryRoot.appendingPathComponent("Musefold.iconset", isDirectory: true)
do {
  try fileManager.createDirectory(at: iconsetURL, withIntermediateDirectories: true)
} catch {
  fail("could not create temporary iconset: \(error)")
}
defer { try? fileManager.removeItem(at: temporaryRoot) }

let iconsetSizes: [(name: String, pixels: Int)] = [
  ("icon_16x16.png", 16),
  ("icon_16x16@2x.png", 32),
  ("icon_32x32.png", 32),
  ("icon_32x32@2x.png", 64),
  ("icon_128x128.png", 128),
  ("icon_128x128@2x.png", 256),
  ("icon_256x256.png", 256),
  ("icon_256x256@2x.png", 512),
  ("icon_512x512.png", 512),
  ("icon_512x512@2x.png", 1024),
]

for item in iconsetSizes {
  let target = iconsetURL.appendingPathComponent(item.name)
  run("/usr/bin/sips", [
    "-z", String(item.pixels), String(item.pixels),
    iconURL.path,
    "--out", target.path,
  ])
}

run("/usr/bin/iconutil", [
  "-c", "icns",
  iconsetURL.path,
  "-o", resourcesURL.appendingPathComponent("icon.icns").path,
])

let icoSizes = [16, 24, 32, 48, 64, 128, 256]
let icoImages: [(size: Int, data: Data)] = icoSizes.map { size in
  let target = temporaryRoot.appendingPathComponent("icon-\(size).png")
  run("/usr/bin/sips", [
    "-z", String(size), String(size),
    iconURL.path,
    "--out", target.path,
  ])
  guard let data = try? Data(contentsOf: target) else {
    fail("could not read generated \(size)px icon")
  }
  return (size, data)
}

func appendUInt16LE(_ value: UInt16, to data: inout Data) {
  data.append(UInt8(value & 0xff))
  data.append(UInt8((value >> 8) & 0xff))
}

func appendUInt32LE(_ value: UInt32, to data: inout Data) {
  data.append(UInt8(value & 0xff))
  data.append(UInt8((value >> 8) & 0xff))
  data.append(UInt8((value >> 16) & 0xff))
  data.append(UInt8((value >> 24) & 0xff))
}

var ico = Data()
appendUInt16LE(0, to: &ico)
appendUInt16LE(1, to: &ico)
appendUInt16LE(UInt16(icoImages.count), to: &ico)

var imageOffset = UInt32(6 + icoImages.count * 16)
for image in icoImages {
  let dimension = image.size == 256 ? 0 : UInt8(image.size)
  ico.append(dimension)
  ico.append(dimension)
  ico.append(0)
  ico.append(0)
  appendUInt16LE(1, to: &ico)
  appendUInt16LE(32, to: &ico)
  appendUInt32LE(UInt32(image.data.count), to: &ico)
  appendUInt32LE(imageOffset, to: &ico)
  imageOffset += UInt32(image.data.count)
}
for image in icoImages {
  ico.append(image.data)
}

do {
  try ico.write(to: resourcesURL.appendingPathComponent("icon.ico"), options: .atomic)
} catch {
  fail("could not write Windows icon: \(error)")
}

print("Generated Musefold app icons and assistant avatar from logo.png and logo-circle.png")
