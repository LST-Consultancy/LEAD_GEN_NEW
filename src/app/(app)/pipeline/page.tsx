import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/context";
import { getPipelineBoard } from "@/lib/services/pipeline";
import { getCashSummary } from "@/lib/services/deal-money";
import { PipelineBoard, PipelineInsights, EmptyPipeline } from "@/components/pipeline/board";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage() {
  const ctx = await requireAuth();
  const [board, cash] = await Promise.all([getPipelineBoard(ctx), getCashSummary(ctx)]);

  if (!board) return <EmptyPipeline />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <PipelineBoard
          cash={cash}
          columns={board.columns}
          totals={board.totals}
          pipelineName={board.pipeline.name}
        />
      </div>
      <PipelineInsights columns={board.columns} />
    </div>
  );
}
