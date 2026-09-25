import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getPhraseVerdicts, listSearchPhrases } from "@/lib/services/search-phrases";
import { phraseWatchability } from "@/lib/services/phrase-watches";
import { PhrasesView } from "@/components/phrases/phrases-view";

export const metadata: Metadata = { title: "Search Phrases" };

export default async function SearchPhrasesPage() {
  const ctx = await requireAuth();
  const [phrases, verdicts, watchability] = await Promise.all([
    listSearchPhrases(ctx),
    getPhraseVerdicts(ctx),
    phraseWatchability(ctx),
  ]);

  return (
    <PhrasesView
      phrases={phrases}
      verdicts={verdicts}
      watchability={watchability}
    />
  );
}
