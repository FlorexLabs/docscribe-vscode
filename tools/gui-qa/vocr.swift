import Vision
import AppKit
import Foundation

// Usage: vocr <image.png> [--text-only]
// Output: JSON array [{text, x, y, w, h}] in image pixels, origin top-left.
// --text-only prints recognized strings one per line (for grep oracles).

var args = CommandLine.arguments.dropFirst()
var textOnly = false
args = args.filter {
  if $0 == "--text-only" { textOnly = true; return false }
  return true
}
guard let imgPath = args.first,
  let nsImage = NSImage(contentsOfFile: imgPath),
  let cgImage = nsImage.cgImage(forProposedRect: nil, context: nil, hints: nil)
else {
  fputs("vocr: cannot load image\n", stderr)
  exit(2)
}

let width = CGFloat(cgImage.width)
let height = CGFloat(cgImage.height)

struct Obs: Encodable {
  let text: String
  let x: Double
  let y: Double
  let w: Double
  let h: Double
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["en-US"]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
  try handler.perform([request])
} catch {
  fputs("vocr: \(error)\n", stderr)
  exit(3)
}

var out: [Obs] = []
for r in (request.results as? [VNRecognizedTextObservation]) ?? [] {
  guard let cand = r.topCandidates(1).first else { continue }
  let b = r.boundingBox
  out.append(
    Obs(
      text: cand.string,
      x: Double((b.minX * width).rounded()),
      y: Double(((1.0 - b.maxY) * height).rounded()),
      w: Double((b.width * width).rounded()),
      h: Double((b.height * height).rounded())
    ))
}

if textOnly {
  for o in out { print(o.text) }
} else {
  let data = try! JSONEncoder().encode(out)
  print(String(data: data, encoding: .utf8)!)
}
