import Foundation

struct MeetingSummary {
    static func generate(customer: String, date: Date, transcript: String) -> String {
        let sentences = transcript
            .replacingOccurrences(of: "\n", with: " ")
            .components(separatedBy: CharacterSet(charactersIn: ".!?"))
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        func matching(_ words: [String], limit: Int = 8) -> [String] {
            Array(sentences.filter { sentence in
                let s = sentence.lowercased()
                return words.contains { s.contains($0) }
            }.prefix(limit))
        }

        let decisions = matching(["dohod", "potvrd", "rozhod", "platí", "schvál", "domluv"])
        let tasks = matching(["pošl", "zašl", "prověř", "ověř", "spočít", "dopočít", "připrav", "zajistí", "udělá", "úkol"])
        let risks = matching(["rizik", "problém", "čekáme", "není potvrzen", "dořešit", "otevřen"])
        let highlights = Array(sentences.filter { $0.count > 35 }.prefix(6))

        let df = DateFormatter()
        df.locale = Locale(identifier: "cs_CZ")
        df.dateStyle = .medium

        func bullets(_ items: [String], fallback: String) -> String {
            items.isEmpty ? "• \(fallback)" : items.map { "• \($0)" }.joined(separator: "\n")
        }

        return """
        ZÁPIS Z JEDNÁNÍ
        \(customer) | \(df.string(from: date))

        SHRNUTÍ
        \(bullets(highlights, fallback: "Doplňte hlavní závěr jednání."))

        DOHODNUTÁ ROZHODNUTÍ
        \(bullets(decisions, fallback: "Nebylo automaticky rozpoznáno jednoznačné rozhodnutí."))

        ÚKOLY A DALŠÍ KROKY
        \(bullets(tasks, fallback: "Nebyl automaticky rozpoznán konkrétní úkol."))

        OTEVŘENÉ BODY / RIZIKA
        \(bullets(risks, fallback: "Bez automaticky rozpoznaných otevřených bodů."))

        ---
        Vytvořeno pomocí HOPI Meeting Listener
        """
    }
}
