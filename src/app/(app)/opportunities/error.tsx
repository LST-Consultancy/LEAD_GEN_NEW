"use client";
export default function Error({ reset }: { reset(): void }) { return <div role="alert" className="space-y-3 p-6"><p>Opportunities could not be loaded. Check the database migration and retry.</p><button onClick={reset} className="rounded border border-border px-4 py-2">Retry</button></div>; }
