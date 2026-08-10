import SwiftUI
import MessageUI

struct ContentView: View {
    @StateObject private var speech = SpeechRecognizer()
    @State private var customer = "MINIT BOHEMIA"
    @State private var meetingDate = Date()
    @State private var recipient = ""
    @State private var summary = ""
    @State private var startedAt: Date?
    @State private var elapsed: TimeInterval = 0
    @State private var showingMail = false
    @State private var showingShare = false
    @State private var timer: Timer?

    private let hopiGreen = Color(red: 0.0, green: 0.51, blue: 0.24)

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    header
                    meetingForm
                    recorderCard
                    transcriptCard
                    summaryCard
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))
            .navigationBarHidden(true)
            .task { await speech.requestPermissions() }
            .onDisappear { stopTimer() }
            .sheet(isPresented: $showingMail) {
                MailComposer(
                    recipient: recipient,
                    subject: "Zápis z jednání – \(customer)",
                    body: summary
                )
            }
            .sheet(isPresented: $showingShare) {
                ShareSheet(items: [summary])
            }
            .alert("Chyba", isPresented: Binding(
                get: { speech.errorMessage != nil },
                set: { if !$0 { speech.errorMessage = nil } }
            )) {
                Button("OK", role: .cancel) { speech.errorMessage = nil }
            } message: {
                Text(speech.errorMessage ?? "")
            }
        }
    }

    private var header: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 14).fill(hopiGreen)
                Text("HOPI").font(.system(size: 27, weight: .black)).foregroundStyle(.white)
            }
            .frame(width: 92, height: 62)

            VStack(alignment: .leading, spacing: 4) {
                Text("Meeting Listener").font(.title2.bold())
                Text("Odposlech → přepis → zápis → e-mail")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
        }
    }

    private var meetingForm: some View {
        VStack(spacing: 12) {
            TextField("Zákazník / meeting", text: $customer)
                .textFieldStyle(.roundedBorder)
            DatePicker("Datum", selection: $meetingDate, displayedComponents: .date)
            TextField("Příjemce zápisu", text: $recipient)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .textFieldStyle(.roundedBorder)
        }
        .cardStyle()
    }

    private var recorderCard: some View {
        VStack(spacing: 16) {
            ZStack {
                Circle().fill(hopiGreen.opacity(0.12)).frame(width: 132, height: 132)
                Circle().fill(hopiGreen).frame(width: 104, height: 104)
                Image(systemName: speech.isRecording ? "waveform" : "mic.fill")
                    .font(.system(size: 42, weight: .bold)).foregroundStyle(.white)
            }

            Text(timeString(elapsed)).font(.system(size: 34, weight: .bold, design: .monospaced))

            Button {
                speech.isRecording ? stopRecording() : startRecording()
            } label: {
                Label(speech.isRecording ? "Ukončit odposlech" : "Spustit odposlech",
                      systemImage: speech.isRecording ? "stop.fill" : "play.fill")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .tint(speech.isRecording ? .red : hopiGreen)
        }
        .cardStyle()
    }

    private var transcriptCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Živý přepis").font(.headline)
                Spacer()
                if speech.isRecording { Label("LIVE", systemImage: "circle.fill").font(.caption.bold()).foregroundStyle(.red) }
            }

            Text(speech.transcript.isEmpty ? "Tady se bude zobrazovat průběžný přepis schůzky…" : speech.transcript)
                .foregroundStyle(speech.transcript.isEmpty ? .secondary : .primary)
                .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
                .padding(12)
                .background(Color(.secondarySystemGroupedBackground))
                .clipShape(RoundedRectangle(cornerRadius: 12))

            HStack {
                Button("Vymazat") { speech.clear(); summary = "" }
                Spacer()
                Text("\(wordCount) slov").font(.caption).foregroundStyle(.secondary)
            }
        }
        .cardStyle()
    }

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Zápis z jednání").font(.headline)

            TextEditor(text: $summary)
                .frame(minHeight: 260)
                .padding(6)
                .background(Color(.secondarySystemGroupedBackground))
                .clipShape(RoundedRectangle(cornerRadius: 12))

            Button {
                summary = MeetingSummary.generate(customer: customer, date: meetingDate, transcript: speech.transcript)
            } label: {
                Label("Vytvořit zápis", systemImage: "sparkles")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(hopiGreen)
            .disabled(speech.transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            HStack {
                Button { sendOrShare() } label: { Label("Odeslat e-mailem", systemImage: "envelope") }
                    .buttonStyle(.bordered)
                    .disabled(summary.isEmpty)

                Button { showingShare = true } label: { Label("Sdílet", systemImage: "square.and.arrow.up") }
                    .buttonStyle(.bordered)
                    .disabled(summary.isEmpty)
            }
        }
        .cardStyle()
    }

    private var wordCount: Int {
        speech.transcript.split(whereSeparator: { $0.isWhitespace }).count
    }

    private func startRecording() {
        do {
            try speech.start()
            startedAt = Date()
            timer?.invalidate()
            timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
                if let startedAt { elapsed = Date().timeIntervalSince(startedAt) }
            }
        } catch {
            speech.errorMessage = error.localizedDescription
        }
    }

    private func stopRecording() {
        speech.stop()
        stopTimer()
    }

    private func stopTimer() {
        timer?.invalidate(); timer = nil
    }

    private func sendOrShare() {
        if MFMailComposeViewController.canSendMail() { showingMail = true }
        else { showingShare = true }
    }

    private func timeString(_ interval: TimeInterval) -> String {
        let total = Int(interval)
        return String(format: "%02d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60)
    }
}

private extension View {
    func cardStyle() -> some View {
        self.padding(16)
            .background(Color(.systemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 18))
            .shadow(color: .black.opacity(0.04), radius: 8, y: 3)
    }
}

struct MailComposer: UIViewControllerRepresentable {
    let recipient: String
    let subject: String
    let body: String

    func makeUIViewController(context: Context) -> MFMailComposeViewController {
        let vc = MFMailComposeViewController()
        vc.mailComposeDelegate = context.coordinator
        if !recipient.isEmpty { vc.setToRecipients([recipient]) }
        vc.setSubject(subject)
        vc.setMessageBody(body, isHTML: false)
        return vc
    }

    func updateUIViewController(_ uiViewController: MFMailComposeViewController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, MFMailComposeViewControllerDelegate {
        func mailComposeController(_ controller: MFMailComposeViewController,
                                   didFinishWith result: MFMailComposeResult,
                                   error: Error?) {
            controller.dismiss(animated: true)
        }
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
